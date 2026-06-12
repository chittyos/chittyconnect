/**
 * MCPPortalProjection — durable Cloudflare Workflow that projects the
 * ChittyRegistry discovery view onto the Cloudflare-managed MCP Portal
 * (Model B, mcp.chitty.cc / `chitty-mcp`).
 *
 * CQRS triad (locked 2026-06-10):
 *   - ChittyRegister  = the WRITE  (register.chitty.cc/api/v1/register) — gatekeeper
 *   - ChittyRegistry  = DISCOVERY  (registry.chitty.cc/v0.1/servers) — read mirror
 *   - CF MCP Portal   = client PROJECTION — written ONLY by this Workflow, off discovery
 *
 * Flow: write once (register) → discover (registry) → project (portal).
 *
 * ── FEATURE FLAG (DEFAULT OFF) ───────────────────────────────────────────────
 * Every step that WRITES to the live portal is gated by
 * `env.MCP_PORTAL_PROJECTION_ENABLED === "true"`. With the flag unset/false
 * (the default), the Workflow runs the full READ + DIFF path and returns the
 * computed plan, but performs ZERO writes — a deploy of this code changes
 * nothing live. This is the D2 inert-by-default guarantee.
 *
 * ── Live API surface (verified 2026-06-12) ──────────────────────────────────
 *   /accounts/{acct}/access/ai-controls/mcp/portals/{id}   GET, PUT (whole servers[])
 *   /accounts/{acct}/access/ai-controls/mcp/servers        GET, POST (per-server)
 *   /accounts/{acct}/access/ai-controls/mcp/servers/{id}/sync  POST
 * Portal membership is a WHOLE-ARRAY PUT; servers[] maxItems = 40.
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  fetchPortal,
  putPortalServers,
  createPortalServer,
  syncPortalServer,
  fetchDiscoveryServers,
  computePortalDiff,
  PORTAL_SERVER_CAP,
} from "../services/mcp-portal-projection.js";

export class MCPPortalProjection extends WorkflowEntrypoint {
  /**
   * @param {{ payload: { portalId?: string, trigger?: string, service?: string } }} event
   */
  async run(event, step) {
    const env = this.env;
    const enabled = env.MCP_PORTAL_PROJECTION_ENABLED === "true";
    const portalId = event.payload?.portalId || env.MCP_PORTAL_ID || "chitty-mcp";
    const trigger = event.payload?.trigger || "manual";

    // 1. READ discovery (registry.chitty.cc/v0.1/servers) — never writes.
    const discovery = await step.do("read-discovery", async () =>
      fetchDiscoveryServers(env),
    );

    // 2. READ portal (current materialized membership) — never writes.
    const portal = await step.do("read-portal", async () => {
      const p = await fetchPortal(env, portalId);
      if (!p) throw new Error(`portal ${portalId} not found`);
      return {
        id: p.id,
        name: p.name,
        hostname: p.hostname,
        servers: (p.servers || []).map((s) => ({
          id: s.id,
          hostname: s.hostname,
          default_disabled: s.default_disabled,
          on_behalf: s.on_behalf,
        })),
      };
    });

    // 3. DIFF desired (from discovery) vs current (portal) — pure compute.
    const diff = await step.do("diff", async () =>
      computePortalDiff(discovery, portal),
    );

    // 4. GUARD/CAP — refuse to exceed the CF per-portal cap; refuse pathological
    //    empties (remove-all) which signal a broken discovery source.
    const guard = await step.do("guard-cap", async () => {
      const desiredCount = diff.desired.length;
      const issues = [];
      if (desiredCount > PORTAL_SERVER_CAP) {
        issues.push(`desired ${desiredCount} exceeds CF cap ${PORTAL_SERVER_CAP}`);
      }
      // Safety brake: if discovery yields an empty desired set while the portal
      // currently has servers, that is almost certainly a discovery outage —
      // do NOT project a remove-all even when writes are enabled.
      if (desiredCount === 0 && portal.servers.length > 0) {
        issues.push("desired set empty but portal non-empty — refusing remove-all (likely discovery outage)");
      }
      return { ok: issues.length === 0, issues, desiredCount };
    });

    const writesAllowed = enabled && guard.ok;

    // 5. APPLY ADDS — create any missing account-level servers (POST-per-server).
    //    GATED: skipped entirely when writes are not allowed.
    const adds = await step.do("apply-adds", async () => {
      if (!writesAllowed) return { skipped: true, reason: skipReason(enabled, guard), planned: diff.toAdd };
      const created = [];
      const failed = [];
      for (const s of diff.toAdd) {
        const r = await createPortalServer(env, { id: s.id, name: s.name, hostname: s.hostname });
        (r.ok ? created : failed).push(r.ok ? s.id : { id: s.id, error: r.error });
      }
      return { skipped: false, created, failed };
    });

    // 6. APPLY MEMBERSHIP (adds + removes in one whole-array PUT).
    //    GATED.
    const membership = await step.do("apply-membership", async () => {
      if (!writesAllowed) return { skipped: true, reason: skipReason(enabled, guard), planned: { add: diff.toAdd.map((s) => s.id), remove: diff.toRemove } };
      const desiredMembership = diff.desired.map((s) => ({
        server_id: s.id,
        default_disabled: s.default_disabled ?? false,
      }));
      const r = await putPortalServers(env, portalId, { name: portal.name, hostname: portal.hostname }, desiredMembership);
      return { skipped: false, ...r };
    });

    // 7. SYNC — force capability re-pull for newly added servers.
    //    GATED.
    const sync = await step.do("sync", async () => {
      if (!writesAllowed) return { skipped: true, reason: skipReason(enabled, guard) };
      const synced = [];
      for (const s of diff.toAdd) {
        const r = await syncPortalServer(env, s.id);
        if (r.ok) synced.push(s.id);
      }
      return { skipped: false, synced };
    });

    // 8. TOGGLES — re-assert default_disabled flags (no-op placeholder until
    //    per-server disable policy is defined). GATED, currently inert.
    const toggles = await step.do("toggles", async () => {
      if (!writesAllowed) return { skipped: true, reason: skipReason(enabled, guard) };
      return { skipped: false, applied: 0 };
    });

    // 9. VERIFY — re-read the portal and confirm membership matches desired.
    //    Read-only; runs in both modes.
    const verify = await step.do("verify", async () => {
      const p = await fetchPortal(env, portalId);
      const present = new Set((p?.servers || []).map((s) => s.id));
      const desiredIds = diff.desired.map((s) => s.id);
      const missing = writesAllowed ? desiredIds.filter((id) => !present.has(id)) : [];
      return {
        portal_server_count: p?.servers?.length ?? 0,
        converged: writesAllowed ? missing.length === 0 : null,
        missing,
      };
    });

    // 10. TELEMETRY — durable summary. Read-only.
    const telemetry = {
      trigger,
      portalId,
      flag_enabled: enabled,
      writes_allowed: writesAllowed,
      guard,
      diff_summary: {
        desired: diff.desired.length,
        current: portal.servers.length,
        to_add: diff.toAdd.map((s) => s.id),
        to_remove: diff.toRemove,
        keeps: diff.keeps.length,
      },
      adds,
      membership,
      sync,
      toggles,
      verify,
      ranAt: new Date().toISOString(),
    };
    await step.do("telemetry", async () => telemetry);
    return telemetry;
  }
}

function skipReason(enabled, guard) {
  if (!enabled) return "feature_flag_off";
  if (!guard.ok) return `guard_blocked: ${guard.issues.join("; ")}`;
  return "unknown";
}
