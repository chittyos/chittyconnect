/**
 * Ecosystem & Resources Scenario Tests
 *
 * Validates ecosystem awareness tool, MCP resource listing,
 * resource reading, and unimplemented-resource 501 responses.
 */

import { describe, it, expect } from "vitest";
import { authFetch } from "./config.js";

describe("ecosystem and resources", () => {
  it("ecosystem_awareness tool returns structured response", async () => {
    const res = await authFetch("/mcp/tools/call", {
      method: "POST",
      body: JSON.stringify({
        name: "chitty_ecosystem_awareness",
        arguments: {},
      }),
    });
    // May be 200 or 500 if downstream services unreachable
    expect([200, 500]).toContain(res.status);

    const body = await res.json();
    expect(body.content).toBeDefined();
    expect(body.content[0].text).toBeTruthy();
  });

  it("GET /mcp/resources/list returns resources array with URIs", async () => {
    const res = await authFetch("/mcp/resources/list");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.resources)).toBe(true);
    expect(body.resources.length).toBeGreaterThan(0);

    for (const r of body.resources) {
      expect(r.uri).toBeDefined();
      expect(r.name).toBeDefined();
    }
  });

  it("GET /mcp/resources/read ecosystem status returns content", async () => {
    const uri = encodeURIComponent("chitty://ecosystem/status");
    const res = await authFetch(`/mcp/resources/read?uri=${uri}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.contents).toBeDefined();
    expect(body.contents.length).toBeGreaterThan(0);
    expect(body.contents[0].uri).toBe("chitty://ecosystem/status");
  });

  it("GET /mcp/resources/read session memory returns 501", async () => {
    const uri = encodeURIComponent("chitty://memory/session/test-session");
    const res = await authFetch(`/mcp/resources/read?uri=${uri}`);
    expect(res.status).toBe(501);
  });

  it("GET /mcp/resources/read unknown resource returns 404", async () => {
    const uri = encodeURIComponent("chitty://nonexistent/resource");
    const res = await authFetch(`/mcp/resources/read?uri=${uri}`);
    expect(res.status).toBe(404);
  });
});
