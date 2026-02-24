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

/**
 * Evict sessions that have been idle longer than SESSION_TTL_MS.
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
}

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
