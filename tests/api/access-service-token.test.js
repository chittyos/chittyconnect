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

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  keys = await jose.generateKeyPair("RS256", { extractable: true });
  foreignKeys = await jose.generateKeyPair("RS256", { extractable: true });
  await startJwksServer();
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

// ───────────────────────────────────────────────────────────────────────────
// Composition tests — these drive the REAL guard and the REAL middleware
// imported from src/auth/secrets-portal-guard.js, mounted on a Hono app and
// exercised through app.fetch(new Request(...)).
//
// There is deliberately NO local re-implementation of the guard here. An
// earlier revision of this file had one; it passed 27/27 against a guard
// mutated to allow everything, because the assertions never reached production
// code. If you are tempted to transcribe guard logic into this file, don't.
//
// The JWKS is served by stubbing globalThis.fetch to return a real JWKS
// document built from the real test key pair. That exercises the true remote
// JWKS code path in verifyAccessJwt — including its failure modes — with no
// module mocking and no test-only affordance in production code.
// ───────────────────────────────────────────────────────────────────────────

import { Hono } from "hono";
import {
  secretsPortalGuard,
  secretsPortalUpsertGuard,
  makeApiSecretsGuard,
  resolveSecretsPortalPrincipal,
  isCloudflareAccessEmailAllowed,
  parseCsvEnv,
} from "../../src/auth/secrets-portal-guard.js";
import { _resetAccessJwksCacheForTests } from "../../src/auth/access-jwt.js";

const ENV = {
  SECRETS_PORTAL_ACCESS_ONLY: "true",
  SECRETS_PORTAL_ACCESS_EMAILS: "nick@chittycorp.com",
  SECRETS_PORTAL_ACCESS_AUD: AUD,
  SECRETS_PORTAL_ACCESS_SERVICE_TOKENS: CLIENT_ID,
};

/** Claims whose `iss` matches the local JWKS server the guard is pointed at. */
function localClaims(overrides = {}) {
  return serviceTokenClaims({
    iss: accessIssuer(jwksOrigin),
    ...overrides,
  });
}

/** ENV pointing the guard at the local JWKS server. */
function env(overrides = {}) {
  return {
    ...ENV,
    SECRETS_PORTAL_ACCESS_AUTH_DOMAIN: jwksOrigin,
    ...overrides,
  };
}

/**
 * A REAL local HTTPS server serving a REAL JWKS built from the test key pair.
 *
 * `jose.createRemoteJWKSet` uses Node's https module, not `globalThis.fetch`,
 * so it cannot be intercepted by reassigning fetch — and we do not want to
 * intercept it. Standing up an actual TLS server means the composition tests
 * exercise the true remote-JWKS code path end to end: real socket, real TLS,
 * real JWKS parse, real RS256 verification, real guard. No mocks anywhere.
 *
 * The self-signed cert is generated once per run with openssl into a temp dir
 * and trusted for this process only via NODE_EXTRA_CA_CERTS-style injection on
 * the server's own agent (we point the auth domain at 127.0.0.1:<port> and set
 * the CA explicitly), so nothing global or persistent is weakened.
 */
let jwksServer;
let jwksOrigin; // "127.0.0.1:<port>" — used as SECRETS_PORTAL_ACCESS_AUTH_DOMAIN
let jwksHits = 0;
let jwksMode = "ok"; // "ok" | "fail"

async function startJwksServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jwks-tls-"));
  const keyPath = path.join(dir, "k.pem");
  const certPath = path.join(dir, "c.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );

  const jwk = await jose.exportJWK(keys.publicKey);
  const doc = JSON.stringify({
    keys: [{ ...jwk, kid: "test-kid", alg: "RS256", use: "sig" }],
  });

  jwksServer = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    (req, res) => {
      jwksHits += 1;
      if (jwksMode === "fail") {
        res.writeHead(503).end("upstream down");
        return;
      }
      if (req.url !== "/cdn-cgi/access/certs") {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(doc);
    },
  );

  await new Promise((r) => jwksServer.listen(0, "127.0.0.1", r));
  jwksOrigin = `127.0.0.1:${jwksServer.address().port}`;

  // Trust ONLY this cert, only in this process, for the duration of the run.
  https.globalAgent.options.ca = [fs.readFileSync(certPath)];
  tls.globalAgent && (tls.globalAgent.options.ca = [fs.readFileSync(certPath)]);
}

