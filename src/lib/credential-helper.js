/**
 * Credential Helper
 *
 * Shared utility functions for retrieving credentials via the credential broker.
 * Backend selection (ChittyServ vs chittysecrets) is controlled by env.CREDENTIAL_BROKER_TYPE.
 *
 * Resolution tiers, in order:
 *   1. Credential broker (ChittySecrets — the cold source of truth)
 *   2. Worker binding / managed secret (the hot tier of the sanctioned
 *      ChittySecrets -> Cloudflare Secrets Store -> call-site chain)
 *
 * Reading tier 2 is NOT a policy violation — it is the delivery path the
 * secret-env model prescribes. What the contract requires is that falling
 * through be *observable*, and that the two failure classes stay distinct:
 *
 *   broker unreachable        -> POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE
 *   absent in every authority -> MISSING_CREDENTIAL_MATERIAL
 *
 * Only MISSING_CREDENTIAL_MATERIAL may request operator provisioning.
 * See chittyos/chittyconnect#303.
 *
 * @module lib/credential-helper
 */

import { createCredentialBroker } from "./credential-broker.js";

// Singleton broker per env object (Worker lifetime)
const brokerCache = new WeakMap();

function getBroker(env) {
  if (!brokerCache.has(env)) {
    brokerCache.set(env, createCredentialBroker(env));
  }
  return brokerCache.get(env);
}

/** Canonical credential error classes (sensitive-intent contract §4). */
export const CREDENTIAL_ERROR_CLASS = {
  BROKER_UNAVAILABLE: "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
  MISSING_MATERIAL: "MISSING_CREDENTIAL_MATERIAL",
};

/**
 * Read a value that may be a Cloudflare Secrets Store binding.
 *
 * A `secrets_store_secrets` binding is an object exposing async `.get()`, not a
 * string. Returning it raw yields "[object Object]" in an Authorization header.
 *
 * @param {unknown} value
 * @returns {Promise<string|undefined>}
 */
export async function resolveBindingValue(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value.get === "function") {
    const resolved = await value.get();
    // Mirrors cloudflare-secrets-client.js resolveBinding: a .get() that yields
    // a non-string is NOT a credential. Returning it truthy is how an object
    // reaches an Authorization header as "[object Object]".
    return typeof resolved === "string" && resolved.length > 0
      ? resolved
      : undefined;
  }
  return undefined;
}

/**
 * resolveBindingValue that cannot throw.
 *
 * A Secrets Store binding whose .get() rejects — store unreachable, entry
 * deleted — must not take down a multi-candidate chain. This is the PR #277
 * rule applied at the hot tier: one broken candidate must not hide a working
 * one. cloudflare-secrets-client.js guards every candidate in its own loop for
 * exactly this reason; the helper has to do the same.
 *
 * @param {unknown} value
 * @param {object} context - for the failure event; never carries a value
 * @returns {Promise<string|undefined>}
 */
async function resolveBindingSafely(value, context, state) {
  try {
    return await resolveBindingValue(value);
  } catch (error) {
    // A binding that FAILS is an availability problem, not an absence. Leaving
    // this unrecorded classified a Secrets Store outage as
    // MISSING_CREDENTIAL_MATERIAL — telling an operator to provision a
    // credential that already exists.
    if (state) state.bindingFailed = true;
    emitCredentialEvent({
      ...context,
      tier: "binding",
      outcome: "binding_error",
      reason: error?.message ?? "binding resolution failed",
    });
    return undefined;
  }
}

/**
 * Emit a structured, greppable credential-resolution event.
 *
 * Never carries the credential value — only which tier served it, or which
 * canonical class explains the miss.
 */
function emitCredentialEvent(event) {
  console.warn(`[credential] ${JSON.stringify(event)}`);
}

/**
 * Resolve a credential and report how it was resolved.
 *
 * Prefer this over getCredential() when the caller needs to distinguish
 * "retry later" from "escalate to an operator".
 *
 * @param {object} env - Worker environment bindings
 * @param {string} credentialPath - Vault path (e.g., 'integrations/notion/api_key')
 * @param {string} fallbackEnvVar - Binding / managed-secret name for the hot tier
 * @param {string} [logPrefix] - Optional prefix for log messages
 * @returns {Promise<{value: string|undefined, source: string, errorClass: string|null}>}
 */
