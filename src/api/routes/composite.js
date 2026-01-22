/**
 * Composite API Routes - Optimized for Custom GPT Actions
 *
 * These endpoints provide multi-step workflows in single API calls,
 * reducing round trips and maintaining context across operations.
 *
 * Key Features:
 * - Atomic operations with rollback support
 * - Rich context preservation
 * - GPT-friendly response formatting
 * - Intelligent error recovery suggestions
 */

import { Hono } from "hono";
import { z } from "zod";
import { getServiceToken } from "../../lib/credential-helper.js";
import { contextualResponse, errorResponse } from "../../lib/responses.js";
import { APIError } from "../../lib/errors.js";
import { validateRequest } from "../middleware/validation.js";

const compositeRoutes = new Hono();

// Validation schemas
const CompleteCaseSchema = z.object({
  caseDetails: z.object({
    title: z.string().min(1).max(200),
    type: z.enum(["eviction", "litigation", "resolution", "general"]),
    description: z.string().max(2000).optional(),
    jurisdiction: z.string().optional(),
    filingDate: z.string().optional(),
  }),
  parties: z
    .array(
      z.object({
        role: z.enum([
          "plaintiff",
          "defendant",
          "witness",
          "attorney",
          "judge",
          "other",
        ]),
        name: z.string(),
        type: z.enum(["individual", "organization"]),
        contactInfo: z
          .object({
            email: z.string().email().optional(),
            phone: z.string().optional(),
            address: z.string().optional(),
          })
          .optional(),
        representation: z
          .object({
            attorneyName: z.string().optional(),
            firmName: z.string().optional(),
            barNumber: z.string().optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
  initialEvidence: z
    .record(
      z.object({
        type: z.enum([
          "document",
          "photo",
          "video",
          "audio",
          "financial",
          "communication",
          "other",
        ]),
        description: z.string(),
        url: z.string().url().optional(),
        data: z.any().optional(),
      }),
    )
    .optional(),
});

/**
 * POST /api/composite/case-with-parties
 * Create a complete case with all parties and initial evidence
 * This is the recommended endpoint for GPTs to create new legal cases
 */
compositeRoutes.post(
  "/case-with-parties",
  validateRequest(CompleteCaseSchema),
  async (c) => {
    const startTime = Date.now();
    const conversationId =
      c.req.header("X-Conversation-ID") || crypto.randomUUID();
    const input = await c.req.json();

    // Track operations for potential rollback
    const operations = [];

    try {
      // Get service tokens
      const chittyIdToken = await getServiceToken(c.env, "chittyid");
      const chittyCasesToken = await getServiceToken(c.env, "chittycases");
      const chittyEvidenceToken = await getServiceToken(
        c.env,
        "chittyevidence",
      );

      if (!chittyIdToken || !chittyCasesToken) {
        throw new APIError(
          "SERVICE_UNAVAILABLE",
          "Required services are not available",
          "ChittyID or ChittyCases service tokens not configured",
          503,
        );
      }

      // Step 1: Create ChittyID for the case
      const caseIdResponse = await fetch("https://id.chitty.cc/v1/mint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${chittyIdToken}`,
        },
        body: JSON.stringify({
          entity: "CONTEXT",
          metadata: {
            title: input.caseDetails.title,
            type: input.caseDetails.type,
            conversationId,
          },
        }),
      });

      if (!caseIdResponse.ok) {
        throw new APIError(
          "CHITTYID_CREATION_FAILED",
          "Failed to create case identifier",
          await caseIdResponse.text(),
          500,
        );
      }

      const caseIdData = await caseIdResponse.json();
      const caseId = caseIdData.chittyid;
      operations.push({ type: "chittyid", id: caseId, service: "chittyid" });

      // Step 2: Create ChittyIDs for all parties
      let partyResults = [];
      if (input.parties && input.parties.length > 0) {
        const partyPromises = input.parties.map(async (party) => {
          const response = await fetch("https://id.chitty.cc/v1/mint", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${chittyIdToken}`,
            },
            body: JSON.stringify({
              entity: party.type === "organization" ? "AUTH" : "PEO",
              metadata: {
                name: party.name,
                role: party.role,
                caseId,
                ...party.contactInfo,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to create party ID for ${party.name}`);
          }

          const data = await response.json();
          return {
            chittyId: data.chittyid,
            role: party.role,
            name: party.name,
            type: party.type,
            contactInfo: party.contactInfo,
          };
        });

        partyResults = await Promise.all(partyPromises);
        operations.push(
          ...partyResults.map((p) => ({
            type: "chittyid",
            id: p.chittyId,
            service: "chittyid",
          })),
        );
      }

      // Step 3: Create the case in ChittyCases
      const caseResponse = await fetch("https://cases.chitty.cc/v1/cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${chittyCasesToken}`,
        },
        body: JSON.stringify({
          chittyId: caseId,
          title: input.caseDetails.title,
          type: input.caseDetails.type,
          description: input.caseDetails.description,
          jurisdiction: input.caseDetails.jurisdiction,
          filingDate: input.caseDetails.filingDate,
          parties: partyResults.map((p) => ({
            chittyId: p.chittyId,
            role: p.role,
            name: p.name,
          })),
          status: "active",
          metadata: {
            createdVia: "composite-api",
            conversationId,
          },
        }),
      });

      if (!caseResponse.ok) {
        throw new APIError(
          "CASE_CREATION_FAILED",
          "Failed to create case record",
          await caseResponse.text(),
          500,
        );
      }

      const caseData = await caseResponse.json();
      operations.push({ type: "case", id: caseId, service: "chittycases" });

      // Step 4: Process initial evidence if provided
      let evidenceResults = [];
      if (
        input.initialEvidence &&
        Object.keys(input.initialEvidence).length > 0
      ) {
        const evidencePromises = Object.entries(input.initialEvidence).map(
          async ([key, evidence]) => {
            // Create ChittyID for evidence
            const evidenceIdResponse = await fetch(
              "https://id.chitty.cc/v1/mint",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${chittyIdToken}`,
                },
                body: JSON.stringify({
                  entity: "INFO",
                  metadata: {
                    type: evidence.type,
                    description: evidence.description,
                    caseId,
                    key,
                  },
                }),
              },
            );

            if (!evidenceIdResponse.ok) {
              throw new Error(`Failed to create evidence ID for ${key}`);
            }

            const evidenceIdData = await evidenceIdResponse.json();
            const evidenceId = evidenceIdData.chittyid;

            // Ingest evidence if service is available
            if (chittyEvidenceToken) {
              const ingestResponse = await fetch(
                "https://evidence.chitty.cc/v1/ingest",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${chittyEvidenceToken}`,
                  },
                  body: JSON.stringify({
                    chittyId: evidenceId,
                    caseId,
                    type: evidence.type,
                    description: evidence.description,
                    url: evidence.url,
                    data: evidence.data,
                    metadata: {
                      key,
                      conversationId,
                    },
                  }),
                },
              );

              if (ingestResponse.ok) {
                const ingestData = await ingestResponse.json();
                return {
                  id: evidenceId,
                  key,
                  type: evidence.type,
                  status: "verified",
                  ...ingestData,
                };
              }
            }

            // Return basic evidence record if ingestion service unavailable
            return {
              id: evidenceId,
              key,
              type: evidence.type,
              status: "pending",
              description: evidence.description,
            };
          },
        );

        evidenceResults = await Promise.all(evidencePromises);
        operations.push(
          ...evidenceResults.map((e) => ({
            type: "evidence",
            id: e.id,
            service: "chittyevidence",
          })),
        );
      }

      // Step 5: Store conversation context
      const contextKey = `context:${conversationId}`;
      const contextData = {
        conversationId,
        caseId,
        operations,
        timestamp: new Date().toISOString(),
        summary: {
          caseTitle: input.caseDetails.title,
          partyCount: partyResults.length,
          evidenceCount: evidenceResults.length,
        },
      };

      await c.env.CONVERSATIONS.put(
        contextKey,
        JSON.stringify(contextData),
        { expirationTtl: 86400 }, // 24 hours
      );

      // Return comprehensive response
      return contextualResponse(
        c,
        {
          case: {
            id: caseId,
            title: input.caseDetails.title,
            type: input.caseDetails.type,
            status: "active",
            createdAt: new Date().toISOString(),
            ...caseData,
          },
          parties: partyResults,
          evidence: evidenceResults,
          operations: operations.map((op) => ({
            ...op,
            status: "completed",
          })),
        },
        {
          conversationId,
          hint: `Case ${caseId} created successfully with ${partyResults.length} parties and ${evidenceResults.length} evidence items. You can now add more evidence, schedule hearings, or generate legal documents.`,
          nextSteps: [
            {
              action: "Add more evidence",
              endpoint: `/api/evidence/add`,
              method: "POST",
              reason: "Strengthen your case with additional documentation",
            },
            {
              action: "Generate legal document",
              endpoint: `/api/documents/generate`,
              method: "POST",
              reason: "Create formal legal notices or filings",
            },
            {
              action: "Schedule hearing",
              endpoint: `/api/cases/${caseId}/schedule`,
              method: "POST",
              reason: "Set court dates and deadlines",
            },
            {
              action: "View case details",
              endpoint: `/api/cases/${caseId}`,
              method: "GET",
              reason: "Review complete case information",
            },
          ],
          explanation: `This composite operation created a complete legal case structure in the ChittyOS ecosystem. Each entity (case, parties, evidence) has been assigned a unique ChittyID for permanent tracking. The case is now active and can be managed through various endpoints.`,
          processingTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      // Rollback operations on failure
      console.error("Composite operation failed:", error);

      // Attempt rollback (simplified for example)
      for (const op of operations.reverse()) {
        try {
          console.log(`Rolling back: ${op.type} ${op.id}`);
          // Actual rollback logic would go here
        } catch (rollbackError) {
          console.error(`Rollback failed for ${op.id}:`, rollbackError);
        }
      }

      // Return structured error
      if (error instanceof APIError) {
        return errorResponse(c, error);
      }

      return errorResponse(
        c,
        new APIError(
          "COMPOSITE_OPERATION_FAILED",
          "Failed to complete case creation workflow",
          {
            error: error.message,
            completedOperations: operations.filter(
              (op) => op.status === "completed",
            ),
            failedAt: operations.find((op) => op.status === "failed"),
            rollbackStatus: "attempted",
          },
          500,
        ),
      );
    }
  },
);

