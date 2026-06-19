/**
 * Credential Gate — Identity-Aware Proxy credential acquisition
 *
 * Wraps a single set of master credentials behind ChittyID accountability.
 * Flow:
 *   1. Agent presents ChittyID + requested tool action
 *   2. Intent is recorded to ChittyLedger
 *   3. Ledger proof is presented to MyChittyActor DO
 *   4. Actor releases scoped credentials ONLY if proof is verified
 *   5. Action + outcome are logged for full audit trail
 *
 * When no ChittyID is present in context, falls back to the legacy
 * per-service credential-helper flow so existing callers keep working.
 *
 * @module lib/credential-gate
 */

import { serviceFetch } from "./service-switch.js";
import { getServiceToken } from "./credential-helper.js";
import { getCloudflareApiCredentials } from "./cloudflare-api-helper.js";

/**
 * Map tool names to the credential service domain they require.
 * The Actor stores master keys keyed by these domains.
 */
const TOOL_CREDENTIAL_MAP = {
  // Identity / Mint
  chitty_id_mint: "mint",
  chitty_id_verify: "mint",
  chitty_id_resolve: "id",

  // Infrastructure
  cf_workers_list: "cloudflare",
  cf_workers_get: "cloudflare",
  cf_worker_deploy: "cloudflare",
  cf_kv_list: "cloudflare",
  cf_kv_read: "cloudflare",
  cf_kv_write: "cloudflare",
  cf_r2_list: "cloudflare",
  cf_r2_read: "cloudflare",
  cf_r2_write: "cloudflare",
  cf_d1_query: "cloudflare",

  // Third-party integrations
  notion_query: "notion",
  notion_page_create: "notion",
  notion_comments: "notion",
  neon_query: "neon",
  openai_chat: "openai",
  google_drive_list: "google",
  google_drive_read: "google",

  // Ledger (self-auth via service binding)
  chitty_ledger_record: "ledger",
  chitty_ledger_query: "ledger",
  chitty_ledger_verify: "ledger",

  // Context / Intelligence
  chitty_context_resolve: "context",
  chitty_context_sync: "context",

  // Finance
  mercury_accounts: "mercury",
  mercury_transactions: "mercury",
};

/**
 * Resolve the credential domain for a given tool.
 * Returns undefined for tools that don't need external credentials
 * (e.g. pure in-memory tools, health checks).
 */
export function getCredentialDomain(toolName) {
  return TOOL_CREDENTIAL_MAP[toolName];
}

/**
 * Record an intent to the ChittyLedger and return the proof.
 *
 * @param {object} env - Worker environment bindings
 * @param {string} chittyId - The acting ChittyID
 * @param {string} toolName - The tool being called
 * @param {string} credentialDomain - The credential domain requested
 * @param {object} args - Tool arguments (sanitized — no secrets)
 * @returns {Promise<{verified: boolean, proof_id: string, hash: string} | null>}
 */
