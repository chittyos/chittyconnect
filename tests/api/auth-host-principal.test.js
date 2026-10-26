/**
 * Host principal (CF Access service token) on POST /api/credentials/provision.
 *
 * Runs the real `authenticate` middleware and the real credentials router in a
 * Hono app. The env is hand-built: HOST_ACCESS_* are shaped like Secrets Store
 * bindings (object with async .get()), API_KEYS is an empty KV-shaped store.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authenticate, digestsEqual } from "../../src/api/middleware/auth.js";
import {
  credentialsRoutes,
  capHostPrincipalTtl,
  HOST_PRINCIPAL_MAX_TTL_MS,
} from "../../src/api/routes/credentials.js";

const HOST_ID = "3b54c400-fc77-4950-bb3f-c48bdd4ea636.access";
const HOST_SECRET = "host-principal-test-secret-value";

const secretsStoreBinding = (value) => ({ get: async () => value });

function buildEnv(overrides = {}) {
  return {
    API_KEYS: { get: async () => null },
    HOST_ACCESS_CLIENT_ID: secretsStoreBinding(HOST_ID),
    HOST_ACCESS_CLIENT_SECRET: secretsStoreBinding(HOST_SECRET),
    ...overrides,
  };
}

// Captures what `authenticate` set, then stops before any downstream handler
// so tests (a)-(c) exercise authentication alone.
function authProbeApp() {
  const app = new Hono();
  app.use("/api/*", authenticate);
  app.all("/api/*", (c) => c.json({ principal: c.get("apiKey") }));
  return app;
}

function fullApp() {
  const app = new Hono();
  app.use("/api/*", authenticate);
  app.route("/api/credentials", credentialsRoutes);
  return app;
}

const hostHeaders = (id = HOST_ID, secret = HOST_SECRET) => ({
  "Content-Type": "application/json",
  "CF-Access-Client-Id": id,
  "CF-Access-Client-Secret": secret,
});

const provisionBody = JSON.stringify({
  type: "cloudflare_workers_deploy",
  context: { service: "chittyconnect" },
});

describe("host principal on /api/credentials/provision", () => {
  it("(a) authenticates matching CF Access headers on POST /provision", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      { method: "POST", headers: hostHeaders(), body: provisionBody },
      buildEnv(),
    );
    expect(res.status).toBe(200);
    const { principal } = await res.json();
    expect(principal).toEqual({
      type: "cloudflare-access-host",
      service: "chittyserv-vm",
      scopes: ["credentials:provision"],
      status: "active",
    });
  });

  it.each([
    ["POST", "/api/credentials/audit"],
    ["POST", "/api/credentials/revoke"],
    ["POST", "/api/v1/context/sync"],
    ["GET", "/api/credentials/provision"],
    ["POST", "/api/credentials/provision/extra"],
  ])(
    "(b) does NOT authenticate matching headers on %s %s",
    async (method, path) => {
      const res = await authProbeApp().request(
        path,
        { method, headers: hostHeaders() },
        buildEnv(),
      );
      expect(res.status).toBe(401);
    },
  );

  it("(c) wrong secret falls through to 401", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      {
        method: "POST",
        headers: hostHeaders(HOST_ID, `${HOST_SECRET}x`),
        body: provisionBody,
      },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("(c) wrong client id falls through to 401", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      {
        method: "POST",
        headers: hostHeaders("someone-else.access", HOST_SECRET),
        body: provisionBody,
      },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("(c) missing headers fall through to 401", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: provisionBody,
      },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("(c) missing bindings fall through to 401", async () => {
    const env = buildEnv();
    delete env.HOST_ACCESS_CLIENT_ID;
    delete env.HOST_ACCESS_CLIENT_SECRET;
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      { method: "POST", headers: hostHeaders(), body: provisionBody },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("(c) empty bindings plus empty headers do not authenticate", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      { method: "POST", headers: hostHeaders("", ""), body: provisionBody },
      buildEnv({
        HOST_ACCESS_CLIENT_ID: secretsStoreBinding(""),
        HOST_ACCESS_CLIENT_SECRET: secretsStoreBinding(""),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("(c) a Secrets Store binding whose .get() rejects falls through to 401", async () => {
    const res = await authProbeApp().request(
      "/api/credentials/provision",
      { method: "POST", headers: hostHeaders(), body: provisionBody },
      buildEnv({
        HOST_ACCESS_CLIENT_SECRET: {
          get: async () => {
            throw new Error("secret not found");
          },
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("(d) a disallowed credential type gets 403 HOST_PRINCIPAL_TYPE_NOT_ALLOWED", async () => {
    const res = await fullApp().request(
      "/api/credentials/provision",
      {
        method: "POST",
        headers: hostHeaders(),
        body: JSON.stringify({
          type: "cloudflare_r2_access",
          context: { service: "chittyconnect" },
        }),
      },
      buildEnv(),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("HOST_PRINCIPAL_TYPE_NOT_ALLOWED");
  });

  it.each([
    ["trailing slash", "/api/credentials/provision/"],
    ["double leading slash", "//api/credentials/provision"],
    ["encoded trailing slash", "/api/credentials/provision%2F"],
    ["upper-case prefix", "/API/credentials/provision"],
  ])(
    "(e) path variant (%s) does NOT authenticate as host principal",
    async (_n, path) => {
      const res = await authProbeApp().request(
        path,
        { method: "POST", headers: hostHeaders(), body: provisionBody },
        buildEnv(),
      );
      // 401 where the auth middleware runs; 404 where the router never matches
      // the path (so authenticate is not reached). Never 200 as host principal.
      expect([401, 404]).toContain(res.status);
    },
  );

  // The incoming header is the literal string a coerced object would hash to,
  // so without the type guard this would authenticate.
  it.each([
    ["client id", { HOST_ACCESS_CLIENT_ID: secretsStoreBinding({}) }, "id"],
    [
      "client secret",
      { HOST_ACCESS_CLIENT_SECRET: secretsStoreBinding({}) },
      "secret",
    ],
  ])(
    "(f) a non-string %s binding value does not authenticate",
    async (_n, over, which) => {
      const coerced = String({});
      const headers =
        which === "id"
          ? hostHeaders(coerced, HOST_SECRET)
          : hostHeaders(HOST_ID, coerced);
      const res = await authProbeApp().request(
        "/api/credentials/provision",
        { method: "POST", headers, body: provisionBody },
        buildEnv(over),
      );
      expect(res.status).toBe(401);
    },
  );
});

describe("capHostPrincipalTtl", () => {
  const yearMs = 365 * 24 * 60 * 60 * 1000;

  it("caps a 1-year ttl to exactly 3600000", () => {
    expect(capHostPrincipalTtl({ ttl: yearMs, permissions: ["a"] }).ttl).toBe(
      3600000,
    );
    expect(HOST_PRINCIPAL_MAX_TTL_MS).toBe(3600000);
  });

  it("leaves a 10-minute ttl unchanged", () => {
    expect(capHostPrincipalTtl({ ttl: 600000 }).ttl).toBe(600000);
  });

  it("applies the cap when ttl is absent", () => {
    expect(capHostPrincipalTtl({}).ttl).toBe(3600000);
  });

  it("throws on undefined typeConfig", () => {
    expect(() => capHostPrincipalTtl(undefined)).toThrow();
  });

  it("preserves permissions and does not mutate the input", () => {
    const input = { ttl: yearMs, permissions: ["workers:write", "kv:read"] };
    const out = capHostPrincipalTtl(input);
    expect(out.permissions).toEqual(["workers:write", "kv:read"]);
    expect(input.ttl).toBe(yearMs);
  });
});

describe("digestsEqual type guard", () => {
  it("rejects non-string and empty inputs instead of coercing them", async () => {
    // Without the guard, {} hashes as "[object Object]" and matches this string.
    expect(await digestsEqual({}, "[object Object]")).toBe(false);
    expect(await digestsEqual("[object Object]", {})).toBe(false);
    expect(await digestsEqual("", "")).toBe(false);
    expect(await digestsEqual(undefined, undefined)).toBe(false);
  });

  it("accepts equal non-empty strings and rejects unequal ones", async () => {
    expect(await digestsEqual("abc", "abc")).toBe(true);
    expect(await digestsEqual("abc", "abd")).toBe(false);
  });
});
