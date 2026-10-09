import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { authenticate } from "../../src/api/middleware/auth.js";
import { thirdpartyRoutes } from "../../src/api/routes/thirdparty.js";

// The PR-land proxy used by chittyagent-autoassist's pr_land_v1 loop.
// Only GitHub's HTTP is stubbed, at the fetch boundary. Auth runs through the
// real `authenticate` middleware with an in-memory API_KEYS store, mounted the
// same way src/api/router.js mounts it (`/api/*` -> authenticate).

const SERVICE_KEY = "svc-key-autoassist-fixture";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", authenticate);
  app.route("/api/thirdparty", thirdpartyRoutes);
  return app;
}

// API_KEYS records, keyed by the raw key. github_actions / github_repos are
// the scoping fields the GitHub proxy guard reads (fail closed without them).
const KEY_RECORDS = {
  [SERVICE_KEY]: {
    service: "chittyagent-autoassist",
    github_actions: ["read", "write", "merge"],
    github_repos: ["chittyos/*"],
  },
  "svc-key-other-service-fixture": {
    service: "chittyagent-other",
    github_actions: ["read"],
    github_repos: ["chittyos/*"],
  },
  "svc-key-other-repo-fixture": {
    service: "chittyagent-autoassist",
    github_actions: ["read", "write", "merge"],
    github_repos: ["chittyos/chittyconnect", "chittyapps/*"],
  },
  "svc-key-unscoped-fixture": { service: "chittyagent-legacy" },
  "svc-key-contents-owner-fixture": {
    service: "chittyagent-autoassist",
    github_actions: ["read"],
    github_repos: ["o/contents", "contents/r"],
  },
};

// OAuth grants the in-memory OAUTH_PROVIDER binding resolves (as /mcp would).
const OAUTH_GRANTS = {
  "oauth-grant-no-github-fixture": { userId: "u1", scope: ["mcp:read"] },
  "oauth-grant-github-read-fixture": {
    userId: "u2",
    scope: ["mcp:read", "github:read"],
  },
};

function makeEnv() {
  const keys = new Map(
    Object.entries(KEY_RECORDS).map(([k, v]) => [
      `key:${k}`,
      JSON.stringify({ status: "active", rateLimit: 1000, ...v }),
    ]),
  );
  return {
    API_KEYS: { get: async (k) => keys.get(k) ?? null },
    OAUTH_PROVIDER: {
      unwrapToken: async (t) => OAUTH_GRANTS[t] ?? null,
    },
    GITHUB_TOKEN: "test-fixture-not-a-credential-gh",
  };
}

let githubCalls;
let githubReply;

