/**
 * Regression test for the /api/secrets/:name broker route auth gap.
 *
 * chittyos/chittyconnect had a route — GET /api/secrets/:name — that returns
 * a brokered credential in plaintext ({ ok, name, value }). It was intended
 * to be gated by the same guard as /api/v1/secrets/*, but the app.use() only
 * matched the /api/v1/ prefix, so /api/secrets/* (no /v1/) was reachable
 * with zero authentication.
 *
 * The full src/index.js worker can't be imported in this (plain Node)
 * vitest environment — it transitively pulls in `cloudflare:*` runtime
 * built-ins (Durable Objects, Sentry-for-Cloudflare) that only exist inside
 * workerd. So this test builds a minimal Hono app that wires the routes
 * under test EXACTLY as src/index.js does — same imports, same guard
 * factory, same authenticate() — and only differs by omitting the
 * ecosystem/Sentry/DO scaffolding that isn't part of what we changed. This
 * exercises the real production auth code path (makeApiSecretsGuard ->
 * authenticate against the API_KEYS KV binding); the only stand-in is a
 * fake KV namespace for API_KEYS, the standard way to exercise a Workers
 * binding outside workerd — not a mock of business logic.
 *
 * Per the sensitive-intent contract, no secret VALUE is ever asserted or
 * logged here — only HTTP status codes.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authenticate } from "../../src/api/middleware/auth.js";
import { makeApiSecretsGuard } from "../../src/auth/secrets-portal-guard.js";

const VALID_KEY = "chitty_test_only_not_a_real_credential";

// Mirrors src/index.js's BROKERED_SECRETS set and its
// GET /api/secrets/:name handler verbatim (see src/index.js).
const BROKERED_SECRETS = new Set(["ONEPASSWORD_CONNECT_TOKEN"]);

function buildApp({ mountBrokerGuard }) {
  const app = new Hono();

  app.use("/api/v1/secrets/*", makeApiSecretsGuard(authenticate));
  if (mountBrokerGuard) {
    // The line this PR adds to src/index.js.
    app.use("/api/secrets/*", makeApiSecretsGuard(authenticate));
  }

  app.get("/api/secrets/:name", async (c) => {
    const { name } = c.req.param();
    if (!BROKERED_SECRETS.has(name)) {
      return c.json({ ok: false, error: "Secret not brokered", name }, 404);
    }
    const value = c.env[name];
    if (!value) {
      return c.json({ ok: false, error: "Secret not configured", name }, 503);
    }
    return c.json({ ok: true, name, value });
  });

  return app;
}

/** Minimal in-memory stand-in for the API_KEYS KV namespace. */
function fakeApiKeysKv() {
  const store = new Map([
    [
      `key:${VALID_KEY}`,
      JSON.stringify({
        status: "active",
        name: "test-caller",
        userId: "test-user",
        scopes: ["mcp:read"],
        rateLimit: 1000,
      }),
    ],
  ]);
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
  };
}

function baseEnv() {
  return {
    API_KEYS: fakeApiKeysKv(),
    // One brokered name, populated, so an authenticated request has
    // something real to resolve. Test-only placeholder value.
    ONEPASSWORD_CONNECT_TOKEN: "test-only-placeholder-value",
  };
}

function req(path, headers = {}) {
  return new Request(`https://connect.chitty.cc${path}`, { headers });
}

describe("GET /api/secrets/:name auth guard (fixed: guard mounted)", () => {
  const app = buildApp({ mountBrokerGuard: true });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await app.fetch(
      req("/api/secrets/ONEPASSWORD_CONNECT_TOKEN"),
      baseEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a request bearing an invalid/unknown key with 401", async () => {
    const res = await app.fetch(
      req("/api/secrets/ONEPASSWORD_CONNECT_TOKEN", {
        Authorization: "Bearer not-a-registered-key",
      }),
      baseEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("allows a correctly-authenticated request through (status only, never body)", async () => {
    const res = await app.fetch(
      req("/api/secrets/ONEPASSWORD_CONNECT_TOKEN", {
        Authorization: `Bearer ${VALID_KEY}`,
      }),
      baseEnv(),
    );
    // Status-only assertion: the guard let it through and the real handler
    // ran. We never read/log the JSON body, which would contain the value.
    expect(res.status).toBe(200);
  });

  it("still 404s a non-brokered name even when authenticated", async () => {
    const res = await app.fetch(
      req("/api/secrets/NOT_A_BROKERED_SECRET", {
        Authorization: `Bearer ${VALID_KEY}`,
      }),
      baseEnv(),
    );
    expect(res.status).toBe(404);
  });
});

describe("mutation check: guard omitted reproduces the original vulnerability", () => {
  it("an unauthenticated request succeeds (200) when the guard is NOT mounted", async () => {
    const app = buildApp({ mountBrokerGuard: false });
    const res = await app.fetch(
      req("/api/secrets/ONEPASSWORD_CONNECT_TOKEN"),
      baseEnv(),
    );
    // This is the exact pre-fix production behavior: 200 with no auth.
    // It proves the "guard mounted" tests above would have caught the bug.
    expect(res.status).toBe(200);
  });
});
