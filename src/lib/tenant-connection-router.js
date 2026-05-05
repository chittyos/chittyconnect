/**
 * Tenant Connection Router
 *
 * Resolves tenant context from a request and returns the appropriate
 * Neon database connection string — either tenant-owned or platform.
 *
 * @module lib/tenant-connection-router
 */

import { Client } from "@neondatabase/serverless";
import { TenantProjectManager } from "../services/tenant-project-manager.js";
import { getCredential } from "./credential-helper.js";

/**
 * Get a connected Neon Client for a tenant's database
 *
 * @param {object} env - Worker environment bindings
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<{client: Client, layer: string}>} Connected client and which layer it points to
 */
export async function getTenantDb(env, tenantId) {
  if (tenantId) {
    const manager = new TenantProjectManager(env);
    const connectionUri = await manager.getTenantConnection(tenantId);

    if (connectionUri) {
      const client = new Client({ connectionString: connectionUri });
      try {
        await client.connect();
      } catch (err) {
        throw new Error(
          `Failed to connect to tenant ${tenantId} database: ${err.message}`,
        );
      }
      return { client, layer: "tenant" };
    }

    // Tenant was requested but has no connection — this is an error, not a fallback
    throw new Error(
      `Tenant ${tenantId} has no connection string. ` +
        `The Neon project may not have been fully provisioned.`,
    );
  }

  // No tenantId provided — use platform DB (shared Neon)
  const platformUri = await getCredential(
    env,
    "integrations/neon/database_url",
    "NEON_DATABASE_URL",
    "TenantRouter",
  );

  if (!platformUri) {
    throw new Error(
      "No database connection available — platform DB not configured",
    );
  }

  const client = new Client({ connectionString: platformUri });
  await client.connect();
  return { client, layer: "platform" };
}

/**
 * Execute a query against the appropriate tenant database
 *
 * @param {object} env - Worker environment bindings
 * @param {string} tenantId - Tenant identifier
 * @param {string} query - SQL query
 * @param {any[]} [params] - Query parameters
 * @returns {Promise<{rows: any[], layer: string}>}
 */
export async function queryTenantDb(env, tenantId, query, params = []) {
  const { client, layer } = await getTenantDb(env, tenantId);
  try {
    const result = await client.query(query, params);
    return { rows: result.rows || [], layer };
  } finally {
    await client.end().catch((err) => {
      console.warn("[TenantRouter] Connection cleanup failed:", err.message);
    });
  }
}

/**
 * Determine which layer a data item belongs to based on its privilege classification.
 *
 * @param {string} privilegeFlag - One of: none, possible_ac, needs_review, work_product
 * @returns {"tenant" | "platform"}
 */
export function resolveDataLayer(privilegeFlag) {
  return privilegeFlag === "work_product" ? "platform" : "tenant";
}
