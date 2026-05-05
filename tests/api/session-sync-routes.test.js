/**
 * Tests for POST /api/v1/sessions/sync
 *
 * Channel-agnostic session lifecycle endpoint.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { sessionRoutes } from "../../src/api/routes/sessions.js";

const mockMemory = {
  persistInteraction: vi.fn().mockResolvedValue(undefined),
};

const mockContextResolver = {
  loadContextByChittyId: vi.fn().mockResolvedValue({
    id: "ctx-001",
    chitty_id: "03-1-USA-5537-P-2602-0-38",
    status: "active",
  }),
  bindSession: vi.fn().mockResolvedValue({ bindingId: "bind-001" }),
  unbindSession: vi.fn().mockResolvedValue(null),
};

const mockSessionService = {
  createSession: vi.fn().mockResolvedValue({ sessionId: "s1", status: "active" }),
  updateSession: vi.fn().mockResolvedValue({ sessionId: "s1", status: "ended" }),
  getContext: vi.fn().mockResolvedValue(null),
  setContext: vi.fn().mockResolvedValue({ ok: true }),
  listSessions: vi.fn().mockResolvedValue([]),
  getSession: vi.fn().mockResolvedValue(null),
  getMetrics: vi.fn().mockResolvedValue({}),
};

// Mock SessionStateService constructor — must use function (not arrow) for new
vi.mock("../../src/services/SessionStateService.js", () => ({
  SessionStateService: vi.fn().mockImplementation(function () {
    Object.assign(this, mockSessionService);
  }),
}));

// Mock credential helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn().mockResolvedValue(null),
}));

function createTestApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("memory", mockMemory);
    c.set("contextResolver", mockContextResolver);
    c.env = c.env || {};
    await next();
  });
  app.route("/api/v1/sessions", sessionRoutes);
  return app;
}

describe("POST /api/v1/sessions/sync", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it("rejects missing required fields", async () => {
    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "session_start" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("rejects invalid event type", async () => {
    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_pause",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "s1",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_EVENT");
  });

  it("handles session_start and creates session", async () => {
    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_start",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "session-1234",
        channel: { type: "claude_desktop", machine: "macbook-pro" },
        project: { slug: "chittyconnect", org: "CHITTYOS" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.event).toBe("session_start");
    expect(body.data.actions).toContain("session_created");
    expect(body.data.actions).toContain("ledger_session_bound");
    expect(mockSessionService.createSession).toHaveBeenCalledWith(
      "03-1-USA-5537-P-2602-0-38",
      "session-1234",
      expect.objectContaining({
        channel: { type: "claude_desktop", machine: "macbook-pro" },
        project: { slug: "chittyconnect", org: "CHITTYOS" },
      }),
    );
    expect(mockContextResolver.bindSession).toHaveBeenCalledWith(
      "ctx-001",
      "03-1-USA-5537-P-2602-0-38",
      "session-1234",
      "claude_desktop",
    );
  });

  it("loads prior context on session_start when available", async () => {
    const priorCtx = {
      summary: "Working on session sync endpoint",
      keyFacts: ["converted to Hono sub-router"],
    };
    mockSessionService.getContext.mockResolvedValueOnce(priorCtx);

    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_start",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "session-5678",
        project: { slug: "chittyconnect" },
      }),
    });
    const body = await res.json();
    expect(body.data.priorContext).toEqual(priorCtx);
    expect(body.data.actions).toContain("prior_context_loaded");
  });

  it("handles session_end with memory persist and context save", async () => {
    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_end",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "session-1234",
        channel: { type: "claude_desktop", machine: "macbook-pro" },
        project: { slug: "chittyconnect", org: "CHITTYOS" },
        context: {
          summary: "Built session sync endpoint",
          keyFacts: ["converted sessions.js to Hono sub-router"],
          completedTasks: ["sync endpoint", "router wiring"],
          pendingTasks: ["write tests"],
        },
        signals: {
          git: { branch: "feat/session-sync", staged: 2, modified: 0 },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.actions).toContain("session_ended");
    expect(body.data.actions).toContain("ledger_session_unbound");
    expect(body.data.actions).toContain("memory_persisted");
    expect(body.data.actions).toContain("project_context_saved");

    // Verify memory was persisted with correct shape
    expect(mockMemory.persistInteraction).toHaveBeenCalledWith(
      "session-1234",
      expect.objectContaining({
        type: "session_sync_end",
        userId: "03-1-USA-5537-P-2602-0-38",
        content: expect.stringContaining("Built session sync endpoint"),
      }),
    );

    // Verify project context was saved for next session
    expect(mockSessionService.setContext).toHaveBeenCalledWith(
      "03-1-USA-5537-P-2602-0-38",
      "project:CHITTYOS:chittyconnect",
      expect.objectContaining({
        summary: "Built session sync endpoint",
        lastSessionId: "session-1234",
      }),
    );
  });

  it("session_end without context does not persist memory", async () => {
    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_end",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "session-empty",
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.actions).toContain("session_ended");
    expect(body.data.actions).not.toContain("memory_persisted");
    expect(mockMemory.persistInteraction).not.toHaveBeenCalled();
  });

  it("gracefully handles SessionStateService failures", async () => {
    mockSessionService.createSession.mockRejectedValueOnce(
      new Error("DO unavailable"),
    );

    const res = await app.request("/api/v1/sessions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "session_start",
        chittyId: "03-1-USA-5537-P-2602-0-38",
        sessionId: "session-fail",
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.actions).toContain("session_create_failed");
  });
});
