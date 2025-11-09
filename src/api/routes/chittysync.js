/**
 * ChittySync API Routes
 * Data synchronization and state management with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

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

    const serviceToken = await getServiceToken(c.env, 'chittysync');

    if (!serviceToken) {
      return c.json({
        error: "ChittySync service token not configured",
        details: "Neither 1Password Connect nor environment variable available"
      }, 503);
    }

    const response = await fetch("https://sync.chitty.cc/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
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

    const serviceToken = await getServiceToken(c.env, 'chittysync');

    if (!serviceToken) {
      return c.json({
        error: "ChittySync service token not configured"
      }, 503);
    }

    const response = await fetch(`https://sync.chitty.cc/api/sync/${syncId}`, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
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

    const serviceToken = await getServiceToken(c.env, 'chittysync');

    if (!serviceToken) {
      return c.json({
        error: "ChittySync service token not configured"
      }, 503);
    }

    const response = await fetch(
      `https://sync.chitty.cc/api/history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
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
