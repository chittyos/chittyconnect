/**
 * tests/secrets/portal-propagator.test.js
 *
 * Integration tests for propagateSecret().
 * Uses real Node http servers as fixture endpoints — no vi.mock(), no module stubs.
 * Each test spins up its own server on 127.0.0.1:0 and tears it down after.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { propagateSecret } from "../../src/secrets/portal-propagator.js";

// ── Test server factory ──────────────────────────────────────────────────────

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function captureBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve(data); }
    });
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_ENVELOPE = {
  requestId: "test-req-001",
  path: "services/my-api/token",
  instructions: "add to prod",
  updatedAt: new Date().toISOString(),
  requestedBy: "nick@chittycorp.com",
  context: {},
};

const SECRET_VALUE = "s3cr3t-v@lue-never-in-output";

function makeEnv(overrides = {}) {
  return {
    CHITTYOS_ACCOUNT_ID: "acct-test-001",
    SECRETS_PORTAL_CF_STORE_ID: "store-test-001",
    CHITTYCHRONICLE_SERVICE_URL: null,
    CHITTY_CHRONICLE_TOKEN: null,
    CREDENTIAL_CACHE: {
      _store: {},
      async put(k, v, opts) { this._store[k] = v; },
      async get(k) { return this._store[k] ?? null; },
      async delete(k) { delete this._store[k]; },
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("propagateSecret", () => {
  describe("skipped — no config", () => {
    it("returns skipped:true and does not throw when neither 1P nor CF is configured", async () => {
      const env = makeEnv();
      // Pre-populate KV so we can assert it is NOT deleted
      await env.CREDENTIAL_CACHE.put(`secret:intake:${BASE_ENVELOPE.requestId}`, "envelope-data");

      const result = await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);

      expect(result.skipped).toBe(true);
      // KV retained
      expect(await env.CREDENTIAL_CACHE.get(`secret:intake:${BASE_ENVELOPE.requestId}`)).toBe("envelope-data");
    });

    it("never includes plaintext in skipped result", async () => {
      const env = makeEnv();
      const result = await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);
      expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
    });
  });

  describe("happy path — all configs present", () => {
    let opServer, cfServer, chronicleServer;
    let opRequests, cfRequests, chronicleRequests;

    beforeEach(async () => {
      opRequests = [];
      cfRequests = [];
      chronicleRequests = [];

      // 1P Connect: search returns empty, POST creates item
      opServer = await startServer(async (req, res) => {
        const body = await captureBody(req);
        opRequests.push({ method: req.method, url: req.url, body });
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([])); // no existing item
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "op-item-abc123", title: "TOKEN" }));
        }
      });

      cfServer = await startServer(async (req, res) => {
        const body = await captureBody(req);
        cfRequests.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: [{ name: "TOKEN" }], success: true }));
      });

      chronicleServer = await startServer(async (req, res) => {
        const body = await captureBody(req);
        chronicleRequests.push({ body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    afterEach(async () => {
      await Promise.all([
        stopServer(opServer.server),
        stopServer(cfServer.server),
        stopServer(chronicleServer.server),
      ]);
    });

    it("returns ok:true and deletes KV on full success", async () => {
      const env = makeEnv({
        OP_CONNECT_WRITE_TOKEN: "op-write-jwt",
        ONEPASSWORD_CONNECT_URL: opServer.url,
        OP_VAULT_ID_DEFAULT: "vault-abc",
        SECRETS_PORTAL_CF_API_TOKEN: "cf-api-token",
        SECRETS_PORTAL_CF_API_BASE: cfServer.url,
        CHITTYCHRONICLE_SERVICE_URL: chronicleServer.url,
        CHITTY_CHRONICLE_TOKEN: "chronicle-token",
      });
      await env.CREDENTIAL_CACHE.put(`secret:intake:${BASE_ENVELOPE.requestId}`, "envelope-data");

      const result = await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);

      expect(result.ok).toBe(true);
      expect(result.steps.onepassword.ok).toBe(true);
      expect(result.steps.cloudflare.ok).toBe(true);
      expect(result.steps.kvCleanup.ok).toBe(true);
      // KV record deleted
      expect(await env.CREDENTIAL_CACHE.get(`secret:intake:${BASE_ENVELOPE.requestId}`)).toBeNull();
    });

    it("sends plaintext value to 1P and CF but never surfaces it in result", async () => {
      const env = makeEnv({
        OP_CONNECT_WRITE_TOKEN: "op-write-jwt",
        ONEPASSWORD_CONNECT_URL: opServer.url,
        OP_VAULT_ID_DEFAULT: "vault-abc",
        SECRETS_PORTAL_CF_API_TOKEN: "cf-api-token",
        SECRETS_PORTAL_CF_API_BASE: cfServer.url,
        CHITTYCHRONICLE_SERVICE_URL: chronicleServer.url,
        CHITTY_CHRONICLE_TOKEN: "chronicle-token",
      });

      const result = await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);

      // Plaintext written to 1P (intentional — it's the SoT write)
      const opCreate = opRequests.find((r) => r.method === "POST");
      const credField = opCreate?.body?.fields?.find((f) => f.id === "credential");
      expect(credField?.value).toBe(SECRET_VALUE);

      // Plaintext written to CF (intentional — runtime delivery)
      expect(cfRequests[0]?.body?.[0]?.value).toBe(SECRET_VALUE);

      // Plaintext never in result
      expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);

      // Chronicle payload never contains plaintext
      expect(JSON.stringify(chronicleRequests)).not.toContain(SECRET_VALUE);
    });

    it("does not send plaintext in Chronicle payload", async () => {
      const env = makeEnv({
        OP_CONNECT_WRITE_TOKEN: "op-write-jwt",
        ONEPASSWORD_CONNECT_URL: opServer.url,
        OP_VAULT_ID_DEFAULT: "vault-abc",
        SECRETS_PORTAL_CF_API_TOKEN: "cf-api-token",
        SECRETS_PORTAL_CF_API_BASE: cfServer.url,
        CHITTYCHRONICLE_SERVICE_URL: chronicleServer.url,
        CHITTY_CHRONICLE_TOKEN: "chronicle-token",
      });

      await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);
      expect(JSON.stringify(chronicleRequests)).not.toContain(SECRET_VALUE);
    });
  });

  describe("partial failure — 1P succeeds, CF 403 → INSUFFICIENT_SCOPE", () => {
    let opServer, cfServer;

    beforeEach(async () => {
      opServer = await startServer(async (req, res) => {
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "op-item-xyz", title: "TOKEN" }));
        }
      });

      cfServer = await startServer(async (req, res) => {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Permission denied" }] }));
      });
    });

    afterEach(async () => {
      await Promise.all([stopServer(opServer.server), stopServer(cfServer.server)]);
    });

    it("returns ok:false with INSUFFICIENT_SCOPE and retains KV", async () => {
      const env = makeEnv({
        OP_CONNECT_WRITE_TOKEN: "op-write-jwt",
        ONEPASSWORD_CONNECT_URL: opServer.url,
        OP_VAULT_ID_DEFAULT: "vault-abc",
        SECRETS_PORTAL_CF_API_TOKEN: "cf-api-token",
        SECRETS_PORTAL_CF_API_BASE: cfServer.url,
      });
      await env.CREDENTIAL_CACHE.put(`secret:intake:${BASE_ENVELOPE.requestId}`, "envelope-data");

      const result = await propagateSecret(env, BASE_ENVELOPE, SECRET_VALUE);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("INSUFFICIENT_SCOPE");
      expect(result.failedStep).toBe("cloudflare");
      // KV retained — not deleted
      expect(await env.CREDENTIAL_CACHE.get(`secret:intake:${BASE_ENVELOPE.requestId}`)).toBe("envelope-data");
      // Never expose plaintext in error
      expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
    });
  });
});
