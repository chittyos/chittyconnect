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
  const tokenEnvVar = `CHITTY_${serviceName.toUpperCase().replace("CHITTY", "")}_TOKEN`;
  return getCredential(
    env,
    `services/${serviceName}/service_token`,
    tokenEnvVar,
    serviceName,
  );
}
