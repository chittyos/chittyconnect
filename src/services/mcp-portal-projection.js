/**
 * mcp-portal-projection service — the read/diff/write primitives the
 * MCPPortalProjection Workflow (and the D3 dry-run) are built from.
 *
 * Targets the LIVE Cloudflare ai-controls MCP surface (verified 2026-06-12):
 *   /accounts/{acct}/access/ai-controls/mcp/portals/{id}   GET, PUT
 *   /accounts/{acct}/access/ai-controls/mcp/servers        GET, POST
 *   /accounts/{acct}/access/ai-controls/mcp/servers/{id}/sync  POST
 *
 * Credentials: CF_API_TOKEN must carry the Zero-Trust MCP (ai-controls)
 * scope. Sourced from Cloudflare Secrets Store / Worker Secrets (cold source:
 * 1Password) — never hardcoded.
 */

export const PORTAL_SERVER_CAP = 40;

/** The canonical compliant MCP endpoint pattern (this repo + builder both
 * treat `{svc}.chitty.cc/mcp` as canonical; `{svc}.agent.chitty.cc/mcp` is
 * LEGACY). The portal also legitimately holds `*.ccorp.workers.dev/mcp`
 * direct-route servers and third-party MCPs (e.g. developers.openai.com/mcp).
 */
const CANONICAL_MCP_RE = /^https:\/\/[a-z0-9-]+\.chitty\.cc\/mcp$/;

/**
 * Removal-safety guard thresholds. A projection run that would remove a large
 * fraction of the live portal is almost always a broken/sparse discovery
 * source — NOT a legitimate desired state. We refuse such removals unless the
 * caller passes an explicit override.
 *
 *  - REMOVE_ABS_FLOOR: always allow removing up to this many members (small
 *    portals must still be able to drop 1–2 stale servers without override).
 *  - REMOVE_FRACTION:  beyond the floor, refuse if removals exceed this
 *    fraction of the CURRENT portal membership.
 *  - DESIRED_FRACTION_FLOOR: independent of the remove count, refuse if the
 *    desired set has collapsed to under this fraction of the current portal
 *    (catches "discovery returned 4, portal has 27" sparse-source wipes).
 */
export const REMOVAL_GUARD = {
  REMOVE_ABS_FLOOR: 2,
  REMOVE_FRACTION: 0.2,
  DESIRED_FRACTION_FLOOR: 0.5,
};

function cfBase(env) {
  const acct = env.CHITTYOS_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  if (!acct) throw new Error("CHITTYOS_ACCOUNT_ID / CF_ACCOUNT_ID missing");
  return `https://api.cloudflare.com/client/v4/accounts/${acct}/access/ai-controls/mcp`;
}

