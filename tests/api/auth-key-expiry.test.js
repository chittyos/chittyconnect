// API-key expiry parity: the main /api/* middleware must honor the same
// expiresAt contract already enforced by the MCP API-key middleware.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { authenticate } from "../../src/api/middleware/auth.js";

function authedApp(record) {
  const app = new Hono();
  app.use("/api/*", authenticate);
  app.get("/api/protected", (c) => c.json({ ok: true, caller: c.get("apiKey")?.userId }));
  return {
    request: () => app.request("/api/protected", {
      headers: { "X-ChittyOS-API-Key": "synthetic-test-key" },
    }, {
      API_KEYS: {
        get: async (key) => key === "key:synthetic-test-key" ? JSON.stringify(record) : null,
      },
    }),
  };
}

describe("main ChittyConnect API key expiry", () => {
  it.each([
    ["expired timestamp", "2020-01-01T00:00:00.000Z"],
    ["expired date-only dashboard key", "2020-01-01"],
    ["malformed expiry", "invalid-forever"],
  ])("denies %s before any protected route runs", async (_kind, expiresAt) => {
    const app = authedApp({
      status: "active", userId: "P-synthetic-expired", scopes: ["mcp:read"], expiresAt,
    });
    const response = await app.request();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("API_KEY_EXPIRED");
  });

  it("allows an active unexpired key through the existing API-key middleware", async () => {
    const app = authedApp({
      status: "active", userId: "P-synthetic-current",
      scopes: ["mcp:read"], expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const response = await app.request();
    expect(response.status).toBe(200);
    expect((await response.json()).caller).toBe("P-synthetic-current");
  });

  it.each([null, undefined, ""])(
    "preserves an existing non-expiring key metadata value (%s)", async (expiresAt) => {
      const app = authedApp({
        status: "active", userId: "P-synthetic-legacy", scopes: ["mcp:read"], expiresAt,
      });
      const response = await app.request();
      expect(response.status).toBe(200);
    },
  );

  it("still rejects inactive keys, with or without an expiry", async () => {
    const app = authedApp({
      status: "revoked", userId: "P-synthetic-revoked", expiresAt: null,
    });
    const response = await app.request();
    expect(response.status).toBe(401);
  });
});
