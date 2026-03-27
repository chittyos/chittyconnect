/**
 * ChatGPT Developer Mode MCP Route
 *
 * Speaks MCP protocol (JSON-RPC 2.0 over Streamable HTTP + SSE) at /chatgpt/mcp.
 * Delegates transport handling to McpConnectAgent (Durable Object backed by
 * the Cloudflare Agents SDK).
 *
 * Sessions are persisted in the Durable Object — no in-memory Map needed.
 * API key authentication is handled by Hono middleware before forwarding
 * to the McpAgent handler.
 */

import { Hono } from "hono";
import { McpConnectAgent } from "../../mcp/agent.js";

const chatgptMcp = new Hono();

/** McpAgent handler for /chatgpt/mcp — DO-backed sessions */
const mcpHandler = McpConnectAgent.serve("/chatgpt/mcp", {
  binding: "MCP_AGENT",
});

/**
 * API key authentication middleware.
 * Validates X-ChittyOS-API-Key or Authorization Bearer token against KV store.
 */
chatgptMcp.use("*", async (c, next) => {
  // Allow CORS preflight
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

  console.log("[ChatGPT-MCP] env keys:", Object.keys(c.env || {}).join(", "));
  if (!c.env.API_KEYS) {
    console.error("[ChatGPT-MCP] API_KEYS KV binding missing — failing closed. env type:", typeof c.env, "keys:", Object.keys(c.env || {}).join(", "));
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Service misconfigured" },
        id: null,
      },
      500,
    );
  }

  const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);
  let keyActive = false;
  if (keyData) {
    try {
      keyActive = JSON.parse(keyData).status === "active";
    } catch {
      console.error("[ChatGPT-MCP] Malformed key data in KV for provided key");
    }
  }
  if (!keyActive) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid API key" },
        id: null,
      },
      403,
    );
  }

  // Store validated API key for downstream use
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
