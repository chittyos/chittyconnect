import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { executeRoutes, credentialDestinationAllowed } from "../../src/api/routes/execute.js";
import { authenticate } from "../../src/api/middleware/auth.js";

// Exercise the actual Hono handler and real credential-broker resolver. The
// provider transport is intercepted with a test-only synthetic response;
// no real GitHub/Google/Notion credentials or external requests are used.
const app = new Hono();
app.use("/execute/*", authenticate);
app.route("/execute", executeRoutes);
const testEnv = {
  // Real API-key middleware is used; only its KV-backed test fixture is synthetic.
  API_KEYS: { get: async () => JSON.stringify({ status: "active", role: "admin", scopes: ["admin"] }) },
  CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
  GITHUB_TOKEN: "synthetic-test-only-github-token",
  NOTION_TOKEN: "synthetic-test-only-notion-token",
  GOOGLE_ACCESS_TOKEN: "synthetic-test-only-google-token",
};

const req = (payload, env = testEnv) => app.request(
  "http://localhost/execute/fetch",
  { method: "POST", headers: { "Content-Type": "application/json", "X-ChittyOS-API-Key": "synthetic-admin-key" }, body: JSON.stringify(payload) },
  env,
);

afterEach(() => { vi.restoreAllMocks(); });

describe("provider-owned credential destination policy", () => {
  it("allows exact HTTPS origins only", () => {
    expect(credentialDestinationAllowed("github", "https://api.github.com/repos/org/repo")).toBe(true);
    expect(credentialDestinationAllowed("notion", "https://api.notion.com/v1/pages")).toBe(true);
    expect(credentialDestinationAllowed("google", "https://sheets.googleapis.com/v4/spreadsheets")).toBe(true);
    expect(credentialDestinationAllowed("google", "https://gmail.googleapis.com/gmail/v1/users/me/messages")).toBe(true);
    for (const dest of [
      "https://example.invalid/collect",
      "https://api.github.com.example.invalid/collect",
      "http://api.github.com/repos/test",
      "https://user:pass@api.github.com/repos/test",
      "https://api.github.com:8443/repos/test",
      "https://api.github.com.evil.invalid",
      "https://api.github.com./repos/test",
      "https://127.0.0.1/",
    ]) {
      expect(credentialDestinationAllowed("github", dest)).toBe(false);
    }
    expect(credentialDestinationAllowed("github", "https://api.notion.com/")).toBe(false);
    expect(credentialDestinationAllowed("notion", "https://api.github.com/")).toBe(false);
    expect(credentialDestinationAllowed("__proto__", "https://api.github.com/")).toBe(false);
    expect(credentialDestinationAllowed("toString", "https://api.github.com/")).toBe(false);
    expect(credentialDestinationAllowed({}, "https://api.github.com/")).toBe(false);
  });

  it("permits operator allowlist only to narrow provider-owned hosts", () => {
    expect(credentialDestinationAllowed("github", "https://api.github.com/", "")).toBe(true);
    expect(credentialDestinationAllowed("github", "https://api.github.com/", "api.github.com")).toBe(true);
    expect(credentialDestinationAllowed("github", "https://api.github.com/", "example.invalid")).toBe(false);
    expect(credentialDestinationAllowed("github", "https://example.invalid/", "example.invalid")).toBe(false);
    expect(credentialDestinationAllowed("google", "https://www.googleapis.com/", "api.github.com")).toBe(false);
  });

  it("denies exfiltration attempts before calling the credential broker or fetch", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    let brokerRead = 0;
    const env = {
      API_KEYS: testEnv.API_KEYS,
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      GITHUB_TOKEN: { get: async () => { brokerRead++; return "synthetic-only-secret"; } },
    };
    for (const destination of [
      "https://attacker.invalid/receive",
      "http://api.github.com",
      "https://api.github.com.evil.invalid/path",
      "https://api.github.com:8443/path",
    ]) {
      const response = await req({ url: destination, credential: "github" }, env);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/credential destination/);
    }
    expect(brokerRead).toBe(0);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("uses exactly one broker-managed Authorization header and prevents redirect following", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const response = await req({
      url: "https://api.github.com/repos/owner/project",
      credential: "github",
      headers: { authorization: "Bearer caller-injected-token", "x-custom": "ok" },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/project");
    expect(init.redirect).toBe("manual");
    expect(init.headers.get("authorization")).toBe("Bearer synthetic-test-only-github-token");
    expect(init.headers.get("x-custom")).toBe("ok");
    expect([...init.headers.keys()].filter(h => h.toLowerCase() === "authorization")).toHaveLength(1);
  });

  it("does not send a credential to a redirect destination", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 302, headers: { Location: "https://attacker.invalid/collect" } }),
    );
    const response = await req({ url: "https://api.github.com/", credential: "github" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe(302);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][1].redirect).toBe("manual");
  });

  it("denies unknown aliases and unavailable credentials without fetching", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    for (const alias of ["toString", "__proto__", "no-such-provider"]) {
      const response = await req({ url: "https://api.github.com/", credential: alias });
      expect(response.status).toBe(400);
    }
    const missing = await req({ url: "https://api.github.com/", credential: "github" }, {
      API_KEYS: testEnv.API_KEYS,
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
    });
    expect(missing.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("denies ordinary authenticated API keys before broker credential access", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    let credentialReads = 0;
    const env = {
      ...testEnv,
      API_KEYS: { get: async () => JSON.stringify({ status: "active", role: "reader", scopes: ["read"] }) },
      GITHUB_TOKEN: { get: async () => { credentialReads++; return "must-not-be-issued"; } },
    };
    const response = await req({ url: "https://api.github.com/", credential: "github" }, env);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/admin scope required/);
    expect(credentialReads).toBe(0);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("respects an explicit operator host restriction even on a provider-owned URL", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    const denied = await req({ url: "https://api.github.com/", credential: "github" }, {
      ...testEnv, FETCH_ALLOWED_HOSTS: "api.notion.com",
    });
    expect(denied.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
