/**
 * Rate Limiting Middleware
 *
 * Implements token bucket algorithm with Cloudflare KV storage
 * Prevents abuse while allowing burst traffic
 */

/**
 * Rate limit configuration
 */
const RATE_LIMITS = {
  // Default limits (per minute)
  default: {
    requests: 60,
    window: 60 // seconds
  },

  // MCP tool execution (more restrictive)
  mcp_tools: {
    requests: 30,
    window: 60
  },

  // ChittyID minting (very restrictive)
  chittyid_mint: {
    requests: 10,
    window: 60
  },

  // API endpoints (moderate)
  api: {
    requests: 100,
    window: 60
  },

  // Authenticated users (higher limits)
  authenticated: {
    requests: 200,
    window: 60
  }
};

/**
 * Get rate limit key for request
 */
function getRateLimitKey(c, identifier) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const path = c.req.path;

  // Use API key if authenticated, otherwise IP
  const id = identifier || ip;

  // Determine limit type based on path
  let limitType = 'default';
  if (path.startsWith('/mcp/tools/call')) {
    limitType = 'mcp_tools';
  } else if (path.startsWith('/api/')) {
    limitType = 'api';
  }

  return `ratelimit:${limitType}:${id}`;
}

/**
 * Get appropriate rate limit config
 */
function getRateLimitConfig(c, isAuthenticated = false) {
  const path = c.req.path;

  if (isAuthenticated) {
    return RATE_LIMITS.authenticated;
  }

  if (path.startsWith('/mcp/tools/call')) {
    const body = c.get('requestBody');
    if (body?.name === 'chittyid_mint') {
      return RATE_LIMITS.chittyid_mint;
    }
    return RATE_LIMITS.mcp_tools;
  }

  if (path.startsWith('/api/')) {
    return RATE_LIMITS.api;
  }

  return RATE_LIMITS.default;
}

/**
 * Rate limiting middleware using token bucket algorithm
 */
export async function rateLimitMiddleware(c, next) {
  const env = c.env;

  // Skip rate limiting for health checks
  if (c.req.path === '/health' || c.req.path === '/mcp/manifest') {
    return next();
  }

  try {
    // Check if user is authenticated (has valid API key)
    const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
    const isAuthenticated = apiKey && await env.API_KEYS?.get(apiKey);

    // Get identifier (API key or IP)
    const identifier = apiKey || c.req.header('cf-connecting-ip') || 'unknown';

    // Get rate limit config
    const config = getRateLimitConfig(c, !!isAuthenticated);
    const key = getRateLimitKey(c, identifier);

    // Get current bucket state from KV
    const bucketJson = await env.RATE_LIMIT?.get(key);
    const now = Date.now();

    let bucket;
    if (bucketJson) {
      bucket = JSON.parse(bucketJson);
    } else {
      // Initialize new bucket
      bucket = {
        tokens: config.requests,
        lastRefill: now
      };
    }

    // Refill tokens based on time elapsed
    const timeSinceRefill = (now - bucket.lastRefill) / 1000; // seconds
    const tokensToAdd = Math.floor(timeSinceRefill * (config.requests / config.window));

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(config.requests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Check if request can proceed
    if (bucket.tokens >= 1) {
      // Consume token
      bucket.tokens -= 1;

      // Update bucket in KV (with TTL = window * 2)
      await env.RATE_LIMIT?.put(
        key,
        JSON.stringify(bucket),
        { expirationTtl: config.window * 2 }
      );

      // Add rate limit headers
      c.header('X-RateLimit-Limit', config.requests.toString());
      c.header('X-RateLimit-Remaining', Math.floor(bucket.tokens).toString());
      c.header('X-RateLimit-Reset', (bucket.lastRefill + (config.window * 1000)).toString());

      return next();
    } else {
      // Rate limit exceeded
      const resetTime = bucket.lastRefill + (config.window * 1000);
      const retryAfter = Math.ceil((resetTime - now) / 1000);

      return c.json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        limit: config.requests,
        window: config.window,
        retryAfter
      }, 429, {
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': config.requests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': resetTime.toString()
      });
    }
  } catch (error) {
    // On error, allow request through (fail open)
    console.error('[RateLimit] Error checking rate limit:', error);
    return next();
  }
}

/**
 * Get rate limit status for identifier
 */
export async function getRateLimitStatus(env, identifier, limitType = 'default') {
  const key = `ratelimit:${limitType}:${identifier}`;
  const config = RATE_LIMITS[limitType] || RATE_LIMITS.default;

  try {
    const bucketJson = await env.RATE_LIMIT?.get(key);

    if (!bucketJson) {
      return {
        limit: config.requests,
        remaining: config.requests,
        reset: Date.now() + (config.window * 1000)
      };
    }

    const bucket = JSON.parse(bucketJson);
    const now = Date.now();

    // Calculate current tokens
    const timeSinceRefill = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timeSinceRefill * (config.requests / config.window));
    const currentTokens = Math.min(config.requests, bucket.tokens + tokensToAdd);

    return {
      limit: config.requests,
      remaining: Math.floor(currentTokens),
      reset: bucket.lastRefill + (config.window * 1000)
    };
  } catch (error) {
    console.error('[RateLimit] Error getting status:', error);
    return {
      limit: config.requests,
      remaining: config.requests,
      reset: Date.now() + (config.window * 1000)
    };
  }
}

/**
 * Reset rate limit for identifier (admin only)
 */
export async function resetRateLimit(env, identifier, limitType = 'default') {
  const key = `ratelimit:${limitType}:${identifier}`;
  await env.RATE_LIMIT?.delete(key);
  return { success: true, message: `Rate limit reset for ${identifier}` };
}
