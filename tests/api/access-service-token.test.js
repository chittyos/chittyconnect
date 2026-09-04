/**
 * Cloudflare Access service-token auth for the ChittySecrets portal write path.
 *
 * NO MOCKS. Every JWT in this file is a real RS256 token signed with a real
 * RSA key pair generated at test time by `jose`, and verified through the same
 * `verifyAccessJwt()` the worker runs in production. The only test affordance
 * is passing the local public key as `keySet` instead of fetching the remote
 * JWKS — the signature, issuer, audience, exp, iat and claim checks are all
 * the production code paths, unmodified.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as jose from "jose";

import {
  ACCESS_JWT_HEADER,
  accessIssuer,
  accessJwksUrl,
  verifyAccessJwt,
  serviceTokenPrincipal,
} from "../../src/auth/access-jwt.js";

const AUTH_DOMAIN = "chittycorp.cloudflareaccess.com";
const AUD = "27d61f1a1143bec18325a5acd65a9d49ac381a450bbb9d610e682bdd3679eaba";
const CLIENT_ID = "142a1994adbbbf34550eaa1792bcd1b6.access";
const ALLOWLIST = [CLIENT_ID];

let keys; // the "real" Access signing key
let foreignKeys; // an attacker's key, same alg

/** Sign a genuine RS256 JWT with the given claims. */
async function sign(claims, { key = keys, alg = "RS256" } = {}) {
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg, kid: "test-kid" })
    .sign(key.privateKey);
}

/** The claim shape Cloudflare Access actually emits for a service token. */
function serviceTokenClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: AUD,
    iss: accessIssuer(AUTH_DOMAIN),
    common_name: CLIENT_ID,
    sub: "",
    type: "app",
    iat: now,
    exp: now + 600,
    ...overrides,
  };
}

function verify(jwt, { keySet = keys.publicKey, audienceTag = AUD } = {}) {
  return verifyAccessJwt(jwt, { authDomain: AUTH_DOMAIN, audienceTag, keySet });
}

beforeAll(async () => {
  keys = await jose.generateKeyPair("RS256");
  foreignKeys = await jose.generateKeyPair("RS256");
});

describe("access-jwt: endpoint derivation", () => {
  it("derives the team JWKS and issuer Cloudflare actually uses", () => {
    // Both confirmed against a live production Access JWT.
    expect(accessJwksUrl(AUTH_DOMAIN)).toBe(
      "https://chittycorp.cloudflareaccess.com/cdn-cgi/access/certs",
    );
    expect(accessIssuer(AUTH_DOMAIN)).toBe(
      "https://chittycorp.cloudflareaccess.com",
    );
  });

  it("reads the header Access actually forwards to the origin", () => {
    expect(ACCESS_JWT_HEADER).toBe("Cf-Access-Jwt-Assertion");
  });
});

describe("verifyAccessJwt: cryptographic verification", () => {
  it("accepts a well-formed, correctly signed service-token JWT", async () => {
    const payload = await verify(await sign(serviceTokenClaims()));
    expect(payload.common_name).toBe(CLIENT_ID);
    expect(payload.email).toBeUndefined();
  });

  it("rejects a signature from a foreign key", async () => {
    const jwt = await sign(serviceTokenClaims(), { key: foreignKeys });
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects a token whose aud is a different Access application", async () => {
    const jwt = await sign(serviceTokenClaims({ aud: "f".repeat(64) }));
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects a token issued by a different Access team", async () => {
    const jwt = await sign(
      serviceTokenClaims({ iss: "https://evil.cloudflareaccess.com" }),
    );
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await sign(
      serviceTokenClaims({ iat: now - 7200, exp: now - 3600 }),
    );
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects a token whose iat is older than the max age, even if exp is far future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await sign(
      serviceTokenClaims({
        iat: now - 60 * 60 * 24 * 30,
        exp: now + 60 * 60 * 24 * 30,
      }),
    );
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects an unsigned (alg=none) token", async () => {
    const jwt = new jose.UnsecuredJWT(serviceTokenClaims()).encode();
    await expect(verify(jwt)).rejects.toThrow();
  });

  it("rejects a missing token rather than treating absence as trust", async () => {
    await expect(verify(undefined)).rejects.toThrow(/Missing Access JWT/);
    await expect(verify("")).rejects.toThrow(/Missing Access JWT/);
  });

  it("rejects when the audience tag is unconfigured (fail closed, not open)", async () => {
    const jwt = await sign(serviceTokenClaims());
    await expect(verify(jwt, { audienceTag: "" })).rejects.toThrow(
      /audience tag is not configured/,
    );
  });

  it("rejects when the auth domain is unconfigured", async () => {
    const jwt = await sign(serviceTokenClaims());
    await expect(
      verifyAccessJwt(jwt, {
        authDomain: "",
        audienceTag: AUD,
        keySet: keys.publicKey,
      }),
    ).rejects.toThrow(/auth domain is not configured/);
  });
});

