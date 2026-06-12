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

function cfBase(env) {
  const acct = env.CHITTYOS_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  if (!acct) throw new Error("CHITTYOS_ACCOUNT_ID / CF_ACCOUNT_ID missing");
  return `https://api.cloudflare.com/client/v4/accounts/${acct}/access/ai-controls/mcp`;
}

function cfHeaders(env) {
  const token = env.CF_API_TOKEN;
  if (!token) throw new Error("CF_API_TOKEN missing (needs ai-controls scope)");
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** GET a portal incl. its embedded servers[] membership. Returns null on 404. */
export async function fetchPortal(env, portalId) {
  const r = await fetch(`${cfBase(env)}/portals/${portalId}`, { headers: cfHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`cf portal get ${r.status}`);
  const body = await r.json();
  return body.result ?? null;
}

/** Whole-array membership write. Idempotent. maxItems 40. */
export async function putPortalServers(env, portalId, portal, servers) {
  if (servers.length > PORTAL_SERVER_CAP) {
    return { ok: false, error: `servers[] length ${servers.length} exceeds cap ${PORTAL_SERVER_CAP}` };
  }
  const r = await fetch(`${cfBase(env)}/portals/${portalId}`, {
    method: "PUT",
    headers: cfHeaders(env),
    body: JSON.stringify({ name: portal.name, hostname: portal.hostname, servers }),
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
  const r = await fetch(`${base}/v0.1/servers`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`registry discovery ${r.status}`);
  const body = await r.json();
  const entries = Array.isArray(body.servers) ? body.servers : [];

  const raw = entries.map((e) => {
    const s = e.server || {};
    const url = (s.remotes || []).find((x) => x?.url)?.url || null;
    const status = e._meta?.["io.modelcontextprotocol.registry/official"]?.status;
    return { name: s.name, url, status };
  });

  const compliant = raw.filter(
    (s) => s.status === "active" && s.url && CANONICAL_MCP_RE.test(s.url),
  );

  return {
    total: raw.length,
    withUrl: raw.filter((s) => s.url).length,
    compliant: compliant.map((s) => ({
      // derive a portal-safe server id from the canonical hostname
      id: portalIdFromUrl(s.url),
      name: s.name,
      hostname: s.url,
    })),
    raw,
  };
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
  const desired = (discovery.compliant || []).filter((s) => s.id);
  const desiredById = new Map(desired.map((s) => [s.id, s]));
  const currentIds = new Set((portal.servers || []).map((s) => s.id));

  const toAdd = desired.filter((s) => !currentIds.has(s.id));
  const toRemove = (portal.servers || []).map((s) => s.id).filter((id) => !desiredById.has(id));
  const keeps = (portal.servers || []).map((s) => s.id).filter((id) => desiredById.has(id));

  return { desired, toAdd, toRemove, keeps };
}
