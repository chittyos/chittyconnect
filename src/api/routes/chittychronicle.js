/**
 * ChittyChronicle API Routes
 * Event logging and audit trails with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

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

    const serviceToken = await getServiceToken(c.env, 'chittychronicle');

    if (!serviceToken) {
      return c.json({
        error: "ChittyChronicle service token not configured",
        details: "Neither 1Password Connect nor environment variable available"
      }, 503);
    }

    const response = await fetch("https://chronicle.chitty.cc/api/entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
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
    const { eventType, entityId, startDate, endDate, limit = 50 } = c.req.query();

    const serviceToken = await getServiceToken(c.env, 'chittychronicle');

    if (!serviceToken) {
      return c.json({
        error: "ChittyChronicle service token not configured"
      }, 503);
    }

    const params = new URLSearchParams();
    if (eventType) params.append("eventType", eventType);
    if (entityId) params.append("entityId", entityId);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    params.append("limit", limit);

    const response = await fetch(
      `https://chronicle.chitty.cc/api/entries?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      }
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