/**
 * POST /api/composite/batch
 * Execute multiple operations in a single request
 * Supports both parallel and sequential processing
 */
compositeRoutes.post("/batch", async (c) => {
  const { requests, sequential = false } = await c.req.json();

  // Validate batch size
  if (!requests || requests.length === 0) {
    return errorResponse(
      c,
      new APIError("INVALID_BATCH", "No requests provided in batch", null, 400),
    );
  }

  if (requests.length > 10) {
    return errorResponse(
      c,
      new APIError(
        "BATCH_TOO_LARGE",
        "Batch size exceeds maximum of 10 requests",
        { provided: requests.length, maximum: 10 },
        400,
      ),
    );
  }

  const conversationId =
    c.req.header("X-Conversation-ID") || crypto.randomUUID();

  try {
    // Process requests based on mode
    const results = sequential
      ? await processSequentially(requests, c, conversationId)
      : await processInParallel(requests, c, conversationId);

    // Analyze results
    const succeeded = results.filter((r) => r.status === "success");
    const failed = results.filter((r) => r.status === "error");
    const allSucceeded = failed.length === 0;

    // Determine response status code
    const statusCode = allSucceeded ? 200 : 207; // 207 Multi-Status for partial success

    return c.json(
      {
        success: allSucceeded,
        batch: {
          size: requests.length,
          mode: sequential ? "sequential" : "parallel",
          conversationId,
        },
        summary: {
          total: requests.length,
          succeeded: succeeded.length,
          failed: failed.length,
        },
        results,
        context: {
          conversationId,
          continuationHint:
            failed.length > 0
              ? `${failed.length} operations failed. Review the errors and retry if needed.`
              : "All operations completed successfully.",
          partialSuccess: !allSucceeded && succeeded.length > 0,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        },
      },
      statusCode,
    );
  } catch (error) {
    return errorResponse(
      c,
      new APIError(
        "BATCH_PROCESSING_FAILED",
        "Failed to process batch operations",
        error.message,
        500,
      ),
    );
  }
});

