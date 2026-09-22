import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/github.js", () => ({
  generateAppJWT: vi.fn(async () => "app.jwt"),
  getInstallationToken: vi.fn(async () => ({
    token: "installation-token",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    permissions: { issues: "write" },
  })),
}));

import {
  createIssueWithGitHubApp,
  processIdempotentIssueCreate,
} from "../../src/github/issue-authority.js";
import { GitHubIssueIdempotency } from "../../src/durable-objects/GitHubIssueIdempotency.js";
import {
  generateAppJWT,
  getInstallationToken,
} from "../../src/auth/github.js";

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

class MockStorage {
  constructor() {
    this.store = new Map();
    this.failDonePutOnce = false;
  }

  async get(key) {
    return this.store.get(key);
  }

  async put(key, value) {
    if (
      this.failDonePutOnce &&
      key === "operation" &&
      value?.status === "done"
    ) {
      this.failDonePutOnce = false;
      throw new Error("simulated durable receipt write failure");
    }
    this.store.set(key, value);
  }
}

function operation(overrides = {}) {
  return {
    repo: "CHITTYOS/chittyentity",
    owner: "CHITTYOS",
    repository: "chittyentity",
    title: "Follow up on queue routing",
    body: "Non-legal operational follow-up.",
    labels: ["automation"],
    assignees: [],
    idempotency_key: "task-123",
    digest: "a".repeat(64),
    request_hash: "b".repeat(64),
    ...overrides,
  };
}

function actor(env, storage = new MockStorage()) {
  return {
    instance: new GitHubIssueIdempotency({ storage }, env),
    storage,
  };
}

function makeEnv() {
  return {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PK: "pem",
    TOKEN_KV: new MockKV(),
  };
}

function installResponse(status = 200, overrides = {}) {
  return new Response(
    JSON.stringify({
      id: 42,
      account: { login: "CHITTYOS" },
      permissions: { issues: "write", metadata: "read" },
      suspended_at: null,
      ...overrides,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function issueResponse(issue, status = 201) {
  return new Response(JSON.stringify(issue), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHub issue authority", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("serializes concurrent duplicate writes through one Durable Object instance", async () => {
    const env = makeEnv();
    const { instance } = actor(env);
    let createCalls = 0;

    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith("/installation")) return installResponse();
      if (u.includes("/issues?")) return Response.json([]);
      if (u.endsWith("/issues") && init.method === "POST") {
        createCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        const body = JSON.parse(init.body);
        return issueResponse({
          number: 88,
          html_url: "https://github.com/CHITTYOS/chittyentity/issues/88",
          body: body.body,
          created_at: new Date().toISOString(),
        });
      }
      throw new Error(`unexpected GitHub request: ${u}`);
    });

    const request = () =>
      instance.fetch(
        new Request("https://internal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation()),
        }),
      );

    const [first, second] = await Promise.all([request(), request()]);
    const [a, b] = await Promise.all([first.json(), second.json()]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(createCalls).toBe(1);
    expect(getInstallationToken).toHaveBeenCalledTimes(1);
  });

  it("recovers a committed GitHub issue when durable receipt persistence fails", async () => {
    const env = makeEnv();
    const storage = new MockStorage();
    storage.failDonePutOnce = true;
    const { instance } = actor(env, storage);

    const createdIssues = [];
    let createCalls = 0;

    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url);
      if (u.endsWith("/installation")) return installResponse();
      if (u.includes("/issues?")) return Response.json(createdIssues);
      if (u.endsWith("/issues") && init.method === "POST") {
        createCalls += 1;
        const body = JSON.parse(init.body);
        const issue = {
          number: 91,
          html_url: "https://github.com/CHITTYOS/chittyentity/issues/91",
          body: body.body,
          created_at: new Date().toISOString(),
        };
        createdIssues.push(issue);
        return issueResponse(issue);
      }
      throw new Error(`unexpected GitHub request: ${u}`);
    });

    const first = await instance.fetch(
      new Request("https://internal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation()),
      }),
    );
    const firstBody = await first.json();

    expect(firstBody).toMatchObject({
      ok: true,
      receipt_persisted: false,
      deduplicated: false,
      issue_number: 91,
    });

    const second = await instance.fetch(
      new Request("https://internal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation()),
      }),
    );
    const secondBody = await second.json();

    expect(secondBody).toMatchObject({
      ok: true,
      receipt_persisted: true,
      deduplicated: true,
      recovered: true,
      issue_number: 91,
    });
    expect(createCalls).toBe(1);
    expect(getInstallationToken).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency-key reuse with a different payload", async () => {
    const env = makeEnv();
    const storage = new MockStorage();
    await storage.put("operation", {
      status: "creating",
      request_hash: "existing-hash",
      repo: "CHITTYOS/chittyentity",
      started_at: new Date().toISOString(),
    });

    const result = await processIdempotentIssueCreate(
      storage,
      env,
      operation({ request_hash: "different-hash" }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      retryable: false,
    });
  });

  it("marks transient installation lookup failures retryable", async () => {
    const env = makeEnv();
    const { instance } = actor(env);

    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith("/installation")) {
        return new Response(JSON.stringify({ message: "temporary outage" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected GitHub request: ${u}`);
    });

    const response = await instance.fetch(
      new Request("https://internal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation()),
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      ok: false,
      status: 503,
      retryable: true,
      code: "GITHUB_INSTALLATION_RETRYABLE",
    });
    expect(getInstallationToken).not.toHaveBeenCalled();
  });

  it("uses the private idempotency actor binding instead of a public write route", async () => {
    const stubFetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.repo).toBe("CHITTYOS/chittyentity");
      expect(body.digest).toHaveLength(64);
      expect(body.request_hash).toHaveLength(64);
      return Response.json({
        ok: true,
        status: 201,
        issue_number: 44,
        issue_url: "https://github.com/CHITTYOS/chittyentity/issues/44",
        idempotency_receipt: body.digest,
      });
    });
    const namespace = {
      idFromName: vi.fn((name) => name),
      get: vi.fn(() => ({ fetch: stubFetch })),
    };
    const env = {
      ...makeEnv(),
      GITHUB_ISSUE_IDEMPOTENCY: namespace,
    };

    const result = await createIssueWithGitHubApp(env, {
      repo: "CHITTYOS/chittyentity",
      title: "Follow up",
      body: "Operational follow-up",
      idempotency_key: "task-44",
    });

    expect(result).toMatchObject({
      ok: true,
      status: 201,
      issue_number: 44,
    });
    expect(namespace.idFromName).toHaveBeenCalledTimes(1);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("fails closed for a repository outside the trusted organization set", async () => {
    const env = {
      ...makeEnv(),
      GITHUB_ISSUE_IDEMPOTENCY: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    };

    const result = await createIssueWithGitHubApp(env, {
      repo: "untrusted/example",
      title: "x",
      idempotency_key: "task-1",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "ORG_NOT_ALLOWED",
    });
    expect(env.GITHUB_ISSUE_IDEMPOTENCY.idFromName).not.toHaveBeenCalled();
    expect(generateAppJWT).not.toHaveBeenCalled();
  });
});
