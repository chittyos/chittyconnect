/**
 * ChittyConnect Git capability control plane.
 *
 * Implements the executable subset of CHARTER "Git Broker Surface":
 *   POST /api/v1/capabilities/mint
 *   POST /api/v1/capabilities/introspect
 *
 * Capability tokens are opaque, single-operation, short-TTL references. They
 * never embed GitHub credentials or signing material.
 */

import { Hono } from "hono";
import { authenticate } from "../middleware/auth.js";
import { githubOIDCMiddleware } from "../../auth/github-oidc.js";

const capabilityRoutes = new Hono();

const CAP_TTL_SECONDS = 300;
const OPS = new Set(["read", "commit", "tag", "push"]);
const FORCE_CLASSES = new Set(["none", "force", "force_with_lease"]);
const CHITTY_ID_RE =
  /^[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]{3}-[A-Z0-9]{4}-[PLTEA]-[0-9]{4}-[0-5]-[0-9]{2}$/;

capabilityRoutes.use(
  "*",
  githubOIDCMiddleware({ audience: "https://connect.chitty.cc" }),
);

// OIDC is accepted only on this narrowly mounted control-plane route. Existing
// API-key auth remains valid for operators/services.
capabilityRoutes.use("*", async (c, next) => {
  if (c.get("auth")?.type === "github_oidc") {
    await next();
    return;
  }
  return authenticate(c, next);
});

function error(c, status, code, message) {
  return c.json({ error: { code, message } }, status);
}

function randomCapabilityToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const opaque = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `cap_${opaque}`;
}

function capabilityKey(token) {
  return `git:cap:${token}`;
}

function normalizeRepoPath(input) {
  if (
    typeof input !== "string" ||
    !input.startsWith("/") ||
    input.includes("\0") ||
    input.split("/").includes("..")
  ) {
    return null;
  }
  return input.replace(/\/+/g, "/").replace(/\/$/, "");
}

function accessAllows(access, operation) {
  if (operation === "read") {
    return access === "read" || access === "readwrite";
  }
  return access === "write" || access === "readwrite";
}

async function repoAllowed(env, tenantId, repoPath, operation) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return { allowed: false, reason: "POLICY_BACKEND_UNAVAILABLE" };
  }

  const query = env.DB.prepare(
    "SELECT path_prefix, access FROM git_repo_allowlist WHERE tenant_id = ?",
  ).bind(tenantId);
  const result = await query.all();
  const rows = result?.results || [];

  const match = rows.find((row) => {
    const prefix = normalizeRepoPath(row.path_prefix);
    if (!prefix || !accessAllows(row.access, operation)) return false;
    return repoPath === prefix || repoPath.startsWith(`${prefix}/`);
  });

  return match
    ? { allowed: true, policy: { path_prefix: match.path_prefix, access: match.access } }
    : { allowed: false, reason: "POLICY_BLOCKED_REPO_NOT_ALLOWED" };
}

function authenticatedTenantAllowed(c, tenantId) {
  const oidc = c.get("auth");
  if (oidc?.type === "github_oidc") {
    const owner = String(oidc.repositoryOwner || "").toLowerCase();
    if (!owner) return false;
    return tenantId === `${owner}-default`;
  }

  const key = c.get("apiKey") || {};
  const declaredTenant = key.tenant_id || key.tenantId;
  return !declaredTenant || declaredTenant === tenantId;
}

function publicScope(record) {
  return {
    caller_chittyid: record.caller_chittyid,
    tenant_id: record.tenant_id,
    operation: record.operation,
    repo_path: record.repo_path,
    remote: record.remote ?? null,
    ref: record.ref ?? null,
    force_class: record.force_class,
  };
}

