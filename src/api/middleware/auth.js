/**
 * Authentication middleware for ChittyConnect API
 */

export async function authenticate(c, next) {
  const apiKey =
    c.req.header("X-ChittyOS-API-Key") ||
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (!apiKey) {
    return c.json({ error: "Missing API key" }, 401);
  }

  // Validate API key against KV store
  const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);

  // OAuth MCP flow passes bearer access tokens (not API keys). For requests
  // that originate from the OAuth-protected /mcp endpoint, allow valid OAuth
  // tokens as an alternate auth path.
  if (!keyData && c.req.header("Authorization")?.startsWith("Bearer ") && c.env.OAUTH_PROVIDER?.unwrapToken) {
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