export async function getCredentialResult(
  env,
  credentialPath,
  fallbackEnvVar,
  logPrefix = "Credential",
  options = {},
) {
  // `candidate: true` marks one attempt in a multi-candidate chain, where a miss
  // is routine and expected. Those must NOT emit the escalation event — four
  // MISSING_CREDENTIAL_MATERIAL warnings per ordinary getMintAuthToken() call
  // makes the one class that may request operator provisioning unalertable.
  const { candidate = false } = options;
  const base = { service: logPrefix, path: credentialPath };

  // A malformed path is a caller bug, not a policy condition. Reporting it as
  // POLICY_BLOCKED_* invites an infinite retry instead of surfacing the defect.
  if (typeof credentialPath !== "string" || credentialPath.length === 0) {
    emitCredentialEvent({
      ...base,
      tier: "none",
      outcome: "invalid_request",
      reason: "credentialPath must be a non-empty string",
    });
    return { value: undefined, source: "none", errorClass: null };
  }

  let brokerUnavailable = false;

  try {
    const broker = getBroker(env);
    const credential = await resolveBindingValue(
      await broker.get(credentialPath),
    );
    if (credential) {
      return { value: credential, source: "broker", errorClass: null };
    }
  } catch (error) {
    // A broker that cannot find the credential is NOT a broker that is down.
    // Every client tags a clean miss with code CREDENTIAL_NOT_FOUND; anything
    // else (transport, auth, timeout) is a real unavailability.
    const isMiss = error?.code === "CREDENTIAL_NOT_FOUND";
    brokerUnavailable = !isMiss;

    if (!isMiss) {
      emitCredentialEvent({
        ...base,
        tier: "broker",
        outcome: "unavailable",
        errorClass: CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE,
        reason: error.message,
      });
    }
  }

  // Hot tier: Worker binding or managed secret. Guarded — a rejecting binding
  // must not escape and kill the caller's remaining candidates (PR #277).
  const hotState = { bindingFailed: false };
  const hot = await resolveBindingSafely(
    env[fallbackEnvVar],
    { ...base, binding: fallbackEnvVar },
    hotState,
  );
  if (hot) {
    if (!candidate) {
      emitCredentialEvent({
        ...base,
        tier: "binding",
        binding: fallbackEnvVar,
        outcome: "served",
        brokerUnavailable,
      });
    }
    return { value: hot, source: "binding", errorClass: null };
  }

  // Absent from every authority. This is the one class permitted to request
  // operator provisioning — do not collapse it into broker-unavailable.
  const errorClass = brokerUnavailable || hotState.bindingFailed
    ? CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE
    : CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL;

  if (!candidate) {
    emitCredentialEvent({
      ...base,
      tier: "none",
      binding: fallbackEnvVar,
      outcome: "unresolved",
      errorClass,
    });
  }

  return { value: undefined, source: "none", errorClass };
}

/**
 * Get credential via broker, falling through to the managed binding.
 *
 * Returns undefined rather than throwing, so multi-candidate `a || b || c`
 * resolution keeps working — a throw here would let the first broken candidate
 * hide every working one after it (see PR #277).
 *
 * @param {object} env - Worker environment bindings
 * @param {string} credentialPath - Vault path (e.g., 'integrations/notion/api_key')
 * @param {string} fallbackEnvVar - Binding / managed-secret name for the hot tier
 * @param {string} [logPrefix] - Optional prefix for log messages
 * @returns {Promise<string|undefined>} Credential value or undefined
 */
export async function getCredential(
  env,
  credentialPath,
  fallbackEnvVar,
  logPrefix = "Credential",
  options = {},
) {
  const { value } = await getCredentialResult(
    env,
    credentialPath,
    fallbackEnvVar,
    logPrefix,
    options,
  );
  return value;
}

/**
 * Get service token via broker with fallback
 *
 * @param {object} env - Worker environment bindings
 * @param {string} serviceName - Service name (e.g., 'chittyid', 'chittyauth')
 * @returns {Promise<string|undefined>} Service token or undefined
 */
export async function getServiceToken(env, serviceName) {
  const normalized = serviceName.toUpperCase().replace("CHITTY", "");
  const authIssuedEnvVar = `CHITTYAUTH_ISSUED_${normalized}_TOKEN`;
  const legacyEnvVar = `CHITTY_${normalized}_TOKEN`;

  // Prefer ChittyAuth-issued token naming across all services.
  // resolveBindingValue: these names are Secrets Store bindings in production,
  // so env[name] is an object with .get(), not a string.
  const authIssued = await resolveBindingSafely(env[authIssuedEnvVar], {
    service: serviceName,
    binding: authIssuedEnvVar,
  });
  if (authIssued) {
    return authIssued;
  }

  // Transitional aliases (service-specific).
  if (normalized === "MINT") {
    for (const aliasName of [
      "CHITTYAUTH_ISSUED_MINT_API_KEY",
      "CHITTYAUTH_ISSUED_MINT_TOKEN",
      "MINT_API_KEY",
    ]) {
      const value = await resolveBindingSafely(env[aliasName], {
        service: serviceName,
        binding: aliasName,
      });
      if (value) return value;
    }
  }

  return getCredential(
    env,
    `services/${serviceName}/service_token`,
    legacyEnvVar,
    serviceName,
  );
}

/**
 * Resolve auth credential used for ChittyMint API calls.
 *
 * Policy:
 * 1) Prefer ChittyAuth-issued mint token
 * 2) Fall back to service token for chittymint
 * 3) Last resort legacy webhook secret (deprecated for API auth)
 */
export async function getMintAuthToken(env) {
  const authIssued =
    (await resolveBindingSafely(env.CHITTYAUTH_ISSUED_MINT_API_KEY, {
      service: "chittymint",
      binding: "CHITTYAUTH_ISSUED_MINT_API_KEY",
    })) ||
    (await resolveBindingSafely(env.CHITTYAUTH_ISSUED_MINT_TOKEN, {
      service: "chittymint",
      binding: "CHITTYAUTH_ISSUED_MINT_TOKEN",
    })) ||
    (await resolveBindingSafely(env.MINT_API_KEY, {
      service: "chittymint",
      binding: "MINT_API_KEY",
    })) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "CHITTYAUTH_ISSUED_MINT_API_KEY",
      "chittymint",
      { candidate: true },
    ) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "CHITTYAUTH_ISSUED_MINT_TOKEN",
      "chittymint",
      { candidate: true },
    ) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "MINT_API_KEY",
      "chittymint",
      { candidate: true },
    );

  if (authIssued) {
    return { token: authIssued, source: "auth-issued" };
  }

  const serviceToken = await getServiceToken(env, "chittymint");
  if (serviceToken) {
    return { token: serviceToken, source: "service-token-fallback" };
  }

  const legacySecret = await resolveBindingSafely(env.CHITTYMINT_SECRET, {
    service: "chittymint",
    binding: "CHITTYMINT_SECRET",
  });
  if (legacySecret) {
    return { token: legacySecret, source: "legacy-webhook-secret" };
  }

  return { token: undefined, source: "none" };
}
