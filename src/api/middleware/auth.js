/**
 * Authentication middleware for ChittyConnect API
 */

export async function authenticate(c, next) {
  const apiKey = c.req.header('X-ChittyOS-API-Key') || c.req.header('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  // Validate API key against KV store
  const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);

  if (!keyData) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  const keyInfo = JSON.parse(keyData);

  // Check if key is active
  if (keyInfo.status !== 'active') {
    return c.json({ error: 'API key is inactive' }, 401);
  }

  // Check rate limits
  const rateLimitKey = `ratelimit:${apiKey}:${Math.floor(Date.now() / 60000)}`;
  const requests = await c.env.RATE_LIMIT.get(rateLimitKey);
  const requestCount = requests ? parseInt(requests) : 0;

  if (requestCount >= keyInfo.rateLimit) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  // Increment rate limit counter
  await c.env.RATE_LIMIT.put(rateLimitKey, (requestCount + 1).toString(), {
    expirationTtl: 60
  });

  // Store key info in context
  c.set('apiKey', keyInfo);

  await next();
}
