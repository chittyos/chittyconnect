/**
 * Tenant Project Manager
 *
 * Wraps the Neon API for per-tenant project lifecycle:
 * provision, lookup, deprovision, export, and list.
 *
 * Two-layer model:
 *   Layer 1 (tenant-owned): evidence originals, custody logs, client documents
 *   Layer 2 (platform-owned): work product, analysis, trust scores, context DNA
 *
 * @module services/tenant-project-manager
 */

import { getCredential } from "../lib/credential-helper.js";
import { runTenantMigrations } from "../lib/tenant-migrations.js";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export class TenantProjectManager {
  /**
   * @param {object} env - Worker environment bindings
   */
  constructor(env) {
    this.env = env;
  }

  /**
   * Get Neon API key from credential broker or env fallback
   * @returns {Promise<string>}
   */
  async #getNeonApiKey() {
    const key = await getCredential(
      this.env,
      "integrations/neon/api_key",
      "NEON_API_KEY",
      "TenantProjectManager",
    );
    if (!key) {
      throw new Error("NEON_API_KEY not configured");
    }
    return key;
  }

  /**
   * Make an authenticated request to the Neon API
   * @param {string} path - API path (e.g. "/projects")
   * @param {object} [options] - Fetch options
   * @returns {Promise<object>} JSON response
   */
  async #neonFetch(path, options = {}) {
    const apiKey = await this.#getNeonApiKey();
    const url = `${NEON_API_BASE}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Neon API error: ${response.status} ${response.statusText} — ${body}`,
      );
    }

    if (response.status === 204) return null;
    return response.json();
  }

  /**
   * Provision a new Neon project for a tenant
   *
   * @param {string} tenantId - Unique tenant identifier (ChittyID or org slug)
   * @param {object} [config] - Optional provisioning config
   * @param {string} [config.region] - Neon region (default: aws-us-east-2)
   * @param {string} [config.pgVersion] - PostgreSQL version (default: 16)
   * @returns {Promise<object>} Provisioned tenant record
   */
  async provisionTenant(tenantId, config = {}) {
    if (!tenantId) throw new Error("tenantId is required");

    const existing = await this.getTenantRecord(tenantId);
    if (existing) {
      throw new Error(`Tenant ${tenantId} already provisioned`);
    }

    const region = config.region || "aws-us-east-2";
    const pgVersion = config.pgVersion || "16";

    const orgId = config.orgId || this.env.NEON_ORG_ID || null;
    const projectBody = {
      project: {
        name: `chittyos-tenant-${tenantId}`,
        region_id: region,
        pg_version: parseInt(pgVersion, 10),
      },
    };
    if (orgId) {
      projectBody.project.org_id = orgId;
    }

    const result = await this.#neonFetch("/projects", {
      method: "POST",
      body: JSON.stringify(projectBody),
    });

    const project = result.project;
    const connectionUri =
      result.connection_uris?.[0]?.connection_uri || null;

    const record = {
      tenant_id: tenantId,
      neon_project_id: project.id,
      neon_region: region,
      connection_uri_encrypted: connectionUri,
      status: "active",
      pg_version: pgVersion,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.#storeTenantRecord(record);

    // Cache connection string in KV for fast lookup
    if (connectionUri && this.env.TENANT_CONNECTIONS) {
      await this.env.TENANT_CONNECTIONS.put(
        `tenant:${tenantId}`,
        connectionUri,
        { expirationTtl: 3600 },
      );
    }

    // Run base migrations on the new tenant database
    let migrationsApplied = 0;
    if (connectionUri) {
      const migrationResult = await runTenantMigrations(connectionUri);
      migrationsApplied = migrationResult.applied;
    }

    return {
      tenantId,
      neonProjectId: project.id,
      region,
      status: "active",
      migrationsApplied,
      createdAt: record.created_at,
    };
  }

  /**
   * Get the connection string for a tenant's Neon project
   *
   * @param {string} tenantId
   * @returns {Promise<string|null>} Connection URI or null if not found
   */
  async getTenantConnection(tenantId) {
    if (!tenantId) return null;

    // Check KV cache first
    if (this.env.TENANT_CONNECTIONS) {
      const cached = await this.env.TENANT_CONNECTIONS.get(
        `tenant:${tenantId}`,
      );
      if (cached) return cached;
    }

    // Fall back to platform DB
    const record = await this.getTenantRecord(tenantId);
    if (!record) return null;

    const connectionUri = record.connection_uri_encrypted;

    // Re-cache in KV
    if (connectionUri && this.env.TENANT_CONNECTIONS) {
      await this.env.TENANT_CONNECTIONS.put(
        `tenant:${tenantId}`,
        connectionUri,
        { expirationTtl: 3600 },
      );
    }

    return connectionUri;
  }

  /**
   * Get tenant record from platform D1 database
   *
   * @param {string} tenantId
   * @returns {Promise<object|null>}
   */
  async getTenantRecord(tenantId) {
    if (!this.env.DB) return null;

    const result = await this.env.DB.prepare(
      "SELECT * FROM tenant_projects WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .first();

    return result || null;
  }

  /**
   * Store tenant record in platform D1 database
   * @param {object} record
   */
  async #storeTenantRecord(record) {
    if (!this.env.DB) {
      throw new Error("Platform DB (D1) not available");
    }

    await this.env.DB.prepare(
      `INSERT INTO tenant_projects
       (tenant_id, neon_project_id, neon_region, connection_uri_encrypted, status, pg_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        record.tenant_id,
        record.neon_project_id,
        record.neon_region,
        record.connection_uri_encrypted,
        record.status,
        record.pg_version,
        record.created_at,
        record.updated_at,
      )
      .run();
  }

  /**
   * Deprovision a tenant's Neon project
   *
   * @param {string} tenantId
   * @returns {Promise<{tenantId: string, status: string}>}
   */
  async deprovisionTenant(tenantId) {
    const record = await this.getTenantRecord(tenantId);
    if (!record) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    await this.#neonFetch(`/projects/${record.neon_project_id}`, {
      method: "DELETE",
    });

    if (this.env.DB) {
      await this.env.DB.prepare(
        "UPDATE tenant_projects SET status = ?, updated_at = ? WHERE tenant_id = ?",
      )
        .bind("deprovisioned", new Date().toISOString(), tenantId)
        .run();
    }

    if (this.env.TENANT_CONNECTIONS) {
      await this.env.TENANT_CONNECTIONS.delete(`tenant:${tenantId}`);
    }

    return { tenantId, status: "deprovisioned" };
  }

  /**
   * Export a tenant's Neon project metadata and connection info
   *
   * @param {string} tenantId
   * @returns {Promise<object>} Export bundle
   */
  async exportTenant(tenantId) {
    const record = await this.getTenantRecord(tenantId);
    if (!record) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const project = await this.#neonFetch(
      `/projects/${record.neon_project_id}`,
    );

    return {
      tenantId,
      neonProjectId: record.neon_project_id,
      region: record.neon_region,
      pgVersion: record.pg_version,
      status: record.status,
      project: project?.project || null,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * List all tenant projects
   *
   * @param {object} [options]
   * @param {string} [options.status] - Filter by status
   * @param {number} [options.limit] - Max results (default 50)
   * @param {number} [options.offset] - Offset for pagination
   * @returns {Promise<{tenants: object[], total: number}>}
   */
  async listTenants(options = {}) {
    if (!this.env.DB) {
      return { tenants: [], total: 0 };
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let query = "SELECT * FROM tenant_projects";
    let countQuery = "SELECT COUNT(*) as total FROM tenant_projects";
    const binds = [];
    const countBinds = [];

    if (options.status) {
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
      binds.push(options.status);
      countBinds.push(options.status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    binds.push(limit, offset);

    const [rows, countResult] = await Promise.all([
      this.env.DB.prepare(query)
        .bind(...binds)
        .all(),
      this.env.DB.prepare(countQuery)
        .bind(...countBinds)
        .first(),
    ]);

    return {
      tenants: rows.results || [],
      total: countResult?.total || 0,
    };
  }
}
