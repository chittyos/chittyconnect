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
  if (typeof value === "string") return value;
  if (typeof value.get === "function") {
    const resolved = await value.get();
    return resolved || undefined;
  }
  return undefined;
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
) {
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
    // CloudflareSecretsClient signals the former with code CREDENTIAL_NOT_FOUND;
    // anything else (transport, auth, timeout) is a real unavailability.
    const isMiss = error?.code === "CREDENTIAL_NOT_FOUND";
    brokerUnavailable = !isMiss;

    if (!isMiss) {
      emitCredentialEvent({
        service: logPrefix,
        path: credentialPath,
        tier: "broker",
        outcome: "unavailable",
        errorClass: CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE,
        reason: error.message,
      });
    }
  }

  // Hot tier: Worker binding or managed secret.
  const hot = await resolveBindingValue(env[fallbackEnvVar]);
  if (hot) {
    emitCredentialEvent({
      service: logPrefix,
      path: credentialPath,
      tier: "binding",
      binding: fallbackEnvVar,
      outcome: "served",
      brokerBypassed: brokerUnavailable,
    });
    return { value: hot, source: "binding", errorClass: null };
  }

  // Absent from every authority. This is the one class permitted to request
  // operator provisioning — do not collapse it into broker-unavailable.
  const errorClass = brokerUnavailable
    ? CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE
    : CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL;

  emitCredentialEvent({
    service: logPrefix,
    path: credentialPath,
    tier: "none",
    binding: fallbackEnvVar,
    outcome: "unresolved",
    errorClass,
  });

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
) {
  const { value } = await getCredentialResult(
    env,
    credentialPath,
    fallbackEnvVar,
    logPrefix,
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
  const authIssued = await resolveBindingValue(env[authIssuedEnvVar]);
  if (authIssued) {
    return authIssued;
  }

  // Transitional aliases (service-specific).
  if (normalized === "MINT") {
    for (const alias of [
      env.CHITTYAUTH_ISSUED_MINT_API_KEY,
      env.CHITTYAUTH_ISSUED_MINT_TOKEN,
      env.MINT_API_KEY,
    ]) {
      const value = await resolveBindingValue(alias);
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
    (await resolveBindingValue(env.CHITTYAUTH_ISSUED_MINT_API_KEY)) ||
    (await resolveBindingValue(env.CHITTYAUTH_ISSUED_MINT_TOKEN)) ||
    (await resolveBindingValue(env.MINT_API_KEY)) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "CHITTYAUTH_ISSUED_MINT_API_KEY",
      "chittymint",
    ) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "CHITTYAUTH_ISSUED_MINT_TOKEN",
      "chittymint",
    ) ||
    await getCredential(
      env,
      "services/chittymint/service_token",
      "MINT_API_KEY",
      "chittymint",
    );

  if (authIssued) {
    return { token: authIssued, source: "auth-issued" };
  }

  const serviceToken = await getServiceToken(env, "chittymint");
  if (serviceToken) {
    return { token: serviceToken, source: "service-token-fallback" };
  }

  const legacySecret = await resolveBindingValue(env.CHITTYMINT_SECRET);
  if (legacySecret) {
    return { token: legacySecret, source: "legacy-webhook-secret" };
  }

  return { token: undefined, source: "none" };
}
