import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMockD1 } from "../helpers/mocks.js";

// Mock 1Password client — created before route import per module mock pattern
const mockPut = vi.fn();

vi.mock("../../src/services/1password-connect-client.js", () => ({
  OnePasswordConnectClient: class MockOnePasswordConnectClient {
    constructor() {}
    put(...args) {
      return mockPut(...args);
    }
  },
}));

const { credentialsRoutes } = await import("../../src/api/routes/credentials.js");

function createTestApp({ service = "test-service" } = {}) {
  const app = new Hono();
  // Simulate auth middleware setting apiKey context
  app.use("*", async (c, next) => {
    c.set("apiKey", { service });
    return next();
  });
  app.route("/api/credentials", credentialsRoutes);
  return app;
}

function makeEnv(dbOverrides = {}) {
  const db = createMockD1();
  if (dbOverrides.runFail) {
    db.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockRejectedValue(new Error("DB error")),
    });
  }
  return {
    DB: db,
    ONEPASSWORD_CONNECT_URL: "https://1password-connect.chitty.cc",
    ONEPASSWORD_CONNECT_TOKEN: "test-token",
    ONEPASSWORD_VAULT_INFRASTRUCTURE: "vault-infra-id",
    ONEPASSWORD_VAULT_SERVICES: "vault-svc-id",
    ONEPASSWORD_VAULT_INTEGRATIONS: "vault-int-id",
    ONEPASSWORD_VAULT_EMERGENCY: "vault-emergency-id",
    CREDENTIAL_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPut.mockResolvedValue({ stored: true, action: "created", item: "cloudflare" });
});

describe("PUT /api/credentials/:vault/:item/:field", () => {
  describe("success cases", () => {
    it("returns 201 when a new credential is created", async () => {
      const app = createTestApp();
      mockPut.mockResolvedValue({ stored: true, action: "created", item: "cloudflare" });

      const res = await app.request(
        "/api/credentials/infrastructure/cloudflare/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret-value" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe("created");
      expect(body.metadata.vault).toBe("infrastructure");
      expect(body.metadata.item).toBe("cloudflare");
      expect(body.metadata.field).toBe("api_key");
    });

    it("returns 200 when an existing credential is updated", async () => {
      const app = createTestApp();
      mockPut.mockResolvedValue({ stored: true, action: "updated", item: "cloudflare" });

      const res = await app.request(
        "/api/credentials/services/myservice/token",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "new-token", notes: "rotated 2026-05" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe("updated");
    });

    it("forwards notes to the put() call", async () => {
      const app = createTestApp();
      const env = makeEnv();

      await app.request(
        "/api/credentials/integrations/notion/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "notion-secret", notes: "rotated by CI" }),
        },
        env,
      );

      expect(mockPut).toHaveBeenCalledWith(
        "integrations/notion/api_key",
        "notion-secret",
        { notes: "rotated by CI" },
      );
    });

    it("continues and returns success when audit DB insert fails", async () => {
      const app = createTestApp();
      mockPut.mockResolvedValue({ stored: true, action: "created", item: "svc" });
      const env = makeEnv({ runFail: true });

      const res = await app.request(
        "/api/credentials/services/svc/token",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "my-token" }),
        },
        env,
      );

      // Audit failure must not surface as an error to callers
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe("invalid vault", () => {
    it("rejects unknown vault with 400", async () => {
      const app = createTestApp();

      const res = await app.request(
        "/api/credentials/emergency/item/field",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INVALID_VAULT");
    });

    it("rejects arbitrary vault names with 400", async () => {
      const app = createTestApp();

      const res = await app.request(
        "/api/credentials/nonexistent/item/field",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_VAULT");
    });
  });

  describe("missing or invalid body", () => {
    it("returns 400 when value is absent", async () => {
      const app = createTestApp();

      const res = await app.request(
        "/api/credentials/infrastructure/cloudflare/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "no value here" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("MISSING_VALUE");
    });
  });

  describe("downstream Connect failures", () => {
    it("returns 503 when Connect is not configured", async () => {
      const app = createTestApp();
      mockPut.mockRejectedValue(new Error("1Password Connect not configured"));

      const res = await app.request(
        "/api/credentials/infrastructure/cloudflare/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("CONNECT_NOT_CONFIGURED");
    });

    it("returns 403 on Connect forbidden / auth error", async () => {
      const app = createTestApp();
      mockPut.mockRejectedValue(new Error("Forbidden: insufficient token permissions"));

      const res = await app.request(
        "/api/credentials/infrastructure/cloudflare/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 500 for unexpected Connect errors", async () => {
      const app = createTestApp();
      mockPut.mockRejectedValue(new Error("Unexpected network failure"));

      const res = await app.request(
        "/api/credentials/infrastructure/cloudflare/api_key",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "secret" }),
        },
        makeEnv(),
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("STORE_FAILED");
    });
  });
});
