
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
  if (!parsed.ok) return error(c, parsed.error, 400);

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

gitBrokerRoutes.post("/capabilities/introspect", async (c) => {
  if (!c.env.TOKEN_KV || typeof c.env.TOKEN_KV.get !== "function") {
    return c.json({ active: false }, 503);
  }

  const body = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "token") ||
    typeof body.token !== "string" ||
    !body.token.startsWith("cap_")
  ) {
    return c.json({ active: false });
  }

  const raw = await c.env.TOKEN_KV.get(await tokenStorageKey(body.token));
  if (!raw) return c.json({ active: false });

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return c.json({ active: false });
  }

  if (
    typeof record.expires_at_epoch !== "number" ||
    record.expires_at_epoch <= Math.floor(Date.now() / 1000) ||
    !record.scope
  ) {
    return c.json({ active: false });
  }

  return c.json({
    active: true,
    expires_at: new Date(record.expires_at_epoch * 1000).toISOString(),
    scope: record.scope,
  });
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
