/**
 * Access guard for the ChittySecrets portal write path.
 *
 * Lives in its own module — NOT inline in `src/index.js` — so that tests can
 * import and drive the exact functions and middleware production runs. An
 * earlier revision of this change kept the guard inline and the test suite
 * re-implemented it locally; that transcription passed 27/27 against a guard
 * mutated to `return { type: "human", name: "ATTACKER-ALLOW-EVERYTHING" }`.
 * Divergence between a copy and production is invisible by construction, which
 * is precisely the failure class this guard exists to prevent. Do not
 * reintroduce a second copy of this logic anywhere, including in tests.
 *
 * Routes protected: POST /secrets-portal, /secrets-portal/upsert,
 * /api/v1/secrets/upsert — the only write path into the ChittySecrets cold
 * store.
 */

import {
  ACCESS_JWT_HEADER,
  verifyAccessJwt,
  serviceTokenPrincipal,
} from "./access-jwt.js";

export function parseCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Human (identity) path — UNCHANGED behaviour, byte-for-byte the same
 * decisions as before service-token support was added, including the
 * "no allow-list configured => trust the Access identity header" branch.
 *
 * This trusts `CF-Access-Authenticated-User-Email` without verifying the JWT.
 * That is pre-existing behaviour, deliberately left alone here. What makes it
 * hold is an edge property, not an origin check: Cloudflare strips inbound
 * client-supplied `CF-Access-*` headers before they reach the Worker, so the
 * header cannot be forged by a caller and only Access itself can set it.
 * Verified 2026-09-04 via `wrangler tail` — a request to the un-fronted
 * workers.dev hostname carrying `CF-Access-Authenticated-User-Email` and a
 * control header arrived at the Worker with the control header present and the
 * CF-Access header absent, and the request 401'd.
 *
 * Caveat worth keeping in view: that is defence supplied by the platform, not
 * by this code, and this Worker is publicly reachable at
 * chittyconnect.ccorp.workers.dev with no Access application in front of it.
 * The durable fix is to verify the JWT and read `payload.email` from it rather
 * than trusting the header; that is deliberately NOT done in this change
 * because it cannot be exercised without authenticating as a human, and
 * getting it wrong locks the operator out of the secrets portal.
 */
export function isCloudflareAccessEmailAllowed(c) {
  const email = (
    c.req.header("CF-Access-Authenticated-User-Email") || ""
  ).toLowerCase();
  if (!email) return false;

  const allowedEmails = parseCsvEnv(c.env.SECRETS_PORTAL_ACCESS_EMAILS);
  const allowedDomains = parseCsvEnv(c.env.SECRETS_PORTAL_ACCESS_DOMAINS);

  if (allowedEmails.length > 0 && allowedEmails.includes(email)) return true;
  if (allowedDomains.length > 0) {
    const domain = email.split("@")[1] || "";
    if (allowedDomains.includes(domain)) return true;
  }

  // Default-deny if allow-lists configured but no match.
  if (allowedEmails.length > 0 || allowedDomains.length > 0) return false;

  // If no allow-list configured, still require Access identity header.
  return true;
}

/**
 * Service-token (non-identity) path.
 *
 * Cloudflare Access service tokens carry NO identity, so no
 * `CF-Access-Authenticated-User-Email` header ever arrives for them — which
 * is why the email check above rejected every service token unconditionally
 * and left incident-response rotations with no non-human write path.
 *
 * Trust here rests solely on the cryptographically verified
 * `Cf-Access-Jwt-Assertion`. `CF-Access-Client-Id` is NOT consulted: Access
 * strips it before the origin, so its presence proves nothing, and trusting
 * it bare is exactly the defect chittysecrets removed in commit 7d946b0.
 *
 * Fails closed on every error — a JWKS fetch failure, malformed token, or
 * misconfiguration yields the same 401 as an absent token, never a 500.
 *
 * @returns {Promise<string|null>} allowlisted client ID, or null to deny
 */
