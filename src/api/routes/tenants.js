/**
 * Tenant Management Routes
 *
 * CRUD operations for Neon project-per-tenant lifecycle.
 * All endpoints require authentication.
 */

import { Hono } from "hono";
import { TenantProjectManager } from "../../services/tenant-project-manager.js";

const tenantRoutes = new Hono();

/**
 * POST /api/v1/tenants/provision
 * Provision a new tenant Neon project
 */
tenantRoutes.post("/provision", async (c) => {
  try {
    const { tenantId, region, pgVersion } = await c.req.json();

    if (!tenantId) {
      return c.json({ error: "tenantId is required" }, 400);
    }

    const manager = new TenantProjectManager(c.env);
    const result = await manager.provisionTenant(tenantId, { region, pgVersion });
    return c.json(result, 201);
  } catch (error) {
    const status = error.message.includes("already provisioned") ? 409 : 500;
    return c.json({ error: error.message }, status);
  }
});

/**
 * GET /api/v1/tenants/:tenantId
 * Get tenant project details
 */
tenantRoutes.get("/:tenantId", async (c) => {
  try {
    const tenantId = c.req.param("tenantId");
    const manager = new TenantProjectManager(c.env);
    const record = await manager.getTenantRecord(tenantId);

    if (!record) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    return c.json({
      tenantId: record.tenant_id,
      neonProjectId: record.neon_project_id,
      region: record.neon_region,
      status: record.status,
      pgVersion: record.pg_version,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/v1/tenants
 * List all tenant projects
 */
tenantRoutes.get("/", async (c) => {
  try {
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const manager = new TenantProjectManager(c.env);
    const result = await manager.listTenants({ status, limit, offset });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/v1/tenants/:tenantId/export
 * Export tenant project metadata
 */
tenantRoutes.post("/:tenantId/export", async (c) => {
  try {
    const tenantId = c.req.param("tenantId");
    const manager = new TenantProjectManager(c.env);
    const result = await manager.exportTenant(tenantId);
    return c.json(result);
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : 500;
    return c.json({ error: error.message }, status);
  }
});

/**
 * DELETE /api/v1/tenants/:tenantId
 * Deprovision a tenant's Neon project
 */
tenantRoutes.delete("/:tenantId", async (c) => {
  try {
    const tenantId = c.req.param("tenantId");
    const manager = new TenantProjectManager(c.env);
    const result = await manager.deprovisionTenant(tenantId);
    return c.json(result);
  } catch (error) {
    const status = error.message.includes("not found") ? 404 : 500;
    return c.json({ error: error.message }, status);
  }
});

export { tenantRoutes };
