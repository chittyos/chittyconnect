/**
 * Rate Limiting Middleware
 *
 * Implements sliding window rate limiting for API endpoints.
 * Uses CF-Connecting-IP for client identification.
 *
 * Note: For production, this should be complemented by Cloudflare's
 * built-in rate limiting rules for global enforcement.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/middleware/rateLimit
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 */

/**
 * Rate limit configurations by endpoint category
 * Requests per minute (RPM) limits
 */
export const RATE_LIMITS = {
  // High-frequency read endpoints
  high: {
    rpm: 60,
    windowMs: 60000,
    description: "Standard read operations",
  },
  // Medium-frequency write endpoints
  medium: {
    rpm: 30,
    windowMs: 60000,
    description: "Write operations",
  },
  // Low-frequency sensitive operations
  low: {
    rpm: 10,
    windowMs: 60000,
    description: "Sensitive operations (supernova, fission)",
  },
  // Very strict for expensive operations
  strict: {
    rpm: 5,
    windowMs: 60000,
    description: "Expensive operations (experiments)",
  },
};

/**
 * Endpoint to rate limit tier mapping
 */
export const ENDPOINT_LIMITS = {
  // Context Intelligence - Read operations (high frequency)
  "GET:/api/v1/intelligence/decisions/:chittyId": "high",
  "GET:/api/v1/intelligence/alchemy/:chittyId": "high",
  "GET:/api/v1/intelligence/autonomy/:chittyId": "high",
  "GET:/api/v1/intelligence/pairs/:chittyId": "high",
  "GET:/api/v1/intelligence/behavior/:chittyId": "high",
  "GET:/api/v1/intelligence/taxonomy": "high",
  "GET:/api/v1/intelligence/alchemist/reference": "high",

  // Context Intelligence - Analyze operations (medium frequency)
  "POST:/api/v1/intelligence/coherence": "medium",
  "POST:/api/v1/intelligence/collaborators/find": "medium",
  "POST:/api/v1/intelligence/supernova/analyze": "medium",
  "POST:/api/v1/intelligence/fission/analyze": "medium",
  "POST:/api/v1/intelligence/alchemy/suggest": "medium",
  "GET:/api/v1/intelligence/alchemist/capabilities/:chittyId": "medium",
  "POST:/api/v1/intelligence/behavior/assess/:chittyId": "medium",

  // Context Intelligence - Execute operations (low frequency)
  "POST:/api/v1/intelligence/supernova/execute": "low",
  "POST:/api/v1/intelligence/fission/execute": "low",
  "POST:/api/v1/intelligence/derivative": "low",
  "POST:/api/v1/intelligence/suspension": "low",
  "POST:/api/v1/intelligence/solution": "low",
  "POST:/api/v1/intelligence/combination": "low",
  "POST:/api/v1/intelligence/collaborations": "low",
  "POST:/api/v1/intelligence/pairs": "low",

  // Very expensive operations
  "POST:/api/v1/intelligence/alchemist/experiment": "strict",
  "GET:/api/v1/intelligence/alchemist/observe": "strict",
};

/**
 * In-memory rate limit tracking
 * Note: In production, use KV or Durable Objects for distributed rate limiting
 *
 * Cloudflare Workers note: We cannot use setInterval in global scope.
 * Cleanup happens lazily during request handling instead.
 */
const requestCounts = new Map();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 300000; // 5 minutes

/**
 * Clean up expired entries (called lazily during requests)
 */
function cleanupExpiredEntries() {
  const now = Date.now();

  // Only run cleanup if enough time has passed
  if (now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanup = now;

  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > data.windowMs * 2) {
      requestCounts.delete(key);
    }
  }
}

/**
 * Get rate limit tier for an endpoint
 */
function getRateLimitTier(method, path) {
  // Direct match first
  const key = `${method}:${path}`;
  if (ENDPOINT_LIMITS[key]) {
    return ENDPOINT_LIMITS[key];
  }

  // Try pattern matching for parameterized routes
  for (const [pattern, tier] of Object.entries(ENDPOINT_LIMITS)) {
    const [patternMethod, patternPath] = pattern.split(":");
    if (patternMethod !== method) continue;

    // Convert pattern to regex (replace :param with wildcard)
    const regexPattern = patternPath.replace(/:[^/]+/g, "[^/]+");
    const regex = new RegExp(`^${regexPattern}$`);

    if (regex.test(path)) {
      return tier;
    }
  }

  return null; // No rate limit configured
}

