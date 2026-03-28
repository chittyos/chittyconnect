/**
 * ChittyCases API Routes
 * Legal case management with 1Password Connect integration
 */

import { Hono } from "hono";
import { requireServiceToken } from "../../middleware/require-service-token.js";

const chittycasesRoutes = new Hono();

chittycasesRoutes.use("*", requireServiceToken("chittycases"));

/** POST /api/chittycases/create */
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

    const serviceToken = c.get("serviceToken");
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

/** GET /api/chittycases/:caseId */
chittycasesRoutes.get("/:caseId", async (c) => {
  try {
    const caseId = c.req.param("caseId");
    const serviceToken = c.get("serviceToken");
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

/** PUT /api/chittycases/:caseId */
chittycasesRoutes.put("/:caseId", async (c) => {
  try {
    const caseId = c.req.param("caseId");
    const updates = await c.req.json();
    const serviceToken = c.get("serviceToken");

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
