import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchToolCall } from "../tool-dispatcher.js";

describe("Context MCP Tools", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const env = {};
  const opts = {
    baseUrl: "https://connect.chitty.cc",
    authToken: "test-token",
  };

  describe("context_resolve", () => {
    it("should POST to /api/v1/intelligence/context/resolve", async () => {
      const result = await dispatchToolCall(
        "context_resolve",
        {
          project_path: "/test",
          platform: "claude_code",
          support_type: "development",
        },
        env,
        opts,
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/intelligence/context/resolve",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  describe("context_restore", () => {
    it("should GET restore endpoint with chitty_id and project", async () => {
      await dispatchToolCall(
        "context_restore",
        {
          chitty_id: "03-1-USA-1234-P-2602-0-01",
          project_slug: "myproject",
        },
        env,
        opts,
      );
      const url = fetch.mock.calls[0][0];
      expect(url).toContain("/intelligence/context/");
      expect(url).toContain("03-1-USA-1234-P-2602-0-01");
    });
  });

  describe("context_commit", () => {
    it("should POST session metrics to commit endpoint", async () => {
      await dispatchToolCall(
        "context_commit",
        {
          session_id: "sess-1",
          chitty_id: "03-1-USA-1234-P-2602-0-01",
          metrics: { interactions: 10, decisions: 2 },
        },
        env,
        opts,
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/intelligence/context/commit",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("context_check", () => {
    it("should GET check endpoint with chitty_id", async () => {
      await dispatchToolCall(
        "context_check",
        {
          chitty_id: "03-1-USA-1234-P-2602-0-01",
        },
        env,
        opts,
      );
      const url = fetch.mock.calls[0][0];
      expect(url).toContain("03-1-USA-1234-P-2602-0-01");
      expect(url).toContain("/check");
    });
  });

  describe("context_checkpoint", () => {
    it("should POST checkpoint data", async () => {
      await dispatchToolCall(
        "context_checkpoint",
        {
          chitty_id: "03-1-USA-1234-P-2602-0-01",
          project_slug: "test",
          name: "v1",
        },
        env,
        opts,
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/intelligence/context/checkpoint",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("memory_persist (enhanced)", () => {
    it("should include chitty_id in request body", async () => {
      await dispatchToolCall(
        "memory_persist",
        {
          content: "test",
          chitty_id: "03-1-USA-1234-P-2602-0-01",
        },
        env,
        opts,
      );
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.chitty_id).toBe("03-1-USA-1234-P-2602-0-01");
    });
  });

  describe("memory_recall (enhanced)", () => {
    it("should include chitty_id as query param", async () => {
      await dispatchToolCall(
        "memory_recall",
        {
          query: "test",
          chitty_id: "03-1-USA-1234-P-2602-0-01",
        },
        env,
        opts,
      );
      const url = fetch.mock.calls[0][0];
      expect(url).toContain("chitty_id=03-1-USA-1234-P-2602-0-01");
    });
  });
});
