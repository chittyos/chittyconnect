/**
 * Identity policy-bundle route tests.
 *
 * Hits the real route + real vendored bundle JSON. No mocks.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { identityRoutes } from "../../src/api/routes/identity.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/v1/identity", identityRoutes);
  return app;
}

const VALID_ID = "03-1-USA-5537-P-2602-0-38";
const INVALID_ID = "not-a-chittyid";

describe("GET /api/v1/identity/:chittyId/policy-bundle", () => {
  it("returns the real bundle with sha256 + ETag for a valid P-typed ChittyID", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/identity/${VALID_ID}/policy-bundle`);
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag");
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);

    const body = await res.json();
    expect(body.chittyId).toBe(VALID_ID);
    expect(body.version).toBe("v1");
    expect(body.scope).toBe("system-wide");
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.bundle.contract.name).toBe(
      "system-wide-sensitive-intent-contract-v1.md",
    );
    expect(body.bundle.policy.name).toBe(
      "system-wide-sensitive-intent-policy-v1.json",
    );
    // Real content present, not a stub
    expect(body.bundle.contract.content.length).toBeGreaterThan(100);
    const policy = JSON.parse(body.bundle.policy.content);
    expect(policy.forbidden_behaviors).toBeTruthy();
    expect(policy.error_taxonomy).toBeTruthy();
  });

  it("returns 304 when If-None-Match matches the bundle ETag", async () => {
    const app = makeApp();
    const first = await app.request(`/api/v1/identity/${VALID_ID}/policy-bundle`);
    const etag = first.headers.get("ETag");
    const second = await app.request(
      `/api/v1/identity/${VALID_ID}/policy-bundle`,
      { headers: { "If-None-Match": etag } },
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
  });

  it("validates ChittyID format (P/L/T/E/A) and rejects malformed input", async () => {
    const app = makeApp();
    const res = await app.request(
      `/api/v1/identity/${INVALID_ID}/policy-bundle`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_CHITTYID");
  });

  it("accepts all five canonical entity types (P/L/T/E/A)", async () => {
    const app = makeApp();
    for (const t of ["P", "L", "T", "E", "A"]) {
      const id = `03-1-USA-5537-${t}-2602-0-38`;
      const res = await app.request(`/api/v1/identity/${id}/policy-bundle`);
      expect(res.status, `type ${t}`).toBe(200);
    }
  });
});

describe("GET /api/v1/identity/:chittyId/policy-bundle/check", () => {
  it("returns version + sha256 without the full bundle", async () => {
    const app = makeApp();
    const res = await app.request(
      `/api/v1/identity/${VALID_ID}/policy-bundle/check`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bundle).toBeUndefined();
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.version).toBe("v1");
  });

  it("returns 304 on ETag match", async () => {
    const app = makeApp();
    const first = await app.request(
      `/api/v1/identity/${VALID_ID}/policy-bundle/check`,
    );
    const etag = first.headers.get("ETag");
    const second = await app.request(
      `/api/v1/identity/${VALID_ID}/policy-bundle/check`,
      { headers: { "If-None-Match": etag } },
    );
    expect(second.status).toBe(304);
  });
});
