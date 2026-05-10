/**
 * portal-propagator.js
 *
 * Server-side secret propagation for the ChittyConnect secrets portal.
 * Called atomically after the AES-GCM envelope is written to KV intake.
 *
 * Step order (each gated on its config being present):
 *   1. Write secret to 1Password Connect (cold SoT)
 *   2. Write secret to Cloudflare Secrets Store (runtime delivery)
 *   3. Log incident to ChittyChronicle
 *   4. Delete KV intake record (only when steps 1+2 both succeeded)
 *
 * Error classes follow system-wide-sensitive-intent-contract-v1.md §4.
 * Plaintext never appears in logs, error messages, or returned objects.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/portal-propagator
 */

/** @typedef {import("../types").PropagateResult} PropagateResult */

const CONTRACT_ERRORS = {
  MISSING_CREDENTIAL_MATERIAL: "MISSING_CREDENTIAL_MATERIAL",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  EXECUTION_FAILED_PROVIDER_ERROR: "EXECUTION_FAILED_PROVIDER_ERROR",
  POLICY_BLOCKED_DESTINATION_UNVERIFIED: "POLICY_BLOCKED_DESTINATION_UNVERIFIED",
};

/**
 * Propagate a secret to its downstream stores.
 *
 * @param {object} env - Worker environment bindings
 * @param {string} env.OP_CONNECT_WRITE_TOKEN - 1Password Connect JWT (write-scoped)
 * @param {string} env.ONEPASSWORD_CONNECT_URL - 1P Connect host
 * @param {string} env.OP_VAULT_ID_DEFAULT - Default 1P vault ID for portal secrets
 * @param {string} env.SECRETS_PORTAL_CF_API_TOKEN - CF API token (Secrets Store:Edit)
 * @param {string} env.CHITTYOS_ACCOUNT_ID - CF account ID (already a var)
 * @param {string} [env.SECRETS_PORTAL_CF_STORE_ID] - CF Secrets Store ID (falls back to wrangler.jsonc value)
 * @param {KVNamespace} env.CREDENTIAL_CACHE - KV namespace for intake envelopes
 * @param {string} [env.CHITTYCHRONICLE_SERVICE_URL] - Chronicle endpoint
 * @param {string} [env.CHITTY_CHRONICLE_TOKEN] - Chronicle service token
 * @param {object} envelope - The KV envelope (no decrypted value inside)
 * @param {string} envelope.requestId
 * @param {string} envelope.path - Hint for secret name/path
 * @param {string} envelope.instructions
 * @param {string} envelope.updatedAt
 * @param {string} envelope.requestedBy
 * @param {object} envelope.context
 * @param {string} decryptedValue - The plaintext secret value (NEVER log or echo)
 * @returns {Promise<PropagateResult>}
 */
