/**
 * ChatGPT Developer Mode MCP Route
 *
 * Speaks real MCP protocol (JSON-RPC 2.0 over Streamable HTTP) at /chatgpt/mcp.
 * Uses the SDK's WebStandardStreamableHTTPServerTransport — designed for
 * Cloudflare Workers and Hono.js.
 *
 * Sessions are stored in an in-memory Map with 5-minute idle cleanup.
 * Worker isolate recycling creates a fresh MCP server when the session ID
 * is not found. The SDK transport may reject the stale session ID,
 * prompting ChatGPT to re-initialize.
 */

import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createChatGPTMcpServer } from "../../mcp/chatgpt-server.js";

const chatgptMcp = new Hono();

/** @type {Map<string, {transport: WebStandardStreamableHTTPServerTransport, server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer, lastAccess: number}>} */
const sessions = new Map();

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SESSIONS = 100;

/**
 * Evict sessions that have been idle longer than SESSION_TTL_MS.
 * Also enforces hard cap of MAX_SESSIONS by evicting oldest.
 * Called lazily on each request — lightweight O(n) scan.
 */
function evictStaleSessions() {
  const now = Date.now();
  for (const [sid, entry] of sessions) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      entry.transport.close().catch((err) => {
        console.warn(`[ChatGPT-MCP] Failed to close session ${sid}:`, err.message);
      });
      sessions.delete(sid);
    }
  }
  // Hard cap: evict oldest if over limit
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    );
    while (sessions.size > MAX_SESSIONS) {
      const [sid, entry] = oldest.shift();
      entry.transport.close().catch(() => {});
      sessions.delete(sid);
    }
  }
}

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

  if (c.env.API_KEYS) {
    const keyData = await c.env.API_KEYS.get(`key:${apiKey}`);
    if (!keyData || JSON.parse(keyData).status !== "active") {
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

  await next();
});

/**
 * Handle all HTTP methods on /chatgpt/mcp.
 *
 * POST — JSON-RPC requests (initialize, tools/list, tools/call, etc.)
 * GET  — SSE stream (optional, for server-initiated notifications)
 * DELETE — session termination
 */
chatgptMcp.all("/", async (c) => {
  evictStaleSessions();

  const sessionId = c.req.header("mcp-session-id");

  try {
    // ── Existing session ──────────────────────────────────────────────
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId);
      entry.lastAccess = Date.now();
      return entry.transport.handleRequest(c.req.raw);
    }

    // ── New session (initialize request) ──────────────────────────────
    // Derive base URL from the incoming request so local dev works too.
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    let server;

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, lastAccess: Date.now() });
      },
    });

    server = createChatGPTMcpServer(c.env, { baseUrl });
    await server.connect(transport);

    return transport.handleRequest(c.req.raw);
  } catch (err) {
    console.error("[ChatGPT-MCP] Request handling error:", err);
    return c.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null },
      500,
    );
  }
});

export { chatgptMcp };
