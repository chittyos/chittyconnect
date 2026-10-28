import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { capabilityRoutes } from "../../src/api/routes/capabilities.js";
import { custodyRoutes } from "../../src/api/routes/custody.js";

function memoryKv(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key) => map.get(key) ?? null),
    put: vi.fn(async (key, value) => { map.set(key, value); }),
    delete: vi.fn(async (key) => { map.delete(key); }),
    _map: map,
  };
}

function policyDb(rows) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: rows })),
      })),
    })),
  };
}

function envFor(rows = [{ path_prefix: "/home/ubuntu/projects/github.com/CHITTYOS", access: "readwrite" }]) {
  return {
    API_KEYS: memoryKv({
      "key:test-api-key": JSON.stringify({
        status: "active",
        tenant_id: "chittyos-default",
        service: "test",
      }),
    }),
    TOKEN_KV: memoryKv(),
    DB: policyDb(rows),
  };
}

function capabilityApp() {
  const app = new Hono();
  app.route("/api/v1/capabilities", capabilityRoutes);
  return app;
}

const headers = {
  "X-ChittyOS-API-Key": "test-api-key",
  "Content-Type": "application/json",
};

const canonicalCaller = "01-A-OPS-TEST-P-2610-3-42";

describe("git capability control plane", () => {
  it("mints an opaque, single-operation capability and introspects it", async () => {
    const app = capabilityApp();
    const env = envFor();

    const mint = await app.request(
      "/api/v1/capabilities/mint",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          caller_chittyid: canonicalCaller,
          tenant_id: "chittyos-default",
          operation: "commit",
          repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/chittyconfig",
          ref: "refs/heads/test",
        }),
      },
      env,
    );

    expect(mint.status).toBe(201);
    const minted = await mint.json();
    expect(minted.token).toMatch(/^cap_/);
    expect(minted.scope).toMatchObject({
      operation: "commit",
      tenant_id: "chittyos-default",
      ref: "refs/heads/test",
    });
    expect(JSON.stringify(minted)).not.toContain("ghs_");

    const introspect = await app.request(
      "/api/v1/capabilities/introspect",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ token: minted.token }),
      },
      env,
    );

    expect(introspect.status).toBe(200);
    await expect(introspect.json()).resolves.toMatchObject({
      active: true,
      scope: {
        operation: "commit",
        repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/chittyconfig",
      },
    });
  });

  it("fails closed on invalid ChittyID, traversal, and read-only write scope", async () => {
    const app = capabilityApp();

    for (const body of [
      {
        caller_chittyid: "P:NOT-CANONICAL",
        tenant_id: "chittyos-default",
        operation: "read",
        repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/chittyconfig",
      },
      {
        caller_chittyid: canonicalCaller,
        tenant_id: "chittyos-default",
        operation: "read",
        repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/../secret",
      },
    ]) {
      const response = await app.request(
        "/api/v1/capabilities/mint",
        { method: "POST", headers, body: JSON.stringify(body) },
        envFor(),
      );
      expect(response.status).toBe(400);
    }

    const write = await app.request(
      "/api/v1/capabilities/mint",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          caller_chittyid: canonicalCaller,
          tenant_id: "chittyos-default",
          operation: "push",
          repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/chittyconfig",
          remote: "origin",
          ref: "refs/heads/test",
        }),
      },
      envFor([{ path_prefix: "/home/ubuntu/projects/github.com/CHITTYOS", access: "read" }]),
    );
    expect(write.status).toBe(403);
  });

  it("re-checks the repo allowlist during introspection", async () => {
    const app = capabilityApp();
    const rows = [{ path_prefix: "/home/ubuntu/projects/github.com/CHITTYOS", access: "read" }];
    const env = envFor(rows);

    const mint = await app.request(
      "/api/v1/capabilities/mint",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          caller_chittyid: canonicalCaller,
          tenant_id: "chittyos-default",
          operation: "read",
          repo_path: "/home/ubuntu/projects/github.com/CHITTYOS/chittyconfig",
        }),
      },
      env,
    );
    const { token } = await mint.json();

    rows.splice(0, rows.length);
    const introspect = await app.request(
      "/api/v1/capabilities/introspect",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ token }),
      },
      env,
    );
    await expect(introspect.json()).resolves.toEqual({ active: false });
  });

  it("never treats raw provider credentials as capabilities", async () => {
    const app = capabilityApp();
    const response = await app.request(
      "/api/v1/capabilities/introspect",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ token: "ghs_not_a_capability" }),
      },
      envFor(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
  });
});

describe("custody diagnostic", () => {
  it("reports missing signer/ledger authority honestly and fails strict readiness", async () => {
    const app = new Hono();
    app.route("/api/v1/health", custodyRoutes);
    const env = envFor();
    env.SVC_SECRETS = {};
    env.SVC_LEDGER = {};

    const response = await app.request(
      "/api/v1/health/custody-verify",
      { headers: { "X-ChittyOS-API-Key": "test-api-key" } },
      env,
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      github_app_id_present: false,
      github_app_pk_valid: false,
      broker_signing_key_custody: "unverified",
      ledger_emission_authority: "unverified",
      signer_binding_present: true,
      ledger_binding_present: true,
      ready_for_gate_4_tx: false,
    });
  });
});
