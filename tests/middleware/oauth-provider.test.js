/**
 * OAuth Provider JSON-RPC Proxy Tests
 *
 * Tests the internal proxy methods in the OAuth provider's
 * JSON-RPC handler, verifying that non-OK responses from
 * internal Hono routes produce proper JSON-RPC errors.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the Cloudflare Workers OAuth provider (uses cloudflare: protocol not available in vitest)
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: vi.fn(),
}));

import { handleJsonRpcRequest } from "../../src/middleware/oauth-provider.js";

const mockRequest = new Request("https://mcp.chitty.cc/mcp", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  },
});

const mockEnv = {};
const mockCtx = {};

function createMockHonoApp(status, body) {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })),
  };
}

function createMockHonoAppNonJson(status, text) {
  return {
    fetch: vi.fn(async () => new Response(text, {
      status,
      headers: { "Content-Type": "text/plain" },
    })),
  };
}

describe("handleJsonRpcRequest", () => {
  describe("initialize", () => {
    it("returns protocol version and capabilities", async () => {
      const honoApp = createMockHonoApp(200, {});
      const result = await handleJsonRpcRequest(
        { jsonrpc: "2.0", method: "initialize", id: 1 },
        mockRequest, honoApp, mockEnv, mockCtx,
      );
      const data = await result.json();
      expect(data.result.protocolVersion).toBe("2025-06-18");
      expect(data.result.serverInfo.name).toBe("chittyconnect");
      expect(data.id).toBe(1);
    });
  });

  describe("invalid jsonrpc version", () => {
    it("returns error for non-2.0 version", async () => {
      const honoApp = createMockHonoApp(200, {});
      const result = await handleJsonRpcRequest(
        { jsonrpc: "1.0", method: "initialize", id: 2 },
        mockRequest, honoApp, mockEnv, mockCtx,
      );
      const data = await result.json();
      expect(data.error.code).toBe(-32600);
    });

    it("returns null for notification with bad version", async () => {
      const honoApp = createMockHonoApp(200, {});
      const result = await handleJsonRpcRequest(
        { jsonrpc: "1.0", method: "notifications/initialized" },
        mockRequest, honoApp, mockEnv, mockCtx,
      );
      expect(result).toBeNull();
    });
  });

  describe("proxy error handling", () => {
    const proxyMethods = [
      { method: "tools/list", label: "tools/list" },
      { method: "tools/call", label: "tools/call", params: { name: "test_tool", arguments: {} } },
      { method: "resources/list", label: "resources/list" },
      { method: "resources/read", label: "resources/read", params: { uri: "chitty://test" } },
    ];

    it.each(proxyMethods)(
      "$method returns JSON-RPC error when internal route returns 500",
      async ({ method, params }) => {
        const honoApp = createMockHonoApp(500, { error: "Internal Server Error" });
        const result = await handleJsonRpcRequest(
          { jsonrpc: "2.0", method, params, id: 10 },
          mockRequest, honoApp, mockEnv, mockCtx,
        );
        const data = await result.json();
        expect(data.error).toBeDefined();
        expect(data.error.code).toBe(-32603);
        expect(data.error.message).toContain("Internal proxy error");
        expect(data.error.message).toContain("500");
        expect(data.error.message).toContain("Internal Server Error");
        expect(data.id).toBe(10);
      },
    );

    it.each(proxyMethods)(
      "$method returns JSON-RPC error when internal route returns 401",
      async ({ method, params }) => {
        const honoApp = createMockHonoApp(401, { error: "Unauthorized" });
        const result = await handleJsonRpcRequest(
          { jsonrpc: "2.0", method, params, id: 11 },
          mockRequest, honoApp, mockEnv, mockCtx,
        );
        const data = await result.json();
        expect(data.error).toBeDefined();
        expect(data.error.code).toBe(-32603);
        expect(data.error.message).toContain("401");
        expect(data.error.message).toContain("Unauthorized");
      },
    );

    it.each(proxyMethods)(
      "$method returns JSON-RPC error when internal route returns non-JSON",
      async ({ method, params }) => {
        const honoApp = createMockHonoAppNonJson(200, "not json");
        const result = await handleJsonRpcRequest(
          { jsonrpc: "2.0", method, params, id: 12 },
          mockRequest, honoApp, mockEnv, mockCtx,
        );
        const data = await result.json();
        expect(data.error).toBeDefined();
        expect(data.error.code).toBe(-32603);
        expect(data.error.message).toContain("non-JSON");
      },
    );

    it.each(proxyMethods)(
      "$method returns success on 200 with valid JSON",
      async ({ method, params }) => {
        const payload = { tools: [{ name: "test" }] };
        const honoApp = createMockHonoApp(200, payload);
        const result = await handleJsonRpcRequest(
          { jsonrpc: "2.0", method, params, id: 13 },
          mockRequest, honoApp, mockEnv, mockCtx,
        );
        const data = await result.json();
        expect(data.result).toEqual(payload);
        expect(data.error).toBeUndefined();
        expect(data.id).toBe(13);
      },
    );
  });

  describe("unknown method", () => {
    it("returns method not found error", async () => {
      const honoApp = createMockHonoApp(200, {});
      const result = await handleJsonRpcRequest(
        { jsonrpc: "2.0", method: "unknown/method", id: 20 },
        mockRequest, honoApp, mockEnv, mockCtx,
      );
      const data = await result.json();
      expect(data.error.code).toBe(-32601);
      expect(data.error.message).toContain("Method not found");
    });
  });

  describe("ping", () => {
    it("returns empty result", async () => {
      const honoApp = createMockHonoApp(200, {});
      const result = await handleJsonRpcRequest(
        { jsonrpc: "2.0", method: "ping", id: 30 },
        mockRequest, honoApp, mockEnv, mockCtx,
      );
      const data = await result.json();
      expect(data.result).toEqual({});
      expect(data.id).toBe(30);
    });
  });
});