capabilityRoutes.post("/mint", async (c) => {
  if (!c.env.TOKEN_KV || typeof c.env.TOKEN_KV.put !== "function") {
    return error(c, 503, "CAPABILITY_STORE_UNAVAILABLE", "TOKEN_KV is unavailable");
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return error(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const allowedKeys = new Set([
    "caller_chittyid",
    "tenant_id",
    "operation",
    "repo_path",
    "remote",
    "ref",
    "force_class",
    "confirmation_token",
  ]);
  const unexpected = Object.keys(body || {}).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    return error(
      c,
      400,
      "UNEXPECTED_FIELDS",
      `Unexpected fields: ${unexpected.join(", ")}`,
    );
  }

  const {
    caller_chittyid,
    tenant_id,
    operation,
    repo_path,
    remote,
    ref,
    force_class = "none",
    confirmation_token,
  } = body || {};

  if (!CHITTY_ID_RE.test(String(caller_chittyid || ""))) {
    return error(c, 400, "INVALID_CALLER_CHITTYID", "caller_chittyid is not canonical");
  }
  if (
    typeof tenant_id !== "string" ||
    tenant_id.length < 1 ||
    tenant_id.length > 128
  ) {
    return error(c, 400, "INVALID_TENANT", "tenant_id is required");
  }
  if (!OPS.has(operation)) {
    return error(c, 400, "INVALID_OPERATION", "operation must be read, commit, tag, or push");
  }
  if (!FORCE_CLASSES.has(force_class)) {
    return error(c, 400, "INVALID_FORCE_CLASS", "force_class is invalid");
  }
  if (!authenticatedTenantAllowed(c, tenant_id)) {
    return error(c, 403, "TENANT_SCOPE_MISMATCH", "Authenticated principal cannot mint for this tenant");
  }

  const normalizedPath = normalizeRepoPath(repo_path);
  if (!normalizedPath) {
    return error(c, 400, "INVALID_REPO_PATH", "repo_path must be a normalized absolute path");
  }

  if (operation !== "read" && (typeof ref !== "string" || !ref.startsWith("refs/"))) {
    return error(c, 400, "CONCRETE_REF_REQUIRED", "commit, tag, and push require a concrete refs/* ref");
  }
  if (operation === "push" && (typeof remote !== "string" || remote.length === 0)) {
    return error(c, 400, "REMOTE_REQUIRED", "push requires a remote name");
  }

  // The existing /api/git/confirm contract predates the current caller+tenant
  // binding requirement. Do not weaken the new contract by accepting it here.
  if (force_class !== "none") {
    return error(
      c,
      403,
      "POLICY_BLOCKED_CONFIRMATION_REQUIRED",
      confirmation_token
        ? "Force confirmation contract is not yet reconciled to caller+tenant scope"
        : "Force operations require a reconciled confirmation token",
    );
  }

  const policy = await repoAllowed(c.env, tenant_id, normalizedPath, operation);
  if (!policy.allowed) {
    return error(c, policy.reason === "POLICY_BACKEND_UNAVAILABLE" ? 503 : 403, policy.reason, "Repository scope is not allowed");
  }

  const token = randomCapabilityToken();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CAP_TTL_SECONDS * 1000);

  const auth = c.get("auth");
  const keyInfo = c.get("apiKey") || {};
  const record = {
    caller_chittyid,
    tenant_id,
    operation,
    repo_path: normalizedPath,
    remote: operation === "push" ? remote : null,
    ref: operation === "read" ? null : ref,
    force_class,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    authenticated_principal:
      auth?.type === "github_oidc"
        ? `github:${auth.repository || "unknown"}:${auth.actor || "unknown"}`
        : keyInfo.userId || keyInfo.service || keyInfo.name || "api-key",
  };

  await c.env.TOKEN_KV.put(capabilityKey(token), JSON.stringify(record), {
    expirationTtl: CAP_TTL_SECONDS,
  });

  return c.json(
    {
      token,
      token_type: "chittyconnect-capability",
      expires_at: record.expires_at,
      scope: publicScope(record),
    },
    201,
  );
});

capabilityRoutes.post("/introspect", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return error(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const token = body?.token;
  if (typeof token !== "string" || !token.startsWith("cap_")) {
    return c.json({ active: false });
  }
  if (!c.env.TOKEN_KV || typeof c.env.TOKEN_KV.get !== "function") {
    return error(c, 503, "CAPABILITY_STORE_UNAVAILABLE", "TOKEN_KV is unavailable");
  }

  const raw = await c.env.TOKEN_KV.get(capabilityKey(token));
  if (!raw) return c.json({ active: false });

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    await c.env.TOKEN_KV.delete(capabilityKey(token));
    return c.json({ active: false });
  }

  if (Date.parse(record.expires_at) <= Date.now()) {
    await c.env.TOKEN_KV.delete(capabilityKey(token));
    return c.json({ active: false });
  }

  // Re-check tenant repository policy so an allowlist revocation invalidates
  // already-minted capabilities immediately rather than waiting for TTL.
  const policy = await repoAllowed(
    c.env,
    record.tenant_id,
    record.repo_path,
    record.operation,
  );
  if (!policy.allowed) return c.json({ active: false });

  return c.json({
    active: true,
    expires_at: record.expires_at,
    scope: publicScope(record),
  });
});

export { capabilityRoutes, normalizeRepoPath, repoAllowed };
