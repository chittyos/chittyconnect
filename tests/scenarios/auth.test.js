/**
 * Auth Validation Scenario Tests
 *
 * Verifies authentication enforcement on protected endpoints.
 * /api/* routes require API key auth.
 * /mcp/* routes are public (no auth required).
 * /chatgpt/mcp has its own API key auth middleware.
 */

import { describe, it, expect } from "vitest";
import { BASE_URL, API_KEY, authFetch } from "./config.js";

describe("authentication", () => {
  describe("REST API auth (/api/*)", () => {
    it("accepts valid API key via X-ChittyOS-API-Key", async () => {
      const res = await authFetch("/api/services/status");
      expect(res.status).toBe(200);
    });

    it("accepts valid Bearer token", async () => {
      const res = await fetch(`${BASE_URL}/api/services/status`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      });
      expect(res.status).toBe(200);
    });

    it("rejects missing auth with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/services/status`);
      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("rejects invalid API key with 401", async () => {
      const res = await fetch(`${BASE_URL}/api/services/status`, {
        headers: { "X-ChittyOS-API-Key": "invalid_key_123" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("ChatGPT MCP auth (/chatgpt/mcp)", () => {
    it("rejects missing auth with 401", async () => {
      const res = await fetch(`${BASE_URL}/chatgpt/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects invalid key with 403", async () => {
      const res = await fetch(`${BASE_URL}/chatgpt/mcp`, {
        method: "POST",
        headers: {
          "X-ChittyOS-API-Key": "invalid_key_123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });
      expect(res.status).toBe(403);
    });

    it("accepts valid API key", async () => {
      const res = await fetch(`${BASE_URL}/chatgpt/mcp`, {
        method: "POST",
        headers: {
          "X-ChittyOS-API-Key": API_KEY,
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
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("public MCP routes (/mcp/*)", () => {
    it("/mcp/tools/list is accessible without auth", async () => {
      const res = await fetch(`${BASE_URL}/mcp/tools/list`);
      expect(res.status).toBe(200);
    });
  });
});
