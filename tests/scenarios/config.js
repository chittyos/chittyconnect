/**
 * Scenario Test Configuration
 *
 * Provides base URLs, auth helpers, and fetch wrappers for
 * authenticated integration tests against live ChittyConnect deployments.
 */

export const BASE_URL =
  process.env.CHITTY_SCENARIO_URL || "https://connect.chitty.cc";

export const MCP_URL =
  process.env.CHITTY_MCP_URL || "https://mcp.chitty.cc";

export const API_KEY =
  process.env.CHITTY_SCENARIO_API_KEY || "chitty_test_scenario_runner";

export const MCP_OAUTH_BEARER =
  process.env.CHITTY_MCP_BEARER_TOKEN || "";

/** Standard authenticated headers. */
export function headers() {
  return {
    "X-ChittyOS-API-Key": API_KEY,
    "Content-Type": "application/json",
  };
}

/**
 * Fetch with automatic auth headers.
 * @param {string} path - Path relative to BASE_URL (e.g. "/health")
 * @param {RequestInit} [opts] - Additional fetch options
 */
export async function authFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { ...headers(), ...opts.headers },
  });
}

/**
 * Send a JSON-RPC 2.0 call to the ChatGPT MCP endpoint.
 * Uses API key auth (not OAuth) so it can run headlessly.
 * @param {string} method - JSON-RPC method name
 * @param {object} [params] - Method params
 * @param {object} [extra] - Extra options (id override, sessionId header)
 */
export async function mcpCall(method, params = {}, extra = {}) {
  const id = extra.id ?? 1;
  const body = {
    jsonrpc: extra.jsonrpc ?? "2.0",
    method,
    id,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };

  const hdrs = {
    "X-ChittyOS-API-Key": API_KEY,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (extra.sessionId) {
    hdrs["Mcp-Session-Id"] = extra.sessionId;
  }

  return fetch(`${BASE_URL}/chatgpt/mcp`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  });
}

/**
 * Send a JSON-RPC 2.0 call to the OAuth-protected MCP gateway at mcp.chitty.cc/mcp.
 * Requires CHITTY_MCP_BEARER_TOKEN.
 * @param {string} method - JSON-RPC method name
 * @param {object} [params] - Method params
 * @param {object} [extra] - Extra options (id override, sessionId header)
 */
export async function mcpOAuthCall(method, params = {}, extra = {}) {
  const id = extra.id ?? 1;
  const body = {
    jsonrpc: extra.jsonrpc ?? "2.0",
    method,
    id,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };

  const hdrs = {
    Authorization: `Bearer ${MCP_OAUTH_BEARER}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  if (extra.sessionId) {
    hdrs["Mcp-Session-Id"] = extra.sessionId;
  }

  return fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  });
}
