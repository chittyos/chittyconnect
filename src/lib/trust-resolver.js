/**
 * Trust Level Resolver
 *
 * Resolves trust levels via ChittyScore DRL reckoning (TY/VY/RY model).
 * Derives backward-compatible trust_level (0-5) from TY/VY/RY composite.
 *
 * @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
 * @module lib/trust-resolver
 */

/** Canonical trust level constants (0-5 scale) — backward compat */
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
 * Derive trust_level (0-5) from TY/VY/RY reckoning.
 * Uses floor of the average, scaled to 0-5.
 *
 * @param {number} ty - idenTitY (0-1)
 * @param {number} vy - connectiVitY (0-1)
 * @param {number} ry - authoRitY (0-1)
 * @returns {number} trust_level 0-5
 */
function deriveTrustLevel(ty, vy, ry) {
  const composite = (ty + vy + ry) / 3;
  return Math.min(5, Math.floor(composite * 5));
}

/**
 * Resolve trust level for a ChittyID entity.
 *
 * Calls ChittyScore DRL reckoning endpoint, caches result in KV.
 * Returns backward-compatible trust_level plus TY/VY/RY breakdown.
 *
 * @param {string} chittyId - Entity ChittyID
 * @param {object} env - Worker environment (needs CREDENTIAL_CACHE KV)
 * @returns {Promise<{trust_level: number, entity_type: string, ty: number, vy: number, ry: number}>}
 */
export async function resolveTrustLevel(chittyId, env) {
  const cacheKey = `trust:${chittyId}`;

  // Extract entity type from ChittyID format: VV-G-LLL-SSSS-T-YM-C-X (segment 4)
  const segments = (chittyId || "").split("-");
  const entityType = segments.length >= 5 ? segments[4] : "P";

  // Fail-closed fallback: ANONYMOUS trust grants no governance permissions
  const FALLBACK = { trust_level: TRUST_LEVELS.ANONYMOUS, entity_type: entityType, ty: 0, vy: 0, ry: 0 };

  if (!env.CREDENTIAL_CACHE) {
    console.error(
      `[TrustResolver] CREDENTIAL_CACHE binding missing for ${chittyId}`,
    );
    return FALLBACK;
  }

  // Check cache
  const cached = await env.CREDENTIAL_CACHE.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (parseErr) {
      console.warn(
        `[TrustResolver] Corrupted cache for ${cacheKey}, ignoring:`,
        parseErr.message,
      );
    }
  }

  // Fetch from ChittyScore DRL reckoning
  try {
    const resp = await fetch(
      `https://score.chitty.cc/v1/reckon/${encodeURIComponent(chittyId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Source-Service": "chittyconnect",
        },
      },
    );

    if (!resp.ok) {
      console.error(
        `[TrustResolver] ChittyScore returned ${resp.status} for ${chittyId}`,
      );
      return FALLBACK;
    }

    const data = await resp.json();
    const ty = data.ty ?? 0;
    const vy = data.vy ?? 0;
    const ry = data.ry ?? 0;

    const result = {
      trust_level: deriveTrustLevel(ty, vy, ry),
      entity_type: entityType,
      ty,
      vy,
      ry,
    };

    // Cache with TTL
    await env.CREDENTIAL_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL,
    });

    return result;
  } catch (err) {
    console.error(
      `[TrustResolver] Failed to resolve trust for ${chittyId}:`,
      err.message,
    );
    return FALLBACK;
  }
}
