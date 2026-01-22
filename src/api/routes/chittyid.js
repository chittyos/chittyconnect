/**
 * ChittyID API Routes
 * Proxy for ChittyID service with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittyidRoutes = new Hono();

/**
 * POST /api/chittyid/mint
 * Mint a new ChittyID
 */
chittyidRoutes.post("/mint", async (c) => {
  try {
    const { entity, metadata } = await c.req.json();

    if (!entity) {
      return c.json({ error: "entity is required" }, 400);
    }

    const validEntities = [
      "PEO",
      "PLACE",
      "PROP",
      "EVNT",
      "AUTH",
      "INFO",
      "FACT",
      "CONTEXT",
      "ACTOR",
    ];
    if (!validEntities.includes(entity)) {
      return c.json({ error: "Invalid entity type" }, 400);
    }

    // ChittyID uses GET endpoint without auth requirement
    // Map entity to the 'for' parameter
    const entityMap = {
      'PEO': 'person',
      'PLACE': 'place',
      'PROP': 'property',
      'EVNT': 'event',
      'AUTH': 'authority',
      'INFO': 'info',
      'FACT': 'fact',
      'CONTEXT': 'CONTEXT',
      'ACTOR': 'actor'
    };

    const forParam = entityMap[entity] || entity;

    // Forward to ChittyID service (public endpoint)
    const response = await fetch(`https://id.chitty.cc/api/get-chittyid?for=${forParam}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ChittyID service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyid/validate
 * Validate a ChittyID
 */
chittyidRoutes.post("/validate", async (c) => {
  try {
    const { chittyid } = await c.req.json();

    if (!chittyid) {
      return c.json({ error: "chittyid is required" }, 400);
    }

    const serviceToken = await getServiceToken(c.env, 'chittyid');

    if (!serviceToken) {
      return c.json({
        error: "ChittyID service token not configured"
      }, 503);
    }

    // Forward to ChittyID service
    const response = await fetch("https://id.chitty.cc/v1/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ chittyid }),
    });

    if (!response.ok) {
      throw new Error(`ChittyID service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyid/:id
 * Get ChittyID details
 */
chittyidRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const serviceToken = await getServiceToken(c.env, 'chittyid');

    if (!serviceToken) {
      return c.json({
        error: "ChittyID service token not configured"
      }, 503);
    }

    const response = await fetch(`https://id.chitty.cc/v1/${id}`, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`ChittyID service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittyidRoutes };
