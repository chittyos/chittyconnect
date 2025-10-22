/**
 * ChittyID API Routes
 */

import { Hono } from "hono";

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

    // Forward to ChittyID service
    const response = await fetch("https://id.chitty.cc/v1/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_ID_TOKEN}`,
      },
      body: JSON.stringify({ entity, metadata }),
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

    // Forward to ChittyID service
    const response = await fetch("https://id.chitty.cc/v1/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_ID_TOKEN}`,
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

    const response = await fetch(`https://id.chitty.cc/v1/${id}`, {
      headers: {
        Authorization: `Bearer ${c.env.CHITTY_ID_TOKEN}`,
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