function cfHeaders(env) {
  const token = env.CF_API_TOKEN;
  if (!token) throw new Error("CF_API_TOKEN missing (needs ai-controls scope)");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** GET a portal incl. its embedded servers[] membership. Returns null on 404. */
export async function fetchPortal(env, portalId) {
  const r = await fetch(`${cfBase(env)}/portals/${portalId}`, {
    headers: cfHeaders(env),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`cf portal get ${r.status}`);
  const body = await r.json();
  return body.result ?? null;
}

/** Whole-array membership write. Idempotent. maxItems 40. */
export async function putPortalServers(env, portalId, portal, servers) {
  if (servers.length > PORTAL_SERVER_CAP) {
    return {
      ok: false,
      error: `servers[] length ${servers.length} exceeds cap ${PORTAL_SERVER_CAP}`,
    };
  }
  const r = await fetch(`${cfBase(env)}/portals/${portalId}`, {
    method: "PUT",
    headers: cfHeaders(env),
    body: JSON.stringify({
      name: portal.name,
      hostname: portal.hostname,
      servers,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: JSON.stringify(body.errors ?? body) };
  return { ok: true, count: body.result?.servers?.length };
}

/** Create an account-level MCP server (POST-per-server). */
export async function createPortalServer(env, server) {
  const r = await fetch(`${cfBase(env)}/servers`, {
    method: "POST",
    headers: cfHeaders(env),
    body: JSON.stringify({
      id: server.id,
      name: server.name,
      hostname: server.hostname,
      auth_type: server.auth_type ?? "unauthenticated",
      ...(server.description ? { description: server.description } : {}),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: JSON.stringify(body.errors ?? body) };
  return { ok: true, id: body.result?.id };
}

/** Force a tools/prompts re-sync from the upstream server. */
export async function syncPortalServer(env, serverId) {
  const r = await fetch(`${cfBase(env)}/servers/${serverId}/sync`, {
    method: "POST",
    headers: cfHeaders(env),
  });
  return { ok: r.ok };
}

/**
 * Read the ChittyRegistry discovery view (MCP server.schema.json shape) and
 * project it to a flat desired-server list. Only LIVE, compliant MCP servers
 * (canonical `{svc}.chitty.cc/mcp`) are included. Returns both the filtered
 * desired set and the raw counts so callers can surface discovery health.
 */
export async function fetchDiscoveryServers(env) {
  const base = env.REGISTRY_SERVICE_URL || "https://registry.chitty.cc";
  const r = await fetch(`${base}/v0.1/servers`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`registry discovery ${r.status}`);
  const body = await r.json();
  const entries = Array.isArray(body.servers) ? body.servers : [];

  const raw = entries.map((e) => {
    const s = e.server || {};
    const url = (s.remotes || []).find((x) => x?.url)?.url || null;
    const status =
      e._meta?.["io.modelcontextprotocol.registry/official"]?.status;
    return { name: s.name, url, status };
  });

  // ACTIVE + has an MCP remote URL. We intentionally do NOT require the
  // canonical `{svc}.chitty.cc/mcp` form here: the live portal legitimately
  // holds `*.ccorp.workers.dev/mcp` direct-route servers and third-party MCPs
  // (developers.openai.com/mcp, mcp.cloudflare.com/mcp). A canonical-only
  // filter would compute those legitimate members as removals (board blocker
  // 1b). The diff keys on NORMALIZED HOSTNAME (see computePortalDiff), which
  // matches whatever pattern discovery and the portal agree on — so widening
  // the filter is safe and the canonical check becomes advisory metadata only.
  const desired = raw.filter(
    (s) => s.status === "active" && s.url && /\/mcp$/.test(s.url),
  );

  // The canonical subset is still surfaced for discovery-health reporting.
  const compliant = desired.filter((s) => CANONICAL_MCP_RE.test(s.url));

  return {
    total: raw.length,
    withUrl: raw.filter((s) => s.url).length,
    canonicalCount: compliant.length,
    desired: desired.map((s) => ({
      hostname: s.url,
      key: normalizeMcpHost(s.url),
      name: s.name,
      canonical: CANONICAL_MCP_RE.test(s.url),
    })),
    // Back-compat alias: callers that read `.compliant` keep working but now
    // receive the full (hostname-keyed) desired set, not the canonical subset.
    compliant: desired.map((s) => ({
      id: portalIdFromUrl(s.url),
      key: normalizeMcpHost(s.url),
      name: s.name,
      hostname: s.url,
    })),
    raw,
  };
}

/**
 * Normalize an MCP endpoint URL to a stable diff key: lowercase host + path,
 * scheme- and trailing-slash-insensitive. This is what desired (discovery) and
 * current (portal) memberships are matched on — it sidesteps the id-mapping
 * problem (board blocker 1c: portal id `chittyagent-ship` vs URL slug `ship`)
 * because BOTH sides expose the real `hostname`.
 */
export function normalizeMcpHost(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.host.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return String(url).toLowerCase().replace(/\/+$/, "");
  }
}

/** chitty-mcp portal ids are kebab service slugs; derive from `{svc}.chitty.cc/mcp`. */
export function portalIdFromUrl(url) {
  const m = /^https:\/\/([a-z0-9-]+)\.chitty\.cc\/mcp$/.exec(url || "");
  return m ? m[1] : null;
}

/**
 * Compute the projection diff. desired = discovery.compliant; current =
 * portal.servers (keyed by id). Returns adds/removes/keeps and the full
 * desired membership the PUT would write.
 */
export function computePortalDiff(discovery, portal) {
  // Diff key = normalized hostname (scheme/trailing-slash insensitive). Both
  // desired (discovery) and current (portal) carry real hostnames, so we never
  // depend on a portal-id mapping surviving the discovery read.
  const desired = (discovery.desired || discovery.compliant || [])
    .map((s) => ({ ...s, key: s.key || normalizeMcpHost(s.hostname) }))
    .filter((s) => s.key);

  const desiredByKey = new Map(desired.map((s) => [s.key, s]));

  const current = (portal.servers || []).map((s) => ({
    id: s.id,
    hostname: s.hostname,
    key: normalizeMcpHost(s.hostname),
    default_disabled: s.default_disabled,
    on_behalf: s.on_behalf,
  }));
  const currentByKey = new Map(current.map((s) => [s.key, s]));

  const toAdd = desired.filter((s) => !currentByKey.has(s.key));
  const toRemove = current.filter((s) => !desiredByKey.has(s.key));
  const keeps = current.filter((s) => desiredByKey.has(s.key));

  return {
    desired,
    toAdd,
    // toRemove/keeps expose portal ids (what the PUT membership array needs).
    toRemove: toRemove.map((s) => s.id),
    keeps: keeps.map((s) => s.id),
    // Full objects retained for the membership PUT (id + flags) and telemetry.
    removeDetail: toRemove,
    keepDetail: keeps,
    currentCount: current.length,
  };
}

/**
 * Removal-safety guard — a PURE function over the computed diff and the
 * current portal size. Returns a verdict the Workflow uses to decide whether
 * the membership PUT may proceed. NEVER mutates anything.
 *
 * Trips (blocks removals) when ANY of:
 *   - the membership would be empty (desired set computed to 0 with a
 *     non-empty portal) — hard fail, and we must never PUT `servers:[]`
 *     (the live API returns 400 for an empty array; board "Open risk");
 *   - removals exceed max(REMOVE_ABS_FLOOR, REMOVE_FRACTION × current);
 *   - the desired set collapsed below DESIRED_FRACTION_FLOOR × current.
 *
 * `override === true` (operator-supplied flag) bypasses the proportional and
 * desired-fraction brakes — but NEVER the empty-membership hard fail, because
 * an empty PUT is an API error, not a policy choice.
 *
 * @param {{ toAdd: any[], toRemove: any[], desired: any[] }} diff
 * @param {number} currentCount  current portal membership size
 * @param {{ override?: boolean, thresholds?: object }} [opts]
 */
export function evaluateRemovalGuard(diff, currentCount, opts = {}) {
  const t = { ...REMOVAL_GUARD, ...(opts.thresholds || {}) };
  const override = opts.override === true;

  const removeCount = (diff.toRemove || []).length;
  const desiredCount = (diff.desired || []).length;
  const addCount = (diff.toAdd || []).length;

  // Resulting membership the PUT would write = keeps + adds = desired set.
  const resultingCount = desiredCount;

  const reasons = [];
  let emptyMembership = false;

  // 1. Empty-membership hard fail (never overridable — empty PUT == 400).
  if (currentCount > 0 && resultingCount === 0) {
    emptyMembership = true;
    reasons.push(
      `desired membership computes to EMPTY while portal holds ${currentCount} — refusing (empty servers[] PUT returns 400; almost certainly a discovery outage)`,
    );
  }

  // 2. Proportional removal brake.
  const removeCeiling = Math.max(
    t.REMOVE_ABS_FLOOR,
    Math.ceil(t.REMOVE_FRACTION * currentCount),
  );
  let proportionTripped = false;
  if (removeCount > removeCeiling) {
    proportionTripped = true;
    reasons.push(
      `would remove ${removeCount} of ${currentCount} members (ceiling ${removeCeiling} = max(${t.REMOVE_ABS_FLOOR}, ${Math.round(t.REMOVE_FRACTION * 100)}%)) — suspiciously large`,
    );
  }

  // 3. Desired-set collapse brake.
  let collapseTripped = false;
  if (
    currentCount > 0 &&
    desiredCount < t.DESIRED_FRACTION_FLOOR * currentCount
  ) {
    collapseTripped = true;
    reasons.push(
      `desired set (${desiredCount}) collapsed below ${Math.round(t.DESIRED_FRACTION_FLOOR * 100)}% of current portal (${currentCount}) — likely sparse/broken discovery`,
    );
  }

  // override bypasses (2) and (3) but NEVER (1).
  const overridableTrip = proportionTripped || collapseTripped;
  const blocked = emptyMembership || (overridableTrip && !override);

  return {
    blocked,
    safeToApplyRemovals: !blocked,
    emptyMembership,
    overrideApplied: override && overridableTrip && !emptyMembership,
    metrics: {
      currentCount,
      desiredCount,
      addCount,
      removeCount,
      removeCeiling,
      resultingCount,
    },
    reasons,
  };
}