async function recordLedgerIntent(
  env,
  chittyId,
  toolName,
  credentialDomain,
  args,
) {
  try {
    const response = await serviceFetch(env, "ledger", "/api/ledger", {
      method: "POST",
      body: JSON.stringify({
        record_type: "credential_gate",
        actor: chittyId,
        action: `tool:${toolName}`,
        credential_domain: credentialDomain,
        metadata: {
          tool: toolName,
          domain: credentialDomain,
          args_summary: summarizeArgs(args),
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[credential-gate] Ledger record failed (${response.status}): ${body.slice(0, 200)}`,
      );
      return null;
    }

    const data = await response.json();
    return {
      verified: true,
      proof_id: data.id || data.record_id || crypto.randomUUID(),
      hash: data.hash || data.chain_hash || "",
      recorded_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[credential-gate] Ledger intent recording failed:", err);
    return null;
  }
}

/**
 * Log the outcome of a gated credential action to ChittyChronicle.
 * Fire-and-forget — never blocks the response.
 */
async function logOutcome(env, chittyId, toolName, proofId, outcome) {
  try {
    const chronicleUrl = env.CHITTYCHRONICLE_SERVICE_URL;
    if (!chronicleUrl) return;

    await fetch(`${chronicleUrl}/api/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "credential_gate.executed",
        entityId: chittyId,
        data: {
          tool: toolName,
          proof_id: proofId,
          outcome,
          timestamp: new Date().toISOString(),
        },
      }),
    }).catch(() => {});
  } catch {
    // Fire-and-forget
  }
}

/**
 * Summarize tool arguments for ledger recording.
 * Strips any values that look like secrets, keeps structure.
 */
function summarizeArgs(args) {
  if (!args || typeof args !== "object") return {};
  const summary = {};
  for (const [key, value] of Object.entries(args)) {
    // Omit anything that smells like a credential
    if (/token|key|secret|password|credential/i.test(key)) {
      summary[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 200) {
      summary[key] = `${value.slice(0, 100)}… (${value.length} chars)`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Acquire credentials through the MyChittyActor identity gate.
 *
 * This is the core function. It:
 *   1. Records intent to the ledger
 *   2. Presents the proof to the Actor DO
 *   3. Returns scoped credentials for the requested domain
 *
 * @param {object} env - Worker environment bindings
 * @param {string} chittyId - The ChittyID of the caller
 * @param {string} toolName - The tool being called
 * @param {object} args - Tool arguments
 * @returns {Promise<{credentials: object|null, error: object|null, proofId: string|null}>}
 */
export async function acquireCredentialsViaActor(
  env,
  chittyId,
  toolName,
  args,
) {
  const domain = getCredentialDomain(toolName);

  if (!domain) {
    // Tool doesn't require external credentials — pass through
    return { credentials: null, error: null, proofId: null, domain: null };
  }

  // 1. Record intent to the ledger
  const proof = await recordLedgerIntent(env, chittyId, toolName, domain, args);

  if (!proof) {
    return {
      credentials: null,
      error: {
        content: [
          {
            type: "text",
            text: `Credential gate: Failed to record intent to ledger for ${toolName}. Action denied.`,
          },
        ],
        isError: true,
      },
      proofId: null,
      domain,
    };
  }

  // 2. Get the MyChittyActor DO stub for this ChittyID
  if (!env.MyChittyActor) {
    console.error("[credential-gate] MyChittyActor DO binding not available");
    return {
      credentials: null,
      error: {
        content: [
          {
            type: "text",
            text: "Credential gate: MyChittyActor binding not available. Cannot release credentials.",
          },
        ],
        isError: true,
      },
      proofId: proof.proof_id,
      domain,
    };
  }

  try {
    const actorId = env.MyChittyActor.idFromName(chittyId);
    const stub = env.MyChittyActor.get(actorId);

    // 3. Present proof to Actor — it will only release credentials if verified
    const masterKeys = await stub.getInjectedCredentials(proof);

    if (!masterKeys || Object.keys(masterKeys).length === 0) {
      return {
        credentials: null,
        error: {
          content: [
            {
              type: "text",
              text: `Credential gate: No master credentials provisioned for ChittyID ${chittyId}. Use the portal to configure credentials.`,
            },
          ],
          isError: true,
        },
        proofId: proof.proof_id,
        domain,
      };
    }

    // 4. Extract only the credentials for the requested domain
    const scopedCreds = masterKeys[domain] || null;

    if (!scopedCreds) {
      return {
        credentials: null,
        error: {
          content: [
            {
              type: "text",
              text: `Credential gate: No credentials configured for domain "${domain}" on ChittyID ${chittyId}. Available domains: ${Object.keys(masterKeys).join(", ") || "none"}.`,
            },
          ],
          isError: true,
        },
        proofId: proof.proof_id,
        domain,
      };
    }

    // Also record the actor's decision locally
    await stub
      .addDecision({
        type: "credential_release",
        tool: toolName,
        domain,
        proof_id: proof.proof_id,
        outcome: "granted",
      })
      .catch((err) => {
        console.warn(
          "[credential-gate] Failed to record decision:",
          err.message,
        );
      });

    // 5. Fire-and-forget outcome log
    logOutcome(env, chittyId, toolName, proof.proof_id, "granted");

    return {
      credentials: scopedCreds,
      error: null,
      proofId: proof.proof_id,
      domain,
    };
  } catch (err) {
    console.error("[credential-gate] Actor credential release failed:", err);

    logOutcome(
      env,
      chittyId,
      toolName,
      proof.proof_id,
      `denied:${err.message}`,
    );

    return {
      credentials: null,
      error: {
        content: [
          {
            type: "text",
            text: `Credential gate: Actor denied credential release — ${err.message}`,
          },
        ],
        isError: true,
      },
      proofId: proof.proof_id,
      domain,
    };
  }
}

/**
 * Wrap the existing requireServiceAuth with identity gating.
 *
 * If a ChittyID is present in context, routes through the Actor gate.
 * Otherwise falls back to the legacy per-service credential-helper flow.
 *
 * @param {object} env - Worker environment bindings
 * @param {string} serviceName - Service name for credential-helper
 * @param {string} displayName - Human-readable service name for errors
 * @param {object} gateContext - { chittyId, toolName, args }
 * @returns {Promise<{error: object|null, headers: object}>}
 */
export async function gatedServiceAuth(
  env,
  serviceName,
  displayName,
  gateContext = {},
) {
  const { chittyId, toolName, args } = gateContext;

  // If no ChittyID in context, use legacy path
  if (!chittyId) {
    let token;
    try {
      token = await getServiceToken(env, serviceName);
    } catch (err) {
      console.error(
        `[MCP] Service token retrieval failed for ${displayName}:`,
        err,
      );
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Authentication failed: Unable to retrieve service token for ${displayName} (${err.message})`,
            },
          ],
          isError: true,
        },
        headers: {},
      };
    }
    if (!token) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Authentication required: No service token available for ${displayName}`,
            },
          ],
          isError: true,
        },
        headers: {},
      };
    }
    return { error: null, headers: { Authorization: `Bearer ${token}` } };
  }

  // ChittyID present — route through the gate
  const { credentials, error, proofId } = await acquireCredentialsViaActor(
    env,
    chittyId,
    toolName || serviceName,
    args || {},
  );

  if (error) return { error, headers: {} };

  // The Actor returned scoped credentials for this domain.
  // Extract the service token from the credential object.
  const token =
    credentials?.token || credentials?.api_key || credentials?.bearer;

  if (!token) {
    return {
      error: {
        content: [
          {
            type: "text",
            text: `Credential gate: Credentials for ${displayName} missing 'token' or 'api_key' field. Check portal configuration.`,
          },
        ],
        isError: true,
      },
      headers: {},
    };
  }

  return {
    error: null,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-ChittyID-Proof": proofId,
    },
  };
}

