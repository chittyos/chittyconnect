import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockKV } from "../helpers/mocks.js";

const mockDiscoverServices = vi.fn().mockResolvedValue({
  services: [
    { name: "chittyid", url: "https://id.chitty.cc", status: "healthy" },
    { name: "chittyauth", url: "https://auth.chitty.cc", status: "healthy" },
  ],
});

vi.mock("../../src/integrations/chittyos-ecosystem.js", () => ({
  ChittyOSEcosystem: class MockEcosystem {
    constructor() {}
    discoverServices(...args) { return mockDiscoverServices(...args); }
  },
}));

const { connectRoutes } = await import("../../src/api/routes/connect.js");

describe("connect discovery routes", () => {
  let mockKV;

  beforeEach(() => {
    mockKV = createMockKV();
    mockDiscoverServices.mockResolvedValue({
      services: [
        { name: "chittyid", url: "https://id.chitty.cc", status: "healthy" },
        { name: "chittyauth", url: "https://auth.chitty.cc", status: "healthy" },
      ],
    });
  });

  function makeEnv(kvOverrides = {}) {
    return { COMMAND_KV: { ...mockKV, ...kvOverrides } };
  }

  describe("POST /discover", () => {
    it("returns discovered services", async () => {
      const env = makeEnv();
      const req = new Request("http://localhost/discover", { method: "POST" });

      const res = await connectRoutes.fetch(req, env);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.services).toHaveLength(2);
      expect(body.services[0].name).toBe("chittyid");
    });

    it("enforces rate limit from KV", async () => {
      const env = makeEnv({
        get: vi.fn()
          .mockResolvedValueOnce("5")   // discover:rate_limit = 5
          .mockResolvedValueOnce("5"),   // current count = 5 (at limit)
      });

      const req = new Request("http://localhost/discover", { method: "POST" });
      const res = await connectRoutes.fetch(req, env);
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.error).toBe("rate_limit_exceeded");
    });

    it("allows requests under the rate limit", async () => {
      const env = makeEnv({
        get: vi.fn()
          .mockResolvedValueOnce("60")  // discover:rate_limit = 60
          .mockResolvedValueOnce("10"), // current count = 10 (under limit)
        put: vi.fn().mockResolvedValue(undefined),
      });

      const req = new Request("http://localhost/discover", { method: "POST" });
      const res = await connectRoutes.fetch(req, env);

      expect(res.status).toBe(200);
    });

    it("works without COMMAND_KV (no rate limiting)", async () => {
      const env = {};
      const req = new Request("http://localhost/discover", { method: "POST" });
      const res = await connectRoutes.fetch(req, env);

      expect(res.status).toBe(200);
    });
  });
});
