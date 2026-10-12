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
  evaluateRemovalGuard,
  buildAddOnlyMembership,
  PORTAL_SERVER_CAP,
} from "../services/mcp-portal-projection.js";

/**
 * Emit a removal-guard alert to chittytrack (best-effort, never throws).
 * The guard tripping is an operational signal — a sparse/broken discovery
 * source nearly wiped the portal — so it must be observable even though we
 * (correctly) refused the removals.
 */
async function alertChittytrack(env, payload) {
  try {
    const url = env.CHITTYTRACK_URL || "https://track.chitty.cc";
    const headers = { "content-type": "application/json" };
    if (env.CHITTYTRACK_TOKEN)
      headers.authorization = `Bearer ${env.CHITTYTRACK_TOKEN}`;
    await fetch(`${url}/api/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "mcp_portal.removal_guard_tripped",
        severity: "warning",
        source: "chittyconnect/MCPPortalProjection",
        ...payload,
      }),
    });
    return { emitted: true };
  } catch (err) {
    return { emitted: false, error: String(err?.message || err) };
  }
}

export class MCPPortalProjection extends WorkflowEntrypoint {
  /**
   * @param {{ payload: { portalId?: string, trigger?: string, service?: string } }} event
   */
  async run(event, step) {
    const env = this.env;
    const enabled = env.MCP_PORTAL_PROJECTION_ENABLED === "true";
    // Never allow an untrusted event to select an arbitrary tenant/portal.
    // Cloudflare Workflows pass create({ params }) as event.payload in the
    // current API, but accept both shapes for older recorded event fixtures.
    const input = event.payload || event.params || {};
    const portalId = env.MCP_PORTAL_ID || "chitty-mcp";
    if (input.portalId && input.portalId !== portalId) {
      throw new Error("MCP projection event cannot override configured portal");
    }
    const trigger = input.trigger || "manual";
    // The legacy event-supplied removal override is deliberately retired.
    // Deletion requires a separate governed, reviewed migration after
    // authoritative registry and portal membership reconcile.

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
        description: p.description,
        code_mode: p.code_mode,
        secure_web_gateway: p.secure_web_gateway,
        // This whole-array PUT must preserve ALL current portal policy fields.
        servers: (p.servers || []).map((s) => ({
          id: s.server_id || s.id,
          hostname: s.hostname,
          default_disabled: s.default_disabled,
          on_behalf: s.on_behalf,
          updated_tools: s.updated_tools,
          updated_prompts: s.updated_prompts,
        })),
      };
    });

    // 3. DIFF desired (from discovery) vs current (portal) — pure compute.
    const diff = await step.do("diff", async () =>
      computePortalDiff(discovery, portal),
    );

    // 4. GUARD — cap check + removal-safety brake. Refuse to exceed the CF
    //    per-portal cap; refuse suspiciously large removals / desired-set
    //    collapse / empty-membership (all signal a broken discovery source).
    //    Adds and keeps are ALWAYS safe; only the REMOVE path is gated.
    const guard = await step.do("guard", async () => {
      const removal = evaluateRemovalGuard(diff, portal.servers.length);
      const issues = [...removal.reasons];
      // The safe add-only payload includes current members even when discovery
      // is sparse, so cap-check the actual projected membership, not desired.
      const capExceeded = portal.servers.length + diff.toAdd.length > PORTAL_SERVER_CAP;
      if (capExceeded) {
        issues.push(
          `current ${portal.servers.length} + new ${diff.toAdd.length} exceeds CF cap ${PORTAL_SERVER_CAP}`,
        );
      }
      return {
        // ok = safe to run the FULL projection (adds + removes).
        ok: !removal.blocked && !capExceeded,
        capExceeded,
        removal,
        removalsBlocked: removal.blocked,
        overrideApplied: removal.overrideApplied,
        issues,
      };
    });

    // Adds may proceed even when removals are blocked (adds never wipe).
    const addsAllowed = enabled && !guard.capExceeded;
    // Removals require the removal guard to pass (or operator override).
    const removalsAllowed = false; // STOP gate: no removal authorization in this Workflow
    // Full convergence (the whole-array PUT that can drop members) requires
    // removals to be allowed; otherwise we PUT an ADD-ONLY membership
    // (current ∪ adds) so we never remove behind the guard's back.
    const writesAllowed = addsAllowed;

    // If the guard blocked removals while writes were enabled, that's a real
    // operational signal — alert chittytrack (best-effort, read of the diff).
    const alert =
      enabled && guard.removalsBlocked
        ? await step.do("alert-chittytrack", async () =>
            alertChittytrack(env, {
              portalId,
              trigger,
              metrics: guard.removal.metrics,
              reasons: guard.removal.reasons,
              to_remove: diff.toRemove,
              override_offered: "none: destructive removal requires a separate approved migration",
            }),
          )
        : { skipped: true };

    // 5. APPLY ADDS — create any missing account-level servers (POST-per-server).
    //    GATED: skipped entirely when writes are not allowed.
    const adds = await step.do("apply-adds", async () => {
      if (!addsAllowed)
        return {
          skipped: true,
          reason: skipReason(enabled, guard, addsAllowed),
          planned: diff.toAdd,
        };
      const created = [];
      const failed = [];
      for (const s of diff.toAdd) {
        // Account-level server needs a portal-safe id. Discovery rows are
        // hostname-keyed; fall back to a slug derived from the hostname when no
        // explicit id is carried.
        const id = s.id || serverIdFromHostname(s.hostname);
        const r = await createPortalServer(env, {
          id,
          name: s.name,
          hostname: s.hostname,
        });
        (r.ok ? created : failed).push(r.ok ? id : { id, error: r.error });
      }
      return { skipped: false, created, failed };
    });

    // 6. APPLY MEMBERSHIP — whole-array PUT.
    //    - When removals are allowed: PUT the desired set (may drop members).
    //    - When removals are BLOCKED but adds are allowed: PUT an ADD-ONLY
    //      membership = current ∪ adds, so the guard's refusal to remove is
    //      honored and the portal is never shrunk.
    //    NEVER PUT an empty servers[] (guard.emptyMembership hard-fails above
    //    and 400s on the API); the membership we build here is always ≥ current.
    const membership = await step.do("apply-membership", async () => {
      if (!writesAllowed) {
        return {
          skipped: true,
          reason: skipReason(enabled, guard, writesAllowed),
          planned: { add: diff.toAdd.map((s) => s.id), remove: diff.toRemove },
        };
      }

      // No-op when there are no additions, and never attach a server whose
      // account-level creation failed (such as auth or ID collision).
      if (diff.toAdd.length === 0) return { skipped: true, reason: "no new members" };
      if (adds.failed?.length) return { skipped: true, reason: "account-level server creation failed", failed: adds.failed };
      const mode = "add-only (removals prohibited)";
      const desiredMembership = buildAddOnlyMembership(portal,
        diff.toAdd.map((s) => ({
          server_id: s.id || serverIdFromHostname(s.hostname),
          hostname: s.hostname,
        })),
      );

      // Defense in depth: a whole-array PUT must never be empty.
      if (desiredMembership.length === 0) {
        return {
          skipped: true,
          mode,
          reason: "refused: computed membership is empty (would 400)",
        };
      }

      const r = await putPortalServers(
        env,
        portalId,
        {
          name: portal.name,
          hostname: portal.hostname,
          description: portal.description,
          code_mode: portal.code_mode,
          secure_web_gateway: portal.secure_web_gateway,
        },
        desiredMembership,
      );
      return { skipped: false, mode, count: desiredMembership.length, ...r };
    });

    // 7. SYNC — force capability re-pull for newly added servers.
    //    GATED.
    const sync = await step.do("sync", async () => {
      if (!addsAllowed)
        return {
          skipped: true,
          reason: skipReason(enabled, guard, addsAllowed),
        };
      const synced = [];
      for (const s of diff.toAdd) {
        const id = s.id || serverIdFromHostname(s.hostname);
        const r = await syncPortalServer(env, id);
        if (r.ok) synced.push(id);
      }
      return { skipped: false, synced };
    });

    // 8. TOGGLES — re-assert default_disabled flags (no-op placeholder until
    //    per-server disable policy is defined). GATED, currently inert.
    const toggles = await step.do("toggles", async () => {
      if (!writesAllowed)
        return {
          skipped: true,
          reason: skipReason(enabled, guard, writesAllowed),
        };
      return { skipped: false, applied: 0 };
    });

    // 9. VERIFY — re-read the portal and confirm membership matches desired.
    //    Read-only; runs in both modes.
    const verify = await step.do("verify", async () => {
      const p = await fetchPortal(env, portalId);
      const presentHosts = new Set((p?.servers || []).map((s) => s.hostname));
      // Verify by hostname (the diff key), independent of portal id mapping.
      const desiredHosts = diff.desired.map((s) => s.hostname);
      const missing = removalsAllowed
        ? desiredHosts.filter((h) => !presentHosts.has(h))
        : [];
      return {
        portal_server_count: p?.servers?.length ?? 0,
        converged: removalsAllowed ? missing.length === 0 : null,
        missing,
      };
    });

    // 10. TELEMETRY — durable summary. Read-only.
    const telemetry = {
      trigger,
      portalId,
      flag_enabled: enabled,
      writes_allowed: writesAllowed,
      adds_allowed: addsAllowed,
      removals_allowed: removalsAllowed,
      guard,
      alert,
      diff_summary: {
        desired: diff.desired.length,
        current: portal.servers.length,
        to_add: diff.toAdd.map((s) => s.id || s.hostname),
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

function skipReason(enabled, guard, allowed) {
  if (!enabled) return "feature_flag_off";
  if (guard?.capExceeded) return `guard_blocked: ${guard.issues.join("; ")}`;
  if (allowed === false && guard?.removalsBlocked) {
    return `removals_guarded: ${guard.removal.reasons.join("; ")}`;
  }
  return "unknown";
}

/**
 * Derive a portal-safe account-level server id from an MCP hostname when
 * discovery doesn't carry an explicit one. CF id pattern:
 * `^[a-z0-9_]+(?:-[a-z0-9_]+)*$`, maxLen 32. NOTE: for the canonical
 * `chitty-mcp` portal, existing members use `chittyagent-{svc}` ids that are
 * NOT derivable from the hostname — that mapping lives portal-side and the
 * diff keys on hostname precisely so we never need to reconstruct it. This
 * fallback is only for genuinely NEW adds (servers not already in the portal).
 */
function serverIdFromHostname(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    const slug = host
      .replace(/\.ccorp\.workers\.dev$/, "")
      .replace(/\.chitty\.cc$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    return slug || "mcp-server";
  } catch {
    return "mcp-server";
  }
}
