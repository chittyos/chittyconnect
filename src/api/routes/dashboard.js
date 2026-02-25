/**
 * Context Dashboard API Routes
 *
 * Provides comprehensive API for the ChittyID Context Dashboard:
 * - Context entity CRUD & lifecycle management
 * - Trust scoring & evolution
 * - Session bindings & activity
 * - Access approvals workflow
 * - Decommissioning workflows
 * - Alchemy suggestions (MCP tool recommendations)
 * - Team selection & project binding
 */

import { Hono } from "hono";

const dashboard = new Hono();

// ============================================================================
// CONTEXT ENTITIES - List, Get, Create
// ============================================================================

/**
 * GET /dashboard/contexts
 * List all context entities with filtering and pagination
 */
dashboard.get("/contexts", async (c) => {
  try {
    const db = c.env.DB;
    const {
      status,
      support_type,
      trust_level,
      limit = 50,
      offset = 0,
    } = c.req.query();

    let query = `
      SELECT
        ce.*,
        cd.total_interactions,
        cd.success_rate,
        cd.expertise_domains,
        cd.competencies,
        (SELECT COUNT(*) FROM context_session_bindings csb
         WHERE csb.context_id = ce.id AND csb.unbound_at IS NULL) as active_sessions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND ce.status = ?`;
      params.push(status);
    }
    if (support_type) {
      query += ` AND ce.support_type = ?`;
      params.push(support_type);
    }
    if (trust_level) {
      query += ` AND ce.trust_level >= ?`;
      params.push(parseInt(trust_level));
    }

    query += ` ORDER BY ce.last_activity DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db
      .prepare(query)
      .bind(...params)
      .all();

    // Get total count
    const countQuery =
      `SELECT COUNT(*) as total FROM context_entities WHERE 1=1` +
      (status ? ` AND status = '${status}'` : "") +
      (support_type ? ` AND support_type = '${support_type}'` : "");
    const countResult = await db.prepare(countQuery).first();

    return c.json({
      success: true,
      data: {
        contexts: result.results.map((ctx) => ({
          ...ctx,
          expertise_domains: JSON.parse(ctx.expertise_domains || "[]"),
          competencies: JSON.parse(ctx.competencies || "[]"),
          current_sessions: JSON.parse(ctx.current_sessions || "[]"),
        })),
        pagination: {
          total: countResult?.total || 0,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      },
    });
  } catch (error) {
    console.error("[Dashboard] List contexts error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /dashboard/contexts/:id
 * Get full context entity details including DNA, ledger, trust history
 */
dashboard.get("/contexts/:id", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");

    // Get context entity
    const context = await db
      .prepare(
        `
      SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    // Get DNA
    const dna = await db
      .prepare(
        `
      SELECT * FROM context_dna WHERE context_id = ?
    `,
      )
      .bind(context.id)
      .first();

    // Get active sessions
    const sessions = await db
      .prepare(
        `
      SELECT * FROM context_session_bindings
      WHERE context_id = ? AND unbound_at IS NULL
      ORDER BY bound_at DESC
    `,
      )
      .bind(context.id)
      .all();

    // Get recent ledger entries
    const ledger = await db
      .prepare(
        `
      SELECT * FROM context_ledger
      WHERE context_id = ?
      ORDER BY timestamp DESC
      LIMIT 50
    `,
      )
      .bind(context.id)
      .all();

    // Get trust history
    const trustHistory = await db
      .prepare(
        `
      SELECT * FROM context_trust_log
      WHERE context_id = ?
      ORDER BY changed_at DESC
      LIMIT 20
    `,
      )
      .bind(context.id)
      .all();

    return c.json({
      success: true,
      data: {
        context: {
          ...context,
          current_sessions: JSON.parse(context.current_sessions || "[]"),
        },
        dna: dna
          ? {
              ...dna,
              patterns: JSON.parse(dna.patterns || "[]"),
              traits: JSON.parse(dna.traits || "[]"),
              preferences: JSON.parse(dna.preferences || "[]"),
              competencies: JSON.parse(dna.competencies || "[]"),
              expertise_domains: JSON.parse(dna.expertise_domains || "[]"),
              peak_activity_hours: JSON.parse(dna.peak_activity_hours || "[]"),
            }
          : null,
        sessions: sessions.results,
        ledger: ledger.results.map((e) => ({
          ...e,
          payload: JSON.parse(e.payload || "{}"),
        })),
        trustHistory: trustHistory.results.map((t) => ({
          ...t,
          change_factors: JSON.parse(t.change_factors || "{}"),
        })),
      },
    });
  } catch (error) {
    console.error("[Dashboard] Get context error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// TRUST MANAGEMENT
// ============================================================================

/**
 * GET /dashboard/contexts/:id/trust-timeline
 * Get trust evolution timeline for visualization
 */
dashboard.get("/contexts/:id/trust-timeline", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");
    const { days = 30 } = c.req.query();

    const cutoff = Math.floor(Date.now() / 1000) - parseInt(days) * 86400;

    const timeline = await db
      .prepare(
        `
      SELECT
        changed_at,
        previous_trust_score,
        new_trust_score,
        previous_trust_level,
        new_trust_level,
        change_trigger,
        change_factors
      FROM context_trust_log
      WHERE context_id = ? AND changed_at >= ?
      ORDER BY changed_at ASC
    `,
      )
      .bind(contextId, cutoff)
      .all();

    return c.json({
      success: true,
      data: {
        timeline: timeline.results.map((t) => ({
          ...t,
          change_factors: JSON.parse(t.change_factors || "{}"),
          timestamp: new Date(t.changed_at * 1000).toISOString(),
        })),
        period: {
          days: parseInt(days),
          from: new Date(cutoff * 1000).toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Dashboard] Trust timeline error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/contexts/:id/trust/adjust
 * Manually adjust trust score (admin action)
 */
dashboard.post("/contexts/:id/trust/adjust", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");
    const { adjustment, reason, admin_chitty_id } = await c.req.json();

    if (!adjustment || !reason) {
      return c.json(
        { success: false, error: "adjustment and reason required" },
        400,
      );
    }

    // Get current context
    const context = await db
      .prepare(
        `
      SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    const newScore = Math.max(
      0,
      Math.min(100, context.trust_score + adjustment),
    );
    const newLevel = Math.floor(newScore / 20); // 0-20=0, 21-40=1, etc.

    // Update context
    await db
      .prepare(
        `
      UPDATE context_entities
      SET trust_score = ?, trust_level = ?, updated_at = unixepoch()
      WHERE id = ?
    `,
      )
      .bind(newScore, newLevel, context.id)
      .run();

    // Log trust change
    const logId = crypto.randomUUID();
    const contentHash = await hashContent({
      contextId,
      adjustment,
      reason,
      newScore,
    });

    await db
      .prepare(
        `
      INSERT INTO context_trust_log
      (id, context_id, context_chitty_id, previous_trust_level, new_trust_level,
       previous_trust_score, new_trust_score, change_trigger, change_factors, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        logId,
        context.id,
        context.chitty_id,
        context.trust_level,
        newLevel,
        context.trust_score,
        newScore,
        "manual_adjustment",
        JSON.stringify({ reason, admin_chitty_id, adjustment }),
        contentHash,
      )
      .run();

    return c.json({
      success: true,
      data: {
        previous: { score: context.trust_score, level: context.trust_level },
        current: { score: newScore, level: newLevel },
        adjustment,
        reason,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Trust adjust error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// LIFECYCLE MANAGEMENT - Decommissioning
// ============================================================================

/**
 * GET /dashboard/contexts/:id/decommission/preview
 * Preview what decommissioning would affect
 */
dashboard.get("/contexts/:id/decommission/preview", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");

    const context = await db
      .prepare(
        `
      SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    // Count affected records
    const activeSessions = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_session_bindings
      WHERE context_id = ? AND unbound_at IS NULL
    `,
      )
      .bind(context.id)
      .first();

    const ledgerEntries = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_ledger WHERE context_id = ?
    `,
      )
      .bind(context.id)
      .first();

    const trustLogs = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_trust_log WHERE context_id = ?
    `,
      )
      .bind(context.id)
      .first();

    return c.json({
      success: true,
      data: {
        context: {
          id: context.id,
          chitty_id: context.chitty_id,
          project_path: context.project_path,
          status: context.status,
          trust_score: context.trust_score,
        },
        impact: {
          active_sessions_to_unbind: activeSessions?.count || 0,
          ledger_entries_archived: ledgerEntries?.count || 0,
          trust_logs_archived: trustLogs?.count || 0,
        },
        warnings:
          activeSessions?.count > 0
            ? [
                `${activeSessions.count} active sessions will be forcibly unbound`,
              ]
            : [],
        recommendation:
          context.status === "active"
            ? "Set to dormant first to allow graceful session termination"
            : "Safe to proceed with decommissioning",
      },
    });
  } catch (error) {
    console.error("[Dashboard] Decommission preview error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/contexts/:id/decommission
 * Decommission a context (archive or revoke)
 */
dashboard.post("/contexts/:id/decommission", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");
    const { action, reason, force = false } = await c.req.json();

    if (!["archive", "revoke"].includes(action)) {
      return c.json(
        { success: false, error: "action must be 'archive' or 'revoke'" },
        400,
      );
    }

    const context = await db
      .prepare(
        `
      SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    // Check for active sessions
    const activeSessions = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_session_bindings
      WHERE context_id = ? AND unbound_at IS NULL
    `,
      )
      .bind(context.id)
      .first();

    if (activeSessions?.count > 0 && !force) {
      return c.json(
        {
          success: false,
          error: `Context has ${activeSessions.count} active sessions. Set force=true to proceed.`,
        },
        400,
      );
    }

    // Unbind all active sessions
    if (activeSessions?.count > 0) {
      await db
        .prepare(
          `
        UPDATE context_session_bindings
        SET unbound_at = unixepoch(), unbind_reason = 'revoked'
        WHERE context_id = ? AND unbound_at IS NULL
      `,
        )
        .bind(context.id)
        .run();
    }

    // Update status
    const newStatus = action === "archive" ? "archived" : "revoked";
    await db
      .prepare(
        `
      UPDATE context_entities
      SET status = ?, updated_at = unixepoch()
      WHERE id = ?
    `,
      )
      .bind(newStatus, context.id)
      .run();

    // Log to ledger
    const ledgerId = crypto.randomUUID();
    const previousHash = await db
      .prepare(
        `
      SELECT hash FROM context_ledger
      WHERE context_id = ? ORDER BY timestamp DESC LIMIT 1
    `,
      )
      .bind(context.id)
      .first();

    const payload = { action, reason, force, previous_status: context.status };
    const entryHash = await hashContent({ ledgerId, ...payload });

    await db
      .prepare(
        `
      INSERT INTO context_ledger
      (id, context_id, context_chitty_id, session_id, event_type, payload, hash, previous_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        ledgerId,
        context.id,
        context.chitty_id,
        "system",
        "decision",
        JSON.stringify(payload),
        entryHash,
        previousHash?.hash || "genesis",
      )
      .run();

    return c.json({
      success: true,
      data: {
        context_id: context.id,
        chitty_id: context.chitty_id,
        previous_status: context.status,
        new_status: newStatus,
        sessions_unbound: activeSessions?.count || 0,
        reason,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Decommission error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/contexts/:id/reactivate
 * Reactivate an archived/dormant context
 */
dashboard.post("/contexts/:id/reactivate", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");
    const { reason } = await c.req.json();

    const context = await db
      .prepare(
        `
      SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    if (context.status === "revoked") {
      return c.json(
        { success: false, error: "Revoked contexts cannot be reactivated" },
        400,
      );
    }

    if (context.status === "active") {
      return c.json(
        { success: false, error: "Context is already active" },
        400,
      );
    }

    await db
      .prepare(
        `
      UPDATE context_entities
      SET status = 'active', updated_at = unixepoch()
      WHERE id = ?
    `,
      )
      .bind(context.id)
      .run();

    return c.json({
      success: true,
      data: {
        context_id: context.id,
        chitty_id: context.chitty_id,
        previous_status: context.status,
        new_status: "active",
        reason,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Reactivate error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// ACCESS APPROVALS
// ============================================================================

/**
 * GET /dashboard/approvals
 * List pending access approval requests
 */
dashboard.get("/approvals", async (c) => {
  try {
    const db = c.env.DB;
    const { status = "pending", limit = 50 } = c.req.query();

    // Access approvals stored in context_ledger as 'transaction' events with approval_request payload
    const approvals = await db
      .prepare(
        `
      SELECT
        cl.id,
        cl.context_id,
        cl.context_chitty_id,
        cl.session_id,
        cl.payload,
        cl.timestamp,
        ce.project_path,
        ce.support_type,
        ce.trust_level
      FROM context_ledger cl
      JOIN context_entities ce ON cl.context_id = ce.id
      WHERE cl.event_type = 'transaction'
      AND json_extract(cl.payload, '$.type') = 'access_request'
      AND json_extract(cl.payload, '$.status') = ?
      ORDER BY cl.timestamp DESC
      LIMIT ?
    `,
      )
      .bind(status, parseInt(limit))
      .all();

    return c.json({
      success: true,
      data: {
        approvals: approvals.results.map((a) => ({
          ...a,
          payload: JSON.parse(a.payload || "{}"),
          timestamp: new Date(a.timestamp * 1000).toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("[Dashboard] List approvals error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/approvals/:id/approve
 * Approve an access request
 */
dashboard.post("/approvals/:id/approve", async (c) => {
  try {
    const db = c.env.DB;
    const approvalId = c.req.param("id");
    const { approver_chitty_id, notes } = await c.req.json();

    // Get the original request
    const request = await db
      .prepare(
        `
      SELECT * FROM context_ledger WHERE id = ?
    `,
      )
      .bind(approvalId)
      .first();

    if (!request) {
      return c.json(
        { success: false, error: "Approval request not found" },
        404,
      );
    }

    const payload = JSON.parse(request.payload || "{}");
    if (payload.status !== "pending") {
      return c.json(
        { success: false, error: "Request already processed" },
        400,
      );
    }

    // Update the ledger entry
    payload.status = "approved";
    payload.approved_by = approver_chitty_id;
    payload.approved_at = Date.now();
    payload.notes = notes;

    await db
      .prepare(
        `
      UPDATE context_ledger SET payload = ? WHERE id = ?
    `,
      )
      .bind(JSON.stringify(payload), approvalId)
      .run();

    // If this grants elevated trust, update the context
    if (payload.requested_trust_level) {
      await db
        .prepare(
          `
        UPDATE context_entities
        SET trust_level = ?, updated_at = unixepoch()
        WHERE id = ?
      `,
        )
        .bind(payload.requested_trust_level, request.context_id)
        .run();
    }

    return c.json({
      success: true,
      data: {
        approval_id: approvalId,
        status: "approved",
        approver: approver_chitty_id,
        context_chitty_id: request.context_chitty_id,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Approve error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/approvals/:id/deny
 * Deny an access request
 */
dashboard.post("/approvals/:id/deny", async (c) => {
  try {
    const db = c.env.DB;
    const approvalId = c.req.param("id");
    const { denier_chitty_id, reason } = await c.req.json();

    const request = await db
      .prepare(
        `
      SELECT * FROM context_ledger WHERE id = ?
    `,
      )
      .bind(approvalId)
      .first();

    if (!request) {
      return c.json(
        { success: false, error: "Approval request not found" },
        404,
      );
    }

    const payload = JSON.parse(request.payload || "{}");
    if (payload.status !== "pending") {
      return c.json(
        { success: false, error: "Request already processed" },
        400,
      );
    }

    payload.status = "denied";
    payload.denied_by = denier_chitty_id;
    payload.denied_at = Date.now();
    payload.denial_reason = reason;

    await db
      .prepare(
        `
      UPDATE context_ledger SET payload = ? WHERE id = ?
    `,
      )
      .bind(JSON.stringify(payload), approvalId)
      .run();

    return c.json({
      success: true,
      data: {
        approval_id: approvalId,
        status: "denied",
        denier: denier_chitty_id,
        reason,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Deny error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// ALCHEMY SUGGESTIONS - MCP Tool Recommendations
// ============================================================================

/**
 * GET /dashboard/contexts/:id/alchemy
 * Get Alchemy suggestions for a context based on its DNA and capabilities
 */
dashboard.get("/contexts/:id/alchemy", async (c) => {
  try {
    const db = c.env.DB;
    const contextId = c.req.param("id");

    const context = await db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.id = ? OR ce.chitty_id = ?
    `,
      )
      .bind(contextId, contextId)
      .first();

    if (!context) {
      return c.json({ success: false, error: "Context not found" }, 404);
    }

    const competencies = JSON.parse(context.competencies || "[]");
    const expertise = JSON.parse(context.expertise_domains || "[]");

    // Generate Alchemy suggestions based on context characteristics
    const suggestions = generateAlchemySuggestions({
      support_type: context.support_type,
      trust_level: context.trust_level,
      competencies,
      expertise,
      success_rate: context.success_rate || 0,
    });

    return c.json({
      success: true,
      data: {
        context_id: context.id,
        chitty_id: context.chitty_id,
        suggestions,
        reasoning: `Based on ${context.support_type} support type, trust level ${context.trust_level}, and ${competencies.length} competencies`,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Alchemy suggestions error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// TEAM SELECTION & PROJECT BINDING
// ============================================================================

/**
 * GET /dashboard/team-candidates
 * Get context entities suitable for team assignment
 */
dashboard.get("/team-candidates", async (c) => {
  try {
    const db = c.env.DB;
    const {
      support_types, // comma-separated: development,operations
      min_trust_level = 2,
      min_success_rate = 0.5,
      required_competencies, // comma-separated
      limit = 20,
    } = c.req.query();

    let query = `
      SELECT
        ce.id,
        ce.chitty_id,
        ce.project_path,
        ce.support_type,
        ce.trust_level,
        ce.trust_score,
        ce.total_sessions,
        ce.last_activity,
        cd.competencies,
        cd.expertise_domains,
        cd.success_rate,
        cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status = 'active'
      AND ce.trust_level >= ?
    `;
    const params = [parseInt(min_trust_level)];

    if (support_types) {
      const types = support_types
        .split(",")
        .map((t) => `'${t.trim()}'`)
        .join(",");
      query += ` AND ce.support_type IN (${types})`;
    }

    query += ` ORDER BY ce.trust_score DESC, cd.success_rate DESC LIMIT ?`;
    params.push(parseInt(limit));

    const result = await db
      .prepare(query)
      .bind(...params)
      .all();

    // Filter by competencies if specified
    let candidates = result.results.map((ctx) => ({
      ...ctx,
      competencies: JSON.parse(ctx.competencies || "[]"),
      expertise_domains: JSON.parse(ctx.expertise_domains || "[]"),
    }));

    if (required_competencies) {
      const required = required_competencies
        .split(",")
        .map((c) => c.trim().toLowerCase());
      candidates = candidates.filter((ctx) => {
        const ctxCompetencies = ctx.competencies.map((c) =>
          (typeof c === "string" ? c : c.name || "").toLowerCase(),
        );
        return required.some((r) =>
          ctxCompetencies.some((cc) => cc.includes(r)),
        );
      });
    }

    // Filter by success rate
    if (min_success_rate) {
      candidates = candidates.filter(
        (ctx) => (ctx.success_rate || 0) >= parseFloat(min_success_rate),
      );
    }

    return c.json({
      success: true,
      data: {
        candidates,
        criteria: {
          support_types,
          min_trust_level,
          min_success_rate,
          required_competencies,
        },
      },
    });
  } catch (error) {
    console.error("[Dashboard] Team candidates error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /dashboard/projects/:projectId/bind
 * Bind context entities to a project as a team
 */
dashboard.post("/projects/:projectId/bind", async (c) => {
  try {
    const db = c.env.DB;
    const projectId = c.req.param("projectId");
    const { context_ids, role_assignments } = await c.req.json();

    if (
      !context_ids ||
      !Array.isArray(context_ids) ||
      context_ids.length === 0
    ) {
      return c.json(
        { success: false, error: "context_ids array required" },
        400,
      );
    }

    const bindings = [];

    for (const contextId of context_ids) {
      const context = await db
        .prepare(
          `
        SELECT * FROM context_entities WHERE id = ? OR chitty_id = ?
      `,
        )
        .bind(contextId, contextId)
        .first();

      if (!context) {
        continue;
      }

      const role = role_assignments?.[contextId] || context.support_type;

      // Log binding to ledger
      const ledgerId = crypto.randomUUID();
      const payload = {
        type: "project_binding",
        project_id: projectId,
        role,
        bound_at: Date.now(),
      };

      const previousHash = await db
        .prepare(
          `
        SELECT hash FROM context_ledger
        WHERE context_id = ? ORDER BY timestamp DESC LIMIT 1
      `,
        )
        .bind(context.id)
        .first();

      const entryHash = await hashContent({ ledgerId, ...payload });

      await db
        .prepare(
          `
        INSERT INTO context_ledger
        (id, context_id, context_chitty_id, session_id, event_type, payload, hash, previous_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(
          ledgerId,
          context.id,
          context.chitty_id,
          "system",
          "transaction",
          JSON.stringify(payload),
          entryHash,
          previousHash?.hash || "genesis",
        )
        .run();

      bindings.push({
        context_id: context.id,
        chitty_id: context.chitty_id,
        role,
        support_type: context.support_type,
        trust_level: context.trust_level,
      });
    }

    return c.json({
      success: true,
      data: {
        project_id: projectId,
        bindings,
        team_size: bindings.length,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Project bind error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /dashboard/projects/:projectId/team
 * Get the team bound to a project
 */
dashboard.get("/projects/:projectId/team", async (c) => {
  try {
    const db = c.env.DB;
    const projectId = c.req.param("projectId");

    const bindings = await db
      .prepare(
        `
      SELECT
        cl.context_id,
        cl.context_chitty_id,
        cl.payload,
        cl.timestamp,
        ce.support_type,
        ce.trust_level,
        ce.trust_score,
        ce.status,
        cd.success_rate,
        cd.total_interactions
      FROM context_ledger cl
      JOIN context_entities ce ON cl.context_id = ce.id
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE cl.event_type = 'transaction'
      AND json_extract(cl.payload, '$.type') = 'project_binding'
      AND json_extract(cl.payload, '$.project_id') = ?
      ORDER BY cl.timestamp DESC
    `,
      )
      .bind(projectId)
      .all();

    // Dedupe to get latest binding per context
    const teamMap = new Map();
    for (const binding of bindings.results) {
      if (!teamMap.has(binding.context_id)) {
        teamMap.set(binding.context_id, {
          ...binding,
          payload: JSON.parse(binding.payload || "{}"),
        });
      }
    }

    return c.json({
      success: true,
      data: {
        project_id: projectId,
        team: Array.from(teamMap.values()),
        team_size: teamMap.size,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Project team error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// DASHBOARD STATS & OVERVIEW
// ============================================================================

/**
 * GET /dashboard/stats
 * Get dashboard overview statistics
 */
dashboard.get("/stats", async (c) => {
  try {
    const db = c.env.DB;

    // Get counts by status
    const statusCounts = await db
      .prepare(
        `
      SELECT status, COUNT(*) as count FROM context_entities GROUP BY status
    `,
      )
      .all();

    // Get counts by support type
    const typeCounts = await db
      .prepare(
        `
      SELECT support_type, COUNT(*) as count, AVG(trust_score) as avg_trust
      FROM context_entities WHERE status = 'active'
      GROUP BY support_type
    `,
      )
      .all();

    // Get trust distribution
    const trustDist = await db
      .prepare(
        `
      SELECT trust_level, COUNT(*) as count
      FROM context_entities WHERE status = 'active'
      GROUP BY trust_level ORDER BY trust_level
    `,
      )
      .all();

    // Get active sessions count
    const activeSessions = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_session_bindings WHERE unbound_at IS NULL
    `,
      )
      .first();

    // Get pending approvals
    const pendingApprovals = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_ledger
      WHERE event_type = 'transaction'
      AND json_extract(payload, '$.type') = 'access_request'
      AND json_extract(payload, '$.status') = 'pending'
    `,
      )
      .first();

    // Get recent activity (last 24h)
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const recentActivity = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM context_ledger WHERE timestamp >= ?
    `,
      )
      .bind(dayAgo)
      .first();

    return c.json({
      success: true,
      data: {
        overview: {
          total_contexts: statusCounts.results.reduce(
            (sum, s) => sum + s.count,
            0,
          ),
          active_contexts:
            statusCounts.results.find((s) => s.status === "active")?.count || 0,
          dormant_contexts:
            statusCounts.results.find((s) => s.status === "dormant")?.count ||
            0,
          archived_contexts:
            statusCounts.results.find((s) => s.status === "archived")?.count ||
            0,
          active_sessions: activeSessions?.count || 0,
          pending_approvals: pendingApprovals?.count || 0,
          events_24h: recentActivity?.count || 0,
        },
        by_support_type: typeCounts.results,
        trust_distribution: trustDist.results,
      },
    });
  } catch (error) {
    console.error("[Dashboard] Stats error:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function hashContent(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(content));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateAlchemySuggestions({
  support_type,
  trust_level,
  competencies,
  expertise,
  success_rate,
}) {
  const suggestions = [];

  // Base MCP tools for all contexts
  const baseTools = [
    { tool: "chittyid_mint", reason: "Identity management", confidence: 0.9 },
    {
      tool: "chitty_services_status",
      reason: "Ecosystem monitoring",
      confidence: 0.85,
    },
  ];

  // Support type specific suggestions
  const typeTools = {
    development: [
      {
        tool: "github_pr_create",
        reason: "Code workflow automation",
        confidence: 0.9,
      },
      {
        tool: "chitty_evidence_ingest",
        reason: "Development artifact tracking",
        confidence: 0.8,
      },
      { tool: "neon_query", reason: "Database operations", confidence: 0.75 },
    ],
    operations: [
      {
        tool: "chitty_consciousness_snapshot",
        reason: "Infrastructure monitoring",
        confidence: 0.95,
      },
      {
        tool: "chitty_consciousness_heal",
        reason: "Self-healing automation",
        confidence: 0.9,
      },
      {
        tool: "cloudflare_kv_ops",
        reason: "Cache management",
        confidence: 0.85,
      },
    ],
    legal: [
      {
        tool: "chitty_case_create",
        reason: "Case management",
        confidence: 0.95,
      },
      {
        tool: "chitty_evidence_ingest",
        reason: "Evidence management",
        confidence: 0.95,
      },
      {
        tool: "notion_database_query",
        reason: "Document research",
        confidence: 0.8,
      },
    ],
    research: [
      {
        tool: "chitty_memory_recall",
        reason: "Knowledge retrieval",
        confidence: 0.9,
      },
      { tool: "web_search", reason: "Information gathering", confidence: 0.85 },
      {
        tool: "notion_create_page",
        reason: "Research documentation",
        confidence: 0.8,
      },
    ],
    financial: [
      {
        tool: "chitty_finance_connect_bank",
        reason: "Banking integration",
        confidence: 0.9,
      },
      {
        tool: "chitty_ledger_entry",
        reason: "Financial tracking",
        confidence: 0.95,
      },
      {
        tool: "chitty_evidence_ingest",
        reason: "Financial document management",
        confidence: 0.85,
      },
    ],
    administrative: [
      {
        tool: "notion_create_task",
        reason: "Task management",
        confidence: 0.9,
      },
      { tool: "google_calendar_event", reason: "Scheduling", confidence: 0.85 },
      {
        tool: "chitty_sync_trigger",
        reason: "Cross-system sync",
        confidence: 0.8,
      },
    ],
  };

  suggestions.push(...baseTools);

  if (typeTools[support_type]) {
    suggestions.push(...typeTools[support_type]);
  }

  // Trust level adjustments
  if (trust_level >= 4) {
    suggestions.push(
      {
        tool: "chitty_trust_adjust",
        reason: "High-trust context can manage trust",
        confidence: 0.7,
      },
      {
        tool: "credential_provision",
        reason: "Credential management access",
        confidence: 0.8,
      },
    );
  }

  // Competency-based suggestions
  const competencyTools = {
    code_review: {
      tool: "github_pr_review",
      reason: "Matches code review competency",
      confidence: 0.9,
    },
    documentation: {
      tool: "notion_create_page",
      reason: "Matches documentation competency",
      confidence: 0.85,
    },
    testing: {
      tool: "test_runner",
      reason: "Matches testing competency",
      confidence: 0.9,
    },
    deployment: {
      tool: "cloudflare_deploy",
      reason: "Matches deployment competency",
      confidence: 0.85,
    },
  };

  for (const comp of competencies) {
    const compName = typeof comp === "string" ? comp : comp.name;
    const compLower = compName?.toLowerCase() || "";
    for (const [key, tool] of Object.entries(competencyTools)) {
      if (compLower.includes(key)) {
        suggestions.push(tool);
      }
    }
  }

  // Sort by confidence and dedupe
  const seen = new Set();
  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .filter((s) => {
      if (seen.has(s.tool)) return false;
      seen.add(s.tool);
      return true;
    })
    .slice(0, 10);
}

export { dashboard };
