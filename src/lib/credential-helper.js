/**
 * Credential Helper
 *
 * Shared utility functions for retrieving credentials via the credential broker.
 * Backend selection (ChittyServ vs 1Password) is controlled by env.CREDENTIAL_BROKER_TYPE.
 * Falls back to environment variables if the broker is unavailable.
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

/**
 * Get credential via broker with fallback to environment variable
 *
 * @param {object} env - Worker environment bindings
 * @param {string} credentialPath - Vault path (e.g., 'integrations/notion/api_key')
 * @param {string} fallbackEnvVar - Environment variable name for fallback
 * @param {string} [logPrefix] - Optional prefix for log messages
 * @returns {Promise<string|undefined>} Credential value or undefined
 */
export async function getCredential(
  env,
  credentialPath,
  fallbackEnvVar,
  logPrefix = "Credential",
) {
  try {
    const broker = getBroker(env);
    const credential = await broker.get(credentialPath);
    if (credential) {
      return credential;
    }
  } catch (error) {
    console.warn(
      `[${logPrefix}] Broker retrieval failed for ${credentialPath}, using fallback:`,
      error.message,
    );
  }

  // Fallback to environment variable
  return env[fallbackEnvVar];
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
  if (env[authIssuedEnvVar]) {
    return env[authIssuedEnvVar];
  }

  // Transitional aliases (service-specific).
  if (normalized === "MINT" && env.MINT_API_KEY) {
    return env.MINT_API_KEY;
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
    env.CHITTYAUTH_ISSUED_MINT_TOKEN ||
    env.MINT_API_KEY ||
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

  if (env.CHITTYMINT_SECRET) {
    return { token: env.CHITTYMINT_SECRET, source: "legacy-webhook-secret" };
  }

  return { token: undefined, source: "none" };
}
