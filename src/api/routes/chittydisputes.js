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
import { requireServiceToken } from "../../middleware/require-service-token.js";

const chittydisputesRoutes = new Hono();
chittydisputesRoutes.use("*", requireServiceToken("chittydispute"));

/**
 * POST /api/chittydisputes/create
 * Create a new dispute
 */
chittydisputesRoutes.post("/create", async (c) => {
  try {
    const body = await c.req.json();
    // Accept legacy `type` for backward compat, but prefer `dispute_type` to match ChittyDispute API.
    const {
      dispute_type,
      type,
      title,
      description,
      severity,
      domains,
      property_address,
      property_unit,
      metadata,
    } = body;
    const disputeType = dispute_type || type;

    if (!disputeType || !title) {
      return c.json({ error: "dispute_type and title are required" }, 400);
    }

    // Canonical dispute types per ChittyDispute enum (sql/001-create-disputes.sql).
    const validTypes = [
      "PROPERTY",
      "INSURANCE",
      "LEGAL",
      "FINANCIAL",
      "TENANT",
      "VENDOR",
      "HOA",
      "REGULATORY",
    ];
    if (!validTypes.includes(disputeType)) {
      return c.json(
        {
          error: "Invalid dispute_type",
          validTypes,
        },
        400,
      );
    }

    const serviceToken = c.get("serviceToken");

    const response = await fetch("https://dispute.chitty.cc/api/disputes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        dispute_type: disputeType,
        title,
        description,
        severity,
        domains,
        property_address,
        property_unit,
        metadata,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`,
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

    const serviceToken = c.get("serviceToken");

    const response = await fetch(
      `https://dispute.chitty.cc/api/disputes/${disputeId}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`,
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

    const serviceToken = c.get("serviceToken");

    // Build query parameters
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (type) params.append("type", type);
    params.append("limit", limit);

    const url = `https://dispute.chitty.cc/api/disputes?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`,
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

    const serviceToken = c.get("serviceToken");

    const response = await fetch(
      `https://dispute.chitty.cc/api/disputes/${disputeId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(updates),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`,
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

    const serviceToken = c.get("serviceToken");

    const response = await fetch(
      `https://dispute.chitty.cc/api/disputes/${disputeId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(eventData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ChittyDisputes service error: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittydisputesRoutes };
