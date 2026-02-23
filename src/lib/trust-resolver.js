/**
 * Trust Level Resolver
 *
 * Resolves ChittyTrust levels with KV caching (5-min TTL).
 * @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
 *
 * @module lib/trust-resolver
 */

/** Canonical trust level constants (0-5 scale) */
export const TRUST_LEVELS = {
  ANONYMOUS: 0,
  BASIC: 1,
  ENHANCED: 2,
  PROFESSIONAL: 3,
  INSTITUTIONAL: 4,
  OFFICIAL: 5,
};

const CACHE_TTL = 300; // 5 minutes

/**
 * Resolve trust level for a ChittyID entity.
 *
 * @param {string} chittyId - Entity ChittyID
 * @param {object} env - Worker environment (needs CREDENTIAL_CACHE KV, CHITTY_TRUST_TOKEN)
 * @returns {Promise<{trust_level: number, entity_type: string}>}
 */
export async function resolveTrustLevel(chittyId, env) {
  const cacheKey = `trust:${chittyId}`;

  // Check cache
  const cached = await env.CREDENTIAL_CACHE.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupted cache entry — fall through to fetch
    }
  }

  // Fetch from ChittyTrust
  try {
    const token = env.CHITTY_TRUST_TOKEN;
    const resp = await fetch(
      `https://trust.chitty.cc/api/v1/trust/${chittyId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Source-Service": "chittyconnect",
        },
      },
    );

    if (!resp.ok) {
      return { trust_level: TRUST_LEVELS.BASIC, entity_type: "P" };
    }

    const data = await resp.json();
    const result = {
      trust_level: data.trust_level ?? TRUST_LEVELS.BASIC,
      entity_type: data.entity_type ?? "P",
    };

    // Cache with TTL
    await env.CREDENTIAL_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL,
    });

    return result;
  } catch {
    return { trust_level: TRUST_LEVELS.BASIC, entity_type: "P" };
  }
}
