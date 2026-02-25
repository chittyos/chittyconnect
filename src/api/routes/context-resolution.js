/**
 * Context Resolution Routes
 *
 * Implements the intelligent context matching and binding flow:
 * 1. Client sends context hints
 * 2. ChittyConnect finds existing context or prepares new one
 * 3. Client displays resolution for user confirmation
 * 4. User confirms or rejects binding
 * 5. On confirm: session is bound, logged to ledger
 * 6. On session end: metrics roll up to DNA
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/context-resolution
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/architecture/context-anchor-model
 */

import { Hono } from "hono";
import { ContextResolver } from "../../intelligence/context-resolver.js";

/**
 * Generate standard response metadata
 * @returns {Object} Metadata with requestId, timestamp, service, version
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
 * Create standardized API response with _meta field
 * @param {Object} c - Hono context
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @returns {Response} JSON response
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

export const contextResolution = new Hono();

/**
 * Resolve context from hints
 * POST /api/v1/context/resolve
 *
 * Body: {
 *   projectPath: string,      // e.g., "/Users/joe/projects/myapp"
 *   workspace: string,        // e.g., "development" | "production"
 *   supportType: string,      // e.g., "development" | "operations" | "support"
 *   organization: string,     // e.g., "CHITTYOS"
 *   platform: string,         // e.g., "claude-code" | "vscode" | "custom"
 *   explicitChittyId?: string // If user explicitly wants to bind to a known context
 * }
 *
 * Returns resolution result with action and context/pendingContext
 */
