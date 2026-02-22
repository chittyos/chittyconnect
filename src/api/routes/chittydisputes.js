/**
 * ChittyDisputes API Routes
 * Dispute/issue management for ChittyOS with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 *
 * ChittyDisputes Registry: REG-WQ6W5M
 * Canonical URI: chittycanon://core/services/disputes
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittydisputesRoutes = new Hono();

/**
 * POST /api/chittydisputes/create
 * Create a new dispute
 */
chittydisputesRoutes.post("/create", async (c) => {
  try {
    const body = await c.req.json();
    const { type, title, description, metadata } = body;

    if (!type || !title) {
      return c.json({ error: "type and title are required" }, 400);
    }

    const validTypes = ["billing", "service", "technical", "policy", "other"];
    if (!validTypes.includes(type)) {
      return c.json(
        {
          error: "Invalid dispute type",
          validTypes,
        },
        400
      );
    }

    const serviceToken = await getServiceToken(c.env, "chittydisputes");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyDisputes service token not configured",
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503
      );
    }

    const response = await fetch("https://disputes.chitty.cc/api/disputes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        type,
        title,
        description,
        metadata,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittydisputes/:disputeId
 * Get dispute details
 */
chittydisputesRoutes.get("/:disputeId", async (c) => {
  try {
    const disputeId = c.req.param("disputeId");

    const serviceToken = await getServiceToken(c.env, "chittydisputes");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyDisputes service token not configured",
        },
        503
      );
    }

    const response = await fetch(
      `https://disputes.chitty.cc/api/disputes/${disputeId}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittydisputes
 * List disputes with optional filters
 */
chittydisputesRoutes.get("/", async (c) => {
  try {
    const status = c.req.query("status");
    const type = c.req.query("type");
    const limit = c.req.query("limit") || "50";

    const serviceToken = await getServiceToken(c.env, "chittydisputes");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyDisputes service token not configured",
        },
        503
      );
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (type) params.append("type", type);
    params.append("limit", limit);

    const url = `https://disputes.chitty.cc/api/disputes?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PATCH /api/chittydisputes/:disputeId
 * Update dispute status or add events
 */
chittydisputesRoutes.patch("/:disputeId", async (c) => {
  try {
    const disputeId = c.req.param("disputeId");
    const updates = await c.req.json();

    const serviceToken = await getServiceToken(c.env, "chittydisputes");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyDisputes service token not configured",
        },
        503
      );
    }

    const response = await fetch(
      `https://disputes.chitty.cc/api/disputes/${disputeId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittydisputes/:disputeId/events
 * Add an event to a dispute
 */
chittydisputesRoutes.post("/:disputeId/events", async (c) => {
  try {
    const disputeId = c.req.param("disputeId");
    const eventData = await c.req.json();

    const serviceToken = await getServiceToken(c.env, "chittydisputes");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyDisputes service token not configured",
        },
        503
      );
    }

    const response = await fetch(
      `https://disputes.chitty.cc/api/disputes/${disputeId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(eventData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittydisputesRoutes };
