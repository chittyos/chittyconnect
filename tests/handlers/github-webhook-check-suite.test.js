import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { handleGitHubWebhook } from "../../src/handlers/github-webhook.js";
import { queueConsumer } from "../../src/handlers/queue.js";
import {
  forwardCheckSuiteCompleted,
  LOOP_EVENT_TYPE,
} from "../../src/handlers/check-suite-forward.js";

// check_suite `completed` -> chittyagent-autoassist /api/v1/loops/events.
// The webhook endpoint runs for real (HMAC verified with WebCrypto); the
// queue consumer runs for real against in-memory KV/D1/queue stand-ins and a
// fake SVC_AUTOASSIST service binding. Only GitHub's HTTP is stubbed, at the
// fetch boundary.

const WEBHOOK_SECRET = "webhook-secret-fixture";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

function checkSuitePayload(overrides = {}) {
  return {
    action: "completed",
    installation: { id: 4242 },
    repository: {
      full_name: "chittyos/chittyentity",
      name: "chittyentity",
      owner: { login: "chittyos" },
    },
    check_suite: {
      head_sha: HEAD,
      conclusion: "success",
      check_runs_url: `https://api.github.com/repos/chittyos/chittyentity/check-suites/77/check-runs`,
      pull_requests: [{ number: 754 }],
    },
    ...overrides,
  };
}

async function sign(body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return (
    "sha256=" +
    [...new Uint8Array(mac)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function memoryKv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
  };
}

function autoassistBinding(status = 202) {
  const calls = [];
  return {
    calls,
    fetch: async (req) => {
      calls.push({
        url: req.url,
        method: req.method,
        auth: req.headers.get("Authorization"),
        body: await req.json(),
      });
      return new Response(JSON.stringify({ success: status < 300 }), {
        status,
      });
    },
  };
}

function makeEnv() {
  const sent = [];
  return {
    sent,
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    IDEMP_KV: memoryKv(),
    TOKEN_KV: {
      get: async (k, opts) => {
        if (k !== "install:4242") return null;
        const v = {
          token: "ghs-install-fixture",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        };
        return opts?.type === "json" ? v : JSON.stringify(v);
      },
      put: async () => {},
    },
    EVENT_Q: { send: async (msg) => void sent.push(msg) },
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ chittyid: "tenant-fixture" }) }),
      }),
    },
    SVC_AUTOASSIST: autoassistBinding(),
    AUTOASSIST_ADMIN_TOKEN: "autoassist-admin-fixture",
  };
}

const CHECK_RUNS = {
  total_count: 2,
  check_runs: [
    { name: "test", status: "completed", conclusion: "success", output: {} },
    { name: "lint", status: "completed", conclusion: "success", output: {} },
  ],
};

let githubCalls;

beforeEach(() => {
  githubCalls = [];
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    githubCalls.push({ url, init });
    if (url.endsWith("/check-suites/77/check-runs")) {
      return new Response(JSON.stringify(CHECK_RUNS), { status: 200 });
    }
    throw new Error(`unreachable in test: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function webhookApp() {
  const app = new Hono();
  app.post("/integrations/github/webhook", handleGitHubWebhook);
  return app;
}

async function deliver(env, payload, { signature } = {}) {
  const body = JSON.stringify(payload);
  return webhookApp().fetch(
    new Request("https://connect.chitty.cc/integrations/github/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": "delivery-1",
        "X-GitHub-Event": "check_suite",
        "X-Hub-Signature-256": signature ?? (await sign(body)),
      },
      body,
    }),
    env,
  );
}

async function drain(env) {
  const messages = env.sent.map((body) => ({ body, ack: () => {} }));
  await queueConsumer({ queue: "github-events", messages }, env);
}

describe("check_suite completed forwarding", () => {
  it("forwards a signed check_suite completed event to autoassist", async () => {
    const env = makeEnv();
    const res = await deliver(env, checkSuitePayload());
    expect(res.status).toBe(200);
    expect(env.sent).toHaveLength(1);

    await drain(env);

    const calls = env.SVC_AUTOASSIST.calls;
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/loops/events");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toBe("Bearer autoassist-admin-fixture");
    expect(LOOP_EVENT_TYPE).toBe("github_check_suite_completed");
    expect(calls[0].body).toEqual({
      type: LOOP_EVENT_TYPE,
      correlation_key: "chittyos/chittyentity#754",
      payload: {
        head_sha: HEAD,
        conclusion: "success",
        check_runs: [
          { name: "test", status: "completed", conclusion: "success" },
          { name: "lint", status: "completed", conclusion: "success" },
        ],
      },
    });
    const runsRead = githubCalls.find((c) => c.url.endsWith("/check-runs"));
    expect(runsRead.init.headers.Authorization).toBe(
      "token ghs-install-fixture",
    );
  });

  it("rejects an invalid signature: 401, nothing queued, nothing forwarded", async () => {
    const env = makeEnv();
    const res = await deliver(env, checkSuitePayload(), {
      signature: "sha256=" + "0".repeat(64),
    });
    expect(res.status).toBe(401);
    expect(env.sent).toHaveLength(0);
    await drain(env);
    expect(env.SVC_AUTOASSIST.calls).toHaveLength(0);
  });

  it("does not forward check_suite actions other than completed", async () => {
    const env = makeEnv();
    await deliver(env, checkSuitePayload({ action: "requested" }));
    await drain(env);
    expect(env.SVC_AUTOASSIST.calls).toHaveLength(0);
  });

  it("sends one event per attached pull request", async () => {
    const env = makeEnv();
    const payload = checkSuitePayload();
    payload.check_suite.pull_requests = [{ number: 754 }, { number: 755 }];
    const out = await forwardCheckSuiteCompleted(
      env,
      payload,
      "ghs-install-fixture",
    );
    expect(out.forwarded).toBe(2);
    expect(env.SVC_AUTOASSIST.calls.map((c) => c.body.correlation_key)).toEqual(
      ["chittyos/chittyentity#754", "chittyos/chittyentity#755"],
    );
  });

  it("skips without throwing when the binding or token is absent", async () => {
    const payload = checkSuitePayload();
    const noBinding = { ...makeEnv(), SVC_AUTOASSIST: undefined };
    await expect(
      forwardCheckSuiteCompleted(noBinding, payload),
    ).resolves.toEqual({
      forwarded: 0,
      skipped: "binding_missing",
    });
    const noToken = { ...makeEnv(), AUTOASSIST_ADMIN_TOKEN: undefined };
    await expect(forwardCheckSuiteCompleted(noToken, payload)).resolves.toEqual(
      {
        forwarded: 0,
        skipped: "token_missing",
      },
    );
    expect(noToken.SVC_AUTOASSIST.calls).toHaveLength(0);
  });

  it("reports a non-2xx autoassist reply without throwing", async () => {
    const env = { ...makeEnv(), SVC_AUTOASSIST: autoassistBinding(404) };
    const out = await forwardCheckSuiteCompleted(env, checkSuitePayload(), "t");
    expect(out.forwarded).toBe(0);
    expect(out.results).toEqual([
      { correlation_key: "chittyos/chittyentity#754", status: 404 },
    ]);
  });
});

describe("wrangler.jsonc", () => {
  it("declares SVC_AUTOASSIST -> chittyagent-autoassist in dev, staging and production", () => {
    const raw = readFileSync(
      new URL("../../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const lines = raw.match(
      /\{ "binding": "SVC_AUTOASSIST", "service": "chittyagent-autoassist" \}/g,
    );
    expect(lines).toHaveLength(3);
  });
});
