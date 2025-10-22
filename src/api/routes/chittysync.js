/**
 * ChittySync API Routes
 * Data synchronization and state management
 */

import { Hono } from "hono";

const chittysyncRoutes = new Hono();

/**
 * POST /api/chittysync/sync
 * Trigger a sync operation
 */
chittysyncRoutes.post("/sync", async (c) => {
  try {
    const {
      source,
      target,
      entities,
      mode = "incremental",
    } = await c.req.json();

    if (!source || !target) {
      return c.json({ error: "source and target are required" }, 400);
    }

    const response = await fetch("https://sync.chitty.cc/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_SYNC_TOKEN}`,
      },
      body: JSON.stringify({ source, target, entities, mode }),
    });

    if (!response.ok) {
      throw new Error(`ChittySync service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittysync/status/:syncId
 * Get sync status
 */
chittysyncRoutes.get("/status/:syncId", async (c) => {
  try {
    const syncId = c.req.param("syncId");

    const response = await fetch(`https://sync.chitty.cc/api/sync/${syncId}`, {
      headers: {
        Authorization: `Bearer ${c.env.CHITTY_SYNC_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`ChittySync service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittysync/history
 * Get sync history
 */
chittysyncRoutes.get("/history", async (c) => {
  try {
    const { source, target, limit = 50 } = c.req.query();

    const params = new URLSearchParams();
    if (source) params.append("source", source);
    if (target) params.append("target", target);
    params.append("limit", limit);

    const response = await fetch(
      `https://sync.chitty.cc/api/history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_SYNC_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittySync service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittysyncRoutes };
