/**
 * Tenant Data Migration Routes (Phase 5)
 *
 * Admin endpoints for migrating existing evidence data from the
 * shared chittyevidence-db to per-tenant Neon projects.
 *
 * All endpoints require admin-level authentication.
 */

import { Hono } from "hono";
import { TenantDataMigration } from "../../services/tenant-data-migration.js";

const migrationRoutes = new Hono();

/**
 * GET /api/v1/tenants/migration/discover
 * List all clients with evidence data in the shared DB
 */
migrationRoutes.get("/discover", async (c) => {
  try {
    const migration = new TenantDataMigration(c.env);
    const result = await migration.discoverClients();
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/v1/tenants/migration/plan
 * Plan the migration (dry-run) — shows what would happen
 */
migrationRoutes.get("/plan", async (c) => {
  try {
    const clientId = c.req.query("clientId");
    const migration = new TenantDataMigration(c.env);
    const result = await migration.plan({ clientId: clientId || undefined });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/v1/tenants/migration/execute
 * Execute the migration — provisions tenants and replicates data
 */
migrationRoutes.post("/execute", async (c) => {
  try {
    const { clientId, dryRun, region } = await c.req.json();

    const migration = new TenantDataMigration(c.env);
    const result = await migration.execute({
      clientId,
      dryRun: dryRun === true,
      region,
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { migrationRoutes };
