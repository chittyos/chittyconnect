/**
 * Task tracking routes: Cross-channel task management with SSE broadcasting
 */

import { Hono } from "hono";

export const tasksRoutes = new Hono();

/**
 * GET /api/context/tasks
 * List tasks for a session
 * Query params: session_id?, status?, limit?
 */
tasksRoutes.get("/", async (c) => {
  try {
    const apiKey = c.get("apiKey");
    const session_id = c.req.query("session_id") || apiKey?.sessionId;
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "50");

    if (!session_id) {
      return c.json({ error: "session_id required" }, 400);
    }

    let query = "SELECT * FROM context_tasks WHERE session_id = ?";
    const params = [session_id];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY updated_at DESC LIMIT ?";
    params.push(limit);

    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    // Parse JSON fields
    const tasks = results.map((t) => ({
      ...t,
      metadata: t.metadata ? JSON.parse(t.metadata) : null,
      result: t.result ? JSON.parse(t.result) : null,
      // Convert Unix timestamps to ISO strings
      created_at: new Date(t.created_at * 1000).toISOString(),
      updated_at: new Date(t.updated_at * 1000).toISOString(),
      started_at: t.started_at
        ? new Date(t.started_at * 1000).toISOString()
        : null,
      completed_at: t.completed_at
        ? new Date(t.completed_at * 1000).toISOString()
        : null,
    }));

    return c.json({ ok: true, tasks, count: tasks.length });
  } catch (error) {
    console.error("[tasks.list] Error:", error);
    return c.json(
      {
        error: "query_failed",
        message: error.message,
      },
      500,
    );
  }
});

/**
 * POST /api/context/tasks
 * Create a new task
 * Body: { title, description?, task_type?, priority?, metadata? }
 */
tasksRoutes.post("/", async (c) => {
  try {
    const apiKey = c.get("apiKey");
    const {
      title,
      description,
      task_type = "user_request",
      priority = "normal",
      metadata = {},
    } = await c.req.json();

    if (!title) {
      return c.json({ error: "title required" }, 400);
    }

    const task_id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const session_id = apiKey?.sessionId || "unknown";
    const chitty_id = apiKey?.chittyId || apiKey?.userId || "unknown";

    await c.env.DB.prepare(
      `
      INSERT INTO context_tasks
      (task_id, session_id, chitty_id, task_type, status, title, description, priority, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        task_id,
        session_id,
        chitty_id,
        task_type,
        title,
        description || null,
        priority,
        now,
        now,
        JSON.stringify(metadata),
      )
      .run();

    // Broadcast via SSE
    const sm = c.get("streaming");
    if (sm) {
      await sm.broadcast({
        type: "task.created",
        sessionId: session_id,
        task_id,
        title,
        priority,
      });
    }

    return c.json({
      ok: true,
      task_id,
      created_at: new Date(now * 1000).toISOString(),
    });
  } catch (error) {
    console.error("[tasks.create] Error:", error);
    return c.json(
      {
        error: "creation_failed",
        message: error.message,
      },
      500,
    );
  }
});

/**
 * PATCH /api/context/tasks/:taskId
 * Update task status/details
 * Body: { status?, title?, description?, priority?, assigned_service?, result?, error? }
 */
tasksRoutes.patch("/:taskId", async (c) => {
  try {
    const task_id = c.req.param("taskId");
    const updates = await c.req.json();
    const apiKey = c.get("apiKey");
    const session_id = apiKey?.sessionId;

    const allowedFields = [
      "status",
      "title",
      "description",
      "priority",
      "assigned_service",
      "result",
      "error",
    ];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(typeof value === "object" ? JSON.stringify(value) : value);
      }
    }

    if (setClauses.length === 0) {
      return c.json({ error: "no valid fields to update" }, 400);
    }

    // Always update updated_at
    setClauses.push("updated_at = ?");
    const now = Math.floor(Date.now() / 1000);
    params.push(now);

    // Automatically set started_at when status changes to in_progress
    if (updates.status === "in_progress" && !updates.started_at) {
      setClauses.push("started_at = COALESCE(started_at, ?)");
      params.push(now);
    }

    // Automatically set completed_at when status changes to terminal state
    if (
      ["completed", "failed", "cancelled"].includes(updates.status) &&
      !updates.completed_at
    ) {
      setClauses.push("completed_at = COALESCE(completed_at, ?)");
      params.push(now);
    }

    params.push(task_id);
    if (session_id) {
      params.push(session_id);
    }

    const whereClause = session_id
      ? "task_id = ? AND session_id = ?"
      : "task_id = ?";

    const result = await c.env.DB.prepare(
      `
      UPDATE context_tasks
      SET ${setClauses.join(", ")}
      WHERE ${whereClause}
    `,
    )
      .bind(...params)
      .run();

    if (result.meta.changes === 0) {
      return c.json({ error: "task_not_found" }, 404);
    }

    // Broadcast via SSE
    const sm = c.get("streaming");
    if (sm && session_id) {
      await sm.broadcast({
        type: "task.updated",
        sessionId: session_id,
        task_id,
        updates,
      });
    }

    return c.json({ ok: true, updated_at: new Date(now * 1000).toISOString() });
  } catch (error) {
    console.error("[tasks.update] Error:", error);
    return c.json(
      {
        error: "update_failed",
        message: error.message,
      },
      500,
    );
  }
});

/**
 * GET /api/context/tasks/:taskId
 * Get single task details
 */
tasksRoutes.get("/:taskId", async (c) => {
  try {
    const task_id = c.req.param("taskId");
    const apiKey = c.get("apiKey");
    const session_id = apiKey?.sessionId;

    const whereClause = session_id
      ? "task_id = ? AND session_id = ?"
      : "task_id = ?";
    const params = session_id ? [task_id, session_id] : [task_id];

    const { results } = await c.env.DB.prepare(
      `
      SELECT * FROM context_tasks WHERE ${whereClause} LIMIT 1
    `,
    )
      .bind(...params)
      .all();

    if (results.length === 0) {
      return c.json({ error: "task_not_found" }, 404);
    }

    const task = results[0];

    // Parse JSON fields and convert timestamps
    const formattedTask = {
      ...task,
      metadata: task.metadata ? JSON.parse(task.metadata) : null,
      result: task.result ? JSON.parse(task.result) : null,
      created_at: new Date(task.created_at * 1000).toISOString(),
      updated_at: new Date(task.updated_at * 1000).toISOString(),
      started_at: task.started_at
        ? new Date(task.started_at * 1000).toISOString()
        : null,
      completed_at: task.completed_at
        ? new Date(task.completed_at * 1000).toISOString()
        : null,
    };

    return c.json({ ok: true, task: formattedTask });
  } catch (error) {
    console.error("[tasks.get] Error:", error);
    return c.json(
      {
        error: "query_failed",
        message: error.message,
      },
      500,
    );
  }
});

export default tasksRoutes;
