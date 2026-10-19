import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueConsumer } from "../../src/handlers/queue.js";

// forwardToDispatch hand-off (queue.js). The queue consumer runs for real
// against in-memory KV/D1 stand-ins; only outbound HTTP is stubbed, at the
// global fetch boundary. `pull_request` `closed` is dispatch-eligible but
// triggers no v1 automation, so the only outbound call is the hand-off.

function memoryKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    get: async (k, opts) => {
      const v = m.get(k) ?? null;
      return opts?.type === "json" && v ? JSON.parse(v) : v;
    },
    put: async (k, v) => void m.set(k, v),
  };
}

function makeEnv(overrides = {}) {
  return {
    INTERNAL_WEBHOOK_SECRET: `test-run-${crypto.randomUUID()}`,
    IDEMP_KV: memoryKv(),
    TOKEN_KV: memoryKv({
      "install:4242": JSON.stringify({
        token: "test-fixture-not-a-credential-install",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    }),
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ chittyid: "tenant-fixture" }) }),
      }),
    },
    ...overrides,
  };
}

function prClosedMessage(delivery) {
  return {
    delivery,
    event: "pull_request",
    payload: {
      action: "closed",
      installation: { id: 4242 },
      repository: {
        full_name: "chittyos/chittyconnect",
        name: "chittyconnect",
        owner: { login: "chittyos" },
      },
      pull_request: { number: 252 },
    },
  };
}

async function drain(env, body) {
  const msg = { body, ack: vi.fn(), retry: vi.fn() };
  await queueConsumer({ queue: "github-events", messages: [msg] }, env);
  return msg;
}

let dispatchCalls;
let dispatchStatus;

beforeEach(() => {
  dispatchCalls = [];
  dispatchStatus = 202;
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/dispatch/github")) {
      dispatchCalls.push({ url, headers: init.headers });
      return new Response("", { status: dispatchStatus });
    }
    throw new Error(`unreachable in test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("forwardToDispatch hand-off", () => {
  it("logs a rejected (non-2xx) hand-off at error level and still completes the event", async () => {
    dispatchStatus = 403;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = makeEnv();

    const msg = await drain(env, prClosedMessage("delivery-403"));

    expect(dispatchCalls).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      "Dispatch hand-off rejected (continuing):",
      expect.objectContaining({
        type: "github.pull_request",
        delivery: "delivery-403",
        transport: "fetch",
        status: 403,
      }),
    );
    // Fail-safe held: no throw, no retry, event marked completed.
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(env.IDEMP_KV.m.get("delivery-403")).toBe("completed");
  });

  it("does not log an accepted hand-off as an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const env = makeEnv();

    await drain(env, prClosedMessage("delivery-202"));

    expect(dispatchCalls).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
    expect(env.IDEMP_KV.m.get("delivery-202")).toBe("completed");
  });

  it("sends the shared secret to the default trusted host only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const env = makeEnv();
    await drain(env, prClosedMessage("delivery-trusted"));
    expect(dispatchCalls[0].url).toBe(
      "https://dispatch.chitty.cc/dispatch/github",
    );
    expect(dispatchCalls[0].headers["X-Webhook-Secret"]).toBe(
      env.INTERNAL_WEBHOOK_SECRET,
    );

    const untrusted = makeEnv({ DISPATCH_URL: "https://dispatch.chitty.co" });
    await drain(untrusted, prClosedMessage("delivery-untrusted"));
    expect(dispatchCalls[1].url).toBe(
      "https://dispatch.chitty.co/dispatch/github",
    );
    expect(dispatchCalls[1].headers).not.toHaveProperty("X-Webhook-Secret");
  });
});
