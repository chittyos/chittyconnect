import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { agentRuntimeRoutes } from "../../src/api/routes/agent-runtime.js";

function appWith(keyInfo, env) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("apiKey", keyInfo);
    await next();
  });
  app.route("/", agentRuntimeRoutes);
  return { app, env };
}

function secretBinding(value = "mint-secret") {
  return { get: vi.fn(async () => value) };
}

describe("agent runtime broker", () => {
  it("mints agents:read and returns sanitized dispatch inventory", async () => {
    const mint = vi.fn(async (scope, secret, ttl) => {
      expect(scope).toBe("agents:read");
      expect(secret).toBe("mint-secret");
      expect(ttl).toBe(300);
      return { token: "short-lived-read", expiresAt: new Date(Date.now() + 300000) };
    });
    const dispatchFetch = vi.fn(async (request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer short-lived-read");
      return new Response(
        JSON.stringify({
          success: true,
          runtime: "anthropic-managed",
          agents: [{ id: "agent_gov", version: 4, name: "ChittyGov", metadata: {} }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const { app, env } = appWith(
      { status: "active" },
      {
        CHITTYAUTH: { mint },
        CHITTYAUTH_MINT_SECRET: secretBinding(),
        SVC_AGENT_DISPATCH: { fetch: dispatchFetch },
      },
    );

    const response = await app.request("/anthropic/agents", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      agents: [{ id: "agent_gov" }],
    });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(dispatchFetch).toHaveBeenCalledTimes(1);
  });

  it("requires admin authority before any projection token is minted", async () => {
    const mint = vi.fn();
    const { app, env } = appWith(
      { status: "active", scopes: ["read"] },
      {
        CHITTYAUTH: { mint },
        CHITTYAUTH_MINT_SECRET: secretBinding(),
        SVC_AGENT_DISPATCH: { fetch: vi.fn() },
      },
    );

    const response = await app.request(
      "/anthropic/project",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: {
            canonicalAgentId: "chittygov",
            name: "ChittyGov",
            model: { id: "claude-opus-5-5" },
          },
        }),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(mint).not.toHaveBeenCalled();
  });

  it("mints agents:write and privately forwards a valid projection", async () => {
    const mint = vi.fn(async (scope) => {
      expect(scope).toBe("agents:write");
      return { token: "short-lived-write", expiresAt: new Date(Date.now() + 300000) };
    });
    const dispatchFetch = vi.fn(async (request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer short-lived-write");
      expect(request.method).toBe("POST");
      const body = await request.json();
      expect(body.spec.canonicalAgentId).toBe("chittyaudit");
      expect(body.target.deploymentRef).toBe("agent_existing");
      return new Response(
        JSON.stringify({
          success: true,
          operation: "updated",
          projection: {
            canonicalAgentId: "chittyaudit",
            deploymentRef: "agent_existing",
            version: "6",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const { app, env } = appWith(
      { status: "active", role: "admin" },
      {
        CHITTYAUTH: { mint },
        CHITTYAUTH_MINT_SECRET: secretBinding(),
        SVC_AGENT_DISPATCH: { fetch: dispatchFetch },
      },
    );

    const response = await app.request(
      "/anthropic/project",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: {
            canonicalAgentId: "chittyaudit",
            name: "ChittyAudit",
            model: { id: "claude-opus-5-5" },
          },
          target: { deploymentRef: "agent_existing" },
        }),
      },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      operation: "updated",
    });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("fails closed before dispatch when mint secret is unavailable", async () => {
    const dispatchFetch = vi.fn();
    const { app, env } = appWith(
      { status: "active" },
      {
        CHITTYAUTH: { mint: vi.fn() },
        CHITTYAUTH_MINT_SECRET: secretBinding(""),
        SVC_AGENT_DISPATCH: { fetch: dispatchFetch },
      },
    );

    const response = await app.request("/anthropic/agents", {}, env);
    expect(response.status).toBe(503);
    expect(dispatchFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "POLICY_BLOCKED_CHITTYAUTH_MINT_SECRET_UNAVAILABLE",
    });
  });
});