export async function propagateSecret(env, envelope, decryptedValue) {
  const configured1P = !!(env.OP_CONNECT_WRITE_TOKEN && env.ONEPASSWORD_CONNECT_URL && env.OP_VAULT_ID_DEFAULT);
  const configuredCF = !!(env.SECRETS_PORTAL_CF_API_TOKEN && env.CHITTYOS_ACCOUNT_ID);

  // Both configs absent → skip (encrypted-KV-only path continues)
  if (!configured1P && !configuredCF) {
    return { skipped: true, reason: "propagation not configured; KV envelope retained for internal consumer" };
  }

  const steps = {};
  let opItemId = null;
  let criticalFailure = null;

  // ── Step 1: Write to 1Password Connect ──────────────────────────────
  if (configured1P) {
    try {
      const secretName = _deriveSecretName(envelope);
      const opRes = await _write1PSecret(env, secretName, decryptedValue, envelope);
      if (opRes.ok) {
        opItemId = opRes.itemId;
        steps.onepassword = { ok: true, itemId: opItemId };
      } else if (opRes.errorClass === CONTRACT_ERRORS.INSUFFICIENT_SCOPE) {
        criticalFailure = { step: "onepassword", error: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
        steps.onepassword = { ok: false, error: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
      } else {
        criticalFailure = { step: "onepassword", error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
        steps.onepassword = { ok: false, error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
      }
    } catch (e) {
      console.error("[PortalPropagator] 1P write threw:", e?.message);
      criticalFailure = { step: "onepassword", error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
      steps.onepassword = { ok: false, error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
    }
  } else {
    steps.onepassword = { ok: false, skipped: true, reason: CONTRACT_ERRORS.MISSING_CREDENTIAL_MATERIAL };
  }

  // ── Step 2: Write to Cloudflare Secrets Store ────────────────────────
  if (configuredCF && !criticalFailure) {
    try {
      const secretName = _deriveSecretName(envelope);
      const cfRes = await _writeCFSecret(env, secretName, decryptedValue, envelope);
      if (cfRes.ok) {
        steps.cloudflare = { ok: true };
      } else if (cfRes.errorClass === CONTRACT_ERRORS.INSUFFICIENT_SCOPE) {
        criticalFailure = { step: "cloudflare", error: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
        steps.cloudflare = { ok: false, error: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
      } else {
        criticalFailure = { step: "cloudflare", error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
        steps.cloudflare = { ok: false, error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
      }
    } catch (e) {
      console.error("[PortalPropagator] CF write threw:", e?.message);
      criticalFailure = { step: "cloudflare", error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
      steps.cloudflare = { ok: false, error: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };
    }
  } else if (!configuredCF) {
    steps.cloudflare = { ok: false, skipped: true, reason: CONTRACT_ERRORS.MISSING_CREDENTIAL_MATERIAL };
  }

  // ── Step 3: Log to ChittyChronicle ──────────────────────────────────
  const allRequiredOk = _requiredStepsSucceeded(steps, configured1P, configuredCF);
  try {
    await _logChronicle(env, envelope, steps, allRequiredOk);
    steps.chronicle = { ok: true };
  } catch (e) {
    console.error("[PortalPropagator] Chronicle log threw:", e?.message);
    steps.chronicle = { ok: false, error: "chronicle_unavailable" };
    // Chronicle failure is non-fatal — proceed with KV cleanup decision
  }

  // ── Step 4: Delete KV intake record (only on full success) ───────────
  if (allRequiredOk && env.CREDENTIAL_CACHE) {
    try {
      await env.CREDENTIAL_CACHE.delete(`secret:intake:${envelope.requestId}`);
      steps.kvCleanup = { ok: true };
    } catch (e) {
      console.error("[PortalPropagator] KV delete threw:", e?.message);
      steps.kvCleanup = { ok: false, error: "kv_delete_failed" };
      // KV has 24h TTL; self-purges even if delete fails. Non-fatal.
    }
  } else {
    steps.kvCleanup = { ok: false, skipped: true, reason: "required step failed; KV retained for retry" };
  }

  if (criticalFailure) {
    return {
      ok: false,
      requestId: envelope.requestId,
      error: criticalFailure.error,
      failedStep: criticalFailure.step,
      steps,
    };
  }

  return { ok: true, requestId: envelope.requestId, steps };
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Derive a stable secret name from the envelope. Uses path if provided,
 * otherwise slugifies the instructions prefix.
 */
function _deriveSecretName(envelope) {
  if (envelope.path) {
    // Use the last segment of the path as the secret name key
    const parts = envelope.path.split("/");
    return parts[parts.length - 1].toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  }
  // Fallback: first 40 chars of instructions, upper-snaked
  return envelope.instructions.slice(0, 40).toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Create or update a secret item in 1Password Connect.
 * Uses PATCH (update) if a same-named item exists; POST (create) otherwise.
 */
async function _write1PSecret(env, secretName, value, envelope) {
  const base = env.ONEPASSWORD_CONNECT_URL.replace(/\/$/, "");
  const vaultId = envelope.context?.vaultId || env.OP_VAULT_ID_DEFAULT;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${env.OP_CONNECT_WRITE_TOKEN}`,
  };

  // Search for existing item by title
  const searchRes = await fetch(
    `${base}/v1/vaults/${vaultId}/items?filter=title eq "${encodeURIComponent(secretName)}"`,
    { headers },
  );
  if (searchRes.status === 403) return { ok: false, errorClass: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
  if (!searchRes.ok) return { ok: false, errorClass: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };

  const existing = await searchRes.json();
  const existingItem = Array.isArray(existing) ? existing[0] : null;

  const itemBody = {
    vault: { id: vaultId },
    title: secretName,
    category: "API_CREDENTIAL",
    tags: ["chittyconnect-portal", "managed"],
    fields: [
      {
        id: "credential",
        type: "CONCEALED",
        label: "value",
        value, // plaintext written to 1P — this is intentional (SoT)
      },
      {
        id: "meta_request_id",
        type: "STRING",
        label: "portal_request_id",
        value: envelope.requestId,
      },
      {
        id: "meta_by",
        type: "STRING",
        label: "requested_by",
        value: envelope.requestedBy,
      },
    ],
  };

  let res;
  if (existingItem) {
    res = await fetch(`${base}/v1/vaults/${vaultId}/items/${existingItem.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...itemBody, id: existingItem.id }),
    });
  } else {
    res = await fetch(`${base}/v1/vaults/${vaultId}/items`, {
      method: "POST",
      headers,
      body: JSON.stringify(itemBody),
    });
  }

  if (res.status === 403) return { ok: false, errorClass: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
  if (!res.ok) return { ok: false, errorClass: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };

  const created = await res.json();
  return { ok: true, itemId: created.id };
}

/**
 * Write a secret to the Cloudflare Secrets Store (fan-out to all bound workers).
 * API: POST /accounts/{acct}/secrets_store/stores/{store_id}/secrets
 * Body: array of { name, value, scopes, comment }
 */
async function _writeCFSecret(env, secretName, value, envelope) {
  const accountId = env.CHITTYOS_ACCOUNT_ID;
  // Prefer env override; fall back to the store ID from wrangler.jsonc
  const storeId = env.SECRETS_PORTAL_CF_STORE_ID || "e914522471964c3c8cf1e601770edcc3";
  const apiBase = (env.SECRETS_PORTAL_CF_API_BASE || "https://api.cloudflare.com").replace(/\/$/, "");

  const res = await fetch(
    `${apiBase}/client/v4/accounts/${accountId}/secrets_store/stores/${storeId}/secrets`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SECRETS_PORTAL_CF_API_TOKEN}`,
      },
      body: JSON.stringify([
        {
          name: secretName,
          value, // plaintext written to CF Secrets Store — intentional (runtime SoT)
          scopes: ["workers"],
          comment: `portal:${envelope.requestId} by:${envelope.requestedBy}`,
        },
      ]),
    },
  );

  if (res.status === 403) return { ok: false, errorClass: CONTRACT_ERRORS.INSUFFICIENT_SCOPE };
  if (!res.ok) return { ok: false, errorClass: CONTRACT_ERRORS.EXECUTION_FAILED_PROVIDER_ERROR };

  return { ok: true };
}

/**
 * Log the propagation incident to ChittyChronicle.
 * Never includes plaintext, IV, or ciphertext — only requestId and step status.
 */
async function _logChronicle(env, envelope, steps, success) {
  const url = env.CHITTYCHRONICLE_SERVICE_URL;
  const token = env.CHITTY_CHRONICLE_TOKEN;
  if (!url || !token) return; // Chronicle not wired — skip silently

  await fetch(`${url}/api/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      eventType: "secrets_portal_propagation",
      service: "chittyconnect",
      requestId: envelope.requestId,
      requestedBy: envelope.requestedBy,
      success,
      steps: _sanitizeSteps(steps),
      timestamp: new Date().toISOString(),
    }),
  });
}

/** Strip any accidental plaintext fields from step results before logging. */
function _sanitizeSteps(steps) {
  return JSON.parse(JSON.stringify(steps, (key, val) => {
    if (["value", "text", "plaintext", "secret", "token", "password", "credential"].includes(key.toLowerCase())) return "[REDACTED]";
    return val;
  }));
}

function _requiredStepsSucceeded(steps, configured1P, configuredCF) {
  if (configured1P && !steps.onepassword?.ok) return false;
  if (configuredCF && !steps.cloudflare?.ok) return false;
  return true;
}
