/**
 * MCP Portal Projection routes.
 *
 * POST /api/v1/mcp-portal/build-event
 *   Enqueues the MCPPortalProjection Workflow to re-project ChittyRegistry
 *   discovery onto the CF MCP Portal (Model B). Called by the post-deploy
 *   beacon (double-post: register THEN enqueue here) and the daily reconcile
 *   sweep. Trigger plane only — the Workflow itself reads discovery and the
 *   portal and (when the flag is on) writes the portal.
 *
 *   FEATURE-FLAGGED DEFAULT-OFF: with MCP_PORTAL_PROJECTION_ENABLED unset or
 *   != "true", the Workflow runs read+diff and writes NOTHING. The enqueue
 *   itself is harmless (durable read+diff). The handler reports the flag state
 *   so callers can see inertness.
 *
 * GET /api/v1/mcp-portal/build-event/:id
 *   Read-only status of a previously enqueued projection run.
 */

import { Hono } from "hono";

const mcpPortalRoutes = new Hono();

mcpPortalRoutes.post("/build-event", async (c) => {
  const wf = c.env.MCP_PORTAL_PROJECTION;
  if (!wf) {
    return c.json(
      { ok: false, error: "MCP_PORTAL_PROJECTION workflow binding not configured" },
      503,
    );
  }

  let payload = {};
  try {
    payload = await c.req.json();
  } catch {
    payload = {};
  }

  const enabled = c.env.MCP_PORTAL_PROJECTION_ENABLED === "true";
  const portalId = payload.portalId || c.env.MCP_PORTAL_ID || "chitty-mcp";

  const instance = await wf.create({
    params: {
      trigger: payload.trigger || "build-event",
      service: payload.service || null,
      portalId,
    },
  });

  return c.json({
    ok: true,
    enqueued: true,
    instanceId: instance.id,
    portalId,
    // Surfaced so the beacon / operator can confirm the projection is inert
    // until the flag is explicitly enabled.
    writes_enabled: enabled,
    note: enabled
      ? "projection writes ENABLED"
      : "projection is read/diff-only (MCP_PORTAL_PROJECTION_ENABLED != 'true') — no portal writes",
  });
});

mcpPortalRoutes.get("/build-event/:id", async (c) => {
  const wf = c.env.MCP_PORTAL_PROJECTION;
  if (!wf) {
    return c.json(
      { ok: false, error: "MCP_PORTAL_PROJECTION workflow binding not configured" },
      503,
    );
  }
  const id = c.req.param("id");
  try {
    const instance = await wf.get(id);
    const status = await instance.status();
    return c.json({ ok: true, instanceId: id, status });
  } catch (err) {
    return c.json({ ok: false, error: String(err?.message || err) }, 404);
  }
});

export { mcpPortalRoutes };