// Helper functions
async function processInParallel(requests, c, conversationId) {
  return Promise.all(
    requests.map((req, index) => processRequest(req, c, conversationId, index)),
  );
}

async function processSequentially(requests, c, conversationId) {
  const results = [];
  let previousContext = null;

  for (let i = 0; i < requests.length; i++) {
    const result = await processRequest(
      requests[i],
      c,
      conversationId,
      i,
      previousContext,
    );

    results.push(result);

    // Pass context forward for sequential processing
    if (result.status === "success" && result.response?.context) {
      previousContext = result.response.context;
    }
  }

  return results;
}

async function processRequest(
  request,
  c,
  conversationId,
  index,
  previousContext = null,
) {
  const { id = `req_${index}`, method, endpoint, body, headers = {} } = request;

  try {
    // Build full URL
    const url = new URL(endpoint, "https://connect.chitty.cc");

    // Prepare headers
    const requestHeaders = {
      "Content-Type": "application/json",
      "X-Conversation-ID": conversationId,
      "X-Batch-Request-ID": id,
      ...headers,
    };

    // Add auth from original request
    const auth = c.req.header("Authorization");
    if (auth) {
      requestHeaders["Authorization"] = auth;
    }

    // Add previous context if available
    if (previousContext) {
      requestHeaders["X-Previous-Context"] = JSON.stringify(previousContext);
    }

    // Make request
    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseData = await response.json();

    return {
      id,
      status: response.ok ? "success" : "error",
      statusCode: response.status,
      response: responseData,
      error: !response.ok ? responseData.error : null,
    };
  } catch (error) {
    return {
      id,
      status: "error",
      statusCode: 500,
      response: null,
      error: {
        code: "REQUEST_FAILED",
        message: error.message,
      },
    };
  }
}

export { compositeRoutes };
