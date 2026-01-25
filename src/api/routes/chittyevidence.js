/**
 * ChittyEvidence API Routes
 * Evidence ingestion and management with 1Password Connect integration
 *
 * UPDATED FOR CHITTYLEDGER INTEGRATION (ChittyEvidence v2.0)
 * - Supports UUID-based evidence_id (primary)
 * - Backward compatible with file_hash lookups (deprecated)
 * - Maps to ChittyLedger things/evidence tables
 * - Response transformers for legacy field names
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";
import { EvidenceCompatibilityLayer } from "../../lib/evidence-compatibility.js";

const chittyevidenceRoutes = new Hono();

/**
 * POST /api/chittyevidence/ingest
 * Ingest evidence file
 *
 * Returns ChittyLedger v2.0 response with UUIDs
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

    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyEvidence service token not configured",
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503,
      );
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

    // ChittyEvidence v2.0 now returns:
    // { evidence_id: UUID, thing_id: UUID, case_id: UUID, ... }
    // No transformation needed - pass through new format

    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyevidence/:identifier
 * Get evidence details by UUID or file_hash
 *
 * Supports both:
 * - evidence_id (UUID) - Primary, recommended
 * - file_hash (SHA256) - Deprecated, backward compatibility
 */
chittyevidenceRoutes.get("/:identifier", async (c) => {
  try {
    const identifier = c.req.param("identifier");
    const legacyFormat = c.req.query("legacy") === "true"; // Optional legacy response format

    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyEvidence service token not configured",
        },
        503,
      );
    }

    // Detect if identifier is UUID or file_hash
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    let response;

    if (isUUID) {
      // New path: Query by evidence_id (UUID)
      response = await fetch(
        `https://evidence.chitty.cc/api/evidence/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${serviceToken}`,
          },
        },
      );
    } else {
      // Legacy path: Query by file_hash (deprecated)
      console.warn(
        `[ChittyEvidence] Deprecated: file_hash lookup for ${identifier}`,
      );

      response = await fetch(
        `https://evidence.chitty.cc/api/compat/legacy/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${serviceToken}`,
          },
        },
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        return c.json({ error: "Evidence not found" }, 404);
      }
      throw new Error(`ChittyEvidence service error: ${response.status}`);
    }

    const data = await response.json();

    // If legacy format requested, transform response
    if (legacyFormat && c.env.EVIDENCE_LEGACY_MODE === "true") {
      const compat = new EvidenceCompatibilityLayer(c.env);
      const transformed = compat.transformToLegacyFormat(data);
      return c.json(transformed);
    }

    // Return v2.0 format by default
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyevidence/case/:caseId
 * List all evidence for a case
 *
 * Returns array of evidence records with ChittyLedger v2.0 structure
 */
chittyevidenceRoutes.get("/case/:caseId", async (c) => {
  try {
    const caseId = c.req.param("caseId");
    const limit = c.req.query("limit") || "50";
    const offset = c.req.query("offset") || "0";

    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyEvidence service token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://evidence.chitty.cc/api/case/${caseId}/evidence?limit=${limit}&offset=${offset}`,
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

/**
 * GET /api/chittyevidence/:evidenceId/sync-status
 * Get platform sync status for evidence
 *
 * Returns sync status from chittyevidence_platform_sync table
 */
chittyevidenceRoutes.get("/:evidenceId/sync-status", async (c) => {
  try {
    const evidenceId = c.req.param("evidenceId");

    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyEvidence service token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://evidence.chitty.cc/api/evidence/${evidenceId}/sync-status`,
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

/**
 * POST /api/chittyevidence/:evidenceId/verify
 * Trigger verification for evidence
 *
 * Integrates with ChittyVerify using new evidence_id
 */
chittyevidenceRoutes.post("/:evidenceId/verify", async (c) => {
  try {
    const evidenceId = c.req.param("evidenceId");
    const verificationOptions = await c.req.json();

    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          error: "ChittyEvidence service token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://evidence.chitty.cc/api/evidence/${evidenceId}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(verificationOptions),
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

/**
 * GET /api/chittyevidence/health
 * Health check endpoint with schema version info
 */
chittyevidenceRoutes.get("/health", async (c) => {
  try {
    const serviceToken = await getServiceToken(c.env, "chittyevidence");

    if (!serviceToken) {
      return c.json(
        {
          status: "degraded",
          error: "Service token not available",
        },
        503,
      );
    }

    const response = await fetch("https://evidence.chitty.cc/health", {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    if (!response.ok) {
      return c.json(
        {
          status: "degraded",
          error: `Service returned ${response.status}`,
        },
        503,
      );
    }

    const health = await response.json();

    // Add ChittyConnect integration info
    return c.json({
      ...health,
      chittyconnect_integration: {
        version: "2.0.0",
        chittyledger_compatible: true,
        backward_compatible: c.env.EVIDENCE_LEGACY_MODE === "true",
        supports_uuid: true,
        supports_file_hash: true, // Deprecated
      },
    });
  } catch (error) {
    return c.json(
      {
        status: "down",
        error: error.message,
      },
      500,
    );
  }
});

export { chittyevidenceRoutes };