export async function resolveAccessServiceTokenPrincipal(c) {
  try {
    // Unset or empty allowlist MUST mean deny, not allow.
    const allowedClientIds = parseCsvEnv(
      c.env.SECRETS_PORTAL_ACCESS_SERVICE_TOKENS,
    );
    if (allowedClientIds.length === 0) return null;

    const authDomain = String(
      c.env.SECRETS_PORTAL_ACCESS_AUTH_DOMAIN || "",
    ).trim();
    const audienceTag = String(c.env.SECRETS_PORTAL_ACCESS_AUD || "").trim();
    if (!authDomain || !audienceTag) return null;

    const jwt = c.req.header(ACCESS_JWT_HEADER);
    if (!jwt) return null;

    const payload = await verifyAccessJwt(jwt, { authDomain, audienceTag });
    return serviceTokenPrincipal(payload, allowedClientIds);
  } catch (err) {
    // Never log the token itself — only the reason.
    console.warn(
      "[secrets-portal] Access service-token verification denied:",
      err?.message || String(err),
    );
    return null;
  }
}

/**
 * Resolve the calling principal for the secrets-portal write path.
 * Email path is evaluated first and is unchanged.
 *
 * @returns {Promise<{type: "human"|"service", name: string}|null>}
 *          null means deny.
 */
export async function resolveSecretsPortalPrincipal(c) {
  if (isCloudflareAccessEmailAllowed(c)) {
    return {
      type: "human",
      name: c.req.header("CF-Access-Authenticated-User-Email") || "unknown",
    };
  }

  const clientId = await resolveAccessServiceTokenPrincipal(c);
  if (clientId) return { type: "service", name: clientId };

  return null;
}

/** Principal metadata stashed on the context for downstream audit logging. */
function setPrincipal(c, principal) {
  c.set("accessPrincipal", principal);
  c.set("apiKey", {
    type: "cloudflare-access",
    // For a service token this is the Access Client ID (an identifier, not a
    // credential — Access strips the Client Secret before the origin).
    name: principal.name,
    identityType: principal.type,
    service: "secrets-portal",
    status: "active",
  });
}

/** Guard for GET/POST /secrets-portal. */
export async function secretsPortalGuard(c, next) {
  const principal = await resolveSecretsPortalPrincipal(c);
  if (!principal) {
    return c.json(
      { ok: false, error: "Cloudflare Access required for secrets portal" },
      401,
    );
  }
  c.set("accessPrincipal", principal);
  await next();
}

/** Guard for POST /secrets-portal/upsert. */
export async function secretsPortalUpsertGuard(c, next) {
  const principal = await resolveSecretsPortalPrincipal(c);
  if (!principal) {
    return c.json(
      { ok: false, error: "Cloudflare Access required for secrets portal" },
      401,
    );
  }
  setPrincipal(c, principal);
  await next();
}

/**
 * Guard factory for /api/v1/secrets/*. Only /api/v1/secrets/upsert is gated on
 * Access (and only when SECRETS_PORTAL_ACCESS_ONLY is true); every other path
 * under the prefix falls through to the normal API-key `authenticate`.
 */
export function makeApiSecretsGuard(authenticate) {
  return async function apiSecretsGuard(c, next) {
    const accessOnly =
      String(c.env.SECRETS_PORTAL_ACCESS_ONLY || "").toLowerCase() === "true";
    const isPortalUpsertPath = c.req.path === "/api/v1/secrets/upsert";

    if (accessOnly && isPortalUpsertPath) {
      const principal = await resolveSecretsPortalPrincipal(c);
      if (!principal) {
        return c.json(
          { ok: false, error: "Cloudflare Access required for secret upsert" },
          401,
        );
      }
      setPrincipal(c, principal);
      await next();
      return;
    }

    await authenticate(c, next);
  };
}
