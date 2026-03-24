/**
 * Tenant Management Routes
 *
 * CRUD operations for Neon project-per-tenant lifecycle.
 * All endpoints require authentication.
 */

import { Hono } from "hono";
import { TenantProjectManager } from "../../services/tenant-project-manager.js";
import { queryTenantDb } from "../../lib/tenant-connection-router.js";

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

    // Strip connection URIs from list response to prevent credential leakage
    const safeTenants = result.tenants.map(
      ({ connection_uri_encrypted, ...rest }) => rest,
    );

    return c.json({ tenants: safeTenants, total: result.total });
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
 * POST /api/v1/tenants/:tenantId/replicate
 * Replicate a record to the tenant's Neon project
 */
tenantRoutes.post("/:tenantId/replicate", async (c) => {
  try {
    const tenantId = c.req.param("tenantId");
    const { table, record } = await c.req.json();

    if (!table || !record) {
      return c.json({ error: "table and record are required" }, 400);
    }

    // Allowlist of tables that can be replicated to tenant DBs
    const allowedTables = ["evidence_documents", "evidence_custody_log", "document_families", "client_documents"];
    if (!allowedTables.includes(table)) {
      return c.json({ error: `table '${table}' is not allowed for tenant replication` }, 400);
    }

    const columns = Object.keys(record);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${columns.map((col, i) => `${col} = $${i + 1}`).join(", ")}`;

    const result = await queryTenantDb(c.env, tenantId, sql, Object.values(record));

    return c.json({
      replicated: true,
      table,
      recordId: record.id,
      layer: result.layer,
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
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