contextResolution.post("/resolve", async (c) => {
  try {
    const hints = await c.req.json();

    if (!hints.projectPath && !hints.workspace && !hints.explicitChittyId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "INSUFFICIENT_HINTS",
            message:
              "At least projectPath, workspace, or explicitChittyId required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);
    const resolution = await resolver.resolveContext(hints);

    // If error (e.g., explicit ChittyID not found)
    if (resolution.action === "error") {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "RESOLUTION_FAILED",
            message: resolution.error,
          },
        },
        404,
      );
    }

    // Return resolution for client to display and confirm
    return apiResponse(c, {
      success: true,
      data: {
        action: resolution.action,
        context: resolution.context || null,
        pendingContext: resolution.pendingContext || null,
        confidence: resolution.confidence || null,
        reason: resolution.reason,
        anchors: resolution.anchors,
        anchorHash: resolution.anchorHash?.slice(0, 16) + "...",
        requiresConfirmation:
          resolution.action === "create_new" || resolution.confidence < 0.9,
      },
    });
  } catch (error) {
    console.error("[ContextResolution] Resolve error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "RESOLVE_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Confirm context binding
 * POST /api/v1/context/bind
 *
 * Body: {
 *   action: "bind_existing" | "create_new",
 *   sessionId: string,           // Client's session ID
 *   platform: string,            // Platform identifier
 *
 *   // For bind_existing:
 *   contextId?: string,          // Existing context ID
 *   chittyId?: string,           // Existing ChittyID
 *
 *   // For create_new:
 *   pendingContext?: {
 *     projectPath, workspace, supportType, organization, anchorHash
 *   }
 * }
 */
contextResolution.post("/bind", async (c) => {
  try {
    const {
      action,
      sessionId,
      platform = "unknown",
      contextId,
      chittyId,
      pendingContext,
    } = await c.req.json();

    if (!sessionId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_SESSION_ID",
            message: "sessionId is required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);
    let boundContext;

    if (action === "bind_existing") {
      if (!contextId || !chittyId) {
        return apiResponse(
          c,
          {
            success: false,
            error: {
              code: "MISSING_CONTEXT",
              message: "contextId and chittyId required for bind_existing",
            },
          },
          400,
        );
      }

      // Bind session to existing context
      const binding = await resolver.bindSession(
        contextId,
        chittyId,
        sessionId,
        platform,
      );
      boundContext = await resolver.loadContextByChittyId(chittyId);

      return apiResponse(c, {
        success: true,
        data: {
          bound: true,
          binding,
          context: boundContext,
          message: `Session bound to existing context: ${chittyId}`,
        },
      });
    } else if (action === "create_new") {
      if (!pendingContext) {
        return apiResponse(
          c,
          {
            success: false,
            error: {
              code: "MISSING_PENDING_CONTEXT",
              message: "pendingContext required for create_new",
            },
          },
          400,
        );
      }

      // Create new context
      boundContext = await resolver.createContext(pendingContext);

      // Bind session to new context
      const binding = await resolver.bindSession(
        boundContext.id,
        boundContext.chitty_id,
        sessionId,
        platform,
      );

      return apiResponse(c, {
        success: true,
        data: {
          bound: true,
          created: true,
          binding,
          context: boundContext,
          message: `New context created and bound: ${boundContext.chitty_id}`,
        },
      });
    } else {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "INVALID_ACTION",
            message: 'action must be "bind_existing" or "create_new"',
          },
        },
        400,
      );
    }
  } catch (error) {
    console.error("[ContextResolution] Bind error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "BIND_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * End session and accumulate to DNA
 * POST /api/v1/context/unbind
 *
 * Body: {
 *   sessionId: string,
 *   metrics?: {
 *     interactions: number,
 *     decisions: number,
 *     successRate: number,       // 0.0 - 1.0
 *     competencies: string[],    // Skills demonstrated
 *     domains: string[]          // Expertise areas touched
 *   }
 * }
 */
contextResolution.post("/unbind", async (c) => {
  try {
    const { sessionId, metrics = {} } = await c.req.json();

    if (!sessionId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_SESSION_ID",
            message: "sessionId is required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);
    const result = await resolver.unbindSession(sessionId, metrics);

    if (!result) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "NO_ACTIVE_BINDING",
            message: `No active binding found for session ${sessionId}`,
          },
        },
        404,
      );
    }

    return apiResponse(c, {
      success: true,
      data: {
        unbound: true,
        contextId: result.contextId,
        chittyId: result.chittyId,
        metricsAccumulated: true,
        message: "Session unbound and metrics accumulated to DNA",
      },
    });
  } catch (error) {
    console.error("[ContextResolution] Unbind error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "UNBIND_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Get context summary for statusline display
 * GET /api/v1/context/summary/:chittyId
 */
contextResolution.get("/summary/:chittyId", async (c) => {
  try {
    const chittyId = c.req.param("chittyId");
    const resolver = new ContextResolver(c.env);
    const summary = await resolver.getContextSummary(chittyId);

    if (!summary) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "CONTEXT_NOT_FOUND",
            message: `Context not found for ChittyID: ${chittyId}`,
          },
        },
        404,
      );
    }

    return apiResponse(c, {
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("[ContextResolution] Summary error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "SUMMARY_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Get current session's bound context
 * GET /api/v1/context/current?sessionId=...
 */
contextResolution.get("/current", async (c) => {
  try {
    const sessionId = c.req.query("sessionId");

    if (!sessionId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_SESSION_ID",
            message: "sessionId query parameter is required",
          },
        },
        400,
      );
    }

    // Look up active binding for this session
    const binding = await c.env.DB.prepare(
      `
      SELECT csb.*, ce.chitty_id, ce.project_path, ce.workspace, ce.support_type,
             ce.trust_score, ce.trust_level, ce.status as context_status,
             cd.success_rate, cd.total_interactions, cd.competencies, cd.expertise_domains
      FROM context_session_bindings csb
      JOIN context_entities ce ON csb.context_id = ce.id
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE csb.session_id = ? AND csb.unbound_at IS NULL
    `,
    )
      .bind(sessionId)
      .first();

    if (!binding) {
      return apiResponse(c, {
        success: true,
        data: {
          bound: false,
          message: "No active context binding for this session",
        },
      });
    }

    return apiResponse(c, {
      success: true,
      data: {
        bound: true,
        sessionId,
        contextId: binding.context_id,
        chittyId: binding.chitty_id,
        context: {
          projectPath: binding.project_path,
          workspace: binding.workspace,
          supportType: binding.support_type,
          trustScore: binding.trust_score,
          trustLevel: binding.trust_level,
          status: binding.context_status,
          successRate: binding.success_rate,
          totalInteractions: binding.total_interactions,
          competencies: JSON.parse(binding.competencies || "[]"),
          expertiseDomains: JSON.parse(binding.expertise_domains || "[]"),
        },
        boundAt: binding.bound_at,
        platform: binding.platform,
      },
    });
  } catch (error) {
    console.error("[ContextResolution] Current error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "CURRENT_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Search for contexts by criteria (for team building, etc.)
 * GET /api/v1/context/search?supportType=...&minTrust=...&competency=...
 */
contextResolution.get("/search", async (c) => {
  try {
    const supportType = c.req.query("supportType");
    const minTrust = parseInt(c.req.query("minTrust") || "0", 10);
    const competency = c.req.query("competency");
    const domain = c.req.query("domain");
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);

    let query = `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status IN ('active', 'dormant')
    `;
    const params = [];

    if (supportType) {
      query += ` AND ce.support_type = ?`;
      params.push(supportType);
    }

    if (minTrust > 0) {
      query += ` AND ce.trust_score >= ?`;
      params.push(minTrust);
    }

    query += ` ORDER BY ce.trust_score DESC, cd.total_interactions DESC LIMIT ?`;
    params.push(limit);

    const results = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    // Post-filter for competency/domain (JSON filtering in SQLite is limited)
    let contexts = results.results.map((r) => ({
      ...r,
      competencies: JSON.parse(r.competencies || "[]"),
      expertiseDomains: JSON.parse(r.expertise_domains || "[]"),
    }));

    if (competency) {
      contexts = contexts.filter((ctx) =>
        ctx.competencies.some((c) =>
          (typeof c === "string" ? c : c.name)
            .toLowerCase()
            .includes(competency.toLowerCase()),
        ),
      );
    }

    if (domain) {
      contexts = contexts.filter((ctx) =>
        ctx.expertiseDomains.some((d) =>
          d.toLowerCase().includes(domain.toLowerCase()),
        ),
      );
    }

    return apiResponse(c, {
      success: true,
      data: contexts,
      total: contexts.length,
    });
  } catch (error) {
    console.error("[ContextResolution] Search error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "SEARCH_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Switch context - unbind from current and bind to new
 * POST /api/v1/context/switch
 *
 * Body: {
 *   sessionId: string,
 *   fromChittyId: string,       // Current context to unbind from
 *   toChittyId: string,         // Existing context to bind to
 *   metrics?: object,           // Metrics to accumulate from current session
 *   platform?: string
 * }
 */
contextResolution.post("/switch", async (c) => {
  try {
    const {
      sessionId,
      fromChittyId,
      toChittyId,
      metrics = {},
      platform = "unknown",
    } = await c.req.json();

    if (!sessionId || !fromChittyId || !toChittyId) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "MISSING_PARAMS",
            message: "sessionId, fromChittyId, and toChittyId required",
          },
        },
        400,
      );
    }

    const resolver = new ContextResolver(c.env);

    // 1. Unbind from current context (with metrics accumulation)
    const unbindResult = await resolver.unbindSession(sessionId, metrics);

    if (!unbindResult) {
      // Session wasn't bound - that's ok, just proceed to bind
      console.warn(
        `[ContextSwitch] No active binding for session ${sessionId}, proceeding to bind`,
      );
    }

    // 2. Load target context
    const targetContext = await resolver.loadContextByChittyId(toChittyId);

    if (!targetContext) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "TARGET_NOT_FOUND",
            message: `Target context ${toChittyId} not found`,
          },
        },
        404,
      );
    }

    // 3. Bind to target context
    const binding = await resolver.bindSession(
      targetContext.id,
      toChittyId,
      sessionId,
      platform,
    );

    // 4. Log switch event to ledger
    await resolver.logToLedger(
      targetContext.id,
      toChittyId,
      sessionId,
      "transaction",
      {
        type: "context_switch",
        fromContext: fromChittyId,
        toContext: toChittyId,
        reason: "user_initiated_switch",
        switchedAt: Date.now(),
      },
    );

    return apiResponse(c, {
      success: true,
      data: {
        switched: true,
        from: fromChittyId,
        to: toChittyId,
        binding,
        context: {
          chittyId: targetContext.chitty_id,
          projectPath: targetContext.project_path,
          workspace: targetContext.workspace,
          supportType: targetContext.support_type,
          trustLevel: targetContext.trust_level,
        },
        message: `Switched from ${fromChittyId} to ${toChittyId}`,
      },
    });
  } catch (error) {
    console.error("[ContextResolution] Switch error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: {
          code: "SWITCH_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Expand context - add new domains/competencies to existing context
 * POST /api/v1/context/expand
 *
 * Body: {
 *   chittyId: string,
 *   newDomains?: string[],
 *   newCompetencies?: string[]
 * }
 */
contextResolution.post("/expand", async (c) => {
  try {
    const {
      chittyId,
      newDomains = [],
      newCompetencies = [],
    } = await c.req.json();

    if (!chittyId) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "MISSING_CHITTY_ID", message: "chittyId required" },
        },
        400,
      );
    }

    if (newDomains.length === 0 && newCompetencies.length === 0) {
      return apiResponse(
        c,
        {
          success: false,
          error: {
            code: "NOTHING_TO_EXPAND",
            message: "Provide newDomains or newCompetencies",
          },
        },
        400,
      );
    }

    // Get current DNA
    const dna = await c.env.DB.prepare(
      `
      SELECT cd.*, ce.chitty_id
      FROM context_dna cd
      JOIN context_entities ce ON cd.context_id = ce.id
      WHERE ce.chitty_id = ?
    `,
    )
      .bind(chittyId)
      .first();

    if (!dna) {
      return apiResponse(
        c,
        {
          success: false,
          error: { code: "CONTEXT_NOT_FOUND", message: "Context not found" },
        },
        404,
      );
    }

    // Merge domains
    const currentDomains = JSON.parse(dna.expertise_domains || "[]");
    const mergedDomains = [...new Set([...currentDomains, ...newDomains])];

    // Merge competencies
    const currentCompetencies = JSON.parse(dna.competencies || "[]");
    const compMap = new Map();
    for (const comp of currentCompetencies) {
      const name = typeof comp === "string" ? comp : comp.name;
      compMap.set(name, comp);
    }
    for (const comp of newCompetencies) {
      if (!compMap.has(comp)) {
        compMap.set(comp, { name: comp, level: 1, count: 1 });
      }
    }
    const mergedCompetencies = Array.from(compMap.values());

    // Update DNA
    await c.env.DB.prepare(
      `
      UPDATE context_dna
      SET expertise_domains = ?, competencies = ?, updated_at = unixepoch()
      WHERE context_chitty_id = ?
    `,
    )
      .bind(
        JSON.stringify(mergedDomains),
        JSON.stringify(mergedCompetencies),
        chittyId,
      )
      .run();

    // Log expansion to ledger
    const resolver = new ContextResolver(c.env);
    const context = await resolver.loadContextByChittyId(chittyId);
    await resolver.logToLedger(
      context.id,
      chittyId,
      "expansion",
      "transaction",
      {
        type: "context_expanded",
        addedDomains: newDomains,
        addedCompetencies: newCompetencies,
        expandedAt: Date.now(),
      },
    );

    return apiResponse(c, {
      success: true,
      data: {
        expanded: true,
        chittyId,
        domains: mergedDomains,
        competencies: mergedCompetencies.map((comp) =>
          typeof comp === "string" ? comp : comp.name,
        ),
        added: {
          domains: newDomains,
          competencies: newCompetencies,
        },
      },
    });
  } catch (error) {
    console.error("[ContextResolution] Expand error:", error);
    return apiResponse(
      c,
      {
        success: false,
        error: { code: "EXPAND_FAILED", message: error.message },
      },
      500,
    );
  }
});

export default contextResolution;
