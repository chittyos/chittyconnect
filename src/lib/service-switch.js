/**
 * Service Switch — routing + kill switch layer for downstream services.
 *
 * Each service can be routed via:
 * - "binding": Cloudflare service binding (no auth, no network)
 * - "http": External HTTP call with service token
 * - "disabled": Service is offline, return error immediately
 *
 * Switches are read from SERVICE_SWITCHES KV with fallback to defaults.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/lib/service-switch
 */

const DEFAULTS = {
  tasks:       { enabled: true, mode: "binding", binding: "SVC_TASKS" },
  ledger:      { enabled: true, mode: "binding", binding: "SVC_LEDGER" },
  finance:     { enabled: true, mode: "binding", binding: "SVC_FINANCE" },
  contextual:  { enabled: true, mode: "binding", binding: "SVC_CONTEXTUAL" },
  id:          { enabled: true, mode: "binding", binding: "SVC_ID" },
  mint:        { enabled: true, mode: "binding", binding: "SVC_ID" },
  evidence:    { enabled: true, mode: "binding", binding: "SVC_EVIDENCE" },
  chronicle:   { enabled: true, mode: "binding", binding: "SVC_CHRONICLE" },
  disputes:    { enabled: true, mode: "binding", binding: "SVC_DISPUTES" },
  score:       { enabled: true, mode: "binding", binding: "SVC_SCORE" },
};

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60_000; // 1 minute

/**
 * Load service switches from KV with in-memory cache.
 */
async function loadSwitches(env) {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL) return _cache;

  try {
    const raw = env.IDEMP_KV ? await env.IDEMP_KV.get("service:switches") : null;
    _cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch (err) {
    console.error("[service-switch] Failed to load switches from KV:", err);
    _cache = { ...DEFAULTS };
  }
  _cacheTs = now;
  return _cache;
}

/**
 * Get switch state for a service.
 * @returns {{ enabled: boolean, mode: string, binding?: string, url?: string, reason?: string }}
 */
export async function getSwitch(env, serviceName) {
  const switches = await loadSwitches(env);
  return switches[serviceName] || { enabled: false, mode: "disabled", reason: "unknown service" };
}

/**
 * Execute a fetch through the service switch layer.
 * Uses service binding when available, falls back to HTTP.
 *
 * @param {object} env - Worker env bindings
 * @param {string} serviceName - Service key (e.g., "tasks", "ledger")
 * @param {string} path - API path (e.g., "/api/v1/tasks")
 * @param {object} [options] - Fetch options (method, body, headers)
 * @returns {Promise<Response>}
 */
export async function serviceFetch(env, serviceName, path, options = {}) {
  const sw = await getSwitch(env, serviceName);

  if (!sw.enabled) {
    return new Response(JSON.stringify({
      error: `Service "${serviceName}" is disabled`,
      reason: sw.reason || "maintenance",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const headers = {
    "Content-Type": "application/json",
    "X-ChittyOS-Caller": "chittyconnect",
    ...options.headers,
  };

  if (sw.mode === "binding" && sw.binding && !env[sw.binding]) {
    console.error(`[service-switch] Binding "${sw.binding}" for "${serviceName}" not in env. Check wrangler.jsonc services.`);
    return new Response(JSON.stringify({
      error: `Service "${serviceName}" binding "${sw.binding}" not configured in wrangler.jsonc`,
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  if (sw.mode === "binding" && sw.binding && env[sw.binding]) {
    // Service binding — direct Worker-to-Worker, no auth needed
    const req = new Request(`https://internal${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return env[sw.binding].fetch(req);
  }

  if (sw.mode === "http" && sw.url) {
    // HTTP fallback — needs service token
    const { getServiceToken } = await import("./credential-helper.js");
    const token = await getServiceToken(env, serviceName);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      console.warn(`[service-switch] No service token for "${serviceName}" in HTTP mode`);
    }

    const req = new Request(`${sw.url}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return fetch(req);
  }

  return new Response(JSON.stringify({
    error: `Service "${serviceName}" has invalid switch mode: ${sw.mode}`,
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/**
 * Invalidate the switch cache (call after updating switches in KV).
 */
export function invalidateSwitchCache() {
  _cache = null;
  _cacheTs = 0;
}
