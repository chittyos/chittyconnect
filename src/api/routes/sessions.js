/**
 * Session Management Routes
 *
 * Handles session lifecycle using Durable Objects for ContextConsciousness™.
 * The /sync endpoint provides channel-agnostic session lifecycle parity,
 * replacing the VM-only bash hook pipeline with a single HTTP call.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/sessions
 * @canon chittycanon://gov/governance#core-types
 */

import { Hono } from "hono";
import { SessionStateService } from "../../services/SessionStateService.js";
import { getCredential } from "../../lib/credential-helper.js";

const sessionRoutes = new Hono();

// Require X-ChittyID header on all parameterized session routes.
// Excludes fixed paths (/, /sync) which handle auth differently.
function requireChittyId() {
  return async (c, next) => {
    const chittyId = c.req.header("X-ChittyID");
    if (!chittyId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_CHITTYID",
            message: "X-ChittyID header is required",
          },
        },
        400,
      );
    }
    c.set("chittyId", chittyId);
    await next();
  };
}

sessionRoutes.post("/", async (c) => {
  try {
    const { chittyId, sessionId, metadata } = await c.req.json();

    if (!chittyId || !sessionId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "chittyId and sessionId are required",
          },
        },
        400,
      );
    }

    const sessionService = new SessionStateService(c.env);
    const session = await sessionService.createSession(
      chittyId,
      sessionId,
      metadata || {},
    );

    if (c.env.CONTEXT_CONSCIOUSNESS) {
      await c.env.CONTEXT_CONSCIOUSNESS.addDecision(chittyId, {
        type: "session_created",
        sessionId,
        reasoning: "New session initiated for ContextConsciousness™",
        confidence: 1.0,
        context: { metadata },
      });
    }

    return c.json({
      success: true,
      data: session,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
    });
  } catch (error) {
    console.error("[Sessions] Create error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "SESSION_CREATE_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.get("/", async (c) => {
  try {
    const chittyId = c.req.header("X-ChittyID");

    if (!chittyId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_CHITTYID",
            message: "X-ChittyID header is required",
          },
        },
        400,
      );
    }

    const sessionService = new SessionStateService(c.env);
    const result = await sessionService.listSessions(chittyId);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Sessions] List error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "SESSION_LIST_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * Channel-agnostic session lifecycle sync.
 * Replaces the VM-only bash hook pipeline with a single HTTP call.
 *
 * POST /sync
 */
sessionRoutes.post("/sync", async (c) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON",
          },
        },
        400,
      );
    }
    const {
      event,
      chittyId,
      sessionId,
      channel,
      project,
      coordinates,
      context,
      signals,
      notion,
    } = body;

    if (!event || !chittyId || !sessionId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "event, chittyId, and sessionId are required",
          },
        },
        400,
      );
    }

    if (event !== "session_start" && event !== "session_end") {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_EVENT",
            message: "event must be session_start or session_end",
          },
        },
        400,
      );
    }

    const timestamp = new Date().toISOString();
    const result = { event, sessionId, chittyId, timestamp, actions: [] };

    // Context key includes org when available for namespace isolation
    const projectContextKey = project?.slug
      ? `project:${project.org ? `${project.org}:` : ""}${project.slug}`
      : null;

    const sessionService = new SessionStateService(c.env);
    const contextResolver = c.get("contextResolver");

    if (event === "session_start") {
      const metadata = {
        channel: channel || { type: "unknown" },
        project: project || {},
        coordinates: coordinates || {},
        startedAt: timestamp,
      };

      // All three operations are independent — run in parallel
      const [sessionResult, ledgerResult, contextResult] =
        await Promise.allSettled([
          // 1. Create session in Durable Object
          sessionService.createSession(chittyId, sessionId, metadata),

          // 2. Bind session in D1 ledger
          contextResolver
            ? contextResolver
                .loadContextByChittyId(chittyId)
                .then((entity) =>
                  entity
                    ? contextResolver.bindSession(
                        entity.id,
                        chittyId,
                        sessionId,
                        channel?.type || "unknown",
                      )
                    : null,
                )
            : Promise.resolve(null),

          // 3. Load prior project context for hydration
          projectContextKey
            ? sessionService.getContext(chittyId, projectContextKey)
            : Promise.resolve(null),
        ]);

      if (sessionResult.status === "fulfilled") {
        result.session = sessionResult.value;
        result.actions.push("session_created");
      } else {
        console.error(
          "[Sessions/Sync] Session create failed:",
          sessionResult.reason?.message,
        );
        result.actions.push("session_create_failed");
      }

      if (ledgerResult.status === "fulfilled" && ledgerResult.value) {
        result.actions.push("ledger_session_bound");
      } else if (ledgerResult.status === "rejected") {
        console.error(
          "[Sessions/Sync] Ledger bind failed:",
          ledgerResult.reason?.message,
        );
        result.actions.push("ledger_bind_failed");
      }

      if (contextResult.status === "fulfilled" && contextResult.value) {
        result.priorContext = contextResult.value;
        result.actions.push("prior_context_loaded");
      }
    }

    if (event === "session_end") {
      // Build memory interaction object (needed by persist, independent of writes)
      const memory = c.get("memory");
      let interaction = null;
      if (memory && context) {
        const parts = [];
        if (project?.slug) parts.push(`Project: ${project.slug}`);
        if (context.summary)
          parts.push(`Session summary: ${context.summary}`);
        if (context.keyFacts?.length)
          parts.push(
            `Key facts: ${context.keyFacts.slice(0, 8).join("; ")}`,
          );
        if (context.pendingTasks?.length)
          parts.push(
            `Pending tasks: ${context.pendingTasks.slice(0, 8).join("; ")}`,
          );
        if (context.completedTasks?.length)
          parts.push(
            `Completed tasks: ${context.completedTasks.slice(0, 8).join("; ")}`,
          );

        const memoryContent = parts.join("\n").slice(0, 6000);
        const tags = [
          "session_sync",
          "session_end",
          "memorycloude_sync",
          channel?.type || "unknown_channel",
        ];
        if (project?.slug) tags.push(`project:${project.slug}`);

        interaction = {
          type: "session_sync_end",
          content: memoryContent,
          input: context.summary || "",
          // "chittyId" type matches MemoryCloude contract + bash drain shape.
          // Owner is Person (P). @canon: chittycanon://gov/governance#core-types
          entities: [{ type: "chittyId", id: chittyId }],
          actions: tags.map((t) => ({ type: `tag:${t}` })),
          decisions: (context.completedTasks || [])
            .slice(0, 8)
            .map((val, idx) => ({
              id: `done-${idx + 1}`,
              text: String(val),
            })),
          userId: chittyId,
          metadata: {
            projectSlug: project?.slug,
            summary: context.summary,
            channel: channel || {},
            taskSignals: signals?.tasks || {},
            gitSignals: signals?.git || {},
          },
        };
      }

      // All end operations are independent writes — run in parallel
      const endOps = [
        // 1. Update session status
        sessionService
          .updateSession(chittyId, sessionId, {
            status: "ended",
            state: "ended",
            endedAt: timestamp,
          })
          .then(() => "session_ended")
          .catch((err) => {
            console.error(
              "[Sessions/Sync] Session end update failed:",
              err.message,
            );
            return "session_end_failed";
          }),

        // 2. Unbind session in D1 ledger
        contextResolver
          ? contextResolver
              .unbindSession(sessionId, {
                interactions: signals?.tasks?.completed || 0,
                decisions: context?.completedTasks?.length || 0,
                successRate: null,
              })
              .then(() => "ledger_session_unbound")
              .catch((err) => {
                console.error(
                  "[Sessions/Sync] Ledger unbind failed:",
                  err.message,
                );
                return "ledger_unbind_failed";
              })
          : Promise.resolve(null),

        // 3. Persist to MemoryCloude™
        interaction
          ? memory
              .persistInteraction(sessionId, interaction)
              .then(() => "memory_persisted")
              .catch((err) => {
                console.error(
                  "[Sessions/Sync] Memory persist failed:",
                  err.message,
                );
                return "memory_persist_failed";
              })
          : Promise.resolve(null),

        // 4. Save project context for next session hydration
        projectContextKey && context
          ? sessionService
              .setContext(chittyId, projectContextKey, {
                summary: context.summary,
                keyFacts: context.keyFacts?.slice(0, 8),
                pendingTasks: context.pendingTasks?.slice(0, 8),
                completedTasks: context.completedTasks?.slice(0, 8),
                coordinates: coordinates || {},
                lastChannel: channel || {},
                lastSessionId: sessionId,
                updatedAt: timestamp,
              })
              .then(() => "project_context_saved")
              .catch((err) => {
                console.error(
                  "[Sessions/Sync] Context save failed:",
                  err.message,
                );
                return null;
              })
          : Promise.resolve(null),
      ];

      const endResults = await Promise.all(endOps);
      for (const action of endResults) {
        if (action) result.actions.push(action);
      }
    }

    // Fire-and-forget Notion update via waitUntil — doesn't block response
    if (notion?.projectPageId) {
      const notionUpdate = async () => {
        try {
          const notionToken = await getCredential(
            c.env,
            "integrations/notion/api_key",
            "NOTION_TOKEN",
          );
          if (!notionToken) return;

          const resp = await fetch(
            `https://api.notion.com/v1/pages/${notion.projectPageId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${notionToken}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                properties: {
                  "Session Status": {
                    select: {
                      name: event === "session_start" ? "Active" : "Ended",
                    },
                  },
                  "Last Session": {
                    rich_text: [
                      {
                        text: {
                          content: `${sessionId} | ${channel?.type || "unknown"} | ${channel?.machine || "unknown"} | ${timestamp}`,
                        },
                      },
                    ],
                  },
                },
              }),
            },
          );
          if (!resp.ok) {
            console.error(
              "[Sessions/Sync] Notion update failed:",
              resp.status,
            );
          }
        } catch (err) {
          console.error("[Sessions/Sync] Notion error:", err.message);
        }
      };
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(notionUpdate());
      } else {
        notionUpdate();
      }
      result.actions.push("notion_queued");
    }

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error("[Sessions/Sync] Error:", error);
    return c.json(
      {
        success: false,
        error: { code: "SESSION_SYNC_FAILED", message: error.message },
      },
      500,
    );
  }
});

sessionRoutes.get("/:sessionId", requireChittyId(), async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const chittyId = c.get("chittyId");

    const sessionService = new SessionStateService(c.env);
    const session = await sessionService.getSession(chittyId, sessionId);

    if (!session) {
      return c.json(
        {
          success: false,
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Session not found",
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("[Sessions] Get error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "SESSION_GET_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.patch("/:sessionId", requireChittyId(), async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const chittyId = c.get("chittyId");
    const updates = await c.req.json();

    const sessionService = new SessionStateService(c.env);
    const session = await sessionService.updateSession(
      chittyId,
      sessionId,
      updates,
    );

    return c.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("[Sessions] Update error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "SESSION_UPDATE_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.get("/:sessionId/context", requireChittyId(), async (c) => {
  try {
    const chittyId = c.get("chittyId");
    const key = c.req.query("key");

    const sessionService = new SessionStateService(c.env);
    const context = await sessionService.getContext(chittyId, key);

    return c.json({
      success: true,
      data: context,
    });
  } catch (error) {
    console.error("[Sessions] Get context error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "CONTEXT_GET_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.put("/:sessionId/context", requireChittyId(), async (c) => {
  try {
    const chittyId = c.get("chittyId");
    const { key, value } = await c.req.json();

    if (!key) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_KEY",
            message: "Context key is required",
          },
        },
        400,
      );
    }

    const sessionService = new SessionStateService(c.env);
    const result = await sessionService.setContext(chittyId, key, value);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Sessions] Set context error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "CONTEXT_SET_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.get("/:sessionId/metrics", requireChittyId(), async (c) => {
  try {
    const chittyId = c.get("chittyId");

    const sessionService = new SessionStateService(c.env);
    const metrics = await sessionService.getMetrics(chittyId);

    return c.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    console.error("[Sessions] Get metrics error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "METRICS_GET_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.get("/:sessionId/ws", requireChittyId(), async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const chittyId = c.get("chittyId");

    if (c.req.header("Upgrade") !== "websocket") {
      return c.json(
        {
          success: false,
          error: {
            code: "WEBSOCKET_REQUIRED",
            message: "WebSocket upgrade required",
          },
        },
        400,
      );
    }

    const sessionService = new SessionStateService(c.env);
    const webSocket = await sessionService.connectWebSocket(
      chittyId,
      sessionId,
    );

    if (!webSocket) {
      return c.json(
        {
          success: false,
          error: {
            code: "WEBSOCKET_FAILED",
            message: "Failed to establish WebSocket connection",
          },
        },
        500,
      );
    }

    return new Response(null, {
      status: 101,
      webSocket,
    });
  } catch (error) {
    console.error("[Sessions] WebSocket error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "WEBSOCKET_ERROR",
          message: error.message,
        },
      },
      500,
    );
  }
});

sessionRoutes.post("/:sessionId/migrate", requireChittyId(), async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const chittyId = c.get("chittyId");

    const sessionService = new SessionStateService(c.env);
    const session = await sessionService.migrateSession(chittyId, sessionId);

    if (!session) {
      return c.json(
        {
          success: false,
          error: {
            code: "MIGRATION_FAILED",
            message: "No session found to migrate or migration failed",
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: session,
      message: "Session successfully migrated to Durable Objects",
    });
  } catch (error) {
    console.error("[Sessions] Migration error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "MIGRATION_ERROR",
          message: error.message,
        },
      },
      500,
    );
  }
});

export { sessionRoutes };
