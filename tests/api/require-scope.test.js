/**
 * Scope enforcement middleware — behavioural tests.
 *
 * These mount the real middleware on a real Hono app and dispatch real
 * Requests through it, asserting on real Responses. Nothing is mocked: the
 * middleware's only input is the `apiKey` context value that `authenticate`
 * sets, so a preceding middleware that sets it exactly as `authenticate` does
 * is the genuine article, not a stand-in.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  requireScope,
  requireScopeFrom,
  revealScopeFor,
  REVEAL_SCOPE_PREFIX,
} from "../../src/api/middleware/require-scope.js";

const VALID_VAULTS = ["infrastructure", "services", "integrations"];

/**
 * Build an app whose first middleware seeds `apiKey` the same way
 * `authenticate` does, then guards a route that would return credential
 * material. `keyInfo` of `null` models a route reached with no key set.
 */
function appWithKey(keyInfo, guard) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (keyInfo !== null) c.set("apiKey", keyInfo);
    await next();
  });
  app.get("/:vault/:item/:field", guard, (c) =>
    c.json({ success: true, value: "REVEALED" }),
  );
  app.get("/twilio-style", guard, (c) =>
    c.json({ success: true, value: "REVEALED" }),
  );
  return app;
}

const vaultGuard = requireScopeFrom((c) => {
  const vault = c.req.param("vault");
  return VALID_VAULTS.includes(vault) ? revealScopeFor(vault) : undefined;
});

describe("revealScopeFor", () => {
  it("namespaces scopes under the reveal prefix", () => {
    expect(revealScopeFor("infrastructure")).toBe(
      "credentials:reveal:infrastructure",
    );
    expect(REVEAL_SCOPE_PREFIX).toBe("credentials:reveal");
  });
});

describe("requireScopeFrom — vault-derived reveal guard", () => {
  it("allows a key carrying the matching per-vault scope", async () => {
    const app = appWithKey(
      { status: "active", scopes: ["credentials:reveal:infrastructure"] },
      vaultGuard,
    );

    const res = await app.request("/infrastructure/neon/connection_url");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, value: "REVEALED" });
  });

  it("denies a key whose scope is for a different vault", async () => {
    const app = appWithKey(
      { status: "active", scopes: ["credentials:reveal:integrations"] },
      vaultGuard,
    );

    const res = await app.request("/infrastructure/neon/connection_url");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    // The 403 must name the scope so an under-provisioned caller can be
    // reissued without reading the source.
    expect(body.error.required).toBe("credentials:reveal:infrastructure");
    expect(JSON.stringify(body)).not.toContain("REVEALED");
  });

  it("denies a legacy key record with no scopes field at all", async () => {
    const app = appWithKey({ status: "active" }, vaultGuard);

    const res = await app.request("/services/chittyid/service_token");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("denies a key with an empty scopes array", async () => {
    const app = appWithKey({ status: "active", scopes: [] }, vaultGuard);

    const res = await app.request("/services/chittyid/service_token");

    expect(res.status).toBe(403);
  });

  it("denies a key whose scopes field is not an array", async () => {
    const app = appWithKey(
      { status: "active", scopes: "credentials:reveal:services" },
      vaultGuard,
    );

    const res = await app.request("/services/chittyid/service_token");

    expect(res.status).toBe(403);
  });

  it("does not let an MCP scope satisfy a credential-reveal check", async () => {
    // mcp:admin is the broadest scope in the MCP OAuth vocabulary. It must not
    // grant credential reveal by vocabulary coincidence.
    const app = appWithKey(
      { status: "active", scopes: ["mcp:read", "mcp:write", "mcp:admin"] },
      vaultGuard,
    );

    const res = await app.request("/infrastructure/neon/connection_url");

    expect(res.status).toBe(403);
    expect((await res.json()).error.required).toBe(
      "credentials:reveal:infrastructure",
    );
  });

  it("denies an unrecognised vault rather than guessing a scope", async () => {
    const app = appWithKey(
      { status: "active", scopes: ["credentials:reveal:infrastructure"] },
      vaultGuard,
    );

    const res = await app.request("/etc-passwd/root/shadow");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SCOPE_UNRESOLVABLE");
  });

  it("denies when no key was set on the context", async () => {
    const app = appWithKey(null, vaultGuard);

    const res = await app.request("/infrastructure/neon/connection_url");

    expect(res.status).toBe(403);
  });
});

describe("credentials routes — real wiring", () => {
  /**
   * Mounts the actual route module behind a shim that seeds `apiKey` exactly
   * as `authenticate` does. No env bindings are supplied on purpose: the
   * handlers need a credential broker and a DB, so if any of these requests
   * reached a handler it would throw rather than 403. A clean 403 is therefore
   * positive evidence the guard short-circuits ahead of the handler.
   */
  async function mountReal(keyInfo) {
    // Named export, mounted the same way src/api/router.js:178 mounts it.
    const { credentialsRoutes } = await import(
      "../../src/api/routes/credentials.js"
    );
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("apiKey", keyInfo);
      await next();
    });
    app.route("/api/credentials", credentialsRoutes);
    return app;
  }

  const unscoped = [
    ["legacy record with no scopes field", { status: "active" }],
    ["mcp:admin only", { status: "active", scopes: ["mcp:admin"] }],
    [
      "reveal scope for a different vault",
      { status: "active", scopes: ["credentials:reveal:services"] },
    ],
  ];

  it.each(unscoped)(
    "GET /:vault/:item/:field is gated against %s",
    async (_label, keyInfo) => {
      const app = await mountReal(keyInfo);

      const res = await app.request(
        "/api/credentials/infrastructure/neon/connection_url",
      );
      const body = await res.text();

      expect(res.status).toBe(403);
      expect(body).toContain("INSUFFICIENT_SCOPE");
      expect(body).toContain("credentials:reveal:infrastructure");
    },
  );

  it.each([
    ["legacy record with no scopes field", { status: "active" }],
    ["mcp:admin only", { status: "active", scopes: ["mcp:admin"] }],
  ])("GET /twilio is gated against %s", async (_label, keyInfo) => {
    const app = await mountReal(keyInfo);

    const res = await app.request("/api/credentials/twilio");
    const body = await res.text();

    expect(res.status).toBe(403);
    expect(body).toContain("credentials:reveal:integrations");
    // The Twilio payload field names must not appear in a denial.
    expect(body).not.toContain("accountSid");
    expect(body).not.toContain("authToken");
  });
});

describe("requireScope — fixed-scope guard (twilio route shape)", () => {
  const guard = requireScope(revealScopeFor("integrations"));

  it("allows a key carrying the integrations reveal scope", async () => {
    const app = appWithKey(
      { status: "active", scopes: ["credentials:reveal:integrations"] },
      guard,
    );

    const res = await app.request("/twilio-style");

    expect(res.status).toBe(200);
  });

  it("denies a key without it and never leaks the payload", async () => {
    const app = appWithKey(
      { status: "active", scopes: ["credentials:reveal:services"] },
      guard,
    );

    const res = await app.request("/twilio-style");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.required).toBe("credentials:reveal:integrations");
    expect(JSON.stringify(body)).not.toContain("REVEALED");
  });
});
