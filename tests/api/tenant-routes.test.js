import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock TenantProjectManager before importing the routes
const mockProvision = vi.fn();
const mockGetRecord = vi.fn();
const mockListTenants = vi.fn();
const mockExport = vi.fn();
const mockDeprovision = vi.fn();

vi.mock("../../src/services/tenant-project-manager.js", () => ({
  TenantProjectManager: class MockTPM {
    constructor() {
      this.provisionTenant = mockProvision;
      this.getTenantRecord = mockGetRecord;
      this.listTenants = mockListTenants;
      this.exportTenant = mockExport;
      this.deprovisionTenant = mockDeprovision;
    }
  },
}));

const { tenantRoutes } = await import("../../src/api/routes/tenants.js");

let app;
beforeEach(() => {
  vi.clearAllMocks();
  app = new Hono();
  app.route("/api/v1/tenants", tenantRoutes);
});

describe("POST /api/v1/tenants/provision", () => {
  it("provisions a new tenant", async () => {
    mockProvision.mockResolvedValue({
      tenantId: "org-123",
      neonProjectId: "neon-proj-456",
      region: "aws-us-east-2",
      status: "active",
      createdAt: "2026-03-24T00:00:00Z",
    });

    const res = await app.request("/api/v1/tenants/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "org-123" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tenantId).toBe("org-123");
    expect(body.status).toBe("active");
  });

  it("returns 400 without tenantId", async () => {
    const res = await app.request("/api/v1/tenants/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("tenantId is required");
  });

  it("returns 409 for duplicate tenant", async () => {
    mockProvision.mockRejectedValue(
      new Error("Tenant org-123 already provisioned"),
    );

    const res = await app.request("/api/v1/tenants/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "org-123" }),
    });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/v1/tenants/:tenantId", () => {
  it("returns tenant details", async () => {
    mockGetRecord.mockResolvedValue({
      tenant_id: "org-123",
      neon_project_id: "neon-proj-456",
      neon_region: "aws-us-east-2",
      status: "active",
      pg_version: "16",
      created_at: "2026-03-24T00:00:00Z",
      updated_at: "2026-03-24T00:00:00Z",
    });

    const res = await app.request("/api/v1/tenants/org-123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("org-123");
  });

  it("returns 404 for missing tenant", async () => {
    mockGetRecord.mockResolvedValue(null);

    const res = await app.request("/api/v1/tenants/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/tenants", () => {
  it("returns paginated list", async () => {
    mockListTenants.mockResolvedValue({
      tenants: [{ tenant_id: "t1" }, { tenant_id: "t2" }],
      total: 2,
    });

    const res = await app.request("/api/v1/tenants");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenants).toHaveLength(2);
    expect(body.total).toBe(2);
  });
});

describe("POST /api/v1/tenants/:tenantId/export", () => {
  it("returns export bundle", async () => {
    mockExport.mockResolvedValue({
      tenantId: "org-123",
      neonProjectId: "neon-proj-456",
      exportedAt: "2026-03-24T00:00:00Z",
    });

    const res = await app.request("/api/v1/tenants/org-123/export", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("org-123");
  });

  it("returns 404 for missing tenant", async () => {
    mockExport.mockRejectedValue(new Error("Tenant org-123 not found"));

    const res = await app.request("/api/v1/tenants/org-123/export", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/tenants/:tenantId", () => {
  it("deprovisions tenant", async () => {
    mockDeprovision.mockResolvedValue({
      tenantId: "org-123",
      status: "deprovisioned",
    });

    const res = await app.request("/api/v1/tenants/org-123", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("deprovisioned");
  });

  it("returns 404 for missing tenant", async () => {
    mockDeprovision.mockRejectedValue(new Error("Tenant org-123 not found"));

    const res = await app.request("/api/v1/tenants/org-123", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
