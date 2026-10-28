import { Hono } from "hono";
import { resolveBindingValue } from "../../lib/credential-helper.js";

export const agentRuntimeRoutes = new Hono();

const TOKEN_TTL_SECONDS = 300;

function scopesFromKeyInfo(keyInfo) {
  if (Array.isArray(keyInfo?.scopes)) return keyInfo.scopes;
  if (typeof keyInfo?.scopes === "string") {
    return keyInfo.scopes.split(/\s+/).filter(Boolean);
  }
  return [];
}

function hasAdminAuthority(c) {
  const keyInfo = c.get("apiKey") || {};
  return keyInfo.role === "admin" || scopesFromKeyInfo(keyInfo).includes("admin");
}

async function mintRuntimeBearer(env, scope) {
  if (!env?.CHITTYAUTH || typeof env.CHITTYAUTH.mint !== "function") {
    throw new Error("POLICY_BLOCKED_CHITTYAUTH_BINDING_UNAVAILABLE");
  }

  const mintSecret = await resolveBindingValue(env.CHITTYAUTH_MINT_SECRET);
  if (!mintSecret) {
    throw new Error("POLICY_BLOCKED_CHITTYAUTH_MINT_SECRET_UNAVAILABLE");
  }

  const minted = await env.CHITTYAUTH.mint(scope, mintSecret, TOKEN_TTL_SECONDS);
  if (!minted || typeof minted.token !== "string" || minted.token.length === 0) {
    throw new Error("POLICY_BLOCKED_CHITTYAUTH_MINT_FAILED");
  }
  return minted.token;
}

async function dispatchFetch(env, path, { method = "GET", body, scope } = {}) {
  if (!env?.SVC_AGENT_DISPATCH || typeof env.SVC_AGENT_DISPATCH.fetch !== "function") {
    throw new Error("POLICY_BLOCKED_AGENT_DISPATCH_BINDING_UNAVAILABLE");
  }

  const token = await mintRuntimeBearer(env, scope);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");

  return env.SVC_AGENT_DISPATCH.fetch(
    new Request(`https://internal${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function proxyJson(c, response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      success: false,
      error: "AGENT_RUNTIME_NON_JSON_RESPONSE",
      status: response.status,
    };
  }
  return c.json(payload, response.status);
}

agentRuntimeRoutes.get("/anthropic/agents", async (c) => {
  try {
    const response = await dispatchFetch(
      c.env,
      "/api/v1/runtime/anthropic/agents",
      { scope: "agents:read" },
    );
    return proxyJson(c, response);
  } catch (error) {
    console.error("[agent-runtime] inventory failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      503,
    );
  }
});

agentRuntimeRoutes.post("/anthropic/project", async (c) => {
  if (!hasAdminAuthority(c)) {
    return c.json({ success: false, error: "admin scope required" }, 403);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "invalid JSON body" }, 400);
  }

  const spec = body?.spec;
  if (
    !spec ||
    typeof spec !== "object" ||
    typeof spec.canonicalAgentId !== "string" ||
    !spec.canonicalAgentId.trim() ||
    typeof spec.name !== "string" ||
    !spec.name.trim() ||
    spec.model == null
  ) {
    return c.json(
      {
        success: false,
        error: "spec.canonicalAgentId, spec.name, and spec.model are required",
      },
      400,
    );
  }

  if (
    body.target !== undefined &&
    (typeof body.target !== "object" ||
      body.target === null ||
      (body.target.deploymentRef !== undefined &&
        (typeof body.target.deploymentRef !== "string" ||
          !body.target.deploymentRef.trim())))
  ) {
    return c.json({ success: false, error: "invalid target" }, 400);
  }

  try {
    const response = await dispatchFetch(
      c.env,
      "/api/v1/runtime/anthropic/project",
      {
        method: "POST",
        body: {
          spec,
          ...(body.target !== undefined ? { target: body.target } : {}),
        },
        scope: "agents:write",
      },
    );
    return proxyJson(c, response);
  } catch (error) {
    console.error("[agent-runtime] projection failed", {
      canonicalAgentId: spec.canonicalAgentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      503,
    );
  }
});

export const _test = {
  hasAdminAuthority,
  mintRuntimeBearer,
  dispatchFetch,
};
