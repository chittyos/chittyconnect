// Regression for #313: a user-facing API key can never mint broader scopes.
// Requests exercise the real Hono route and the real key generator.
// Only the Cloudflare KV persistence boundary uses an in-memory test adapter.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { authKeysRoutes } from "../../src/api/routes/auth-keys.js";

function createHarness(caller) {
  const stored = [];
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (caller !== null) c.set("apiKey", caller);
    await next();
  });
  app.route("/api/auth/keys", authKeysRoutes);
  const env = {
    API_KEYS: {
      put: async (_key, raw) => {
        stored.push(JSON.parse(raw));
      },
    },
  };
  return {
    stored,
    request: (body) => app.request("/api/auth/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, env),
  };
}

const reader = { status: "active", userId: "P-synthetic-user-01", scopes: ["mcp:read"] };
const writer = { status: "active", userId: "P-synthetic-user-02", scopes: ["mcp:read", "mcp:write"] };

describe("POST /api/auth/keys self-service admission", () => {
  it.each([
    ["credential reveal", ["credentials:reveal:infrastructure"]],
    ["credential reveal with extra scope", ["mcp:read", "credentials:reveal:services"]],
    ["MCP admin", ["mcp:admin"]],
    ["unknown scope", ["chittyauth:admin"]],
    ["untyped scope", "mcp:write"],
    ["duplicate scopes", ["mcp:read", "mcp:read"]],
    ["empty scope", []],
  ])("rejects %s before a KV write", async (_label, scopes) => {
    const h = createHarness(writer);
    const response = await h.request({ name: "test-user-key", scopes });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_KEY_SCOPES");
    expect(h.stored).toHaveLength(0);
  });

  it("cannot mint a permission the parent key does not already hold", async () => {
    const h = createHarness(reader);
    const response = await h.request({ name: "reader-not-writer", scopes: ["mcp:write"] });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("SCOPE_ESCALATION_DENIED");
    expect(h.stored).toHaveLength(0);
  });

  it("never grants defaults missing on the parent", async () => {
    const h = createHarness(reader);
    const response = await h.request({ name: "reader-only" });
    expect(response.status).toBe(201);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0].scopes).toEqual(["mcp:read"]);
    expect(h.stored[0].metadata).toEqual({
      issuance: "self-service",
      issuerUserId: reader.userId,
    });
    expect((await response.json()).data.scopes).toEqual(["mcp:read"]);
  });

  it("allows a narrowed key under an already-authorized writer", async () => {
    const h = createHarness(writer);
    const response = await h.request({ name: "limited", scopes: ["mcp:read"] });
    expect(response.status).toBe(201);
    expect(h.stored[0].scopes).toEqual(["mcp:read"]);
    expect(h.stored[0].userId).toBe(writer.userId);
  });

  it("rejects legacy keys without a user or scope rather than granting implicit read", async () => {
    for (const caller of [null, { userId: "P-synthetic", scopes: [] }, { scopes: ["mcp:read"] }]) {
      const h = createHarness(caller);
      const response = await h.request({ name: "request-default" });
      expect([400, 403]).toContain(response.status);
      expect(h.stored).toHaveLength(0);
    }
  });

  it.each([
    ["newline", "trusted-service\nspoof"],
    ["control", "x\u0007"],
    ["bidi", "safe\u202Espoof"],
    ["non-string", { not: "a name" }],
    ["empty", "    "],
  ])("rejects %s from display label before persistence", async (_label, name) => {
    const h = createHarness(writer);
    const response = await h.request({ name, scopes: ["mcp:read"] });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_KEY_NAME");
    expect(h.stored).toHaveLength(0);
  });

  it("rejects invalid expiry and does not create an immortal token inadvertently", async () => {
    const h = createHarness(writer);
    const response = await h.request({
      name: "expired",
      scopes: ["mcp:read"],
      expiresAt: "2020-01-01T00:00:00Z",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_KEY_EXPIRY");
    expect(h.stored).toHaveLength(0);
  });
});