describe("serviceTokenPrincipal: allowlist decision", () => {
  it("admits an allowlisted client ID and returns it as the principal", async () => {
    const payload = await verify(await sign(serviceTokenClaims()));
    expect(serviceTokenPrincipal(payload, ALLOWLIST)).toBe(CLIENT_ID);
  });

  it("denies a validly signed token whose client ID is not allowlisted", async () => {
    const payload = await verify(
      await sign(serviceTokenClaims({ common_name: "deadbeef.access" })),
    );
    expect(serviceTokenPrincipal(payload, ALLOWLIST)).toBeNull();
  });

  it("denies when the allowlist is empty — unset must not mean allow", async () => {
    const payload = await verify(await sign(serviceTokenClaims()));
    expect(serviceTokenPrincipal(payload, [])).toBeNull();
    expect(serviceTokenPrincipal(payload, undefined)).toBeNull();
    expect(serviceTokenPrincipal(payload, null)).toBeNull();
  });

  it("denies a token with no common_name claim", async () => {
    const claims = serviceTokenClaims();
    delete claims.common_name;
    const payload = await verify(await sign(claims));
    expect(serviceTokenPrincipal(payload, ALLOWLIST)).toBeNull();
  });

  it("denies an email-bearing token on the service path", async () => {
    const payload = await verify(
      await sign(serviceTokenClaims({ email: "nick@chittycorp.com" })),
    );
    expect(serviceTokenPrincipal(payload, ALLOWLIST)).toBeNull();
  });

  it("matches client IDs case-insensitively, as parseCsvEnv lowercases", async () => {
    const payload = await verify(
      await sign(serviceTokenClaims({ common_name: CLIENT_ID.toUpperCase() })),
    );
    expect(serviceTokenPrincipal(payload, ALLOWLIST)).toBe(CLIENT_ID);
  });

  it("denies a non-object payload", () => {
    expect(serviceTokenPrincipal(null, ALLOWLIST)).toBeNull();
    expect(serviceTokenPrincipal("not-a-payload", ALLOWLIST)).toBeNull();
  });
});

/**
 * The guard as the worker composes it. This mirrors
 * `resolveSecretsPortalPrincipal()` in src/index.js: email path first
 * (unchanged), then the verified service-token path, deny otherwise.
 *
 * The critical case is the last one — a caller presenting CF-Access-Client-Id
 * with no JWT must be denied. That is the shape chittysecrets commit 7d946b0
 * removed, and it must never come back.
 */
