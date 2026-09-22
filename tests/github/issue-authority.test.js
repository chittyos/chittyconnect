import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/github.js", () => ({
  generateAppJWT: vi.fn(async () => "app.jwt"),
  getInstallationToken: vi.fn(async () => ({
    token: "installation-token",
    permissions: { issues: "write" },
  })),
}));

import { createIssueWithGitHubApp } from "../../src/github/issue-authority.js";
import { generateAppJWT, getInstallationToken } from "../../src/auth/github.js";

class MockKV {
  constructor() {
    this.store = new Map();
  }
  async get(key, type) {
    const value = this.store.get(key);
    if (value == null) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
}

describe("GitHub issue authority", () => {
  let originalFetch;
  let env;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    env = {
      TOKEN_KV: new MockKV(),
      GITHUB_APP_ID: "123",
      GITHUB_APP_PK: "pem",
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates one issue with a repository-scoped App token and deduplicates replay", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            account: { login: "CHITTYOS" },
            permissions: { issues: "write", metadata: "read" },
            suspended_at: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 88,
            html_url: "https://github.com/CHITTYOS/chittyentity/issues/88",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );

    const input = {
      repo: "CHITTYOS/chittyentity",
      title: "Follow up on routed session signal",
      body: "Non-legal operational follow-up",
      labels: ["automation"],
      idempotency_key: "task-123",
    };

    const first = await createIssueWithGitHubApp(env, input, "chittyagent-dispatch");
    expect(first).toMatchObject({
      ok: true,
      status: 201,
      deduplicated: false,
      issue_number: 88,
    });
    expect(generateAppJWT).toHaveBeenCalledWith("123", "pem");
    expect(getInstallationToken).toHaveBeenCalledWith(
      42,
      "app.jwt",
      { repositories: ["chittyentity"], permissions: { issues: "write" } },
    );

    const callsAfterFirst = globalThis.fetch.mock.calls.length;
    const second = await createIssueWithGitHubApp(env, input, "chittyagent-dispatch");
    expect(second).toMatchObject({
      ok: true,
      status: 200,
      deduplicated: true,
      issue_number: 88,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("fails closed for repositories outside the allowlist", async () => {
    globalThis.fetch = vi.fn();
    const result = await createIssueWithGitHubApp(
      env,
      {
        repo: "untrusted/example",
        title: "x",
        idempotency_key: "task-1",
      },
      "chittyagent-dispatch",
    );
    expect(result).toMatchObject({ ok: false, status: 403, code: "ORG_NOT_ALLOWED" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses to write without the idempotency store", async () => {
    globalThis.fetch = vi.fn();
    const result = await createIssueWithGitHubApp(
      { GITHUB_APP_ID: "123", GITHUB_APP_PK: "pem" },
      {
        repo: "CHITTYOS/chittyentity",
        title: "x",
        idempotency_key: "task-1",
      },
      "chittyagent-dispatch",
    );
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "IDEMPOTENCY_STORE_UNAVAILABLE",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses an installation without Issues write permission", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 42,
          account: { login: "CHITTYOS" },
          permissions: { issues: "read" },
          suspended_at: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await createIssueWithGitHubApp(
      env,
      {
        repo: "CHITTYOS/chittyentity",
        title: "x",
        idempotency_key: "task-1",
      },
      "chittyagent-dispatch",
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "ISSUES_WRITE_NOT_GRANTED",
    });
    expect(getInstallationToken).not.toHaveBeenCalled();
  });
});
