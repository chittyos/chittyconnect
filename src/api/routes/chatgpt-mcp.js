/**
 * ChatGPT Developer Mode MCP Route
 *
 * Speaks MCP protocol (JSON-RPC 2.0 over Streamable HTTP + SSE) at /chatgpt/mcp.
 * Delegates transport handling to McpConnectAgent (Durable Object backed by
 * the Cloudflare Agents SDK).
 *
 * Sessions are persisted in the Durable Object — no in-memory Map needed.
 *
 * NOTE: c.env inside the OAuthProvider defaultHandler only contains Worker
 * secrets, NOT resource bindings (KV, DO, R2). Auth validation against
 * API_KEYS KV is therefore deferred to the DO layer or trusted from the
 * Cloudflare Access / MCP Portal authentication layer.
 */

import { Hono } from "hono";
import { McpConnectAgent } from "../../mcp/agent.js";

const chatgptMcp = new Hono();

/** McpAgent handler for /chatgpt/mcp — DO-backed sessions */
const mcpHandler = McpConnectAgent.serve("/chatgpt/mcp", {
  binding: "MCP_AGENT",
});

// Deprecation headers — this route is being retired in favor of the canonical
// mcp.chitty.cc aggregator. ChatGPT clients should re-register against
// https://mcp.chitty.cc/ (unified OAuth, same scopes, same tools, unified audit).
// Sunset window: 2026-08-15.
chatgptMcp.use("*", async (c, next) => {
  await next();
  // The downstream MCP handler returns a streamed Response (SSE) whose headers
  // are immutable; mutating c.res.headers in place can throw. Rebuild the
  // Response so deprecation headers attach cleanly without buffering the body.
  const res = new Response(c.res.body, c.res);
  // RFC 9745: Deprecation is a structured-field Date (@<unix-seconds>), not a
  // boolean. @1778976000 = 2026-05-17T00:00:00Z, the date this route entered
  // deprecation.
  res.headers.set("Deprecation", "@1778976000");
  res.headers.set("Sunset", "Sat, 15 Aug 2026 00:00:00 GMT");
  res.headers.set(
    "Link",
    '<https://mcp.chitty.cc/mcp>; rel="successor-version", <https://mcp.chitty.cc/sse>; rel="alternate"',
  );
  c.res = res;
});

/**
 * Authentication middleware.
 * Extracts bearer token or API key. Validation is deferred to the DO layer
 * since KV bindings are not available in the OAuthProvider env context.
 */
chatgptMcp.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();

  const apiKey =
    c.req.header("X-ChittyOS-API-Key") ||
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!apiKey) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Authentication required" },
        id: null,
      },
      401,
    );
  }

  // Validate the API key against the KV store
  if (c.env.API_KEYS) {
    const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);
    if (!keyData) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Invalid API key" },
          id: null,
        },
        403,
      );
    }
  }

  c.set("authToken", apiKey);
  await next();
});

/**
 * Forward all methods to McpConnectAgent handler.
 * Injects authToken as ctx.props so the DO receives it in onStart().
 */
chatgptMcp.all("/", async (c) => {
  const ctx = c.executionCtx;
  ctx.props = { authToken: c.get("authToken") };
  return mcpHandler.fetch(c.req.raw, c.env, ctx);
});

export { chatgptMcp };
