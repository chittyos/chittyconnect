/**
 * Host principal (CF Access service token) on POST /api/credentials/provision.
 *
 * Runs the real `authenticate` middleware and the real credentials router in a
 * Hono app. The env is hand-built: HOST_ACCESS_* are shaped like Secrets Store
 * bindings (object with async .get()), API_KEYS is an empty KV-shaped store.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authenticate } from "../../src/api/middleware/auth.js";
import { credentialsRoutes } from "../../src/api/routes/credentials.js";

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
  ])("(b) does NOT authenticate matching headers on %s %s", async (method, path) => {
    const res = await authProbeApp().request(
      path,
      { method, headers: hostHeaders() },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

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
});