beforeEach(() => {
  githubCalls = [];
  githubReply = { status: 200, body: {} };
  vi.stubGlobal("fetch", async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("https://api.github.com/")) {
      // Anything else (e.g. the credential broker) is unreachable in tests;
      // getCredential then serves the GITHUB_TOKEN binding.
      throw new Error(`unreachable in test: ${url}`);
    }
    githubCalls.push({ url, init });
    return new Response(JSON.stringify(githubReply.body), {
      status: githubReply.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...githubReply.headers,
      },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(path, { method = "GET", body, key = SERVICE_KEY, bearer } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key && !bearer) headers["X-ChittyOS-API-Key"] = key;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return buildApp().fetch(
    new Request(`https://internal${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    makeEnv(),
  );
}

const ROUTES = [
  {
    name: "GET pulls/:n",
    path: "/api/thirdparty/github/repos/chittyos/chittyentity/pulls/754",
    method: "GET",
    upstream: "https://api.github.com/repos/chittyos/chittyentity/pulls/754",
  },
  {
    name: "GET commits/:sha/check-runs",
    path: `/api/thirdparty/github/repos/chittyos/chittyentity/commits/${HEAD}/check-runs`,
    method: "GET",
    upstream: `https://api.github.com/repos/chittyos/chittyentity/commits/${HEAD}/check-runs`,
  },
  {
    name: "GET commits/:sha/status",
    path: `/api/thirdparty/github/repos/chittyos/chittyentity/commits/${HEAD}/status`,
    method: "GET",
    upstream: `https://api.github.com/repos/chittyos/chittyentity/commits/${HEAD}/status`,
  },
  {
    name: "GET contents/*",
    path: "/api/thirdparty/github/repos/chittyos/chittyentity/contents/.gate/review.json?ref=feat%2Fx",
    method: "GET",
    upstream:
      "https://api.github.com/repos/chittyos/chittyentity/contents/.gate/review.json?ref=feat%2Fx",
  },
  {
    name: "PUT contents/*",
    path: "/api/thirdparty/github/repos/chittyos/chittyentity/contents/.gate/review.json",
    method: "PUT",
    body: { message: "chore(gate): attest", content: "e30=", branch: "feat/x" },
    upstream:
      "https://api.github.com/repos/chittyos/chittyentity/contents/.gate/review.json",
  },
  {
    name: "PUT pulls/:n/merge",
    path: "/api/thirdparty/github/repos/chittyos/chittyentity/pulls/754/merge",
    method: "PUT",
    body: { merge_method: "squash", sha: HEAD },
    upstream:
      "https://api.github.com/repos/chittyos/chittyentity/pulls/754/merge",
  },
];

describe.each(ROUTES)("$name", (route) => {
  it("proxies a success with GitHub's body and status", async () => {
    githubReply = { status: 200, body: { ok: true, number: 754 } };
    const res = await call(route.path, route);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, number: 754 });
    expect(githubCalls).toHaveLength(1);
    expect(githubCalls[0].url).toBe(route.upstream);
    expect(githubCalls[0].init.method).toBe(route.method);
    expect(githubCalls[0].init.headers.Authorization).toBe(
      "Bearer test-fixture-not-a-credential-gh",
    );
  });

  it("passes a 404 through as 404, not 500", async () => {
    githubReply = { status: 404, body: { message: "Not Found" } };
    const res = await call(route.path, route);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found" });
  });

  it("passes a 409 through as 409, not 500", async () => {
    githubReply = {
      status: 409,
      body: {
        message: "Head branch was modified. Review and try the merge again.",
      },
    };
    const res = await call(route.path, route);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/Head branch was modified/);
  });

  it("requires an API key", async () => {
    const res = await call(route.path, { ...route, key: null });
    expect(res.status).toBe(401);
    expect(githubCalls).toHaveLength(0);
  });

  it("rejects an unknown API key", async () => {
    const res = await call(route.path, { ...route, key: "not-a-key" });
    expect(res.status).toBe(401);
    expect(githubCalls).toHaveLength(0);
  });
});

