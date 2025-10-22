/**
 * ChittyChronicle API Routes
 * Event logging and audit trails
 */

import { Hono } from "hono";

const chittychronicleRoutes = new Hono();

/**
 * POST /api/chittychronicle/log
 * Create a chronicle entry
 */
chittychronicleRoutes.post("/log", async (c) => {
  try {
    const { eventType, entityId, data, timestamp } = await c.req.json();

    if (!eventType || !data) {
      return c.json({ error: "eventType and data are required" }, 400);
    }

    const response = await fetch("https://chronicle.chitty.cc/api/entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_CHRONICLE_TOKEN}`,
      },
      body: JSON.stringify({
        eventType,
        entityId,
        data,
        timestamp: timestamp || new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`ChittyChronicle service error: ${response.status}`);
    }

    const result = await response.json();
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/query
 * Query chronicle entries
 */
chittychronicleRoutes.get("/query", async (c) => {
  try {
    const { entityId, eventType, startDate, limit = 100 } = c.req.query();

    const params = new URLSearchParams();
    if (entityId) params.append("entityId", entityId);
    if (eventType) params.append("eventType", eventType);
    if (startDate) params.append("startDate", startDate);
    params.append("limit", limit);

    const response = await fetch(
      `https://chronicle.chitty.cc/api/entries?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_CHRONICLE_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyChronicle service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/timeline/:entityId
 * Get timeline for an entity
 */
chittychronicleRoutes.get("/timeline/:entityId", async (c) => {
  try {
    const entityId = c.req.param("entityId");

    const response = await fetch(
      `https://chronicle.chitty.cc/api/timeline/${entityId}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_CHRONICLE_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyChronicle service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittychronicleRoutes };
