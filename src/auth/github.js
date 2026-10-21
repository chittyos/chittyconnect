/**
 * GitHub App authentication
 *
 * Implements:
 * - App JWT generation (RS256)
 * - Installation token exchange with repository/permission down-scoping
 * - Token caching with TTL
 *
 * Provider credentials remain inside ChittyConnect. Callers receive governed
 * authority results/capabilities, never the GitHub App private key or an
 * installation access token.
 */

import * as jose from "jose";

function canonicalScopeKey(scope = {}) {
  const repositories = Array.isArray(scope.repositories)
    ? [...scope.repositories].sort()
    : [];
  const repositoryIds = Array.isArray(scope.repository_ids)
    ? [...scope.repository_ids].map(String).sort()
    : [];
  const permissions =
    scope.permissions && typeof scope.permissions === "object"
      ? Object.fromEntries(
          Object.entries(scope.permissions).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : {};

  return JSON.stringify({
    repositories,
    repository_ids: repositoryIds,
    permissions,
  });
}

function assertPkcs8PrivateKey(privateKeyPem) {
  if (typeof privateKeyPem !== "string" || privateKeyPem.length === 0) {
    throw new Error("GitHub App private key is not configured");
  }

  if (privateKeyPem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    throw new Error(
      "GITHUB_APP_KEY_FORMAT_PKCS1: GitHub-generated App keys are PKCS#1; convert the key to unencrypted PKCS#8 before provisioning ChittyConnect",
    );
  }

  if (!privateKeyPem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error(
      "GITHUB_APP_KEY_FORMAT_UNSUPPORTED: expected an unencrypted PKCS#8 PEM (BEGIN PRIVATE KEY)",
    );
  }
}

/**
 * Generate GitHub App JWT
 * @param {string} appId - GitHub App client ID or App ID
 * @param {string} privateKeyPem - Private key in unencrypted PKCS#8 PEM format
 * @returns {Promise<string>} Signed JWT
 */
export async function generateAppJWT(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);

  assertPkcs8PrivateKey(privateKeyPem);

  // GitHub recommends backdating iat by 60 seconds to tolerate clock skew.
  // exp remains no more than 10 minutes into the future.
  const privateKey = await jose.importPKCS8(privateKeyPem, "RS256");

  const jwt = await new jose.SignJWT({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);

  return jwt;
}

/**
 * Exchange App JWT for an installation access token.
 *
 * Scope can narrow the installation token to specific repositories and a
 * permission subset. GitHub will reject any requested repository/permission
 * not already granted to the installation/App.
 *
 * @param {number} installationId - GitHub App installation ID
 * @param {string} appJwt - App-authenticated JWT
 * @param {{
 *   repositories?: string[],
 *   repository_ids?: Array<string|number>,
 *   permissions?: Record<string, "read"|"write">
 * }} [scope]
 * @returns {Promise<{token: string, expiresAt: string, permissions: object, repositories?: object[]}>}
 */
export async function getInstallationToken(
  installationId,
  appJwt,
  scope = {},
) {
  const body = {};

  if (Array.isArray(scope.repositories) && scope.repositories.length > 0) {
    body.repositories = scope.repositories;
  }
  if (
    Array.isArray(scope.repository_ids) &&
    scope.repository_ids.length > 0
  ) {
    body.repository_ids = scope.repository_ids;
  }
  if (
    scope.permissions &&
    typeof scope.permissions === "object" &&
    Object.keys(scope.permissions).length > 0
  ) {
    body.permissions = scope.permissions;
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
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
    repositories: data.repositories,
  };
}

/**
 * Get cached installation token or mint a new one.
 *
 * Cache identity includes the requested repository/permission scope so a broad
 * token can never be reused for a narrower authority request (or vice versa).
 *
 * @param {object} env - Worker environment with TOKEN_KV, GITHUB_APP_ID, GITHUB_APP_PK
 * @param {number} installationId - Installation ID
 * @param {{
 *   repositories?: string[],
 *   repository_ids?: Array<string|number>,
 *   permissions?: Record<string, "read"|"write">
 * }} [scope]
 * @returns {Promise<string>} Installation access token for internal use only
 */
export async function getCachedInstallationToken(
  env,
  installationId,
  scope = {},
) {
  const scopeKey = canonicalScopeKey(scope);
  const scopeDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scopeKey),
  );
  const scopeHash = Array.from(new Uint8Array(scopeDigest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const cacheKey = `install:${installationId}:${scopeHash}`;

  const cached = await env.TOKEN_KV.get(cacheKey, { type: "json" });
  if (cached) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Math.floor(
      new Date(cached.expiresAt).getTime() / 1000,
    );

    if (expiresAt - now > 30) {
      return cached.token;
    }
  }

  const appJwt = await generateAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PK);
  const tokenData = await getInstallationToken(
    installationId,
    appJwt,
    scope,
  );

  // GitHub installation tokens expire after one hour. Keep the cache no longer
  // than that provider lifetime and refresh early on read.
  await env.TOKEN_KV.put(cacheKey, JSON.stringify(tokenData), {
    expirationTtl: 3600,
  });

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

      const shouldRetry =
        error.message?.includes("403") ||
        error.message?.includes("502") ||
        error.message?.includes("503");

      if (!shouldRetry || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 200 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
