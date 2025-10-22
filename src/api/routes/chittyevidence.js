/**
 * ChittyEvidence API Routes
 * Evidence ingestion and management
 */

import { Hono } from "hono";

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

    // Forward to ChittyEvidence service
    const uploadFormData = new FormData();
    uploadFormData.append("file", file);
    uploadFormData.append("caseId", caseId);
    if (evidenceType) uploadFormData.append("evidenceType", evidenceType);
    if (metadata) uploadFormData.append("metadata", metadata);

    const response = await fetch("https://evidence.chitty.cc/api/ingest", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.CHITTY_EVIDENCE_TOKEN}`,
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

    const response = await fetch(
      `https://evidence.chitty.cc/api/evidence/${evidenceId}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_EVIDENCE_TOKEN}`,
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
