/**
 * MCP Tools Scenario Tests
 *
 * Validates MCP tool listing and calling via the REST /mcp/* endpoints.
 * Tool calls that depend on downstream services may return isError:true
 * with a 500 status when those services are unreachable.
 */

import { describe, it, expect } from "vitest";
import { authFetch } from "./config.js";

describe("MCP tools", () => {
  it("GET /mcp/tools/list returns tools array", async () => {
    const res = await authFetch("/mcp/tools/list");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThanOrEqual(34);
  });

  it("tool list includes key tool names", async () => {
    const res = await authFetch("/mcp/tools/list");
    const { tools } = await res.json();
    const names = tools.map((t) => t.name);

    expect(names).toContain("chitty_id_mint");
    expect(names).toContain("chitty_services_status");
    expect(names).toContain("chitty_ecosystem_awareness");
    expect(names).toContain("chitty_ledger_stats");
  });

  it("POST /mcp/tools/call chitty_services_status returns structured response", async () => {
    const res = await authFetch("/mcp/tools/call", {
      method: "POST",
      body: JSON.stringify({ name: "chitty_services_status", arguments: {} }),
    });
    // May be 200 (success) or 500 (downstream unreachable)
    expect([200, 500]).toContain(res.status);

    const body = await res.json();
    expect(body.content).toBeDefined();
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content[0].type).toBe("text");
  });

  it("POST /mcp/tools/call chitty_ecosystem_awareness returns structured response", async () => {
    const res = await authFetch("/mcp/tools/call", {
      method: "POST",
      body: JSON.stringify({
        name: "chitty_ecosystem_awareness",
        arguments: {},
      }),
    });
    expect([200, 500]).toContain(res.status);

    const body = await res.json();
    expect(body.content).toBeDefined();
    expect(body.content[0].type).toBe("text");
  });

  it("POST /mcp/tools/call with unknown tool returns 400", async () => {
    const res = await authFetch("/mcp/tools/call", {
      method: "POST",
      body: JSON.stringify({ name: "nonexistent_tool", arguments: {} }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.isError).toBe(true);
  });
});
