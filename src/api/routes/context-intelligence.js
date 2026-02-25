/**
 * Context Intelligence API Routes
 *
 * Exposes the ContextIntelligence service for:
 * - Session decisions (what to auto-approve, what tools to suggest)
 * - Context drift detection and switch recommendations
 * - Collaboration management (delegation between contexts)
 * - Context pairs (complementary relationships)
 * - Supernova (merge) and Fission (split) operations
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/context-intelligence
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 */

import { Hono } from "hono";
import { ContextIntelligence } from "../../intelligence/context-intelligence.js";
import { ContextResolver } from "../../intelligence/context-resolver.js";

/**
 * Generate standard API response metadata
 * Per canonical API response format specification
 *
 * @returns {Object} - Standard metadata fields
 */
function generateResponseMetadata() {
  return {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    service: "chittyconnect",
    version: "1.0.0",
  };
}

/**
 * Create a standardized API response with metadata
 *
 * @param {Object} c - Hono context
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code (default 200)
 * @returns {Response} - JSON response with metadata
 */
function apiResponse(c, data, status = 200) {
  return c.json(
    {
      ...data,
      _meta: generateResponseMetadata(),
    },
    status,
  );
}

export const contextIntelligence = new Hono();

/**
 * Get full session decisions for a context
 * GET /api/v1/intelligence/decisions/:chittyId
 *
 * Returns: profile, coherence, alchemy, autonomy, guardrails, routing, pairs
 */
