import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { githubMergeRoutes } from "../../src/api/routes/github-merge.js";

/**
 * Exercises the real route handler end-to-end through Hono's request
 * pipeline. The only thing stubbed is the GitHub HTTP boundary (global
 * fetch) — no live API calls, no mocking of internal service modules.
 * The App private key is a real RS256 PKCS#8 key generated per-suite so
 * generateAppJWT() runs for real.
 */

const SECRET = "internal-secret-abc123";

let appPkPem;

function makeApp(envOverrides = {}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.env = {
      INTERNAL_WEBHOOK_SECRET: SECRET,
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PK: appPkPem,
      TOKEN_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
      ...envOverrides,
    };
    await next();
  });
  app.route("/integrations/github", githubMergeRoutes);
  return app;
}

function req(body, headers = {}) {
  return new Request("http://local/integrations/github/merge-pr", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // Generate a real RS256 PKCS#8 key so generateAppJWT works for real.
  const { generateKeyPair, exportPKCS8 } = await import("jose");
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  appPkPem = await exportPKCS8(privateKey);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /integrations/github/merge-pr — auth", () => {
  it("rejects when internal secret header is missing", async () => {
    const app = makeApp();
    const res = await app.request(
      req({ repo: "CHITTYOS/x", pr_number: 1 }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.merged).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects when internal secret is wrong", async () => {
    const app = makeApp();
    const res = await app.request(
      req({ repo: "CHITTYOS/x", pr_number: 1 }, { "X-Webhook-Secret": "nope" }),
    );
    expect(res.status).toBe(401);
  });

  it("fails closed when INTERNAL_WEBHOOK_SECRET is unset", async () => {
    const app = makeApp({ INTERNAL_WEBHOOK_SECRET: undefined });
    const res = await app.request(
      req({ repo: "CHITTYOS/x", pr_number: 1 }, { "X-Webhook-Secret": SECRET }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("POLICY_BLOCKED_INTERNAL_SECRET_UNSET");
  });
});

describe("POST /integrations/github/merge-pr — validation", () => {
  it("rejects missing repo", async () => {
    const app = makeApp();
    const res = await app.request(
      req({ pr_number: 1 }, { "X-Webhook-Secret": SECRET }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("rejects invalid merge_method", async () => {
    const app = makeApp();
    const res = await app.request(
      req(
        { repo: "CHITTYOS/x", pr_number: 1, merge_method: "fast-forward" },
        { "X-Webhook-Secret": SECRET },
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_MERGE_METHOD");
  });
});

describe("POST /integrations/github/merge-pr — merge execution", () => {
  /**
   * Stub the GitHub HTTP boundary. Routes the three GitHub calls:
   *  - GET .../installation   -> { id }
   *  - POST .../access_tokens -> { token, expires_at }
   *  - PUT  .../merge         -> caller-supplied mergeResult
   *  - GET  .../pulls/{n}     -> caller-supplied prResult (idempotency check)
   */
  function stubGitHub({ mergeStatus, mergeJson, prStatus, prJson, captureMerge }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/installation")) {
        return new Response(JSON.stringify({ id: 99 }), { status: 200 });
      }
      if (u.endsWith("/access_tokens")) {
        return new Response(
          JSON.stringify({
            token: "ghs_test",
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 201 },
        );
      }
      if (u.endsWith("/merge") && init?.method === "PUT") {
        if (captureMerge) captureMerge(JSON.parse(init.body));
        return new Response(JSON.stringify(mergeJson), {
          status: mergeStatus,
        });
      }
      // GET PR (idempotency / TOCTOU check)
      return new Response(JSON.stringify(prJson ?? {}), {
        status: prStatus ?? 200,
      });
    });
  }

  it("merges with squash default and passes expected_head_sha as TOCTOU guard", async () => {
    let mergeBody;
    stubGitHub({
      mergeStatus: 200,
      mergeJson: { merged: true, sha: "mergesha", message: "Pull Request successfully merged" },
      captureMerge: (b) => (mergeBody = b),
    });
    const app = makeApp();
    const res = await app.request(
      req(
        { repo: "CHITTYOS/x", pr_number: 7, expected_head_sha: "headsha123" },
        { "X-Webhook-Secret": SECRET },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ merged: true, sha: "mergesha" });
    expect(mergeBody).toEqual({ merge_method: "squash", sha: "headsha123" });
  });

  it("returns merged:true idempotently when GitHub 405s but PR is already merged", async () => {
    stubGitHub({
      mergeStatus: 405,
      mergeJson: { message: "Pull Request is not mergeable" },
      prStatus: 200,
      prJson: { merged: true, merge_commit_sha: "already" },
    });
    const app = makeApp();
    const res = await app.request(
      req({ repo: "CHITTYOS/x", pr_number: 7 }, { "X-Webhook-Secret": SECRET }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ merged: true, sha: "already" });
  });

  it("surfaces failure (not merged:true) when 405 and PR is NOT merged", async () => {
    stubGitHub({
      mergeStatus: 405,
      mergeJson: { message: "Pull Request is not mergeable" },
      prStatus: 200,
      prJson: { merged: false },
    });
    const app = makeApp();
    const res = await app.request(
      req({ repo: "CHITTYOS/x", pr_number: 7 }, { "X-Webhook-Secret": SECRET }),
    );
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.merged).toBe(false);
    expect(body.error.code).toBe("NOT_MERGEABLE");
  });

  it("surfaces 409 when head moved (TOCTOU guard tripped) and PR not merged", async () => {
    stubGitHub({
      mergeStatus: 409,
      mergeJson: { message: "Head branch was modified. Review and try the merge again." },
      prStatus: 200,
      prJson: { merged: false },
    });
    const app = makeApp();
    const res = await app.request(
      req(
        { repo: "CHITTYOS/x", pr_number: 7, expected_head_sha: "stale" },
        { "X-Webhook-Secret": SECRET },
      ),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.merged).toBe(false);
    expect(body.error.code).toBe("HEAD_MOVED_OR_NOT_MERGEABLE");
  });
});