describe("PUT pulls/:n/merge input", () => {
  const path =
    "/api/thirdparty/github/repos/chittyos/chittyentity/pulls/754/merge";

  it("forwards exactly {sha, merge_method} so GitHub enforces the head", async () => {
    githubReply = { status: 200, body: { merged: true, sha: "f".repeat(40) } };
    const res = await call(path, {
      method: "PUT",
      body: { merge_method: "squash", sha: HEAD, commit_title: "ignored" },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(githubCalls[0].init.body)).toEqual({
      sha: HEAD,
      merge_method: "squash",
    });
  });

  it.each([
    ["missing sha", { merge_method: "squash" }],
    ["short sha", { merge_method: "squash", sha: "abc1234" }],
    ["unknown merge_method", { merge_method: "fast-forward", sha: HEAD }],
  ])("rejects %s with 400 and never calls GitHub", async (_label, body) => {
    const res = await call(path, { method: "PUT", body });
    expect(res.status).toBe(400);
    expect(githubCalls).toHaveLength(0);
  });

  it("rejects a non-numeric pull number with 400", async () => {
    const res = await call(
      "/api/thirdparty/github/repos/chittyos/chittyentity/pulls/abc/merge",
      { method: "PUT", body: { sha: HEAD } },
    );
    expect(res.status).toBe(400);
    expect(githubCalls).toHaveLength(0);
  });
});

describe("GitHub token unavailable", () => {
  it("returns 503 without calling GitHub", async () => {
    const env = { ...makeEnv(), GITHUB_TOKEN: undefined };
    const res = await buildApp().fetch(
      new Request(
        "https://internal/api/thirdparty/github/repos/chittyos/chittyentity/pulls/754",
        { headers: { "X-ChittyOS-API-Key": SERVICE_KEY } },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(githubCalls).toHaveLength(0);
  });
});

describe("check-runs pagination", () => {
  const path = `/api/thirdparty/github/repos/chittyos/chittyentity/commits/${HEAD}/check-runs`;

  it("forwards per_page and page, the Link header, and each run's app", async () => {
    const link =
      '<https://api.github.com/repositories/1/commits/x/check-runs?per_page=2&page=2>; rel="next"';
    githubReply = {
      status: 200,
      headers: { Link: link },
      body: {
        total_count: 3,
        check_runs: [
          {
            name: "test",
            status: "completed",
            conclusion: "success",
            app: { id: 15368, slug: "github-actions" },
          },
          {
            name: "gate",
            status: "completed",
            conclusion: "success",
            app: { id: 99, slug: "chittyconnect" },
          },
        ],
      },
    };
    const res = await call(`${path}?per_page=2&page=1&ignored=x`);
    expect(res.status).toBe(200);
    expect(githubCalls[0].url).toBe(
      `https://api.github.com/repos/chittyos/chittyentity/commits/${HEAD}/check-runs?per_page=2&page=1`,
    );
    expect(res.headers.get("Link")).toBe(link);
    const body = await res.json();
    expect(body.check_runs.map((r) => r.app)).toEqual([
      { id: 15368, slug: "github-actions" },
      { id: 99, slug: "chittyconnect" },
    ]);
  });

  it("rejects a non-numeric per_page with 400", async () => {
    const res = await call(`${path}?per_page=all`);
    expect(res.status).toBe(400);
    expect(githubCalls).toHaveLength(0);
  });
});

describe("contents PUT response", () => {
  it("returns GitHub's full body including commit.sha and commit.parents", async () => {
    const upstream = {
      content: { path: ".gate/review.json", sha: "b".repeat(40) },
      commit: { sha: "c".repeat(40), parents: [{ sha: HEAD }] },
    };
    githubReply = { status: 201, body: upstream };
    const res = await call(
      "/api/thirdparty/github/repos/chittyos/chittyentity/contents/.gate/review.json",
      {
        method: "PUT",
        body: { message: "m", content: "e30=", branch: "feat/x" },
      },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(upstream);
  });
});

describe("path safety", () => {
  it.each([
    ["owner '..'", "/api/thirdparty/github/repos/../chittyentity/pulls/754"],
    [
      "owner with %",
      "/api/thirdparty/github/repos/a%2Fb/chittyentity/pulls/754",
    ],
    [
      "repo '..' (encoded)",
      "/api/thirdparty/github/repos/chittyos/%2e%2e/pulls/754",
    ],
    [
      "encoded '/' in a file segment",
      "/api/thirdparty/github/repos/chittyos/chittyentity/contents/a%2F..%2Fb",
    ],
  ])("rejects %s and never calls GitHub", async (_label, path) => {
    const res = await call(path);
    expect([400, 404]).toContain(res.status);
    expect(githubCalls).toHaveLength(0);
  });

  it("keeps an encoded '..' file segment inside the contents route", async () => {
    // `new Request` normalizes %2e%2e to `..`, so the route sees contents/b.
    // Safety property: the request stays under .../contents/ on the same repo
    // and can only reach GitHub's contents endpoint, never another route.
    githubReply = { status: 200, body: {} };
    const res = await call(
      "/api/thirdparty/github/repos/chittyos/chittyentity/contents/a/%2e%2e/b",
    );
    expect(res.status).toBe(200);
    expect(githubCalls).toHaveLength(1);
    expect(githubCalls[0].url).toBe(
      "https://api.github.com/repos/chittyos/chittyentity/contents/b",
    );
  });

  it("encodes each file path segment exactly once", async () => {
    githubReply = { status: 200, body: {} };
    const res = await call(
      "/api/thirdparty/github/repos/chittyos/.github/contents/docs/my%20file.md",
    );
    expect(res.status).toBe(200);
    expect(githubCalls[0].url).toBe(
      "https://api.github.com/repos/chittyos/.github/contents/docs/my%20file.md",
    );
  });
});

describe("per-caller authorization", () => {
  const READ = ROUTES.filter((r) => r.method === "GET");
  const merge = ROUTES.find((r) => r.name === "PUT pulls/:n/merge");
  const write = ROUTES.find((r) => r.name === "PUT contents/*");

  it("denies a merge to a key from another service (read-only scope)", async () => {
    const res = await call(merge.path, {
      ...merge,
      key: "svc-key-other-service-fixture",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("GITHUB_PROXY_FORBIDDEN");
    expect(githubCalls).toHaveLength(0);
  });

  it("denies a contents write to a key without write", async () => {
    const res = await call(write.path, {
      ...write,
      key: "svc-key-other-service-fixture",
    });
    expect(res.status).toBe(403);
    expect(githubCalls).toHaveLength(0);
  });

  it.each(ROUTES.map((r) => [r.name, r]))(
    "%s: denies a key whose repo allow-list excludes the repo",
    async (_n, route) => {
      const res = await call(route.path, {
        ...route,
        key: "svc-key-other-repo-fixture",
      });
      expect(res.status).toBe(403);
      expect(githubCalls).toHaveLength(0);
    },
  );

  it.each(ROUTES.map((r) => [r.name, r]))(
    "%s: denies a key with no github scoping fields (fail closed)",
    async (_n, route) => {
      const res = await call(route.path, {
        ...route,
        key: "svc-key-unscoped-fixture",
      });
      expect(res.status).toBe(403);
      expect(githubCalls).toHaveLength(0);
    },
  );

  it.each([merge, write].map((r) => [r.name, r]))(
    "%s: denies OAuth principals even with github:read",
    async (_n, route) => {
      const res = await call(route.path, {
        ...route,
        bearer: "oauth-grant-github-read-fixture",
      });
      expect(res.status).toBe(403);
      expect(githubCalls).toHaveLength(0);
    },
  );

  it.each(READ.map((r) => [r.name, r]))(
    "%s: denies an OAuth read without github:read",
    async (_n, route) => {
      const res = await call(route.path, {
        ...route,
        bearer: "oauth-grant-no-github-fixture",
      });
      expect(res.status).toBe(403);
      expect(githubCalls).toHaveLength(0);
    },
  );

  it.each(READ.map((r) => [r.name, r]))(
    "%s: allows an OAuth read with github:read",
    async (_n, route) => {
      const res = await call(route.path, {
        ...route,
        bearer: "oauth-grant-github-read-fixture",
      });
      expect(res.status).toBe(200);
      expect(githubCalls).toHaveLength(1);
    },
  );

  it("allows a read-scoped key from another service to read in its repos", async () => {
    const route = READ[0];
    const res = await call(route.path, {
      ...route,
      key: "svc-key-other-service-fixture",
    });
    expect(res.status).toBe(200);
    expect(githubCalls).toHaveLength(1);
  });

  it("allows a properly scoped key to merge, matching the repo case-insensitively", async () => {
    const res = await call(
      "/api/thirdparty/github/repos/ChittyOS/chittyentity/pulls/754/merge",
      { method: "PUT", body: { sha: HEAD } },
    );
    expect(res.status).toBe(200);
    expect(githubCalls).toHaveLength(1);
  });
});

describe("contents path when owner or repo is literally 'contents'", () => {
  it.each([
    [
      "repos/o/contents/contents/README.md",
      "https://api.github.com/repos/o/contents/contents/README.md",
    ],
    [
      "repos/contents/r/contents/x.md",
      "https://api.github.com/repos/contents/r/contents/x.md",
    ],
  ])("%s keeps the exact file path upstream", async (suffix, upstream) => {
    const res = await call(`/api/thirdparty/github/${suffix}`, {
      key: "svc-key-contents-owner-fixture",
    });
    expect(res.status).toBe(200);
    expect(githubCalls).toHaveLength(1);
    expect(githubCalls[0].url).toBe(upstream);
  });
});

describe("commit sha validation on check-runs and status", () => {
  it.each([
    "/api/thirdparty/github/repos/chittyos/chittyentity/commits/..%2F..%2Fx/status",
    "/api/thirdparty/github/repos/chittyos/chittyentity/commits/not-a-sha/check-runs",
    "/api/thirdparty/github/repos/chittyos/chittyentity/commits/not-a-sha/status",
  ])("rejects %s with 400 and never calls GitHub", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(400);
    expect(githubCalls).toHaveLength(0);
  });
});
