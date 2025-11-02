/**
 * MCP Authentication Middleware
 *
 * Quick-fix authentication for MCP endpoints while we migrate to
 * Cloudflare's official OAuth provider pattern.
 *
 * This provides basic API key authentication to secure MCP endpoints
 * and resolve the "Access denied" issues.
 */

/**
 * API Key Authentication Middleware for MCP endpoints
 *
 * Validates X-ChittyOS-API-Key header against API_KEYS KV store
 * Supports:
 * - API key validation
 * - Rate limiting metadata
 * - User scoping
 * - Access logging
 *
 * @param {HonoContext} c - Hono context
 * @param {Function} next - Next middleware
 */
export async function mcpAuthMiddleware(c, next) {
  // Public endpoints (no auth required)
  const publicPaths = ["/manifest", "/health"];
  const path = new URL(c.req.url).pathname;

  if (publicPaths.some((p) => path.endsWith(p))) {
    return await next();
  }

  // Extract API key from header
  const apiKey = c.req.header("X-ChittyOS-API-Key");

  if (!apiKey) {
    return c.json(
      {
        error: "Authentication required",
        message:
          "Missing X-ChittyOS-API-Key header. Obtain an API key from ChittyAuth.",
        docs: "https://docs.chitty.cc/authentication",
      },
      401,
    );
  }

  // Validate API key against KV store
  let keyData;
  try {
    const keyJson = await c.env.API_KEYS.get(`key:${apiKey}`);

    if (!keyJson) {
      // Log failed authentication attempt
      console.warn("[MCP Auth] Invalid API key attempted:", {
        key: apiKey.substring(0, 8) + "...",
        path,
        ip: c.req.header("CF-Connecting-IP"),
        timestamp: new Date().toISOString(),
      });

      return c.json(
        {
          error: "Invalid API key",
          message:
            "The provided API key is not valid or has been revoked. Please check your credentials.",
        },
        403,
      );
    }

    keyData = JSON.parse(keyJson);
  } catch (error) {
    console.error("[MCP Auth] Error validating API key:", error);
    return c.json(
      {
        error: "Authentication error",
        message: "Failed to validate API key. Please try again.",
      },
      500,
    );
  }

  // Check if key is active
  if (keyData.status !== "active") {
    return c.json(
      {
        error: "API key inactive",
        message: `This API key is ${keyData.status}. Please contact support.`,
      },
      403,
    );
  }

  // Check expiration (if set)
  if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
    return c.json(
      {
        error: "API key expired",
        message: "This API key has expired. Please generate a new one.",
      },
      403,
    );
  }

  // Attach key metadata to context for downstream handlers
  c.set("apiKey", {
    key: apiKey,
    name: keyData.name,
    userId: keyData.userId,
    scopes: keyData.scopes || [],
    rateLimit: keyData.rateLimit || 1000,
    metadata: keyData.metadata || {},
  });

  // Log successful authentication
  console.log("[MCP Auth] Authenticated request:", {
    key: apiKey.substring(0, 8) + "...",
    user: keyData.name || keyData.userId,
    path,
    timestamp: new Date().toISOString(),
  });

  await next();
}

/**
 * Generate a new API key
 *
 * Usage:
 *   const apiKey = await generateAPIKey(env, {
 *     name: "Claude Desktop",
 *     userId: "chitty_abc123",
 *     scopes: ["mcp:read", "mcp:write"],
 *     rateLimit: 2000
 *   });
 *
 * @param {Env} env - Cloudflare environment bindings
 * @param {Object} options - API key options
 * @returns {Promise<string>} Generated API key
 */
export async function generateAPIKey(env, options = {}) {
  const {
    name = "Unnamed API Key",
    userId = null,
    scopes = ["mcp:read", "mcp:write"],
    rateLimit = 1000,
    expiresAt = null,
    metadata = {},
  } = options;

  // Generate secure random API key
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const apiKey =
    "chitty_" +
    Array.from(keyBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // Store in KV
  const keyData = {
    status: "active",
    name,
    userId,
    scopes,
    rateLimit,
    expiresAt,
    metadata,
    createdAt: new Date().toISOString(),
  };

  await env.API_KEYS.put(`key:${apiKey}`, JSON.stringify(keyData));

  console.log("[MCP Auth] Generated new API key:", {
    key: apiKey.substring(0, 8) + "...",
    name,
    userId,
    scopes,
  });

  return apiKey;
}

/**
 * Revoke an API key
 *
 * @param {Env} env - Cloudflare environment bindings
 * @param {string} apiKey - API key to revoke
 * @returns {Promise<boolean>} True if revoked
 */
export async function revokeAPIKey(env, apiKey) {
  const keyJson = await env.API_KEYS.get(`key:${apiKey}`);

  if (!keyJson) {
    return false;
  }

  const keyData = JSON.parse(keyJson);
  keyData.status = "revoked";
  keyData.revokedAt = new Date().toISOString();

  await env.API_KEYS.put(`key:${apiKey}`, JSON.stringify(keyData));

  console.log("[MCP Auth] Revoked API key:", {
    key: apiKey.substring(0, 8) + "...",
  });

  return true;
}

/**
 * List all API keys for a user
 *
 * @param {Env} env - Cloudflare environment bindings
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of API keys
 */
export async function listUserAPIKeys(env, userId) {
  // Note: KV doesn't support efficient querying by value
  // For production, consider using D1 database for API key management
  // This is a basic implementation using KV list

  const keys = [];
  const list = await env.API_KEYS.list({ prefix: "key:" });

  for (const item of list.keys) {
    const keyJson = await env.API_KEYS.get(item.name);
    if (keyJson) {
      const keyData = JSON.parse(keyJson);
      if (keyData.userId === userId) {
        keys.push({
          key: item.name.replace("key:", "").substring(0, 16) + "...",
          name: keyData.name,
          status: keyData.status,
          createdAt: keyData.createdAt,
          expiresAt: keyData.expiresAt,
        });
      }
    }
  }

  return keys;
}
