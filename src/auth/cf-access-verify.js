/**
 * Cloudflare Access assertion verifier.
 *
 * The secrets portal (`/secrets-portal*`, `/api/v1/secrets/upsert`) historically
 * trusted the `CF-Access-Authenticated-User-Email` request header. That header is
 * injected by Cloudflare Access *after* it authenticates a user, but it is NOT
 * self-authenticating: if the Worker origin is reachable without transiting an
 * Access policy, a client can forge the header and pass identity checks.
 *
 * Cloudflare Access additionally sends a SIGNED JWT in the
 * `Cf-Access-Jwt-Assertion` header. Verifying that assertion against the team's
 * public JWKS — and pinning `aud` to the Access application's AUD tag — is the
 * canonical, forgery-resistant way to establish identity. This module does that,
 * reusing the same `jose` remote-JWKS plumbing as `jwks-verify.js`.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import * as jose from "jose";

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, matches jwks-verify.js / github-oidc.js

let jwksCache = null;
let jwksCacheLoadedAt = 0;
let jwksCacheKey = null;

function getRemoteJWKS(certsUrl) {
  const now = Date.now();
  if (
    jwksCache &&
    jwksCacheKey === certsUrl &&
    now - jwksCacheLoadedAt < JWKS_CACHE_TTL_MS
  ) {
    return jwksCache;
  }
  jwksCache = jose.createRemoteJWKSet(new URL(certsUrl));
  jwksCacheKey = certsUrl;
  jwksCacheLoadedAt = now;
  return jwksCache;
}

/**
 * Normalize a configured team domain into a bare host.
 * Accepts "chittyos", "chittyos.cloudflareaccess.com", or a full https URL.
 */
function normalizeTeamHost(teamDomain) {
  let host = String(teamDomain || "").trim();
  if (!host) return "";
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host.includes(".")) host = `${host}.cloudflareaccess.com`;
  return host.toLowerCase();
}

/**
 * Whether Access-assertion verification is configured for this environment.
 * When false, callers should treat assertion verification as unavailable and
 * fall back to their prior behavior (header trust) — but log the gap.
 *
 * @param {object} env Worker env.
 * @returns {boolean}
 */
export function isCfAccessVerificationConfigured(env = {}) {
  return Boolean(
    normalizeTeamHost(env.CF_ACCESS_TEAM_DOMAIN) &&
    String(env.CF_ACCESS_AUD || "").trim(),
  );
}

/**
 * Verify a Cloudflare Access JWT assertion.
 *
 * @param {string} assertion The raw `Cf-Access-Jwt-Assertion` header value.
 * @param {object} env       Worker env. Reads:
 *                             env.CF_ACCESS_TEAM_DOMAIN (required; team host or slug)
 *                             env.CF_ACCESS_AUD         (required; Access application AUD tag)
 * @param {object} [opts]    Optional. `opts.jwks` injects a `jose` key resolver
 *                           (used by tests to verify against a locally generated
 *                           keypair); defaults to the team's remote JWKS.
 * @returns {Promise<{ valid: true, email: string, payload: object }
 *                  | { valid: false, error: string, code: string }>}
 */
export async function verifyCfAccessAssertion(assertion, env = {}, opts = {}) {
  if (!assertion || typeof assertion !== "string") {
    return { valid: false, error: "missing assertion", code: "no_assertion" };
  }

  const teamHost = normalizeTeamHost(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = String(env.CF_ACCESS_AUD || "").trim();
  if (!teamHost || !aud) {
    return {
      valid: false,
      error: "access verification not configured",
      code: "not_configured",
    };
  }

  const issuer = `https://${teamHost}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;

  try {
    const jwks = opts.jwks || getRemoteJWKS(certsUrl);
    const { payload } = await jose.jwtVerify(assertion, jwks, {
      issuer,
      audience: aud,
    });

    const email = String(payload.email || payload.identity || "").toLowerCase();
    if (!email) {
      return {
        valid: false,
        error: "assertion has no email claim",
        code: "no_email_claim",
      };
    }
    return { valid: true, email, payload };
  } catch (err) {
    return {
      valid: false,
      error: err?.message || "assertion verification failed",
      code: err?.code || "verify_failed",
    };
  }
}
