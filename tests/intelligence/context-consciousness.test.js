import { describe, it, expect, beforeEach } from "vitest";
import { ContextConsciousness } from "../../src/intelligence/context-consciousness.js";

describe("ContextConsciousness health checks", () => {
  let consciousness;

  beforeEach(() => {
    consciousness = new ContextConsciousness({
      PORTAL_STATUS_URL: "https://mcp.chitty.cc/api/v1/servers",
      PORTAL_API_KEY: "test-api-key",
    });
  });

  it("fetches status from the MCP Portal server-list endpoint", async () => {
    const mockServers = {
      servers: [
        { id: "chittyagent-tasks", status: "Ready" },
        { id: "chittyledger", status: "Sync Required" }
      ]
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      expect(url).toBe("https://mcp.chitty.cc/api/v1/servers");
      expect(options.headers.Authorization).toBe("Bearer test-api-key");
      return {
        ok: true,
        json: async () => mockServers,
      };
    };

    try {
      const health1 = await consciousness.checkServiceHealth("chittyagent-tasks", {});
      expect(health1.status).toBe("healthy");
      expect(health1.details.status).toBe("Ready");

      const health2 = await consciousness.checkServiceHealth("chittyledger", {});
      expect(health2.status).toBe("down");
      expect(health2.details.status).toBe("Sync Required");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
