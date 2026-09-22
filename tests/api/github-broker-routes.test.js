import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../../src/github/issue-authority.js", () => ({
  createIssueWithGitHubApp: vi.fn(async (_env, input, caller) => ({
    ok: true,
    status: 201,
    deduplicated: false,
    repo: input.repo,
    issue_number: 17,
    issue_url: "https://github.com/CHITTYOS/chittyentity/issues/17",
    idempotency_receipt: "abc123",
    caller,
  })),
}));

import { githubBrokerRoutes } from "../../src/api/routes/github-broker.js";
import { createIssueWithGitHubApp } from "../../src/github/issue-authority.js";

function buildApp(principal = "chittyagent-dispatch") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("apiKey", { service: principal, status: "active" });
    await next();
  });
  app.route("/api/github", githubBrokerRoutes);
  return app;
}

describe("GitHub broker route authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing caller header", async () => {
    const res = await buildApp().request("/api/github/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "CHITTYOS/chittyentity", title: "x", idempotency_key: "t1" }),
    });
    expect(res.status).toBe(403);
    expect(createIssueWithGitHubApp).not.toHaveBeenCalled();
  });

  it("rejects caller/principal mismatch", async () => {
    const res = await buildApp("some-other-service").request("/api/github/issues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ChittyOS-Caller": "chittyagent-dispatch",
      },
      body: JSON.stringify({ repo: "CHITTYOS/chittyentity", title: "x", idempotency_key: "t1" }),
    });
    expect(res.status).toBe(403);
    expect(createIssueWithGitHubApp).not.toHaveBeenCalled();
  });

  it("allows the authenticated dispatch principal", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/github/issues",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ChittyOS-Caller": "chittyagent-dispatch",
        },
        body: JSON.stringify({
          repo: "CHITTYOS/chittyentity",
          title: "Follow up",
          idempotency_key: "task-1",
        }),
      },
      {
        GITHUB_BROKER_ALLOWED_CALLERS: "chittyagent-dispatch",
      },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      issue_number: 17,
      deduplicated: false,
    });
    expect(createIssueWithGitHubApp).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ idempotency_key: "task-1" }),
      "chittyagent-dispatch",
    );
  });
});
