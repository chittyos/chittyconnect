/**
 * CourtListener API Proxy Routes
 *
 * Proxies the Free Law Project's CourtListener REST API (v4) using a
 * synthetic-env-injected API token. The token is delivered via the
 * Cloudflare Secrets Store binding `COURTLISTENER_API_TOKEN` declared
 * per environment in wrangler.jsonc.
 *
 * Token resolution priority:
 *   1. env.COURTLISTENER_API_TOKEN (Cloudflare Secrets Store binding)
 *   2. getCredential broker path (integrations/courtlistener/api_token)
 *
 * Allowlisted resources (REST v4):
 *   - search, opinions, clusters, dockets, docket-entries,
 *     recap-documents, audio, citation-lookup, people, courts
 *
 * Routes exposed:
 *   - GET  /search
 *   - GET  /:resource[/:id]
 *   - POST /citation-lookup
 *
 * Edge behaviors:
 *   - 15-minute Cache API wrap on GETs (bypass via `X-Bypass-Cache: 1`).
 *   - Fail-closed 503 POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE when no
 *     token is available from any source.
 *   - Upstream error bodies truncated to 200 chars; the API token is
 *     never echoed in errors or logs.
 *
 * Consumers: ChittyCounsel (counsel.chitty.cc).
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#courtlistener-proxy
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";

const courtlistenerRoutes = new Hono();
// Auth: covered by /api/* authenticate middleware in router.js

const CL_API = "https://www.courtlistener.com/api/rest/v4";
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

// Allowlist of resources reachable through this proxy. Unknown resources
// are rejected with 404 before any upstream call is made.
const RESOURCE_ALLOWLIST = new Set([
  "search",
  "opinions",
  "clusters",
  "dockets",
  "docket-entries",
  "recap-documents",
  "audio",
  "citation-lookup",
  "people",
  "courts",
]);

/**
 * Resolve the CourtListener API token from the synthetic env binding,
 * falling back to the credential broker. Returns undefined if neither
 * source has a value (the route then emits the fail-closed 503).
 */
async function getCourtListenerToken(env) {
  if (env && env.COURTLISTENER_API_TOKEN) {
    // Secrets Store bindings may surface as { get() } accessors; normalize.
    const v = env.COURTLISTENER_API_TOKEN;
    if (typeof v === "string") return v;
    if (v && typeof v.get === "function") {
      try {
        const resolved = await v.get();
        if (resolved) return resolved;
      } catch {
        // fall through to broker
      }
    }
  }
  return getCredential(
    env,
    "integrations/courtlistener/api_token",
    "COURTLISTENER_API_TOKEN_FALLBACK",
    "CourtListener",
  );
}

/**
 * Build a fail-closed 503 response when no token is available.
 */
function failClosedNoToken(c) {
  return c.json(
    {
      error: "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      detail: "CourtListener API token is not provisioned in this environment.",
    },
    503,
  );
}

/**
 * Perform a GET against CourtListener, optionally wrapped in the Cache API.
 * The cache key is the absolute upstream URL; bypass via X-Bypass-Cache: 1.
 */
async function clGet(c, upstreamUrl) {
  const bypass = c.req.header("X-Bypass-Cache") === "1";
  const cache = !bypass && typeof caches !== "undefined" ? caches.default : null;
  const cacheReq = new Request(upstreamUrl, { method: "GET" });

  if (cache) {
    try {
      const hit = await cache.match(cacheReq);
      if (hit) {
        // Clone — Cache API responses are immutable
        const cloned = new Response(hit.body, hit);
        cloned.headers.set("X-Cache", "HIT");
        return cloned;
      }
    } catch {
      // cache.match failure is non-fatal; fall through to live fetch
    }
  }

  const token = await getCourtListenerToken(c.env);
  if (!token) return failClosedNoToken(c);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return c.json({ error: "CourtListener API request failed" }, 502);
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return c.json(
      { error: `CourtListener API ${upstream.status}: ${body.slice(0, 200)}` },
      upstream.status,
    );
  }

  let json;
  try {
    json = await upstream.json();
  } catch {
    return c.json({ error: "CourtListener API returned invalid JSON" }, 502);
  }

  const res = new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "X-Cache": "MISS",
    },
  });

  if (cache) {
    try {
      // Cache a clone so we can still return the original body
      c.executionCtx && c.executionCtx.waitUntil
        ? c.executionCtx.waitUntil(cache.put(cacheReq, res.clone()))
        : await cache.put(cacheReq, res.clone());
    } catch {
      // cache.put failure is non-fatal
    }
  }

  return res;
}

/**
 * Build a CourtListener upstream URL for a given resource, optional id, and
 * forwarded query string. Always appends a trailing slash before the query —
 * CourtListener REST endpoints require it.
 */
function buildUpstream(resource, id, search) {
  const path = id ? `${resource}/${encodeURIComponent(id)}` : `${resource}`;
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${CL_API}/${path}/${qs}`;
}

// ============================================
// GET /search
// ============================================

/**
 * GET /search
 * CourtListener unified search (opinions, RECAP, audio, judges).
 * Forwards all query parameters verbatim to /api/rest/v4/search/.
 */
courtlistenerRoutes.get("/search", async (c) => {
  const url = new URL(c.req.url);
  return clGet(c, buildUpstream("search", null, url.search));
});

// ============================================
// POST /citation-lookup
// ============================================

/**
 * POST /citation-lookup
 * Citation lookup endpoint — accepts a JSON body with citation text and
 * returns parsed citations + resolved CourtListener clusters.
 *
 * Body is forwarded verbatim; not cached (POST).
 */
courtlistenerRoutes.post("/citation-lookup", async (c) => {
  const token = await getCourtListenerToken(c.env);
  if (!token) return failClosedNoToken(c);

  const body = await c.req.text();
  const contentType = c.req.header("Content-Type") || "application/json";

  let upstream;
  try {
    upstream = await fetch(`${CL_API}/citation-lookup/`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
        "Content-Type": contentType,
      },
      body,
    });
  } catch {
    return c.json({ error: "CourtListener API request failed" }, 502);
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return c.json(
      { error: `CourtListener API ${upstream.status}: ${text.slice(0, 200)}` },
      upstream.status,
    );
  }

  let json;
  try {
    json = await upstream.json();
  } catch {
    return c.json({ error: "CourtListener API returned invalid JSON" }, 502);
  }

  return c.json(json);
});

// ============================================
// GET /:resource[/:id]
// ============================================

/**
 * GET /:resource and /:resource/:id
 * Generic allowlisted resource fetch. Rejects unknown resources with 404
 * before any upstream call. `id` is URL-encoded.
 */
courtlistenerRoutes.get("/:resource/:id?", async (c) => {
  const resource = c.req.param("resource");
  const id = c.req.param("id");

  if (!RESOURCE_ALLOWLIST.has(resource)) {
    return c.json({ error: `Unknown CourtListener resource: ${resource}` }, 404);
  }

  // citation-lookup is POST-only via this proxy
  if (resource === "citation-lookup") {
    return c.json({ error: "citation-lookup requires POST" }, 405);
  }

  const url = new URL(c.req.url);
  return clGet(c, buildUpstream(resource, id, url.search));
});

export { courtlistenerRoutes };
