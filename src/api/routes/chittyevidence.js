/**
 * ChittyEvidence API Routes
 * Evidence ingestion and management with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittyevidenceRoutes = new Hono();

/**
 * POST /api/chittyevidence/ingest
 * Ingest evidence file
 */
chittyevidenceRoutes.post("/ingest", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const caseId = formData.get("caseId");
    const evidenceType = formData.get("evidenceType");
    const metadata = formData.get("metadata");

    if (!file || !caseId) {
      return c.json({ error: "file and caseId are required" }, 400);
    }

    const serviceToken = await getServiceToken(c.env, 'chittyevidence');

    if (!serviceToken) {
      return c.json({
        error: "ChittyEvidence service token not configured",
        details: "Neither 1Password Connect nor environment variable available"
      }, 503);
    }

    // Forward to ChittyEvidence service
    const uploadFormData = new FormData();
    uploadFormData.append("file", file);
    uploadFormData.append("caseId", caseId);
    if (evidenceType) uploadFormData.append("evidenceType", evidenceType);
    if (metadata) uploadFormData.append("metadata", metadata);

    const response = await fetch("https://evidence.chitty.cc/api/ingest", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
      body: uploadFormData,
    });

    if (!response.ok) {
      throw new Error(`ChittyEvidence service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyevidence/:evidenceId
 * Get evidence details
 */
chittyevidenceRoutes.get("/:evidenceId", async (c) => {
  try {
    const evidenceId = c.req.param("evidenceId");

    const serviceToken = await getServiceToken(c.env, 'chittyevidence');

    if (!serviceToken) {
      return c.json({
        error: "ChittyEvidence service token not configured"
      }, 503);
    }

    const response = await fetch(
      `https://evidence.chitty.cc/api/evidence/${evidenceId}`,
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyEvidence service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittyevidenceRoutes };
