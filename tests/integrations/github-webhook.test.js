import { describe, it, expect, beforeEach, vi } from "vitest";

import { handleGitHubWebhook } from "../../src/integrations/github-webhook.js";

async function signGitHubWebhook(secret, bodyText) {
  const cryptoImpl =
    globalThis.crypto?.subtle ? globalThis.crypto : (await import("node:crypto")).webcrypto;
  const encoder = new TextEncoder();
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await cryptoImpl.subtle.sign("HMAC", key, encoder.encode(bodyText));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function createEnv(overrides = {}) {
  const db = {
    prepare: () => ({
      run: async () => {},
    }),
  };

  const idempotencyKv = {
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  };

  const eventQueue = {
    send: vi.fn(async () => {}),
  };

  return {
    DB: db,
    IDEMP_KV: idempotencyKv,
    EVENT_Q: eventQueue,
    GITHUB_WEBHOOK_SECRET: "test-secret",
    ...overrides,
  };
}

describe("POST /integrations/github/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues GitHub events using explicit json contentType", async () => {
    const env = createEnv();
    const delivery = "delivery-1";
    const event = "pull_request";
    const payload = { action: "opened", installation: { id: 123 } };
    const bodyText = JSON.stringify(payload);
    const signature = await signGitHubWebhook(env.GITHUB_WEBHOOK_SECRET, bodyText);

    const res = await handleGitHubWebhook(
      new Request("https://connect.chitty.cc/integrations/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Delivery": delivery,
          "X-GitHub-Event": event,
          "X-Hub-Signature-256": signature,
        },
        body: bodyText,
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(env.EVENT_Q.send).toHaveBeenCalledTimes(1);
    expect(env.EVENT_Q.send).toHaveBeenCalledWith(
      expect.objectContaining({ delivery, event, payload: expect.any(Object) }),
      expect.objectContaining({ contentType: "json" }),
    );
  });

  it("does not throw when queue send fails (returns 202)", async () => {
    const env = createEnv({
      EVENT_Q: { send: vi.fn(async () => {
        throw new Error("Queue unavailable");
      }) },
    });

    const delivery = "delivery-2";
    const event = "workflow_job";
    const payload = { action: "queued", installation: { id: 123 } };
    const bodyText = JSON.stringify(payload);
    const signature = await signGitHubWebhook(env.GITHUB_WEBHOOK_SECRET, bodyText);

    const res = await handleGitHubWebhook(
      new Request("https://connect.chitty.cc/integrations/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Delivery": delivery,
          "X-GitHub-Event": event,
          "X-Hub-Signature-256": signature,
        },
        body: bodyText,
      }),
      env,
    );

    expect(res.status).toBe(202);
  });
});