async function resolvePrincipal({ headers = {}, env = {} } = {}) {
  const get = (name) => {
    const k = Object.keys(headers).find(
      (h) => h.toLowerCase() === name.toLowerCase(),
    );
    return k ? headers[k] : undefined;
  };
  const csv = (v) =>
    String(v || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

  const email = (get("CF-Access-Authenticated-User-Email") || "").toLowerCase();
  if (email) {
    const allowedEmails = csv(env.SECRETS_PORTAL_ACCESS_EMAILS);
    const allowedDomains = csv(env.SECRETS_PORTAL_ACCESS_DOMAINS);
    if (allowedEmails.length > 0 && allowedEmails.includes(email))
      return { type: "human", name: email };
    if (allowedDomains.length > 0) {
      const domain = email.split("@")[1] || "";
      if (allowedDomains.includes(domain))
        return { type: "human", name: email };
    }
    if (allowedEmails.length > 0 || allowedDomains.length > 0) return null;
    return { type: "human", name: email };
  }

  try {
    const allowed = csv(env.SECRETS_PORTAL_ACCESS_SERVICE_TOKENS);
    if (allowed.length === 0) return null;
    const authDomain = String(
      env.SECRETS_PORTAL_ACCESS_AUTH_DOMAIN || "",
    ).trim();
    const audienceTag = String(env.SECRETS_PORTAL_ACCESS_AUD || "").trim();
    if (!authDomain || !audienceTag) return null;
    const jwt = get(ACCESS_JWT_HEADER);
    if (!jwt) return null;
    const payload = await verifyAccessJwt(jwt, {
      authDomain,
      audienceTag,
      keySet: keys.publicKey,
    });
    const clientId = serviceTokenPrincipal(payload, allowed);
    return clientId ? { type: "service", name: clientId } : null;
  } catch {
    return null;
  }
}

describe("secrets-portal guard composition", () => {
  const ENV = {
    SECRETS_PORTAL_ACCESS_ONLY: "true",
    SECRETS_PORTAL_ACCESS_EMAILS: "nick@chittycorp.com",
    SECRETS_PORTAL_ACCESS_AUTH_DOMAIN: AUTH_DOMAIN,
    SECRETS_PORTAL_ACCESS_AUD: AUD,
    SECRETS_PORTAL_ACCESS_SERVICE_TOKENS: CLIENT_ID,
  };

  it("NEGATIVE: a CF-Access-Client-Id header with no JWT is denied", async () => {
    const principal = await resolvePrincipal({
      headers: { "CF-Access-Client-Id": CLIENT_ID },
      env: ENV,
    });
    expect(principal).toBeNull();
  });

  it("NEGATIVE: a spoofed CF-Access-Client-Id plus a foreign-signed JWT is denied", async () => {
    const principal = await resolvePrincipal({
      headers: {
        "CF-Access-Client-Id": CLIENT_ID,
        [ACCESS_JWT_HEADER]: await sign(serviceTokenClaims(), {
          key: foreignKeys,
        }),
      },
      env: ENV,
    });
    expect(principal).toBeNull();
  });

  it("NEGATIVE: no credentials at all is denied", async () => {
    expect(await resolvePrincipal({ headers: {}, env: ENV })).toBeNull();
  });

  it("POSITIVE: a valid, allowlisted service-token JWT is admitted as a service principal", async () => {
    const principal = await resolvePrincipal({
      headers: { [ACCESS_JWT_HEADER]: await sign(serviceTokenClaims()) },
      env: ENV,
    });
    expect(principal).toEqual({ type: "service", name: CLIENT_ID });
  });

  it("denies a valid JWT when the service-token allowlist is unset", async () => {
    const { SECRETS_PORTAL_ACCESS_SERVICE_TOKENS, ...envNoAllowlist } = ENV;
    const principal = await resolvePrincipal({
      headers: { [ACCESS_JWT_HEADER]: await sign(serviceTokenClaims()) },
      env: envNoAllowlist,
    });
    expect(principal).toBeNull();
  });

  it("UNCHANGED: an allowlisted human email is still admitted, with no JWT involved", async () => {
    const principal = await resolvePrincipal({
      headers: { "CF-Access-Authenticated-User-Email": "nick@chittycorp.com" },
      env: ENV,
    });
    expect(principal).toEqual({
      type: "human",
      name: "nick@chittycorp.com",
    });
  });

  it("UNCHANGED: a non-allowlisted human email is still denied", async () => {
    const principal = await resolvePrincipal({
      headers: { "CF-Access-Authenticated-User-Email": "stranger@example.org" },
      env: ENV,
    });
    expect(principal).toBeNull();
  });

  it("UNCHANGED: with no email allow-list configured, any Access identity is still admitted", async () => {
    const principal = await resolvePrincipal({
      headers: { "CF-Access-Authenticated-User-Email": "anyone@chitty.cc" },
      env: { SECRETS_PORTAL_ACCESS_ONLY: "true" },
    });
    expect(principal).toEqual({ type: "human", name: "anyone@chitty.cc" });
  });
});
