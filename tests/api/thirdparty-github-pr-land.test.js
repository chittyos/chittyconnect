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

function makeEnv() {
  const keys = new Map([
    [
      `key:${SERVICE_KEY}`,
      JSON.stringify({
        status: "active",
        service: "chittyagent-autoassist",
        rateLimit: 1000,
      }),
    ],
  ]);
  return {
    API_KEYS: { get: async (k) => keys.get(k) ?? null },
    GITHUB_TOKEN: "gh-token-fixture",
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
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(path, { method = "GET", body, key = SERVICE_KEY } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-ChittyOS-API-Key"] = key;
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
      "Bearer gh-token-fixture",
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