/**
 * Create rate limiting middleware
 *
 * @param {Object} options - Configuration options
 * @param {string} options.tier - Rate limit tier (high, medium, low, strict)
 * @param {Function} options.keyGenerator - Custom key generator function
 * @returns {Function} Hono middleware
 */
export function rateLimit(options = {}) {
  const { tier = "high", keyGenerator } = options;

  return async (c, next) => {
    // Lazy cleanup of expired entries
    cleanupExpiredEntries();

    const config = RATE_LIMITS[tier] || RATE_LIMITS.high;

    // Generate rate limit key
    const clientIp =
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
      "unknown";
    const path = c.req.path;
    const key = keyGenerator ? keyGenerator(c) : `${clientIp}:${path}`;

    const now = Date.now();

    // Get or create tracking data
    let data = requestCounts.get(key);
    if (!data || now - data.windowStart > config.windowMs) {
      data = {
        count: 0,
        windowStart: now,
        windowMs: config.windowMs,
      };
      requestCounts.set(key, data);
    }

    // Increment and check
    data.count++;

    if (data.count > config.rpm) {
      const retryAfter = Math.ceil(
        (config.windowMs - (now - data.windowStart)) / 1000,
      );

      c.header("X-RateLimit-Limit", config.rpm.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header(
        "X-RateLimit-Reset",
        Math.ceil((data.windowStart + config.windowMs) / 1000).toString(),
      );
      c.header("Retry-After", retryAfter.toString());

      return c.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
            tier,
            limit: config.rpm,
            windowMs: config.windowMs,
          },
          _meta: {
            requestId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            service: "chittyconnect",
          },
        },
        429,
      );
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", config.rpm.toString());
    c.header(
      "X-RateLimit-Remaining",
      Math.max(0, config.rpm - data.count).toString(),
    );
    c.header(
      "X-RateLimit-Reset",
      Math.ceil((data.windowStart + config.windowMs) / 1000).toString(),
    );

    await next();
  };
}

/**
 * Auto rate limiting middleware - automatically determines tier from endpoint
 */
export function autoRateLimit() {
  return async (c, next) => {
    // Lazy cleanup of expired entries
    cleanupExpiredEntries();

    const method = c.req.method;
    const path = c.req.path;
    const tier = getRateLimitTier(method, path);

    if (tier) {
      const config = RATE_LIMITS[tier];
      const clientIp =
        c.req.header("CF-Connecting-IP") ||
        c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
        "unknown";
      const key = `${clientIp}:${method}:${path}`;

      const now = Date.now();

      let data = requestCounts.get(key);
      if (!data || now - data.windowStart > config.windowMs) {
        data = {
          count: 0,
          windowStart: now,
          windowMs: config.windowMs,
        };
        requestCounts.set(key, data);
      }

      data.count++;

      if (data.count > config.rpm) {
        const retryAfter = Math.ceil(
          (config.windowMs - (now - data.windowStart)) / 1000,
        );

        c.header("X-RateLimit-Limit", config.rpm.toString());
        c.header("X-RateLimit-Remaining", "0");
        c.header(
          "X-RateLimit-Reset",
          Math.ceil((data.windowStart + config.windowMs) / 1000).toString(),
        );
        c.header("Retry-After", retryAfter.toString());

        return c.json(
          {
            success: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
              tier,
              limit: config.rpm,
              windowMs: config.windowMs,
            },
            _meta: {
              requestId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              service: "chittyconnect",
            },
          },
          429,
        );
      }

      c.header("X-RateLimit-Limit", config.rpm.toString());
      c.header(
        "X-RateLimit-Remaining",
        Math.max(0, config.rpm - data.count).toString(),
      );
      c.header(
        "X-RateLimit-Reset",
        Math.ceil((data.windowStart + config.windowMs) / 1000).toString(),
      );
      c.header("X-RateLimit-Tier", tier);
    }

    await next();
  };
}

export default rateLimit;
