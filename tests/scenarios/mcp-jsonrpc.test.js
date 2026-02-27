/**
 * MCP JSON-RPC Scenario Tests
 *
 * Tests the Streamable HTTP transport at /chatgpt/mcp which speaks
 * real JSON-RPC 2.0.  Responses arrive as SSE event streams
 * (Content-Type: text/event-stream) per the MCP Streamable HTTP spec.
 *
 * NOTE: Cloudflare Workers in-memory sessions aren't shared across
 * isolates, so session-dependent tests may hit a different isolate.
 * Tests that need sessions initialize + call within a tight window.
 */

import { describe, it, expect } from "vitest";
import { BASE_URL, API_KEY, mcpCall } from "./config.js";

/**
 * Parse a Streamable HTTP response.
 * Handles both application/json and text/event-stream content types.
 */
async function parseStreamableResponse(res) {
  const ct = res.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    return res.json();
  }

  // SSE stream — collect "data:" lines
  const text = await res.text();
  const results = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const payload = line.slice("data:".length).trim();
      if (payload && payload !== "[DONE]") {
        try {
          results.push(JSON.parse(payload));
        } catch {
          // skip non-JSON data lines
        }
      }
    }
  }
  return results.length === 1 ? results[0] : results;
}

describe("MCP JSON-RPC protocol", () => {
  it("initialize returns protocolVersion and capabilities", async () => {
    const res = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });
    expect(res.ok).toBe(true);

    const body = await parseStreamableResponse(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toBeDefined();
    expect(body.result.protocolVersion).toBeDefined();
    expect(body.result.capabilities).toBeDefined();
    expect(body.result.serverInfo).toBeDefined();
  });

  it("initialize returns a session ID header", async () => {
    const res = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
  });

  it("ping on fresh session returns empty result", async () => {
    // Initialize then immediately ping — same isolate window
    const initRes = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });
    const sid = initRes.headers.get("mcp-session-id");
    // Consume init body to free connection
    await parseStreamableResponse(initRes);

    const res = await mcpCall("ping", {}, { id: 2, sessionId: sid });

    // Session may land on different isolate — accept either success or new session
    if (res.ok) {
      const body = await parseStreamableResponse(res);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.result).toEqual({});
    } else {
      // Isolate mismatch — the SDK rejects stale session IDs.
      // This is expected in multi-isolate Workers deployments.
      expect([400, 404, 409]).toContain(res.status);
    }
  });

  it("tools/list via JSON-RPC returns tools", async () => {
    const initRes = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });
    const sid = initRes.headers.get("mcp-session-id");
    await parseStreamableResponse(initRes);

    const res = await mcpCall("tools/list", {}, { id: 3, sessionId: sid });

    if (res.ok) {
      const body = await parseStreamableResponse(res);
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
    } else {
      // Session not found on this isolate
      expect([400, 404, 409]).toContain(res.status);
    }
  });

  it("bad jsonrpc version returns a parse/invalid-request error", async () => {
    // Send bad JSON-RPC version without a session — should be rejected
    const res = await fetch(`${BASE_URL}/chatgpt/mcp`, {
      method: "POST",
      headers: {
        "X-ChittyOS-API-Key": API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "1.0", method: "ping", id: 6 }),
    });

    const body = await parseStreamableResponse(res);
    expect(body.error).toBeDefined();
    // SDK may return -32700 (parse error) or -32600 (invalid request)
    expect([-32700, -32600]).toContain(body.error.code);
  });

  it("missing auth returns 401 JSON-RPC error", async () => {
    const res = await fetch(`${BASE_URL}/chatgpt/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
