/**
 * ChittyRegistry API Routes
 */

import { Hono } from "hono";

const registryRoutes = new Hono();

/**
 * GET /api/registry/services
 * List all registered services
 */
registryRoutes.get("/services", async (c) => {
  try {
    const response = await fetch("https://registry.chitty.cc/api/services", {
      headers: {
        Authorization: `Bearer ${c.env.CHITTY_REGISTRY_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/registry/services/:serviceId
 * Get service details
 */
registryRoutes.get("/services/:serviceId", async (c) => {
  try {
    const serviceId = c.req.param("serviceId");

    const response = await fetch(
      `https://registry.chitty.cc/api/services/${serviceId}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_REGISTRY_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/registry/whoami
 * Get current tenant and session information
 * Requires authentication via API key
 */
registryRoutes.get("/whoami", async (c) => {
  try {
    const apiKey = c.get("apiKey"); // Set by authenticate middleware

    if (!apiKey) {
      return c.json(
        {
          error: "unauthorized",
          message: "API key required",
        },
        401,
      );
    }

    // Query context_files for active files
    let activeFiles = [];
    try {
      const filesResult = await c.env.DB.prepare(
        `
        SELECT file_uri, file_name, file_size, sha256, mime_type, last_accessed
        FROM context_files
        WHERE session_id = ? AND is_active = 1
        ORDER BY last_accessed DESC
        LIMIT 10
      `,
      )
        .bind(apiKey.sessionId)
        .all();
      activeFiles = filesResult.results || [];
    } catch (error) {
      console.warn("[whoami] Failed to query active files:", error.message);
    }

    // Query context_tasks for active tasks
    let activeTasks = [];
    try {
      const tasksResult = await c.env.DB.prepare(
        `
        SELECT task_id, title, status, priority, created_at, updated_at
        FROM context_tasks
        WHERE session_id = ? AND status IN ('pending', 'in_progress')
        ORDER BY priority DESC, created_at DESC
        LIMIT 10
      `,
      )
        .bind(apiKey.sessionId)
        .all();
      activeTasks = tasksResult.results || [];
    } catch (error) {
      console.warn("[whoami] Failed to query active tasks:", error.message);
    }

    // Build response
    const response = {
      success: true,
      data: {
        tenant: {
          chitty_id: apiKey.chittyId || apiKey.userId,
          name: apiKey.name || apiKey.userId || "Unknown User",
          account_type: apiKey.accountType || "standard",
        },
        session: {
          session_id: apiKey.sessionId,
          created_at: apiKey.createdAt || new Date().toISOString(),
          last_activity: new Date().toISOString(),
          active_files: activeFiles.map((f) => ({
            uri: f.file_uri,
            name: f.file_name,
            size: f.file_size,
            sha256: f.sha256,
            mime: f.mime_type,
            last_accessed: new Date(f.last_accessed * 1000).toISOString(),
          })),
          active_tasks: activeTasks.map((t) => ({
            task_id: t.task_id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            created_at: new Date(t.created_at * 1000).toISOString(),
            updated_at: new Date(t.updated_at * 1000).toISOString(),
          })),
        },
        scopes: apiKey.scopes || ["read", "write"],
        flags: {
          mcp_enabled: true,
          context_consciousness_enabled: true,
          memory_cloude_enabled: true,
          beta_features: ["presigned_uploads", "task_tracking", "context_sync"],
        },
        quota: {
          storage_bytes: apiKey.storageQuota || 1073741824, // 1GB default
          api_calls_remaining: apiKey.rateLimit || 1000,
        },
      },
    };

    return c.json(response);
  } catch (error) {
    console.error("[whoami] Error:", error);
    return c.json(
      {
        error: "internal_error",
        message: "Failed to retrieve user information",
      },
      500,
    );
  }
});

export { registryRoutes };
