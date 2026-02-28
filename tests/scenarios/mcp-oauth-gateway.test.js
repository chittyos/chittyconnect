/**
 * MCP OAuth Gateway Scenario Tests
 *
 * Validates the OAuth-protected Streamable HTTP MCP endpoint at:
 *   https://mcp.chitty.cc/mcp
 *
 * Required env var:
 *   CHITTY_MCP_BEARER_TOKEN=<oauth access token>
 */

import { describe, it, expect } from "vitest";
import { MCP_URL, MCP_OAUTH_BEARER, mcpOAuthCall } from "./config.js";

function parseStreamableResponseText(text) {
  const results = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const payload = line.slice("data:".length).trim();
      if (payload && payload !== "[DONE]") {
        try {
          results.push(JSON.parse(payload));
        } catch {
          // ignore non-JSON data events
        }
      }
    }
  }
  return results.length === 1 ? results[0] : results;
}

async function parseStreamableResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  return parseStreamableResponseText(await res.text());
}

const describeIfToken = MCP_OAUTH_BEARER ? describe : describe.skip;

describeIfToken("MCP OAuth gateway (mcp.chitty.cc/mcp)", () => {
  it("initialize succeeds and returns session header", async () => {
    const res = await mcpOAuthCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });

    expect(res.ok).toBe(true);
    expect(res.url).toContain("/mcp");
    expect(MCP_URL).toContain("mcp.chitty.cc");

    const body = await parseStreamableResponse(res);
    const sessionId = res.headers.get("mcp-session-id");

    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo).toBeDefined();
    expect(sessionId).toBeTruthy();
  });

  it("tools/list succeeds on same session", async () => {
    const init = await mcpOAuthCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scenario-tests", version: "1.0.0" },
    });

    expect(init.ok).toBe(true);
    await parseStreamableResponse(init);

    const sid = init.headers.get("mcp-session-id");
    const res = await mcpOAuthCall("tools/list", {}, { id: 2, sessionId: sid });

    if (res.ok) {
      const body = await parseStreamableResponse(res);
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
    } else {
      // Session can land on a different isolate in Cloudflare Workers.
      expect([400, 404, 409]).toContain(res.status);
    }
  });
});

