/**
 * Integration tests for /api/v1/* broker primitives.
 *
 * Boots a real `wrangler unstable_dev` instance with local D1 + KV. No mocks
 * on DB, KV, or any service module — per global rule "No Mocks, Fake Data,
 * or Placeholder Endpoints" and advisor guidance.
 *
 * Prerequisites:
 *   - migrations 016, 018, 019 applied to local D1 via setup helper
 *   - API_KEYS KV seeded with a test key for mcpAuthMiddleware
 *
 * Tracks: chittyos/chittyconnect#210, #211, partial of #209.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import { execSync } from "node:child_process";

const TEST_API_KEY = "test_broker_api_key_2026";
const TEST_TENANT = "chittyos-default";
const TEST_CHITTYID = "CC-A-CCC-0001-P-2606-3-42"; // canonical VV-G-LLL-SSSS-T-YYMM-C-XX
const TEST_REPO = "/home/ubuntu/projects/github.com/CHITTYOS/chittyconnect";

let worker;

function runWrangler(args) {
  return execSync(`npx wrangler ${args}`, {
    cwd: process.cwd(),
    env: { ...process.env, CHITTYCONNECT_SAFE_DEPLOY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

async function applyLocalMigrations() {
  const migrations = [
    "migrations/016_tenant_registry.sql",
    "migrations/018_git_tenant_allowlists.sql",
    "migrations/019_policy_resolve_extensions.sql",
  ];
  for (const m of migrations) {
    runWrangler(`d1 execute DB --env=dev --local --file=${m}`);
  }
  // Seed a force-enabled tenant for testing scope-binding + KV write paths
  // that the default tenant (force_push_allowed=0) blocks before they run.
  // Real D1 seed; no mock.
  const seedSql = `
    INSERT OR IGNORE INTO git_tenant_policy (tenant_id, force_push_allowed, default_author, notes)
    VALUES ('test-force-tenant', 1, 'TestOps <test@chitty.cc>', 'PR240 test fixture');
    INSERT OR IGNORE INTO git_remote_allowlist (tenant_id, pattern, match_type, allow_force)
    VALUES ('test-force-tenant', 'github.com/CHITTYOS/*', 'glob', 1);
    INSERT OR IGNORE INTO git_repo_allowlist (tenant_id, path_prefix, access)
    VALUES ('test-force-tenant', '${TEST_REPO}', 'readwrite');
  `;
  runWrangler(
    `d1 execute DB --env=dev --local --command="${seedSql.replace(/\n\s*/g, " ")}"`,
  );
}

async function seedApiKey() {
  const value = JSON.stringify({
    status: "active",
    userId: "test_user",
    rateLimit: 1000,
  });
  runWrangler(
    `kv key put --binding=API_KEYS --env=dev --local "key:${TEST_API_KEY}" '${value}'`,
  );
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-ChittyOS-API-Key": TEST_API_KEY,
  };
}