contextIntelligence.get("/decisions/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const hints = {
      projectPath: c.req.query("projectPath"),
      workspace: c.req.query("workspace"),
      supportType: c.req.query("supportType"),
      domains: c.req.query("domains")?.split(",").filter(Boolean),
    };

    const intel = new ContextIntelligence(c.env);
    const decisions = await intel.getSessionDecisions(chittyId, hints);

    if (decisions.error) {
      return apiResponse(c, { success: false, error: decisions.error }, 404);
    }

    return apiResponse(c, { success: true, data: decisions });
  } catch (error) {
    console.error("[Intelligence] Decisions error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "DECISIONS_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Analyze context coherence (should we switch?)
 * POST /api/v1/intelligence/coherence
 *
 * Body: { boundChittyId, currentHints: { projectPath, workspace, supportType, domains } }
 */
contextIntelligence.post("/coherence", async (c) => {
  try {
    const { boundChittyId, currentHints } = await c.req.json();

    if (!boundChittyId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_CHITTY_ID",
            message: "boundChittyId required",
          },
        },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const analysis = await intel.analyzeContextCoherence(
      boundChittyId,
      currentHints || {},
    );

    return apiResponse(c, { success: true, data: analysis });
  } catch (error) {
    console.error("[Intelligence] Coherence error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "COHERENCE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get Alchemy tool suggestions for a context
 * GET /api/v1/intelligence/alchemy/:chittyId
 */
contextIntelligence.get("/alchemy/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_NOT_FOUND" } },
        404,
      );
    }

    const tools = intel.suggestTools(profile);
    return apiResponse(c, {
      success: true,
      data: { tools, profile: intel.summarizeProfile(profile) },
    });
  } catch (error) {
    console.error("[Intelligence] Alchemy error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "ALCHEMY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get autonomy/guardrails for a context
 * GET /api/v1/intelligence/autonomy/:chittyId
 */
contextIntelligence.get("/autonomy/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_NOT_FOUND" } },
        404,
      );
    }

    const autonomy = intel.determineAutonomy(profile);
    const guardrails = intel.determineGuardrails(profile);

    return apiResponse(c, { success: true, data: { autonomy, guardrails } });
  } catch (error) {
    console.error("[Intelligence] Autonomy error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "AUTONOMY_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ COLLABORATION ============

/**
 * Find potential collaborators for a project
 * POST /api/v1/intelligence/collaborators/find
 *
 * Body: { projectHints: { domains }, requiredCompetencies: string[] }
 */
contextIntelligence.post("/collaborators/find", async (c) => {
  try {
    const { projectHints, requiredCompetencies } = await c.req.json();

    const intel = new ContextIntelligence(c.env);
    const candidates = await intel.findCollaborators(
      projectHints || {},
      requiredCompetencies || [],
    );

    return apiResponse(c, { success: true, data: candidates });
  } catch (error) {
    console.error("[Intelligence] Find collaborators error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "FIND_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Create collaboration/delegation
 * POST /api/v1/intelligence/collaborations
 *
 * Body: { parentChittyId, childChittyId, projectId, scope, permissions }
 */
contextIntelligence.post("/collaborations", async (c) => {
  try {
    const { parentChittyId, childChittyId, projectId, scope, permissions } =
      await c.req.json();

    if (!parentChittyId || !childChittyId) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_CONTEXTS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createCollaboration(
      parentChittyId,
      childChittyId,
      projectId,
      scope,
      permissions,
    );

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "COLLABORATION_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Create collaboration error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ CONTEXT PAIRS ============

/**
 * Create context pair
 * POST /api/v1/intelligence/pairs
 *
 * Body: { chittyId1, chittyId2, relationship }
 */
contextIntelligence.post("/pairs", async (c) => {
  try {
    const { chittyId1, chittyId2, relationship } = await c.req.json();

    if (!chittyId1 || !chittyId2 || !relationship) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createContextPair(
      chittyId1,
      chittyId2,
      relationship,
    );

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "PAIR_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Create pair error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get pairs for a context
 * GET /api/v1/intelligence/pairs/:chittyId
 */
contextIntelligence.get("/pairs/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const pairs = await intel.getContextPairs(chittyId);

    return apiResponse(c, { success: true, data: pairs });
  } catch (error) {
    console.error("[Intelligence] Get pairs error:", error);
    return apiResponse(
      c,
      { success: false, error: { code: "GET_FAILED", message: error.message } },
      500,
    );
  }
});

// ============ SUPERNOVA (MERGE) ============

/**
 * Analyze potential supernova merge
 * POST /api/v1/intelligence/supernova/analyze
 *
 * Body: { chittyId1, chittyId2 }
 */
contextIntelligence.post("/supernova/analyze", async (c) => {
  try {
    const { chittyId1, chittyId2 } = await c.req.json();

    if (!chittyId1 || !chittyId2) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_CONTEXTS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const analysis = await intel.analyzeSupernova(chittyId1, chittyId2);

    if (analysis.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "ANALYSIS_FAILED", message: analysis.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: analysis });
  } catch (error) {
    console.error("[Intelligence] Supernova analyze error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "ANALYZE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Execute supernova merge
 * POST /api/v1/intelligence/supernova/execute
 *
 * Body: { chittyId1, chittyId2, confirmationToken }
 */
contextIntelligence.post("/supernova/execute", async (c) => {
  try {
    const { chittyId1, chittyId2, confirmationToken } = await c.req.json();

    if (!chittyId1 || !chittyId2) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_CONTEXTS" } },
        400,
      );
    }

    if (!confirmationToken) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message:
              "Supernova is a significant operation. Provide confirmationToken to proceed.",
          },
        },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.executeSupernova(
      chittyId1,
      chittyId2,
      confirmationToken,
    );

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "SUPERNOVA_FAILED", message: result.error },
          data: result.analysis,
        },
        400,
      );
    }

    // Log lifecycle event
    await c.env.DB.prepare(
      `
      INSERT INTO context_lifecycle_events (id, event_type, source_chitty_ids, result_chitty_ids, user_confirmed, trigger_reason)
      VALUES (?, 'supernova_executed', ?, ?, 1, 'user_initiated')
    `,
    )
      .bind(
        crypto.randomUUID(),
        JSON.stringify([chittyId1, chittyId2]),
        JSON.stringify([result.mergedChittyId]),
      )
      .run();

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Supernova execute error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "EXECUTE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ FISSION (SPLIT) ============

/**
 * Analyze potential fission split
 * POST /api/v1/intelligence/fission/analyze
 *
 * Body: { chittyId, splitCriteria: { splitBy: 'domain' | 'supportType' } }
 */
contextIntelligence.post("/fission/analyze", async (c) => {
  try {
    const { chittyId, splitCriteria } = await c.req.json();

    if (!chittyId) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_CONTEXT" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const analysis = await intel.analyzeFission(chittyId, splitCriteria || {});

    if (analysis.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "ANALYSIS_FAILED", message: analysis.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: analysis });
  } catch (error) {
    console.error("[Intelligence] Fission analyze error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "ANALYZE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Execute fission split
 * POST /api/v1/intelligence/fission/execute
 *
 * Body: { chittyId, splitConfig: { splits: [{ label, domains, competencies, supportType }] }, confirmationToken }
 */
contextIntelligence.post("/fission/execute", async (c) => {
  try {
    const { chittyId, splitConfig, confirmationToken } = await c.req.json();

    if (!chittyId || !splitConfig?.splits?.length) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    if (!confirmationToken) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message:
              "Fission is a significant operation. Provide confirmationToken to proceed.",
          },
        },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.executeFission(
      chittyId,
      splitConfig,
      confirmationToken,
    );

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "FISSION_FAILED", message: result.error },
        },
        400,
      );
    }

    // Log lifecycle event
    await c.env.DB.prepare(
      `
      INSERT INTO context_lifecycle_events (id, event_type, source_chitty_ids, result_chitty_ids, user_confirmed, trigger_reason)
      VALUES (?, 'fission_executed', ?, ?, 1, 'user_initiated')
    `,
    )
      .bind(
        crypto.randomUUID(),
        JSON.stringify([chittyId]),
        JSON.stringify(result.newContexts.map((ctx) => ctx.chittyId)),
      )
      .run();

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Fission execute error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "EXECUTE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ ALCHEMY: Chemistry-Inspired Classification ============

import {
  classifyElement,
  suggestReactions,
  ALCHEMY,
  describeChittyIdType,
} from "../../intelligence/context-alchemy.js";

/**
 * Get alchemy classification and suggested reactions
 * GET /api/v1/intelligence/alchemy/classify/:chittyId
 */
contextIntelligence.get("/alchemy/classify/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_NOT_FOUND" } },
        404,
      );
    }

    const element = classifyElement(profile);
    const suggestions = suggestReactions(profile);
    const chittyIdType = describeChittyIdType(chittyId.split("-")[4]); // Extract type from ChittyID

    return apiResponse(c, {
      success: true,
      data: {
        chittyId,
        element,
        origin: chittyIdType,
        suggestedReactions: suggestions,
        alchemyReference: ALCHEMY.ELEMENTS,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Alchemy classify error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CLASSIFY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Suggest reactions between two contexts
 * POST /api/v1/intelligence/alchemy/suggest
 *
 * Body: { chittyId1, chittyId2 }
 */
contextIntelligence.post("/alchemy/suggest", async (c) => {
  try {
    const { chittyId1, chittyId2 } = await c.req.json();

    if (!chittyId1) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_CHITTY_ID" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const profile1 = await intel.loadContextProfile(chittyId1);
    if (!profile1)
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_1_NOT_FOUND" } },
        404,
      );

    let profile2 = null;
    if (chittyId2) {
      profile2 = await intel.loadContextProfile(chittyId2);
      if (!profile2)
        return apiResponse(
          c,
          { success: false, error: { code: "CONTEXT_2_NOT_FOUND" } },
          404,
        );
    }

    const element1 = classifyElement(profile1);
    const element2 = profile2 ? classifyElement(profile2) : null;
    const suggestions = suggestReactions(profile1, profile2);

    return apiResponse(c, {
      success: true,
      data: {
        contexts: [
          { chittyId: chittyId1, element: element1 },
          chittyId2 ? { chittyId: chittyId2, element: element2 } : null,
        ].filter(Boolean),
        suggestedReactions: suggestions,
        reactionReference: ALCHEMY.REACTIONS,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Alchemy suggest error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "SUGGEST_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ DERIVATIVE: Fork a Context ============

/**
 * Create derivative (fork) of a context
 * POST /api/v1/intelligence/derivative
 *
 * Body: { sourceChittyId, label, projectPath?, supportType?, inheritCompetencies?, inheritDomains? }
 */
contextIntelligence.post("/derivative", async (c) => {
  try {
    const { sourceChittyId, ...config } = await c.req.json();

    if (!sourceChittyId || !config.label) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_PARAMS",
            message: "sourceChittyId and label required",
          },
        },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createDerivative(sourceChittyId, config);

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "DERIVATIVE_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Derivative error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ SUSPENSION: Temporary Blend ============

/**
 * Create suspension (temporary blend)
 * POST /api/v1/intelligence/suspension
 *
 * Body: { contextIds: string[], taskDescription, expiresIn?: number }
 */
contextIntelligence.post("/suspension", async (c) => {
  try {
    const { contextIds, taskDescription, expiresIn } = await c.req.json();

    if (!contextIds || contextIds.length < 2 || !taskDescription) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createSuspension(contextIds, {
      taskDescription,
      expiresIn,
    });

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "SUSPENSION_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Suspension error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Dissolve suspension
 * POST /api/v1/intelligence/suspension/:chittyId/dissolve
 */
contextIntelligence.post("/suspension/:chittyId/dissolve", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const result = await intel.dissolveSuspension(chittyId);

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Dissolve error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "DISSOLVE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ SOLUTION: Team of Contexts ============

/**
 * Create solution (team collaboration)
 * POST /api/v1/intelligence/solution
 *
 * Body: { contextIds: string[], problemDescription, roles?: { [chittyId]: string } }
 */
contextIntelligence.post("/solution", async (c) => {
  try {
    const { contextIds, problemDescription, roles } = await c.req.json();

    if (!contextIds || contextIds.length < 2 || !problemDescription) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createSolution(contextIds, {
      problemDescription,
      roles,
    });

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "SOLUTION_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Solution error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ COMBINATION (Amalgamation): Soft Merge ============

/**
 * Create combination (soft merge / amalgamation)
 * POST /api/v1/intelligence/combination
 *
 * Body: { chittyId1, chittyId2, shareDirection?, shareDomains?, shareCompetencies? }
 */
contextIntelligence.post("/combination", async (c) => {
  try {
    const { chittyId1, chittyId2, ...config } = await c.req.json();

    if (!chittyId1 || !chittyId2) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const intel = new ContextIntelligence(c.env);
    const result = await intel.createCombination(chittyId1, chittyId2, config);

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "COMBINATION_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Combination error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CREATE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ ALCHEMIST DAEMON: Capability Assessment ============

import {
  AlchemistDaemon,
  CAPABILITY_DIMENSIONS,
  CONTEXT_ARCHETYPES,
} from "../../intelligence/alchemist-daemon.js";

/**
 * Assess context capabilities (stability vs complexity tradeoff)
 * GET /api/v1/intelligence/alchemist/capabilities/:chittyId
 */
contextIntelligence.get("/alchemist/capabilities/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const daemon = new AlchemistDaemon(c.env);
    const assessment = await daemon.assessCapabilities(chittyId);

    if (assessment.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "NOT_FOUND", message: assessment.error },
        },
        404,
      );
    }

    return apiResponse(c, { success: true, data: assessment });
  } catch (error) {
    console.error("[Alchemist] Capabilities error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "ASSESS_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get capability dimensions and archetypes reference
 * GET /api/v1/intelligence/alchemist/reference
 */
contextIntelligence.get("/alchemist/reference", (c) => {
  return apiResponse(c, {
    success: true,
    data: {
      capabilityDimensions: CAPABILITY_DIMENSIONS,
      archetypes: CONTEXT_ARCHETYPES,
    },
  });
});

/**
 * Run controlled experiment (Laboratory Mode)
 * POST /api/v1/intelligence/alchemist/experiment
 *
 * Body: { contextIds: string[], taskType: string, parameters?: object }
 */
contextIntelligence.post("/alchemist/experiment", async (c) => {
  try {
    const config = await c.req.json();

    if (!config.contextIds?.length || !config.taskType) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const daemon = new AlchemistDaemon(c.env);
    const results = await daemon.runExperiment(config);

    return apiResponse(c, { success: true, data: results });
  } catch (error) {
    console.error("[Alchemist] Experiment error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "EXPERIMENT_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Observe evolution (Field Mode)
 * GET /api/v1/intelligence/alchemist/observe
 */
contextIntelligence.get("/alchemist/observe", async (c) => {
  try {
    const daemon = new AlchemistDaemon(c.env);
    const observations = await daemon.observeEvolution();

    return apiResponse(c, { success: true, data: observations });
  } catch (error) {
    console.error("[Alchemist] Observe error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "OBSERVE_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ BEHAVIORAL ANALYSIS ============

import {
  ContextBehavior,
  BEHAVIORAL_TRAITS,
  SOURCE_PROFILES,
} from "../../intelligence/context-behavior.js";

/**
 * Log exposure to an external source
 * POST /api/v1/intelligence/behavior/exposure
 *
 * Body: { chittyId, sourceDomain, sourceType?, interactionType?, contentCategory?, sessionId? }
 */
contextIntelligence.post("/behavior/exposure", async (c) => {
  try {
    const { chittyId, ...exposure } = await c.req.json();

    if (!chittyId || !exposure.sourceDomain) {
      return apiResponse(
        c,
        { success: false, error: { code: "MISSING_PARAMS" } },
        400,
      );
    }

    const behavior = new ContextBehavior(c.env);
    const result = await behavior.logExposure(chittyId, exposure);

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "LOG_FAILED", message: result.error },
        },
        400,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Exposure log error:", error);
    return apiResponse(
      c,
      { success: false, error: { code: "LOG_FAILED", message: error.message } },
      500,
    );
  }
});

/**
 * Assess and update behavioral traits
 * POST /api/v1/intelligence/behavior/assess/:chittyId
 */
contextIntelligence.post("/behavior/assess/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const behavior = new ContextBehavior(c.env);
    const result = await behavior.assessBehavior(chittyId);

    if (result.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "ASSESS_FAILED", message: result.error },
        },
        404,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Assess error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "ASSESS_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get contexts with behavioral concerns
 * GET /api/v1/intelligence/behavior/concerns
 * NOTE: This MUST be before /behavior/:chittyId to avoid route collision
 */
contextIntelligence.get("/behavior/concerns", async (c) => {
  try {
    const behavior = new ContextBehavior(c.env);
    const concerns = await behavior.getContextsWithConcerns();

    return apiResponse(c, {
      success: true,
      data: {
        contexts: concerns,
        traitDefinitions: BEHAVIORAL_TRAITS,
        sourceProfiles: SOURCE_PROFILES,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Concerns error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "FETCH_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get behavioral summary for a context
 * GET /api/v1/intelligence/behavior/:chittyId
 */
contextIntelligence.get("/behavior/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const behavior = new ContextBehavior(c.env);
    const summary = await behavior.getBehaviorSummary(chittyId);

    if (summary.error) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "NOT_FOUND", message: summary.error },
        },
        404,
      );
    }

    return apiResponse(c, { success: true, data: summary });
  } catch (error) {
    console.error("[Intelligence] Behavior summary error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "FETCH_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ TAXONOMY: Practical Context Classification ============

import {
  CONTEXT_TYPES,
  CATEGORIES,
  classifyContext,
  findCollaborators,
  getDiscoveryStatus,
  getTaxonomySummary,
} from "../../intelligence/context-taxonomy.js";

/**
 * Get full taxonomy summary (all types grouped by category)
 * GET /api/v1/intelligence/taxonomy
 */
contextIntelligence.get("/taxonomy", (c) => {
  try {
    const summary = getTaxonomySummary();
    return apiResponse(c, {
      success: true,
      data: {
        categories: CATEGORIES,
        typesByCategory: summary,
        totalTypes: Object.keys(CONTEXT_TYPES).filter(
          (k) => CONTEXT_TYPES[k].category !== "synthetic",
        ).length,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Taxonomy error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "TAXONOMY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Classify a context into a taxonomy type
 * GET /api/v1/intelligence/taxonomy/classify/:chittyId
 */
contextIntelligence.get("/taxonomy/classify/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_NOT_FOUND" } },
        404,
      );
    }

    const classification = classifyContext(profile);

    return apiResponse(c, {
      success: true,
      data: {
        chittyId,
        classification,
        profile: intel.summarizeProfile(profile),
      },
    });
  } catch (error) {
    console.error("[Intelligence] Taxonomy classify error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CLASSIFY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Get discovery status for a user
 * GET /api/v1/intelligence/taxonomy/discovery
 *
 * Query: userId (optional, uses auth if not provided)
 */
contextIntelligence.get("/taxonomy/discovery", async (c) => {
  try {
    const userId = c.req.query("userId") || c.get("userId");

    // Get all contexts for user
    const result = await c.env.DB.prepare(
      `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.anomaly_count
      FROM context_entities ce
      LEFT JOIN context_dna cd ON cd.chitty_id = ce.chitty_id
      WHERE ce.owner_identity = ?
    `,
    )
      .bind(userId)
      .all();

    const contexts = result.results.map((row) => ({
      ...row,
      competencies: JSON.parse(row.competencies || "[]"),
      expertise_domains: JSON.parse(row.expertise_domains || "[]"),
    }));

    const discovery = getDiscoveryStatus(contexts);

    return apiResponse(c, {
      success: true,
      data: discovery,
    });
  } catch (error) {
    console.error("[Intelligence] Discovery error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "DISCOVERY_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Find collaborators for a context based on taxonomy
 * GET /api/v1/intelligence/taxonomy/collaborators/:chittyId
 */
contextIntelligence.get("/taxonomy/collaborators/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        { success: false, error: { code: "CONTEXT_NOT_FOUND" } },
        404,
      );
    }

    const classification = classifyContext(profile);

    // Get all active contexts (potential collaborators)
    const result = await c.env.DB.prepare(
      `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate
      FROM context_entities ce
      LEFT JOIN context_dna cd ON cd.chitty_id = ce.chitty_id
      WHERE ce.status = 'active' AND ce.chitty_id != ?
      LIMIT 50
    `,
    )
      .bind(chittyId)
      .all();

    const candidates = result.results.map((row) => ({
      ...row,
      competencies: JSON.parse(row.competencies || "[]"),
      expertise_domains: JSON.parse(row.expertise_domains || "[]"),
    }));

    const collaborators = findCollaborators(classification.type, candidates);

    return apiResponse(c, {
      success: true,
      data: {
        sourceContext: {
          chittyId,
          classification,
        },
        collaborators,
        collaboratesWellWith: classification.type.collaboratesWellWith || [],
      },
    });
  } catch (error) {
    console.error("[Intelligence] Find collaborators error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "FIND_FAILED", message: error.message },
      },
      500,
    );
  }
});

// ============ CONTEXT TOOLS: MCP Backend Routes ============

/**
 * Resolve context from hints (MCP tool backend)
 * POST /api/v1/intelligence/context/resolve
 *
 * Body: { project_path, platform, support_type, organization }
 */
contextIntelligence.post("/context/resolve", async (c) => {
  try {
    const { project_path, platform, support_type, organization } =
      await c.req.json();

    if (!project_path && !organization) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "INSUFFICIENT_HINTS",
            message: "At least project_path or organization required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);
    const result = await resolver.resolveContext({
      projectPath: project_path,
      platform,
      supportType: support_type,
      organization,
    });

    if (result.action === "error") {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "RESOLUTION_FAILED", message: result.error },
        },
        404,
      );
    }

    return apiResponse(c, { success: true, data: result });
  } catch (error) {
    console.error("[Intelligence] Context resolve error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "RESOLVE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Restore context for a ChittyID (MCP tool backend)
 * GET /api/v1/intelligence/context/:chittyId/restore
 *
 * Query: project (optional project slug)
 */
contextIntelligence.get("/context/:chittyId/restore", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const project = c.req.query("project");

    const resolver = new ContextResolver(c.env);
    const resolution = await resolver.resolveContext({
      explicitChittyId: chittyId,
    });

    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (resolution.action === "error" && !profile) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONTEXT_NOT_FOUND",
            message: `ChittyID ${chittyId} not found`,
          },
        },
        404,
      );
    }

    return apiResponse(c, {
      success: true,
      data: {
        resolution,
        profile: profile ? intel.summarizeProfile(profile) : null,
        trust: profile
          ? {
              level: profile.trust_level,
              score: profile.trust_score,
              anomalyCount: profile.anomaly_count,
            }
          : null,
        dna: profile
          ? {
              competencies: profile.competencies,
              domains: profile.expertise_domains,
              totalInteractions: profile.total_interactions,
              successRate: profile.success_rate,
            }
          : null,
        project,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Context restore error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "RESTORE_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Commit context session metrics (MCP tool backend)
 * POST /api/v1/intelligence/context/commit
 *
 * Body: { session_id, chitty_id, project_slug, metrics, decisions }
 */
contextIntelligence.post("/context/commit", async (c) => {
  try {
    const { session_id, chitty_id, project_slug, metrics, decisions } =
      await c.req.json();

    if (!session_id) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_SESSION_ID",
            message: "session_id is required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);
    const result = await resolver.unbindSession(session_id, {
      interactions: metrics?.interactions,
      decisions: metrics?.decisions,
      successRate: metrics?.success_rate,
      competencies: metrics?.competencies,
      domains: metrics?.domains,
    });

    if (!result) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "NO_ACTIVE_BINDING",
            message: `No active binding found for session ${session_id}`,
          },
        },
        404,
      );
    }

    return apiResponse(c, {
      success: true,
      data: {
        committed: true,
        contextId: result.contextId,
        chittyId: result.chittyId,
        sessionId: session_id,
        projectSlug: project_slug,
        metricsAccumulated: true,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Context commit error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "COMMIT_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Check context trust/DNA status (MCP tool backend)
 * GET /api/v1/intelligence/context/:chittyId/check
 */
contextIntelligence.get("/context/:chittyId/check", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");

    const intel = new ContextIntelligence(c.env);
    const profile = await intel.loadContextProfile(chittyId);

    if (!profile) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONTEXT_NOT_FOUND",
            message: `Context ${chittyId} not found`,
          },
        },
        404,
      );
    }

    return apiResponse(c, {
      success: true,
      data: {
        chittyId,
        trust: {
          level: profile.trust_level,
          score: profile.trust_score,
          anomalyCount: profile.anomaly_count,
          lastAnomalyAt: profile.last_anomaly_at,
        },
        dna: {
          competencies: profile.competencies,
          domains: profile.expertise_domains,
          totalInteractions: profile.total_interactions,
          totalDecisions: profile.total_decisions,
          successRate: profile.success_rate,
        },
        status: profile.status,
        supportType: profile.support_type,
        projectPath: profile.project_path,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Context check error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CHECK_FAILED", message: error.message },
      },
      500,
    );
  }
});

/**
 * Save context checkpoint (MCP tool backend)
 * POST /api/v1/intelligence/context/checkpoint
 *
 * Body: { chitty_id, project_slug, name, state }
 */
contextIntelligence.post("/context/checkpoint", async (c) => {
  try {
    const { chitty_id, project_slug, name, state } = await c.req.json();

    if (!chitty_id) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_CHITTY_ID",
            message: "chitty_id is required",
          },
        },
        400,
      );
    }

    if (!name) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_NAME",
            message: "Checkpoint name is required",
          },
        },
        400,
      );
    }

    // Use the resolver's logToLedger to store the checkpoint as a ledger entry
    const resolver = new ContextResolver(c.env);
    const context = await resolver.loadContextByChittyId(chitty_id);

    if (!context) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONTEXT_NOT_FOUND",
            message: `Context ${chitty_id} not found`,
          },
        },
        404,
      );
    }

    const ledgerEntry = await resolver.logToLedger(
      context.id,
      chitty_id,
      "checkpoint",
      "checkpoint",
      {
        type: "context_checkpoint",
        name,
        projectSlug: project_slug,
        state: state || {},
        checkpointedAt: Date.now(),
      },
    );

    return apiResponse(c, {
      success: true,
      data: {
        checkpointed: true,
        chittyId: chitty_id,
        projectSlug: project_slug,
        name,
        ledgerEntryId: ledgerEntry.entryId,
        ledgerHash: ledgerEntry.hash,
      },
    });
  } catch (error) {
    console.error("[Intelligence] Context checkpoint error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "CHECKPOINT_FAILED", message: error.message },
      },
      500,
    );
  }
});

export default contextIntelligence;
