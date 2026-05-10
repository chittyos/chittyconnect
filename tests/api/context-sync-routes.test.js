import { describe, it, expect, vi } from "vitest";
import contextRoutes from "../../src/api/routes/context.js";
import { createMockD1 } from "../helpers/mocks.js";

function makeEnv() {
  return {
    DB: createMockD1(),
  };
}

describe("context sync routes", () => {
  it("accepts SESSION_INGEST payloads on /sync", async () => {
    const env = makeEnv();
    const req = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "SESSION_INGEST",
        session_id: "sess-123",
        chitty_id: "CID-123",
        project: "CHITTYOS/chittyconnect",
        event_count: 4,
        events: [{ type: "user" }, { type: "assistant" }],
      }),
    });

    const res = await contextRoutes.fetch(req, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.sessionId).toBe("sess-123");
  });

  it("rejects invalid sync payloads", async () => {
    const env = makeEnv();
    const req = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "NOT_SESSION_INGEST",
      }),
    });

    const res = await contextRoutes.fetch(req, env);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_SESSION_INGEST_PAYLOAD");
  });

  it("returns 400 for malformed JSON", async () => {
    const env = makeEnv();
    const req = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    });

    const res = await contextRoutes.fetch(req, env);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("bad_json");
  });

  it("continues when D1 write fails", async () => {
    const env = makeEnv();
    env.DB.prepare = vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockRejectedValue(new Error("d1 unavailable")),
    }));

    const req = new Request("http://localhost/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "SESSION_INGEST",
        session_id: "sess-err",
        event_count: 1,
      }),
    });

    const res = await contextRoutes.fetch(req, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
