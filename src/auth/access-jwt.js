/**
 * Cloudflare Access JWT verification for the ChittySecrets portal write path.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/secrets-portal`, `/secrets-portal/upsert` and `/api/v1/secrets/upsert` are
 * the only non-human write path into the ChittySecrets cold store. They are
 * fronted by a self-hosted Cloudflare Access application scoped to
 * `connect.chitty.cc/secrets-portal`. That application admits two kinds of
 * principal:
 *
 *   - humans, via an identity provider — Access forwards
 *     `CF-Access-Authenticated-User-Email` (handled by the pre-existing email
 *     path in `src/index.js`, untouched by this module);
 *   - service tokens, via a `non_identity` policy — Access forwards NO email
 *     header at all, because a service token has no identity. Before this
 *     module existed the origin rejected every service token unconditionally,
 *     which is why incident-response rotations had no automatable write path.
 *
 * SECURITY MODEL — READ BEFORE CHANGING
 * -------------------------------------
 * The signed `Cf-Access-Jwt-Assertion` is the ONLY trust boundary. We do not
 * trust `CF-Access-Client-Id`, `CF-Access-Client-Secret`, or any other request
 * header as an assertion of identity. Cloudflare Access strips the service
 * token's id/secret headers before proxying to the origin (verified live via
 * `wrangler tail`), so their presence at the origin proves nothing at all — a
 * direct-to-origin caller can set them to anything.
 *
 * This is the same class of defect that CHITTYOS/chittysecrets removed in
 * commit 7d946b0 ("security: remove unvalidated Access header fallback"),
 * where `verifyAccess()` fell back to trusting a bare `CF-Access-Client-Id`
 * header whenever the JWT was absent, exposing 15 production secrets. Do not
 * reintroduce a header-presence fallback here, in any form, for any reason.
 *
 * Every failure mode — missing JWT, JWKS fetch failure, bad signature, wrong
 * audience, wrong issuer, expired, stale `iat`, missing/absent claim, empty
 * allowlist — resolves to DENY. There is no path through this module that
 * returns a principal without a cryptographically verified JWT.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import * as jose from "jose";

/** Wrapper cache lifetime. `jose` does its own kid-miss refresh underneath. */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, matches src/auth/jwks-verify.js

/**
 * Refuse tokens older than this regardless of `exp`. `jose.jwtVerify` checks
 * `exp`/`nbf` but never `iat`; `maxTokenAge` is what makes `iat` binding.
 * Access service-token JWTs are short-lived, so this is a generous ceiling.
 */
const TOKEN_MAX_AGE_S = 24 * 60 * 60;

/** Cloudflare Access signs with RS256. Pinning the alg blocks alg-confusion. */
const ACCESS_JWT_ALGS = ["RS256"];

/**
 * The header Cloudflare Access uses to forward the signed assertion to the
 * origin. Verified live against production: present on non-identity
 * (service-token) requests, with `CF-Access-Client-Id`/`-Secret` stripped.
 */
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

// Module-local JWKS cache. Deliberately NOT shared with src/auth/jwks-verify.js:
// that module's cache is a single global slot keyed on one URL, so alternating
// ChittyAuth and Access verifications would thrash it.
let jwksCache = null;
let jwksCacheUrl = null;
let jwksCacheLoadedAt = 0;

/**
 * @param {string} authDomain e.g. "chittycorp.cloudflareaccess.com"
 * @returns {string} the team's Access JWKS endpoint
 */
export function accessJwksUrl(authDomain) {
  return `https://${authDomain}/cdn-cgi/access/certs`;
}

/**
 * @param {string} authDomain
 * @returns {string} the issuer Access stamps into `iss`
 */
export function accessIssuer(authDomain) {
  return `https://${authDomain}`;
}

