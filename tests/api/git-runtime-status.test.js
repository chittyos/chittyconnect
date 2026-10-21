import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { gitRuntimeStatusRoutes } from "../../src/api/routes/git-runtime-status.js";

function app() {
  const h = new Hono();
  h.route("/api/v1/git/runtime", gitRuntimeStatusRoutes);
  return h;
}

describe("git runtime status", () => {
  it("fails closed without GitHub App/signing/ledger authority", async () => {
    const res = await app().fetch(
      new Request("https://internal/api/v1/git/runtime/status"),
      {},
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.github_app_auth).toBe("unverified");
    expect(body.secrets_broker_bound).toBe(false);
    expect(body.ledger_binding_bound).toBe(false);
    expect(body.signing_key_custody).toBe("unverified");
    expect(body.capability_surface).toBe("spec_only");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/ghs_|ghp_|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY/);
  });
});
