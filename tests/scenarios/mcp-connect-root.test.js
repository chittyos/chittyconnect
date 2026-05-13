/**
 * connect.chitty.cc/mcp Scenario Tests
 *
 * Verifies that POST /mcp on the connect.chitty.cc host routes to the
 * McpConnectAgent DO using API-key auth (issue #190, option A fix).
 *
 * These tests mirror mcp-jsonrpc.test.js but target the /mcp root path
 * instead of /chatgpt/mcp, and rely on X-ChittyOS-API-Key auth.
 */

import { describe, it, expect } from "vitest";
import { BASE_URL, API_KEY, mcpConnectCall } from "./config.js";

async function parseStreamableResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
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

describe("connect.chitty.cc/mcp — API-key JSON-RPC", () => {
  it("missing auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
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

  it("invalid API key returns 401", async () => {
    const res = await mcpConnectCall(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
      { apiKey: "invalid_key_that_does_not_exist" },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("initialize with valid API key returns protocolVersion and capabilities", async () => {
    const res = await mcpConnectCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "connect-root-test", version: "1.0.0" },
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
    const res = await mcpConnectCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "connect-root-test", version: "1.0.0" },
    });
    expect(res.ok).toBe(true);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
  });

  it("Authorization: Bearer token auth also works", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "bearer-test", version: "1.0.0" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    const body = await parseStreamableResponse(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toBeDefined();
  });
});