function getRemoteJWKS(jwksUrl) {
  const now = Date.now();
  if (
    jwksCache &&
    jwksCacheUrl === jwksUrl &&
    now - jwksCacheLoadedAt < JWKS_CACHE_TTL_MS
  ) {
    return jwksCache;
  }
  jwksCache = jose.createRemoteJWKSet(new URL(jwksUrl));
  jwksCacheUrl = jwksUrl;
  jwksCacheLoadedAt = now;
  return jwksCache;
}

/**
 * Cryptographically verify a Cloudflare Access JWT.
 *
 * Checks, in order, all enforced by `jose.jwtVerify`: RS256 signature against
 * the team's JWKS, `iss` equals `https://<authDomain>`, `aud` contains the
 * application's audience tag, `exp`/`nbf` not violated, and `iat` no older
 * than TOKEN_MAX_AGE_S.
 *
 * THROWS on any failure. Never returns a partially-trusted result.
 *
 * @param {string} jwt Compact JWS from the Cf-Access-Jwt-Assertion header.
 * @param {{ authDomain: string, audienceTag: string, keySet?: any }} opts
 *        `keySet` overrides the remote JWKS. It exists so tests can verify
 *        against a locally generated RSA key pair with real crypto rather
 *        than mocking this module; production always leaves it unset.
 * @returns {Promise<object>} the verified JWT payload
 */
export async function verifyAccessJwt(jwt, opts = {}) {
  const { authDomain, audienceTag, keySet } = opts;

  if (!jwt || typeof jwt !== "string") {
    throw new Error("Missing Access JWT (Cf-Access-Jwt-Assertion)");
  }
  if (!authDomain || typeof authDomain !== "string") {
    throw new Error("Access auth domain is not configured");
  }
  if (!audienceTag || typeof audienceTag !== "string") {
    throw new Error("Access audience tag is not configured");
  }

  const keys = keySet || getRemoteJWKS(accessJwksUrl(authDomain));

  const { payload } = await jose.jwtVerify(jwt, keys, {
    issuer: accessIssuer(authDomain),
    audience: audienceTag,
    algorithms: ACCESS_JWT_ALGS,
    maxTokenAge: TOKEN_MAX_AGE_S,
  });

  return payload;
}

/**
 * Decide whether a VERIFIED Access JWT payload represents an allowlisted
 * service token, and if so return its principal name.
 *
 * Pure — no I/O, no crypto. The caller must have already verified the JWT;
 * passing an unverified payload here is a caller bug, not a supported mode.
 *
 * A Cloudflare Access service-token JWT carries `common_name` = the token's
 * Client ID (e.g. "<32-hex>.access") and carries NO `email` claim. The Client
 * ID is an identifier, not a credential — the Client *Secret* is the secret,
 * and Access strips it before the origin ever sees it. Using the Client ID as
 * the audit principal is therefore safe and is what the ops contract asks for.
 *
 * Deny conditions:
 *   - allowlist empty or not an array  → deny (unset MUST NOT mean allow)
 *   - payload carries an `email` claim → deny (that is the human path's job)
 *   - `common_name` missing or empty   → deny
 *   - `common_name` not on the allowlist → deny
 *
 * @param {object} payload verified JWT payload
 * @param {string[]} allowedClientIds lowercased client IDs from parseCsvEnv
 * @returns {string|null} the allowlisted client ID, or null to deny
 */
export function serviceTokenPrincipal(payload, allowedClientIds) {
  if (!payload || typeof payload !== "object") return null;
  if (!Array.isArray(allowedClientIds) || allowedClientIds.length === 0) {
    return null;
  }

  // An email-bearing token is a human identity, not a service token. It is
  // handled by the pre-existing email allowlist path and must not be admitted
  // here under service-token rules.
  if (payload.email) return null;

  const commonName =
    typeof payload.common_name === "string"
      ? payload.common_name.trim().toLowerCase()
      : "";
  if (!commonName) return null;

  return allowedClientIds.includes(commonName) ? commonName : null;
}

/** Internal: reset the module JWKS cache. Test-only. */
export function _resetAccessJwksCacheForTests() {
  jwksCache = null;
  jwksCacheUrl = null;
  jwksCacheLoadedAt = 0;
}
