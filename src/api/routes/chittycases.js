/**
 * ChittyCases API Routes
 * Legal case management with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittycasesRoutes = new Hono();

/**
 * POST /api/chittycases/create
 * Create a new legal case
 */
chittycasesRoutes.post("/create", async (c) => {
  try {
    const { title, description, caseType, metadata } = await c.req.json();

    if (!title || !caseType) {
      return c.json({ error: "title and caseType are required" }, 400);
    }

    const validTypes = ["eviction", "litigation", "resolution", "general"];
    if (!validTypes.includes(caseType)) {
      return c.json({ error: "Invalid caseType" }, 400);
    }

    const serviceToken = await getServiceToken(c.env, "chittycases");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyCases service token not configured",
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503,
      );
    }

    const response = await fetch("https://cases.chitty.cc/api/cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ title, description, caseType, metadata }),
    });

    if (!response.ok) {
      throw new Error(`ChittyCases service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittycases/:caseId
 * Get case details
 */
chittycasesRoutes.get("/:caseId", async (c) => {
  try {
    const caseId = c.req.param("caseId");

    const serviceToken = await getServiceToken(c.env, "chittycases");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyCases service token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://cases.chitty.cc/api/cases/${caseId}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyCases service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PUT /api/chittycases/:caseId
 * Update case
 */
chittycasesRoutes.put("/:caseId", async (c) => {
  try {
    const caseId = c.req.param("caseId");
    const updates = await c.req.json();

    const serviceToken = await getServiceToken(c.env, "chittycases");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyCases service token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://cases.chitty.cc/api/cases/${caseId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(updates),
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyCases service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittycasesRoutes };
