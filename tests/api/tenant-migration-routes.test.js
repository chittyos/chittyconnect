import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockMigrationInstance = {
  discoverClients: vi.fn().mockResolvedValue({
    clients: [{ clientId: "client-a", documentCount: 5 }],
  }),
  plan: vi.fn().mockResolvedValue({
    mode: "dry-run",
    totalClients: 1,
    clients: [{ clientId: "client-a", documents: 5, custodyLogs: 2, families: 1 }],
    totals: { documents: 5, custodyLogs: 2, families: 1, alreadyProvisioned: 0, needsProvisioning: 1 },
  }),
  execute: vi.fn().mockResolvedValue({
    mode: "execute",
    startedAt: "2026-01-01T00:00:00Z",
    clients: [{ clientId: "client-a", provisioned: true, documents: 5, custodyLogs: 2, families: 1 }],
    totals: { provisioned: 1, documents: 5, custodyLogs: 2, families: 1, errors: 0 },
    completedAt: "2026-01-01T00:00:05Z",
  }),
};

vi.mock("../../src/services/tenant-data-migration.js", () => {
  class MockTenantDataMigration {
    constructor() {
      this.discoverClients = mockMigrationInstance.discoverClients;
      this.plan = mockMigrationInstance.plan;
      this.execute = mockMigrationInstance.execute;
    }
  }
  return { TenantDataMigration: MockTenantDataMigration };
});

const { migrationRoutes } = await import(
  "../../src/api/routes/tenant-migration.js"
);

function createTestApp() {
  const app = new Hono();
  app.route("/api/v1/tenants/migration", migrationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set defaults after clearAllMocks
  mockMigrationInstance.discoverClients.mockResolvedValue({
    clients: [{ clientId: "client-a", documentCount: 5 }],
  });
  mockMigrationInstance.plan.mockResolvedValue({
    mode: "dry-run",
    totalClients: 1,
    clients: [{ clientId: "client-a", documents: 5, custodyLogs: 2, families: 1 }],
    totals: { documents: 5, custodyLogs: 2, families: 1, alreadyProvisioned: 0, needsProvisioning: 1 },
  });
  mockMigrationInstance.execute.mockResolvedValue({
    mode: "execute",
    startedAt: "2026-01-01T00:00:00Z",
    clients: [{ clientId: "client-a", provisioned: true, documents: 5, custodyLogs: 2, families: 1 }],
    totals: { provisioned: 1, documents: 5, custodyLogs: 2, families: 1, errors: 0 },
    completedAt: "2026-01-01T00:00:05Z",
  });
});

describe("Tenant Migration Routes", () => {
  describe("GET /discover", () => {
    it("returns discovered clients", async () => {
      const app = createTestApp();
      const res = await app.request("/api/v1/tenants/migration/discover", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.clients).toHaveLength(1);
      expect(body.clients[0].clientId).toBe("client-a");
    });

    it("returns 500 on error", async () => {
      mockMigrationInstance.discoverClients.mockRejectedValueOnce(
        new Error("DB unavailable"),
      );

      const app = createTestApp();
      const res = await app.request("/api/v1/tenants/migration/discover", {
        method: "GET",
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("DB unavailable");
    });
  });

  describe("GET /plan", () => {
    it("returns migration plan", async () => {
      const app = createTestApp();
      const res = await app.request("/api/v1/tenants/migration/plan", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("dry-run");
      expect(body.totalClients).toBe(1);
    });

    it("passes clientId query param", async () => {
      const app = createTestApp();
      await app.request(
        "/api/v1/tenants/migration/plan?clientId=client-b",
        { method: "GET" },
      );

      expect(mockMigrationInstance.plan).toHaveBeenCalledWith({
        clientId: "client-b",
      });
    });
  });

  describe("POST /execute", () => {
    it("executes migration", async () => {
      const app = createTestApp();
      const res = await app.request("/api/v1/tenants/migration/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("execute");
      expect(body.totals.provisioned).toBe(1);
    });

    it("passes options to execute", async () => {
      const app = createTestApp();
      await app.request("/api/v1/tenants/migration/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "client-a",
          dryRun: true,
          region: "aws-us-west-2",
        }),
      });

      expect(mockMigrationInstance.execute).toHaveBeenCalledWith({
        clientId: "client-a",
        dryRun: true,
        region: "aws-us-west-2",
      });
    });

    it("returns 500 on error", async () => {
      mockMigrationInstance.execute.mockRejectedValueOnce(
        new Error("Migration failed"),
      );

      const app = createTestApp();
      const res = await app.request("/api/v1/tenants/migration/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Migration failed");
    });
  });
});
