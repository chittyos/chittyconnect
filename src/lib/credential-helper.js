/**
 * Credential Helper
 *
 * Shared utility functions for retrieving credentials from 1Password Connect
 * with automatic failover to environment variables.
 *
 * @module lib/credential-helper
 */

import { OnePasswordConnectClient } from '../services/1password-connect-client.js';

/**
 * Get credential with 1Password Connect fallback to environment variable
 *
 * @param {object} env - Worker environment bindings
 * @param {string} credentialPath - 1Password vault path (e.g., 'integrations/notion/api_key')
 * @param {string} fallbackEnvVar - Environment variable name for fallback
 * @param {string} [logPrefix] - Optional prefix for log messages
 * @returns {Promise<string|undefined>} Credential value or undefined
 */
export async function getCredential(env, credentialPath, fallbackEnvVar, logPrefix = 'Credential') {
  try {
    const opClient = new OnePasswordConnectClient(env);
    const credential = await opClient.get(credentialPath);
    if (credential) {
      return credential;
    }
  } catch (error) {
    console.warn(`[${logPrefix}] 1Password retrieval failed for ${credentialPath}, using fallback:`, error.message);
  }

  // Fallback to environment variable
  return env[fallbackEnvVar];
}

/**
 * Get service token with 1Password Connect fallback
 *
 * @param {object} env - Worker environment bindings
 * @param {string} serviceName - Service name (e.g., 'chittyid', 'chittyauth')
 * @returns {Promise<string|undefined>} Service token or undefined
 */
export async function getServiceToken(env, serviceName) {
  const tokenEnvVar = `CHITTY_${serviceName.toUpperCase().replace('CHITTY', '')}_TOKEN`;
  return getCredential(
    env,
    `services/${serviceName}/service_token`,
    tokenEnvVar,
    serviceName
  );
}
