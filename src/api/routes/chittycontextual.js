/**
 * ChittyContextual API Routes
 * Contextual analysis and AI-powered insights with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittycontextualRoutes = new Hono();

/**
 * POST /api/chittycontextual/analyze
 * Perform contextual analysis
 */
chittycontextualRoutes.post("/analyze", async (c) => {
  try {
    const {
      text,
      context,
      analysisType = "comprehensive",
    } = await c.req.json();

    if (!text) {
      return c.json({ error: "text is required" }, 400);
    }

    const validTypes = [
      "sentiment",
      "entities",
      "legal",
      "financial",
      "comprehensive",
    ];
    if (!validTypes.includes(analysisType)) {
      return c.json({ error: "Invalid analysisType" }, 400);
    }

    const serviceToken = await getServiceToken(c.env, "chittycontextual");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyContextual service token not configured",
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503,
      );
    }

    // Forward to ChittyContextual service
    const response = await fetch("https://contextual.chitty.cc/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ text, context, analysisType }),
    });

    if (!response.ok) {
      throw new Error(`ChittyContextual service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittycontextual/extract
 * Extract entities and metadata from text
 */
chittycontextualRoutes.post("/extract", async (c) => {
  try {
    const { text, entityTypes } = await c.req.json();

    if (!text) {
      return c.json({ error: "text is required" }, 400);
    }

    const serviceToken = await getServiceToken(c.env, "chittycontextual");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyContextual service token not configured",
        },
        503,
      );
    }

    const response = await fetch("https://contextual.chitty.cc/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ text, entityTypes }),
    });

    if (!response.ok) {
      throw new Error(`ChittyContextual service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittycontextualRoutes };
