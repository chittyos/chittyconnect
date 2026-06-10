/**
 * JWKS verifier for ChittyAuth-issued tokens (iss = https://auth.chitty.cc).
 *
 * Used by `src/auth/neon-user-store.js` and any other ChittyConnect route
 * that needs to bind to a user identity in the Neon `neon_auth.*` tables.
 *
 * The `sub` claim in ChittyAuth-issued JWTs is the identity DID
 * (did:chitty:*), per chittyauth `src/services/token.service.ts:49`.
 *
 * The verified `sub` is later threaded into Postgres via
 *   SELECT set_config('request.jwt.claim.sub', $1, true)
 * by `withRlsBinding(env, sub, fn)` in `neon-user-store.js`, which lets the
 * RLS policies created in migration 019 enforce per-user isolation.
 */

import * as jose from "jose";

const DEFAULT_ISSUER = "https://auth.chitty.cc";
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, matches github-oidc.js
const TOKEN_MAX_AGE_S = 24 * 60 * 60; // refuse tokens older than 24h regardless of exp

let jwksCache = null;
let jwksCacheLoadedAt = 0;
let jwksCacheKey = null;

/**
 * Lazily build and cache a remote JWKS set keyed on the JWKS URL.
 *
 * `jose.createRemoteJWKSet` itself does internal caching with
 * refresh-on-kid-miss, but we additionally cap the lifetime of the wrapper
 * to flush stale state if the issuer rotates host or URL.
 */
function getRemoteJWKS(jwksUrl) {
  const now = Date.now();
  if (
    jwksCache &&
    jwksCacheKey === jwksUrl &&
    now - jwksCacheLoadedAt < JWKS_CACHE_TTL_MS
  ) {
    return jwksCache;
  }
  jwksCache = jose.createRemoteJWKSet(new URL(jwksUrl));
  jwksCacheKey = jwksUrl;
  jwksCacheLoadedAt = now;
  return jwksCache;
}

/**
 * Verify a ChittyAuth-issued JWT.
 *
 * @param {string}  token   Compact JWS string.
 * @param {object}  env     Worker env. Reads optional overrides:
 *                            env.CHITTYAUTH_ISSUER   (default https://auth.chitty.cc)
 *                            env.CHITTYAUTH_JWKS_URL (default <issuer>/.well-known/jwks.json)
 *                            env.CHITTYAUTH_AUDIENCE (optional; if set, enforced)
 * @returns {Promise<{ valid: true, sub: string, payload: object, header: object }
 *                  | { valid: false, error: string, code: string }>}
 */
export async function verifyChittyAuthJWT(token, env = {}) {
  if (!token || typeof token !== "string") {
    return { valid: false, code: "missing_token", error: "Token is required" };
  }

  const issuer = env.CHITTYAUTH_ISSUER || DEFAULT_ISSUER;
  const jwksUrl = env.CHITTYAUTH_JWKS_URL || `${issuer}/.well-known/jwks.json`;
  const audience = env.CHITTYAUTH_AUDIENCE;

  const verifyOpts = {
    issuer,
    maxTokenAge: TOKEN_MAX_AGE_S,
    algorithms: ["ES256"],
  };
  if (audience) verifyOpts.audience = audience;

  try {
    const jwks = getRemoteJWKS(jwksUrl);
    const { payload, protectedHeader } = await jose.jwtVerify(
      token,
      jwks,
      verifyOpts,
    );

    if (!payload.sub || typeof payload.sub !== "string") {
      return {
        valid: false,
        code: "missing_sub",
        error: "Token has no sub claim",
      };
    }

    // Service tokens (chittyauth uses sub='service' for non-user tokens)
    // are intentionally rejected here — neon-user-store routes are bound to
    // a user identity. Service-to-service traffic uses the existing
    // X-ChittyOS-API-Key auth path.
    if (payload.sub === "service") {
      return {
        valid: false,
        code: "service_token_rejected",
        error:
          "Service tokens cannot access user-bound routes; use X-ChittyOS-API-Key or a user-scoped JWT",
      };
    }

    return {
      valid: true,
      sub: payload.sub,
      payload,
      header: protectedHeader,
    };
  } catch (err) {
    return {
      valid: false,
      code: err?.code || "verify_failed",
      error: err?.message || String(err),
    };
  }
}

/**
 * Hono middleware: verify the inbound Authorization: Bearer <jwt> against
 * the ChittyAuth JWKS, then stash the verified `sub` (DID) on the context.
 *
 * Downstream handlers read `c.get("chittyAuth")` for { sub, payload, header }.
 *
 * Returns 401 on any failure; never falls through to a partial trust state.
 */
export async function requireChittyAuthJWT(c, next) {
  const header = c.req.header("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json(
      {
        error: "missing_bearer",
        message: "Authorization: Bearer <jwt> required",
      },
      401,
    );
  }

  const verified = await verifyChittyAuthJWT(match[1].trim(), c.env);
  if (!verified.valid) {
    return c.json(
      {
        error: "invalid_token",
        code: verified.code,
        message: verified.error,
      },
      401,
    );
  }

  c.set("chittyAuth", {
    sub: verified.sub,
    payload: verified.payload,
    header: verified.header,
  });

  await next();
}

/**
 * Internal: reset JWKS cache. Test-only.
 */
export function _resetJwksCacheForTests() {
  jwksCache = null;
  jwksCacheLoadedAt = 0;
  jwksCacheKey = null;
}
