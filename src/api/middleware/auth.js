/**
 * Authentication middleware for ChittyConnect API
 */

function isContextSyncPath(c) {
  try {
    const url = new URL(c.req.raw?.url || "http://localhost");
    return url.pathname === "/api/v1/context/sync";
  } catch {
    return false;
  }
}

/**
 * Paths that perform their own JWT/JWKS-based authentication and must NOT
 * be gated by the API-key `authenticate` middleware. The downstream router
 * for these paths is responsible for rejecting unauthenticated requests.
 *
 * Currently: `/api/v1/neon-auth/*` runs `requireChittyAuthJWT` per-route
 * (verifies Bearer tokens against auth.chitty.cc JWKS — see
 * `src/auth/jwks-verify.js` and `src/auth/neon-user-store.js`).
 */
function isJwtAuthOwnedPath(c) {
  try {
    const url = new URL(c.req.raw?.url || "http://localhost");
    return url.pathname.startsWith("/api/v1/neon-auth/");
  } catch {
    return false;
  }
}

function cfAccessHeadersMatch(c) {
  const incomingId = c.req.header("CF-Access-Client-Id") || "";
  const incomingSecret = c.req.header("CF-Access-Client-Secret") || "";
  const envId = c.env.CHITTY_CF_ACCESS_CLIENT_ID || "";
  const envSecret = c.env.CHITTY_CF_ACCESS_CLIENT_SECRET || "";
  return (
    !!incomingId &&
    !!incomingSecret &&
    !!envId &&
    !!envSecret &&
    incomingId === envId &&
    incomingSecret === envSecret
  );
}

export async function authenticate(c, next) {
  // Skip API-key auth for routes that do their own JWT/JWKS verification.
  // Those routes (see isJwtAuthOwnedPath) gate themselves; falling through
  // here would otherwise reject any request that does not also carry an
  // X-ChittyOS-API-Key.
  if (isJwtAuthOwnedPath(c)) {
    await next();
    return;
  }

  const authorizationHeader = c.req.header("Authorization") || "";
  const bearerMatch = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : null;

  const apiKey = c.req.header("X-ChittyOS-API-Key") || bearerToken;

  if (!apiKey) {
    if (isContextSyncPath(c) && cfAccessHeadersMatch(c)) {
      c.set("apiKey", {
        type: "cloudflare-access",
        name: c.req.header("CF-Access-Authenticated-User-Email") || "unknown",
        service: "chittycontext-sync",
        status: "active",
      });
      await next();
      return;
    }
    return c.json({ error: "Missing API key" }, 401);
  }

  // Validate API key against KV store. Guard against a missing binding so a
  // deploy-time binding drift surfaces as a clear 503 rather than a raw 500
  // TypeError ("Cannot read properties of undefined (reading 'get')").
  // See chittyos/chittyconnect#207.
  if (!c.env.API_KEYS || typeof c.env.API_KEYS.get !== "function") {
    console.error("[auth] API_KEYS KV binding is missing");
    return c.json(
      { error: "Auth backend unavailable", code: "API_KEYS_BINDING_MISSING" },
      503,
    );
  }
  const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);

  // OAuth MCP flow passes bearer access tokens (not API keys). For requests
  // that originate from the OAuth-protected /mcp endpoint, allow valid OAuth
  // tokens as an alternate auth path.
  if (!keyData && bearerToken && c.env.OAUTH_PROVIDER?.unwrapToken) {
    try {
      const token = await c.env.OAUTH_PROVIDER.unwrapToken(apiKey);
      if (!token) {
        return c.json({ error: "Invalid API key" }, 401);
      }

      c.set("apiKey", {
        type: "oauth",
        userId: token.userId,
        scopes: token.scope || [],
        status: "active",
      });

      await next();
      return;
    } catch {
      return c.json({ error: "Invalid API key" }, 401);
    }
  }

  if (!keyData) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  const keyInfo = JSON.parse(keyData);

  // Check if key is active
  if (keyInfo.status !== "active") {
    return c.json({ error: "API key is inactive" }, 401);
  }

  // Optional KV-based rate limiting (only if RATE_LIMIT is bound)
  // In environments without RATE_LIMIT KV, skip this and rely on
  // the dedicated token-bucket middleware when enabled.
  if (c.env.RATE_LIMIT) {
    const rateLimitKey = `ratelimit:${apiKey}:${Math.floor(Date.now() / 60000)}`;
    const requests = await c.env.RATE_LIMIT.get(rateLimitKey);
    const requestCount = requests ? parseInt(requests) : 0;

    if (requestCount >= (keyInfo.rateLimit || 1000)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    // Increment rate limit counter
    await c.env.RATE_LIMIT.put(rateLimitKey, (requestCount + 1).toString(), {
      expirationTtl: 60,
    });
  }

  // Store key info in context
  c.set("apiKey", keyInfo);

  await next();
}
