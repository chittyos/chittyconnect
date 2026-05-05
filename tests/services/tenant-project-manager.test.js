import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantProjectManager } from "../../src/services/tenant-project-manager.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock credential-helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn().mockResolvedValue("test-neon-api-key"),
}));

// Mock tenant-migrations
vi.mock("../../src/lib/tenant-migrations.js", () => ({
  runTenantMigrations: vi.fn().mockResolvedValue({ applied: 2, total: 2 }),
}));

function createMockEnv() {
  return {
    NEON_API_KEY: "test-neon-api-key",
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    },
    TENANT_CONNECTIONS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TenantProjectManager", () => {
  describe("provisionTenant", () => {
    it("creates a Neon project and stores the mapping", async () => {
      const env = createMockEnv();
      const manager = new TenantProjectManager(env);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          project: { id: "neon-proj-123" },
          connection_uris: [
            { connection_uri: "postgresql://user:pass@host/db" },
          ],
        }),
      });

      const result = await manager.provisionTenant("tenant-abc", {
        region: "aws-us-east-2",
      });

      expect(result.tenantId).toBe("tenant-abc");
      expect(result.neonProjectId).toBe("neon-proj-123");
      expect(result.status).toBe("active");
      expect(result.region).toBe("aws-us-east-2");
      expect(result.migrationsApplied).toBe(2);

      // Verify Neon API was called
      expect(mockFetch).toHaveBeenCalledWith(
        "https://console.neon.tech/api/v2/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-neon-api-key",
          }),
        }),
      );

      // Verify D1 insert
      expect(env.DB.prepare).toHaveBeenCalled();

      // Verify KV cache
      expect(env.TENANT_CONNECTIONS.put).toHaveBeenCalledWith(
        "tenant:tenant-abc",
        "postgresql://user:pass@host/db",
        { expirationTtl: 3600 },
      );
    });

    it("rejects duplicate tenant provisioning", async () => {
      const env = createMockEnv();
      // Simulate existing record
      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ tenant_id: "tenant-abc" }),
          run: vi.fn(),
          all: vi.fn(),
        }),
      });

      const manager = new TenantProjectManager(env);
      await expect(manager.provisionTenant("tenant-abc")).rejects.toThrow(
        "already provisioned",
      );
    });

    it("requires tenantId", async () => {
      const env = createMockEnv();
      const manager = new TenantProjectManager(env);
      await expect(manager.provisionTenant("")).rejects.toThrow(
        "tenantId is required",
      );
    });
  });

  describe("getTenantConnection", () => {
    it("returns cached connection from KV", async () => {
      const env = createMockEnv();
      env.TENANT_CONNECTIONS.get.mockResolvedValue("postgresql://cached");

      const manager = new TenantProjectManager(env);
      const conn = await manager.getTenantConnection("tenant-abc");

      expect(conn).toBe("postgresql://cached");
      expect(env.DB.prepare).not.toHaveBeenCalled();
    });

    it("falls back to D1 when KV cache misses", async () => {
      const env = createMockEnv();
      env.TENANT_CONNECTIONS.get.mockResolvedValue(null);
      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            connection_uri_encrypted: "postgresql://from-d1",
          }),
        }),
      });

      const manager = new TenantProjectManager(env);
      const conn = await manager.getTenantConnection("tenant-abc");

      expect(conn).toBe("postgresql://from-d1");
      // Should re-cache in KV
      expect(env.TENANT_CONNECTIONS.put).toHaveBeenCalledWith(
        "tenant:tenant-abc",
        "postgresql://from-d1",
        { expirationTtl: 3600 },
      );
    });

    it("returns null for unknown tenant", async () => {
      const env = createMockEnv();
      const manager = new TenantProjectManager(env);
      const conn = await manager.getTenantConnection("nonexistent");
      expect(conn).toBeNull();
    });

    it("returns null for empty tenantId", async () => {
      const env = createMockEnv();
      const manager = new TenantProjectManager(env);
      const conn = await manager.getTenantConnection("");
      expect(conn).toBeNull();
    });
  });

  describe("deprovisionTenant", () => {
    it("deletes the Neon project and updates status", async () => {
      const env = createMockEnv();
      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            tenant_id: "tenant-abc",
            neon_project_id: "neon-proj-123",
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      });

      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      const manager = new TenantProjectManager(env);
      const result = await manager.deprovisionTenant("tenant-abc");

      expect(result.status).toBe("deprovisioned");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://console.neon.tech/api/v2/projects/neon-proj-123",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(env.TENANT_CONNECTIONS.delete).toHaveBeenCalledWith(
        "tenant:tenant-abc",
      );
    });

    it("throws for unknown tenant", async () => {
      const env = createMockEnv();
      const manager = new TenantProjectManager(env);
      await expect(manager.deprovisionTenant("nonexistent")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("exportTenant", () => {
    it("returns project metadata from Neon API", async () => {
      const env = createMockEnv();
      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            tenant_id: "tenant-abc",
            neon_project_id: "neon-proj-123",
            neon_region: "aws-us-east-2",
            pg_version: "16",
            status: "active",
          }),
        }),
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          project: { id: "neon-proj-123", name: "chittyos-tenant-tenant-abc" },
        }),
      });

      const manager = new TenantProjectManager(env);
      const result = await manager.exportTenant("tenant-abc");

      expect(result.tenantId).toBe("tenant-abc");
      expect(result.neonProjectId).toBe("neon-proj-123");
      expect(result.project.name).toBe("chittyos-tenant-tenant-abc");
      expect(result.exportedAt).toBeDefined();
    });
  });

  describe("listTenants", () => {
    it("returns paginated tenant list", async () => {
      const env = createMockEnv();
      const mockAll = vi.fn().mockResolvedValue({
        results: [
          { tenant_id: "t1", status: "active" },
          { tenant_id: "t2", status: "active" },
        ],
      });
      const mockFirst = vi.fn().mockResolvedValue({ total: 2 });

      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: mockAll,
          first: mockFirst,
        }),
      });

      const manager = new TenantProjectManager(env);
      const result = await manager.listTenants({ limit: 10, offset: 0 });

      expect(result.tenants).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      const env = createMockEnv();
      const mockBind = vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue({ total: 0 }),
      });
      env.DB.prepare.mockReturnValue({ bind: mockBind });

      const manager = new TenantProjectManager(env);
      await manager.listTenants({ status: "active" });

      // First call is the SELECT query, should include WHERE status = ?
      const selectCall = env.DB.prepare.mock.calls[0][0];
      expect(selectCall).toContain("WHERE status = ?");
    });

    it("throws when DB is unavailable", async () => {
      const env = { ...createMockEnv(), DB: undefined };
      const manager = new TenantProjectManager(env);
      await expect(manager.listTenants()).rejects.toThrow(
        "Platform DB (D1) not available",
      );
    });
  });
});
