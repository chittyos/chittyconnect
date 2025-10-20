/**
 * GitHub App authentication
 *
 * Implements:
 * - App JWT generation (RS256)
 * - Installation token exchange
 * - Token caching with TTL
 */

import * as jose from 'jose';

/**
 * Generate GitHub App JWT
 * @param {string} appId - GitHub App ID
 * @param {string} privateKeyPem - Private key in PEM format (PKCS#8)
 * @returns {Promise<string>} Signed JWT
 */
export async function generateAppJWT(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);

  // Import private key
  const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256');

  // Create JWT (valid for 9 minutes, GitHub max is 10)
  const jwt = await new jose.SignJWT({
    iat: now,
    exp: now + 540, // 9 minutes
    iss: appId
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey);

  return jwt;
}

/**
 * Exchange App JWT for installation access token
 * @param {number} installationId - Installation ID
 * @param {string} appJwt - App JWT
 * @returns {Promise<{token: string, expiresAt: string, permissions: object}>}
 */
export async function getInstallationToken(installationId, appJwt) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appJwt}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      }
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  return {
    token: data.token,
    expiresAt: data.expires_at,
    permissions: data.permissions,
    repositories: data.repositories
  };
}

/**
 * Get cached installation token or mint a new one
 * @param {object} env - Worker environment with TOKEN_KV, GITHUB_APP_ID, GITHUB_APP_PK
 * @param {number} installationId - Installation ID
 * @returns {Promise<string>} Installation access token
 */
export async function getCachedInstallationToken(env, installationId) {
  const cacheKey = `install:${installationId}`;

  // Check cache first
  const cached = await env.TOKEN_KV.get(cacheKey, { type: 'json' });
  if (cached) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Math.floor(new Date(cached.expiresAt).getTime() / 1000);

    // Use cached token if it has >30 seconds remaining
    if (expiresAt - now > 30) {
      return cached.token;
    }
  }

  // Mint new token
  const appJwt = await generateAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PK);
  const tokenData = await getInstallationToken(installationId, appJwt);

  // Cache with 50-second TTL (tokens last 1 hour, but we refresh early)
  await env.TOKEN_KV.put(
    cacheKey,
    JSON.stringify(tokenData),
    { expirationTtl: 3600 }
  );

  return tokenData.token;
}

/**
 * Retry wrapper for token operations with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Retry on 403 (rate limit), 502/503 (server errors)
      const shouldRetry = error.message?.includes('403') ||
                          error.message?.includes('502') ||
                          error.message?.includes('503');

      if (!shouldRetry || attempt === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff with jitter: 200ms * 2^attempt + random(0-100ms)
      const delay = Math.pow(2, attempt) * 200 + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