/**
 * Wrap the existing requireCloudflareAuth with identity gating.
 *
 * @param {object} env - Worker environment bindings
 * @param {object} gateContext - { chittyId, toolName, args }
 * @returns {Promise<{error: object|null, apiToken?: string, accountId?: string}>}
 */
export async function gatedCloudflareAuth(env, gateContext = {}) {
  const { chittyId, toolName, args } = gateContext;

  // If no ChittyID in context, use legacy path
  if (!chittyId) {
    let apiToken, accountId;
    try {
      ({ apiToken, accountId } = await getCloudflareApiCredentials(env));
    } catch (err) {
      console.error("[MCP] Cloudflare credential retrieval failed:", err);
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Cloudflare auth failed: ${err.message}`,
            },
          ],
          isError: true,
        },
      };
    }
    if (!apiToken) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: "Cloudflare API token not configured",
            },
          ],
          isError: true,
        },
      };
    }
    if (!accountId) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: "Cloudflare account ID not configured (set CHITTYOS_ACCOUNT_ID)",
            },
          ],
          isError: true,
        },
      };
    }
    return { error: null, apiToken, accountId };
  }

  // ChittyID present — route through the gate
  const { credentials, error, proofId } = await acquireCredentialsViaActor(
    env,
    chittyId,
    toolName || "cloudflare",
    args || {},
  );

  if (error) return { error };

  const apiToken = credentials?.api_token || credentials?.token;
  const accountId = credentials?.account_id || env.CHITTYOS_ACCOUNT_ID;

  if (!apiToken) {
    return {
      error: {
        content: [
          {
            type: "text",
            text: "Credential gate: Cloudflare credentials missing 'api_token'. Check portal configuration.",
          },
        ],
        isError: true,
      },
    };
  }

  return { error: null, apiToken, accountId, proofId };
}
