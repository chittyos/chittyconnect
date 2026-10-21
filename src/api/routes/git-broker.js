
import { Hono } from "hono";
import {
  resolvePolicy,
  resolveRemotePolicy,
  resolveRepoPolicy,
  validateMintBody,
  validPolicyRequest,
} from "../../git/broker-policy.js";

const gitBrokerRoutes = new Hono();
const CAPABILITY_TTL_SECONDS = 300;

function error(c, code, status = 400) {
  return c.json({ error: code }, status);
}

async function tokenStorageKey(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return "gitcap:" + hex;
}

gitBrokerRoutes.post("/capabilities/mint", async (c) => {
  if (!c.env.TOKEN_KV || typeof c.env.TOKEN_KV.put !== "function") {
    return error(c, "CAPABILITY_STORE_UNAVAILABLE", 503);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = validateMintBody(body);
  if (!parsed.ok) {
    return error(
      c,
      parsed.error,
      String(parsed.error).startsWith("POLICY_BLOCKED_") ? 403 : 400,
    );
  }

  const scope = parsed.value;
  const repoCheck = await resolveRepoPolicy(
    c.env,
    scope.tenant_id,
    scope.repo_path,
    scope.operation,
  );
  if (!repoCheck.allowed) {
    return error(
      c,
      repoCheck.reason,
      repoCheck.reason === "POLICY_BACKEND_UNAVAILABLE" ? 503 : 403,
    );
  }

  if (scope.operation === "push") {
    const remoteCheck = await resolveRemotePolicy(
      c.env,
      scope.tenant_id,
      scope.remote,
    );
    if (!remoteCheck.allowed) {
      return error(
        c,
        remoteCheck.reason,
        remoteCheck.reason === "POLICY_BACKEND_UNAVAILABLE" ? 503 : 403,
      );
    }
  }

  const token = "cap_" + crypto.randomUUID().replaceAll("-", "");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + CAPABILITY_TTL_SECONDS;

  await c.env.TOKEN_KV.put(
    await tokenStorageKey(token),
    JSON.stringify({
      scope,
      issued_at: now,
      expires_at_epoch: expiresAt,
    }),
    { expirationTtl: CAPABILITY_TTL_SECONDS },
  );

  return c.json({
    token,
    token_type: "chittyconnect-capability",
    expires_at: new Date(expiresAt * 1000).toISOString(),
    scope,
  });
});

export async function introspectGitCapability(env, token) {
  if (!env.TOKEN_KV || typeof env.TOKEN_KV.get !== "function") {
    return { active: false, backend_unavailable: true };
  }
  if (typeof token !== "string" || !token.startsWith("cap_")) {
    return { active: false };
  }

  const raw = await env.TOKEN_KV.get(await tokenStorageKey(token));
  if (!raw) return { active: false };

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { active: false };
  }

  if (
    typeof record.expires_at_epoch !== "number" ||
    record.expires_at_epoch <= Math.floor(Date.now() / 1000) ||
    !record.scope
  ) {
    return { active: false };
  }

  return {
    active: true,
    expires_at: new Date(record.expires_at_epoch * 1000).toISOString(),
    scope: record.scope,
  };
}

gitBrokerRoutes.post("/capabilities/introspect", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "token")
  ) {
    return c.json({ active: false });
  }

  const result = await introspectGitCapability(c.env, body.token);
  if (result.backend_unavailable) return c.json({ active: false }, 503);
  return c.json(result);
});

gitBrokerRoutes.post("/policy/resolve", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!validPolicyRequest(body)) {
    return error(c, "invalid_policy_request", 400);
  }

  const result = await resolvePolicy(c.env, body.tenant_id, body.operation);
  if (!result.ok) return error(c, result.reason, 503);
  return c.json(result.policy);
});

export { gitBrokerRoutes };
