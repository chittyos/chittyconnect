/**
 * Connections Management Routes
 *
 * Unified registry of all ChittyOS services and third-party integrations.
 * Provides CRUD, health checks, credential testing, and dependency graph.
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";

const connectionsRoutes = new Hono();

/**
 * GET /api/connections
 * List connections with optional filters
 */
connectionsRoutes.get("/", async (c) => {
  try {
    const category = c.req.query("category");
    const status = c.req.query("status");
    const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
    const offset = parseInt(c.req.query("offset") || "0");

    let query = "SELECT * FROM connections WHERE 1=1";
    const params = [];

    if (category) {
      query += " AND category = ?";
      params.push(category);
    }
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY tier ASC NULLS LAST, name ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    // Parse JSON fields
    const connections = (result.results || []).map(parseConnection);

    return c.json({
      success: true,
      data: { connections },
      metadata: { total: connections.length, limit, offset },
    });
  } catch (error) {
    console.error("[Connections] List error:", error);
    return c.json(
      {
        success: false,
        error: { code: "LIST_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * GET /api/connections/stats
 * Aggregate counts by category and health status
 */
connectionsRoutes.get("/stats", async (c) => {
  try {
    const [byCategory, byHealth, total] = await Promise.all([
      c.env.DB.prepare(
        "SELECT category, COUNT(*) as count FROM connections WHERE status = 'active' GROUP BY category",
      ).all(),
      c.env.DB.prepare(
        "SELECT last_health_status, COUNT(*) as count FROM connections WHERE status = 'active' GROUP BY last_health_status",
      ).all(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM connections",
      ).first(),
    ]);

    const categoryMap = {};
    for (const row of byCategory.results || []) {
      categoryMap[row.category] = row.count;
    }

    const healthMap = {};
    for (const row of byHealth.results || []) {
      healthMap[row.last_health_status || "unknown"] = row.count;
    }

    return c.json({
      success: true,
      data: {
        total: total?.total || 0,
        active: total?.active || 0,
        by_category: categoryMap,
        by_health: healthMap,
        healthy: healthMap.healthy || 0,
        degraded: healthMap.degraded || 0,
        down: healthMap.down || 0,
        unknown: healthMap.unknown || healthMap[null] || 0,
      },
    });
  } catch (error) {
    console.error("[Connections] Stats error:", error);
    return c.json(
      {
        success: false,
        error: { code: "STATS_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * GET /api/connections/graph
 * Dependency graph nodes + edges for visualization
 */
connectionsRoutes.get("/graph", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      "SELECT id, name, slug, category, tier, status, last_health_status, icon, depends_on, base_url FROM connections ORDER BY tier ASC NULLS LAST",
    ).all();

    const nodes = [];
    const edges = [];

    for (const row of result.results || []) {
      nodes.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        category: row.category,
        tier: row.tier,
        status: row.status,
        health: row.last_health_status || "unknown",
        icon: row.icon,
        base_url: row.base_url,
      });

      const deps = safeParseJSON(row.depends_on, []);
      for (const dep of deps) {
        edges.push({ source: dep, target: row.id });
      }
    }

    return c.json({ success: true, data: { nodes, edges } });
  } catch (error) {
    console.error("[Connections] Graph error:", error);
    return c.json(
      {
        success: false,
        error: { code: "GRAPH_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * GET /api/connections/:slug
 * Single connection detail
 */
connectionsRoutes.get("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const row = await c.env.DB.prepare(
      "SELECT * FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (!row) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    return c.json({ success: true, data: parseConnection(row) });
  } catch (error) {
    console.error("[Connections] Get error:", error);
    return c.json(
      { success: false, error: { code: "GET_FAILED", message: error.message } },
      500,
    );
  }
});

/**
 * POST /api/connections
 * Create new connection
 */
connectionsRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { name, slug, category } = body;

    if (!name || !slug || !category) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "name, slug, and category are required",
          },
        },
        400,
      );
    }

    const id = `conn-${slug}`;
    await c.env.DB.prepare(
      `INSERT INTO connections (id, name, slug, category, provider, base_url, health_endpoint, api_version,
        config_json, credential_source, credential_path, credential_env_var, service_token_pattern,
        status, description, icon, tier, tags, depends_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        name,
        slug,
        category,
        body.provider || null,
        body.base_url || null,
        body.health_endpoint || null,
        body.api_version || null,
        JSON.stringify(body.config_json || {}),
        body.credential_source || "env",
        body.credential_path || null,
        body.credential_env_var || null,
        body.service_token_pattern || null,
        body.status || "active",
        body.description || null,
        body.icon || null,
        body.tier ?? null,
        JSON.stringify(body.tags || []),
        JSON.stringify(body.depends_on || []),
      )
      .run();

    const created = await c.env.DB.prepare(
      "SELECT * FROM connections WHERE id = ?",
    )
      .bind(id)
      .first();

    return c.json({ success: true, data: parseConnection(created) }, 201);
  } catch (error) {
    console.error("[Connections] Create error:", error);
    if (error.message?.includes("UNIQUE")) {
      return c.json(
        {
          success: false,
          error: {
            code: "DUPLICATE",
            message: "A connection with this slug already exists",
          },
        },
        409,
      );
    }
    return c.json(
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * PUT /api/connections/:slug
 * Update connection config
 */
connectionsRoutes.put("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const body = await c.req.json();

    const existing = await c.env.DB.prepare(
      "SELECT id FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (!existing) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    const fields = [];
    const values = [];

    const updatable = [
      "name",
      "base_url",
      "health_endpoint",
      "api_version",
      "credential_source",
      "credential_path",
      "credential_env_var",
      "service_token_pattern",
      "status",
      "description",
      "icon",
      "tier",
      "provider",
    ];

    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    // JSON fields
    if (body.config_json !== undefined) {
      fields.push("config_json = ?");
      values.push(JSON.stringify(body.config_json));
    }
    if (body.tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(body.tags));
    }
    if (body.depends_on !== undefined) {
      fields.push("depends_on = ?");
      values.push(JSON.stringify(body.depends_on));
    }

    if (fields.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "NO_CHANGES",
            message: "No updatable fields provided",
          },
        },
        400,
      );
    }

    fields.push("updated_at = datetime('now')");

    await c.env.DB.prepare(
      `UPDATE connections SET ${fields.join(", ")} WHERE slug = ?`,
    )
      .bind(...values, slug)
      .run();

    const updated = await c.env.DB.prepare(
      "SELECT * FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    return c.json({ success: true, data: parseConnection(updated) });
  } catch (error) {
    console.error("[Connections] Update error:", error);
    return c.json(
      {
        success: false,
        error: { code: "UPDATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * DELETE /api/connections/:slug
 * Soft-delete (set status = 'inactive')
 */
connectionsRoutes.delete("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");

    const result = await c.env.DB.prepare(
      "UPDATE connections SET status = 'inactive', updated_at = datetime('now') WHERE slug = ?",
    )
      .bind(slug)
      .run();

    if (result.meta?.changes === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      message: `Connection '${slug}' deactivated`,
    });
  } catch (error) {
    console.error("[Connections] Delete error:", error);
    return c.json(
      {
        success: false,
        error: { code: "DELETE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * POST /api/connections/:slug/test
 * Run health check, update status, log to health_log
 */
connectionsRoutes.post("/:slug/test", async (c) => {
  try {
    const slug = c.req.param("slug");
    const conn = await c.env.DB.prepare(
      "SELECT * FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (!conn) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    const result = await performHealthCheck(conn, c.env);

    // Update connection record
    await c.env.DB.prepare(
      `UPDATE connections SET
        last_health_check = datetime('now'),
        last_health_status = ?,
        last_health_latency_ms = ?,
        consecutive_failures = ?,
        error_count = error_count + ?,
        updated_at = datetime('now')
       WHERE slug = ?`,
    )
      .bind(
        result.status,
        result.latency_ms,
        result.status === "healthy" ? 0 : conn.consecutive_failures + 1,
        result.status === "healthy" ? 0 : 1,
        slug,
      )
      .run();

    // Log to health_log
    await c.env.DB.prepare(
      `INSERT INTO connection_health_log (connection_id, status, latency_ms, status_code, error_message)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        conn.id,
        result.status,
        result.latency_ms,
        result.status_code || null,
        result.error || null,
      )
      .run();

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error("[Connections] Test error:", error);
    return c.json(
      {
        success: false,
        error: { code: "TEST_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * POST /api/connections/test-all
 * Batch health check all active connections
 */
connectionsRoutes.post("/test-all", async (c) => {
  try {
    const conns = await c.env.DB.prepare(
      "SELECT * FROM connections WHERE status = 'active'",
    ).all();

    const results = await Promise.all(
      (conns.results || []).map(async (conn) => {
        const result = await performHealthCheck(conn, c.env);

        // Update + log in parallel
        await Promise.all([
          c.env.DB.prepare(
            `UPDATE connections SET
              last_health_check = datetime('now'),
              last_health_status = ?,
              last_health_latency_ms = ?,
              consecutive_failures = ?,
              error_count = error_count + ?,
              updated_at = datetime('now')
             WHERE id = ?`,
          )
            .bind(
              result.status,
              result.latency_ms,
              result.status === "healthy" ? 0 : conn.consecutive_failures + 1,
              result.status === "healthy" ? 0 : 1,
              conn.id,
            )
            .run(),
          c.env.DB.prepare(
            `INSERT INTO connection_health_log (connection_id, status, latency_ms, status_code, error_message)
             VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(
              conn.id,
              result.status,
              result.latency_ms,
              result.status_code || null,
              result.error || null,
            )
            .run(),
        ]);

        return { slug: conn.slug, name: conn.name, ...result };
      }),
    );

    const summary = {
      total: results.length,
      healthy: results.filter((r) => r.status === "healthy").length,
      degraded: results.filter((r) => r.status === "degraded").length,
      down: results.filter((r) => r.status === "down").length,
    };

    return c.json({ success: true, data: { results, summary } });
  } catch (error) {
    console.error("[Connections] Test-all error:", error);
    return c.json(
      {
        success: false,
        error: { code: "TEST_ALL_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * GET /api/connections/:slug/health-history
 * Recent health log entries
 */
connectionsRoutes.get("/:slug/health-history", async (c) => {
  try {
    const slug = c.req.param("slug");
    const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);

    const conn = await c.env.DB.prepare(
      "SELECT id FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (!conn) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    const result = await c.env.DB.prepare(
      "SELECT * FROM connection_health_log WHERE connection_id = ? ORDER BY checked_at DESC LIMIT ?",
    )
      .bind(conn.id, limit)
      .all();

    return c.json({
      success: true,
      data: { entries: result.results || [] },
    });
  } catch (error) {
    console.error("[Connections] Health history error:", error);
    return c.json(
      {
        success: false,
        error: { code: "HISTORY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * POST /api/connections/:slug/credential/test
 * Test credential retrieval — returns {available, source} (never the value)
 */
connectionsRoutes.post("/:slug/credential/test", async (c) => {
  try {
    const slug = c.req.param("slug");
    const conn = await c.env.DB.prepare(
      "SELECT credential_source, credential_path, credential_env_var, service_token_pattern FROM connections WHERE slug = ?",
    )
      .bind(slug)
      .first();

    if (!conn) {
      return c.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Connection '${slug}' not found`,
          },
        },
        404,
      );
    }

    if (
      conn.credential_source === "none" &&
      !conn.credential_env_var &&
      !conn.credential_path
    ) {
      return c.json({
        success: true,
        data: {
          available: true,
          source: "none",
          message: "No credentials required",
        },
      });
    }

    // Try 1Password path first, then env var
    let available = false;
    let source = null;

    if (conn.credential_path) {
      try {
        const val = await getCredential(
          c.env,
          conn.credential_path,
          "__NONE__",
        );
        if (val) {
          available = true;
          source = "onepassword";
        }
      } catch {
        // Fall through to env
      }
    }

    if (!available && conn.credential_env_var) {
      if (c.env[conn.credential_env_var]) {
        available = true;
        source = "env";
      }
    }

    if (!available && conn.service_token_pattern) {
      if (c.env[conn.service_token_pattern]) {
        available = true;
        source = "env";
      }
    }

    return c.json({
      success: true,
      data: { available, source: source || "unavailable" },
    });
  } catch (error) {
    console.error("[Connections] Credential test error:", error);
    return c.json(
      {
        success: false,
        error: { code: "CREDENTIAL_TEST_FAILED", message: error.message },
      },
      500,
    );
  }
});

// --- Helpers ---

function safeParseJSON(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
}

function parseConnection(row) {
  if (!row) return null;
  return {
    ...row,
    tags: safeParseJSON(row.tags, []),
    depends_on: safeParseJSON(row.depends_on, []),
    config_json: safeParseJSON(row.config_json, {}),
  };
}

async function performHealthCheck(conn, env) {
  const start = Date.now();

  // ChittyOS services: hit base_url + health_endpoint
  if (
    conn.category === "chittyos_service" &&
    conn.base_url &&
    conn.health_endpoint
  ) {
    try {
      const url = conn.base_url + conn.health_endpoint;
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;

      if (response.ok) {
        return {
          status: "healthy",
          latency_ms: latency,
          status_code: response.status,
        };
      }
      return {
        status: "degraded",
        latency_ms: latency,
        status_code: response.status,
      };
    } catch (error) {
      return {
        status: "down",
        latency_ms: Date.now() - start,
        error: error.message,
      };
    }
  }

  // Third-party with known health endpoints
  if (conn.base_url && conn.health_endpoint) {
    try {
      // Need auth for most third-party endpoints
      const credential = conn.credential_path
        ? await getCredential(
            env,
            conn.credential_path,
            conn.credential_env_var || "__NONE__",
          )
        : conn.credential_env_var
          ? env[conn.credential_env_var]
          : null;

      if (!credential) {
        return {
          status: "degraded",
          latency_ms: Date.now() - start,
          error: "Credential not available for health check",
        };
      }

      const headers = { Authorization: `Bearer ${credential}` };
      // Notion needs version header
      if (conn.provider === "notion") {
        headers["Notion-Version"] = "2022-06-28";
      }

      const url = conn.base_url + conn.health_endpoint;
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;
      return {
        status: response.ok ? "healthy" : "degraded",
        latency_ms: latency,
        status_code: response.status,
      };
    } catch (error) {
      return {
        status: "down",
        latency_ms: Date.now() - start,
        error: error.message,
      };
    }
  }

  // Database: check credential availability as proxy for health
  if (conn.category === "database") {
    const credential = conn.credential_path
      ? await getCredential(
          env,
          conn.credential_path,
          conn.credential_env_var || "__NONE__",
        ).catch(() => null)
      : conn.credential_env_var
        ? env[conn.credential_env_var]
        : null;

    return {
      status: credential ? "healthy" : "down",
      latency_ms: Date.now() - start,
      error: credential ? null : "Database credential not available",
    };
  }

  // Fallback: credential availability check
  let hasCredential = false;
  if (conn.credential_path) {
    try {
      const val = await getCredential(env, conn.credential_path, "__NONE__");
      hasCredential = !!val;
    } catch {
      // ignore
    }
  }
  if (!hasCredential && conn.credential_env_var) {
    hasCredential = !!env[conn.credential_env_var];
  }

  return {
    status: hasCredential ? "healthy" : "degraded",
    latency_ms: Date.now() - start,
    error: hasCredential
      ? null
      : "No health endpoint; credential check used as proxy",
  };
}

export { connectionsRoutes };