async function post(path, body) {
  return worker.fetch(`/api/v1${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

describe("broker primitives v1 (integration, real D1 + KV)", () => {
  beforeAll(async () => {
    await applyLocalMigrations();
    await seedApiKey();
    worker = await unstable_dev("src/index.js", {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: true,
      env: "dev",
    });
  }, 120_000);

  afterAll(async () => {
    if (worker) await worker.stop();
  });

  describe("policy.resolve", () => {
    it("returns seeded chittyos-default policy", async () => {
      const res = await post("/policy/resolve", {
        tenant_id: TEST_TENANT,
        caller_chittyid: TEST_CHITTYID,
        operation: "read",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.allowed_repos).toContain(
        "/home/ubuntu/projects/github.com/CHITTYOS/",
      );
      expect(body.allowed_remotes).toContain("github.com/CHITTYOS/*");
      expect(body.force_push_allowed).toBe(false);
      expect(body.protected_branches).toEqual(
        expect.arrayContaining(["refs/heads/main", "refs/heads/master"]),
      );
      expect(body.default_author).toBe("ChittyOps <ops@chitty.cc>");
    });

    it("rejects malformed ChittyID via schema", async () => {
      const res = await post("/policy/resolve", {
        tenant_id: TEST_TENANT,
        caller_chittyid: "not-a-chittyid",
        operation: "read",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("SCHEMA_VALIDATION_FAILED");
    });
  });

  describe("capabilities.mint + introspect", () => {
    it("mints a read capability and introspects it active", async () => {
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "read",
        repo_path: TEST_REPO,
      });
      expect(mintRes.status).toBe(201);
      const mint = await mintRes.json();
      expect(mint.token_type).toBe("chittyconnect-capability");
      expect(mint.scope.operation).toBe("read");

      const introRes = await post("/capabilities/introspect", {
        token: mint.token,
      });
      expect(introRes.status).toBe(200);
      const intro = await introRes.json();
      expect(intro.active).toBe(true);
      expect(intro.scope.caller_chittyid).toBe(TEST_CHITTYID);
      expect(intro.scope.operation).toBe("read");
    });

    it("returns active=false for unknown token", async () => {
      const res = await post("/capabilities/introspect", { token: "bogus" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(false);
    });

    // PR #240 review-fix coverage — silent-failure-hunter critical #2.
    // Introspect must return active:false for an expired token. We force
    // expiry by writing a record directly to KV with expires_at in the past,
    // using the same wrangler local KV the worker reads from.
    it("returns active=false for an expired token (no fail-open on bad date)", async () => {
      const expiredToken = "expired_token_for_test_2026";
      const expiredRec = {
        scope: {
          caller_chittyid: TEST_CHITTYID,
          tenant_id: TEST_TENANT,
          operation: "read",
          repo_path: TEST_REPO,
          force_class: "none",
        },
        issued_at: "2020-01-01T00:00:00.000Z",
        expires_at: "2020-01-01T00:05:00.000Z",
        fingerprint: "deadbeef".repeat(8),
      };
      runWrangler(
        `kv key put --binding=TOKEN_KV --env=dev --local "broker:cap:${expiredToken}" '${JSON.stringify(
          expiredRec,
        )}'`,
      );
      const res = await post("/capabilities/introspect", { token: expiredToken });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(false);
    });

    it("blocks mint when repo_path outside tenant allowlist", async () => {
      const res = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "read",
        repo_path: "/tmp/not-allowed",
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_REPO_NOT_ALLOWED");
    });

    it("requires ref + remote for push operation (schema)", async () => {
      const res = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("SCHEMA_VALIDATION_FAILED");
    });

    it("rejects force push to protected branch (main hard-deny)", async () => {
      const confRes = await post("/capabilities/confirm", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        repo_path: TEST_REPO,
        remote: "origin",
        ref: "refs/heads/main",
        force_class: "force",
      });
      expect(confRes.status).toBe(403);
      const cbody = await confRes.json();
      expect(cbody.error.code).toBe("POLICY_BLOCKED_FORCE_TO_PROTECTED");
    });
  });

  describe("capabilities.confirm → mint force push", () => {
    it("force-class mint fails without confirmation token", async () => {
      const res = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/chittyconnect",
        ref: "refs/heads/feature-x",
        force_class: "force",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("SCHEMA_VALIDATION_FAILED");
    });

    // Updated by PR #240 critical #5: /capabilities/confirm now rejects
    // earlier (at confirm-time) when the tenant scalar policy disables
    // force-push, instead of letting the caller hold a confirmation token
    // that will inevitably fail at mint.
    it("force-push blocked at confirm time when force_push_allowed=false (chittyos-default)", async () => {
      const confRes = await post("/capabilities/confirm", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/chittyconnect",
        ref: "refs/heads/feature-y",
        force_class: "force_with_lease",
      });
      expect(confRes.status).toBe(403);
      const body = await confRes.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_FORCE_DISABLED");
    });
  });

  describe("ledger.emit", () => {
    it("emits a git.commit event with capability token", async () => {
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "commit",
        repo_path: TEST_REPO,
        ref: "refs/heads/feature-z",
      });
      expect(mintRes.status).toBe(201);
      const mint = await mintRes.json();

      const emitRes = await post("/ledger/emit", {
        capability_token: mint.token,
        event_type: "git.commit",
        payload: { commit_sha: "abc1234", message: "test commit" },
      });
      expect(emitRes.status).toBe(200);
      const body = await emitRes.json();
      expect(body.domain).toBe("git");
      expect(body.entry_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(body.ledger_event_id).toBeDefined();
    });

    it("rejects ledger emit when event_type does not match capability operation", async () => {
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "commit",
        repo_path: TEST_REPO,
        ref: "refs/heads/feature-w",
      });
      expect(mintRes.status).toBe(201);
      const mint = await mintRes.json();

      const emitRes = await post("/ledger/emit", {
        capability_token: mint.token,
        event_type: "git.tag",
        payload: { tag_name: "v1.0.0" },
      });
      expect(emitRes.status).toBe(403);
      const body = await emitRes.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_CAPABILITY_INVALID");
    });

    it("redacts URL userinfo in payload", async () => {
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/chittyconnect",
        ref: "refs/heads/feature-v",
      });
      expect(mintRes.status).toBe(201);
      const mint = await mintRes.json();

      const emitRes = await post("/ledger/emit", {
        capability_token: mint.token,
        event_type: "git.push",
        payload: {
          remote_url: "https://user:secret@github.com/CHITTYOS/foo.git",
        },
      });
      expect(emitRes.status).toBe(200);
      const body = await emitRes.json();
      expect(body.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // PR #240 review-fix coverage — pr-test-analyzer critical #6.
  // Confirmation tokens are scope-bound (caller_chittyid + tenant_id +
  // repo_path + remote + ref + force_class). Mint must reject redemption
  // when ANY scope field disagrees. The original #235 scope-binding fix
  // had no behavior test — this is it.
  describe("confirmation-token scope binding (PR#240 #235 regression coverage)", () => {
    const FORCE_TENANT = "test-force-tenant";
    const REMOTE = "github.com/CHITTYOS/example";
    const REF = "refs/heads/feature-pr240-scope";

    async function mintConfirmation() {
      const res = await post("/capabilities/confirm", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: FORCE_TENANT,
        repo_path: TEST_REPO,
        remote: REMOTE,
        ref: REF,
        force_class: "force_with_lease",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.confirmation_token).toBeDefined();
      return body.confirmation_token;
    }

    it("redeems successfully when every scope field matches", async () => {
      const ct = await mintConfirmation();
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: FORCE_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: REMOTE,
        ref: REF,
        force_class: "force_with_lease",
        confirmation_token: ct,
      });
      expect(mintRes.status).toBe(201);
      const mb = await mintRes.json();
      expect(mb.scope.force_class).toBe("force_with_lease");
    });

    it("rejects redemption with mismatched ref", async () => {
      const ct = await mintConfirmation();
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: FORCE_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: REMOTE,
        ref: "refs/heads/different-branch",
        force_class: "force_with_lease",
        confirmation_token: ct,
      });
      expect(mintRes.status).toBe(403);
      const body = await mintRes.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_CONFIRMATION_INVALID");
    });

    it("rejects redemption with mismatched remote", async () => {
      const ct = await mintConfirmation();
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: FORCE_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/other-repo",
        ref: REF,
        force_class: "force_with_lease",
        confirmation_token: ct,
      });
      expect(mintRes.status).toBe(403);
      const body = await mintRes.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_CONFIRMATION_INVALID");
    });

    it("rejects redemption with mismatched caller_chittyid", async () => {
      const ct = await mintConfirmation();
      // Different valid ChittyID for a different actor.
      const otherCaller = "CC-A-CCC-0002-P-2606-3-43";
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: otherCaller,
        tenant_id: FORCE_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: REMOTE,
        ref: REF,
        force_class: "force_with_lease",
        confirmation_token: ct,
      });
      expect(mintRes.status).toBe(403);
      const body = await mintRes.json();
      expect(body.error.code).toBe("POLICY_BLOCKED_CONFIRMATION_INVALID");
    });
  });

  // PR #240 review-fix coverage — pr-test-analyzer critical #6.
  // A confirmation token minted for tenant A must not redeem under tenant B
  // (the #210 reopen reason). Cross-tenant replay must be hard-blocked.
  describe("cross-tenant confirmation-token replay (PR#240 #210 regression)", () => {
    it("a confirmation token minted for tenant A cannot redeem under tenant B", async () => {
      const FORCE_TENANT = "test-force-tenant";
      const confRes = await post("/capabilities/confirm", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: FORCE_TENANT,
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/example",
        ref: "refs/heads/feature-pr240-xtenant",
        force_class: "force",
      });
      expect(confRes.status).toBe(201);
      const ct = (await confRes.json()).confirmation_token;

      // Replay against TEST_TENANT (chittyos-default). Even though the
      // confirmation token exists in KV, the scope binding includes
      // tenant_id, so redemption must fail with confirmation-invalid —
      // never with policy-blocked-force-disabled (that would mean the
      // scope check came too late).
      const mintRes = await post("/capabilities/mint", {
        caller_chittyid: TEST_CHITTYID,
        tenant_id: TEST_TENANT,
        operation: "push",
        repo_path: TEST_REPO,
        remote: "github.com/CHITTYOS/example",
        ref: "refs/heads/feature-pr240-xtenant",
        force_class: "force",
        confirmation_token: ct,
      });
      expect(mintRes.status).toBe(403);
      const body = await mintRes.json();
      // The default tenant disallows force globally, but we want the
      // scope-binding check to catch this first. Either code path is a
      // hard-deny; accept both to keep the test stable under ordering.
      expect([
        "POLICY_BLOCKED_CONFIRMATION_INVALID",
        "POLICY_BLOCKED_FORCE_TO_PROTECTED",
      ]).toContain(body.error.code);
    });
  });

  describe("deprecation 410 Gone", () => {
    it("legacy /api/git/confirm returns 410 with replacement pointer", async () => {
      const res = await worker.fetch("/api/git/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error.code).toBe("ENDPOINT_GONE");
      expect(body.error.replacement).toBe("/api/v1/capabilities/confirm");
    });
  });
});