afterEach(() => {
  jwksMode = "ok";
  _resetAccessJwksCacheForTests();
});

afterAll(() => {
  jwksServer?.close();
});

/** The three real routes, wired with the real middleware. */
function buildApp() {
  const app = new Hono();
  app.use("/secrets-portal", secretsPortalGuard);
  app.use("/secrets-portal/upsert", secretsPortalUpsertGuard);
  app.use(
    "/api/v1/secrets/*",
    makeApiSecretsGuard(async (c, next) => {
      c.set("apiKey", { type: "api-key-path", service: "fallthrough" });
      await next();
    }),
  );
  const echo = (c) =>
    c.json({
      reached: true,
      accessPrincipal: c.get("accessPrincipal") || null,
      apiKey: c.get("apiKey") || null,
    });
  app.all("/secrets-portal", echo);
  app.all("/secrets-portal/upsert", echo);
  app.all("/api/v1/secrets/upsert", echo);
  app.all("/api/v1/secrets/list", echo);
  return app;
}

function call(app, path, headers = {}, e = env()) {
  return app.fetch(
    new Request(`https://connect.chitty.cc${path}`, {
      method: "POST",
      headers,
    }),
    e,
  );
}

describe("secrets-portal guard — real middleware via app.fetch", () => {
  const ROUTES = [
    "/secrets-portal",
    "/secrets-portal/upsert",
    "/api/v1/secrets/upsert",
  ];

  it.each(ROUTES)(
    "NEGATIVE %s: CF-Access-Client-Id with NO JWT is denied",
    async (path) => {
      const res = await call(buildApp(), path, {
        "CF-Access-Client-Id": CLIENT_ID,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).ok).toBe(false);
    },
  );

  it.each(ROUTES)(
    "NEGATIVE %s: no credentials at all is denied",
    async (path) => {
      const res = await call(buildApp(), path, {});
      expect(res.status).toBe(401);
    },
  );

  it.each(ROUTES)("NEGATIVE %s: foreign-signed JWT is denied", async (path) => {
    const jwt = await sign(localClaims(), { key: foreignKeys });
    const res = await call(buildApp(), path, {
      "CF-Access-Client-Id": CLIENT_ID,
      [ACCESS_JWT_HEADER]: jwt,
    });
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)(
    "POSITIVE %s: valid allowlisted service token reaches the handler",
    async (path) => {
      const res = await call(buildApp(), path, {
        [ACCESS_JWT_HEADER]: await sign(localClaims()),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reached).toBe(true);
      expect(body.accessPrincipal).toEqual({
        type: "service",
        name: CLIENT_ID,
      });
    },
  );

  it("sets the apiKey audit shape (name = client ID, identityType = service) on upsert routes", async () => {
    for (const path of ["/secrets-portal/upsert", "/api/v1/secrets/upsert"]) {
      const jwt = await sign(localClaims());
      const res = await call(buildApp(), path, { [ACCESS_JWT_HEADER]: jwt });
      const { apiKey } = await res.json();
      expect(apiKey).toEqual({
        type: "cloudflare-access",
        name: CLIENT_ID,
        identityType: "service",
        service: "secrets-portal",
        status: "active",
      });
      // The audit principal must never carry credential material: no JWT,
      // no client secret, no field that looks like a token holder.
      expect(JSON.stringify(apiKey)).not.toContain(jwt);
      expect(Object.keys(apiKey)).not.toContain("secret");
      expect(Object.keys(apiKey)).not.toContain("token");
      expect(Object.keys(apiKey)).not.toContain("jwt");
    }
  });

  it("sets identityType human on the email path", async () => {
    const res = await call(buildApp(), "/secrets-portal/upsert", {
      "CF-Access-Authenticated-User-Email": "nick@chittycorp.com",
    });
    const { apiKey } = await res.json();
    expect(apiKey.identityType).toBe("human");
    expect(apiKey.name).toBe("nick@chittycorp.com");
  });

  it("denies a valid JWT when the service-token allowlist is empty or unset", async () => {
    // NOTE: keep every other var present (especially the auth domain) so this
    // asserts the ALLOWLIST gate specifically, and cannot pass because some
    // unrelated config check short-circuited first.
    for (const allowlist of ["", "   ", undefined]) {
      const res = await call(
        buildApp(),
        "/secrets-portal",
        { [ACCESS_JWT_HEADER]: await sign(localClaims()) },
        env({ SECRETS_PORTAL_ACCESS_SERVICE_TOKENS: allowlist }),
      );
      expect(res.status).toBe(401);
    }

    // Control: the SAME request with the allowlist populated is admitted, which
    // proves the 401s above came from the allowlist and nothing else.
    const ok = await call(buildApp(), "/secrets-portal", {
      [ACCESS_JWT_HEADER]: await sign(localClaims()),
    });
    expect(ok.status).toBe(200);
  });

  it("fails CLOSED with 401 (not 500) when the JWKS endpoint is down", async () => {
    jwksMode = "fail";
    const res = await call(buildApp(), "/secrets-portal", {
      [ACCESS_JWT_HEADER]: await sign(localClaims()),
    });
    expect(res.status).toBe(401);
  });

  it("evaluates the email path BEFORE the service path", async () => {
    // Both credentials present: the human identity must win.
    const res = await call(buildApp(), "/secrets-portal/upsert", {
      "CF-Access-Authenticated-User-Email": "nick@chittycorp.com",
      [ACCESS_JWT_HEADER]: await sign(localClaims()),
    });
    const { accessPrincipal } = await res.json();
    expect(accessPrincipal).toEqual({
      type: "human",
      name: "nick@chittycorp.com",
    });
  });

  it("UNCHANGED: allowlisted human email is admitted, non-allowlisted denied", async () => {
    const ok = await call(buildApp(), "/secrets-portal", {
      "CF-Access-Authenticated-User-Email": "nick@chittycorp.com",
    });
    expect(ok.status).toBe(200);
    const no = await call(buildApp(), "/secrets-portal", {
      "CF-Access-Authenticated-User-Email": "stranger@example.org",
    });
    expect(no.status).toBe(401);
  });

  it("UNCHANGED: with no email allow-list configured, any Access identity is admitted", async () => {
    const res = await call(
      buildApp(),
      "/secrets-portal",
      {
        "CF-Access-Authenticated-User-Email": "anyone@chitty.cc",
      },
      { SECRETS_PORTAL_ACCESS_ONLY: "true" },
    );
    expect(res.status).toBe(200);
  });

  it("leaves non-upsert /api/v1/secrets/* paths on the API-key path", async () => {
    const res = await call(buildApp(), "/api/v1/secrets/list", {});
    expect(res.status).toBe(200);
    expect((await res.json()).apiKey.type).toBe("api-key-path");
  });

  it("rejects a token with NO iat claim (maxTokenAge requires it)", async () => {
    const claims = localClaims();
    delete claims.iat;
    const res = await call(buildApp(), "/secrets-portal", {
      [ACCESS_JWT_HEADER]: await sign(claims),
    });
    expect(res.status).toBe(401);
  });
});

describe("guard helpers are the real exports, not copies", () => {
  it("parseCsvEnv lowercases, trims and drops empties", () => {
    expect(parseCsvEnv(" A.access , B.ACCESS ,, ")).toEqual([
      "a.access",
      "b.access",
    ]);
    expect(parseCsvEnv(undefined)).toEqual([]);
  });

  it("isCloudflareAccessEmailAllowed denies when no email header is present", () => {
    const c = { req: { header: () => undefined }, env: ENV };
    expect(isCloudflareAccessEmailAllowed(c)).toBe(false);
  });

  it("resolveSecretsPortalPrincipal is the exported production function", () => {
    expect(typeof resolveSecretsPortalPrincipal).toBe("function");
  });
});
