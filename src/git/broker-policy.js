
const VALID_OPERATIONS = new Set(["read", "commit", "tag", "push"]);
const WRITE_OPERATIONS = new Set(["commit", "tag", "push"]);
const CHITTY_ID_RE =
  /^[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]{3}-[A-Z0-9]{4}-[PLTEA]-[0-9]{4}-[0-5]-[0-9]{2}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^refs\/(heads|tags)\/[A-Za-z0-9._\/-]+$/;

export function canonicalRepo(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return REPO_RE.test(trimmed) ? trimmed : null;
}

export function canonicalRemote(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const remote = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^ssh:\/\/git@/i, "")
    .replace(/^git@([^:]+):/i, "$1/")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  return /^[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(remote)
    ? remote
    : null;
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+?^$(){}|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i");
}

function accessAllows(access, operation) {
  if (operation === "read") return access === "read" || access === "readwrite";
  return access === "write" || access === "readwrite";
}

export function validateMintBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_request" };
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
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "unexpected_field" };
  }
  if (!CHITTY_ID_RE.test(body.caller_chittyid || "")) {
    return { ok: false, error: "invalid_caller_chittyid" };
  }
  if (
    typeof body.tenant_id !== "string" ||
    body.tenant_id.length < 1 ||
    body.tenant_id.length > 128
  ) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  if (!VALID_OPERATIONS.has(body.operation)) {
    return { ok: false, error: "invalid_operation" };
  }

  const repo = canonicalRepo(body.repo_path);
  if (!repo) return { ok: false, error: "invalid_repo_path" };

  const forceClass = body.force_class || "none";
  if (!["none", "force", "force_with_lease"].includes(forceClass)) {
    return { ok: false, error: "invalid_force_class" };
  }

  if (WRITE_OPERATIONS.has(body.operation)) {
    if (typeof body.ref !== "string" || !REF_RE.test(body.ref)) {
      return { ok: false, error: "invalid_ref" };
    }
  }

  let remote = null;
  if (body.operation === "push") {
    remote = canonicalRemote(body.remote);
    if (!remote) return { ok: false, error: "invalid_remote" };
  } else if (body.remote !== undefined) {
    return { ok: false, error: "remote_only_valid_for_push" };
  }

  if (forceClass !== "none") {
    return { ok: false, error: "POLICY_BLOCKED_CONFIRMATION_REQUIRED" };
  }

  return {
    ok: true,
    value: {
      caller_chittyid: body.caller_chittyid,
      tenant_id: body.tenant_id,
      operation: body.operation,
      repo_path: repo,
      ...(remote ? { remote } : {}),
      ...(body.ref ? { ref: body.ref } : {}),
      force_class: forceClass,
    },
  };
}

export async function resolveRepoPolicy(env, tenantId, repo, operation) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return { allowed: false, reason: "POLICY_BACKEND_UNAVAILABLE" };
  }
  const result = await env.DB.prepare(
    "SELECT path_prefix, access FROM git_repo_allowlist WHERE tenant_id = ?",
  )
    .bind(tenantId)
    .all();

  const normalized = repo.toLowerCase();
  const row = (result.results || []).find(
    (candidate) =>
      typeof candidate.path_prefix === "string" &&
      normalized.startsWith(candidate.path_prefix.toLowerCase()) &&
      accessAllows(candidate.access, operation),
  );

  return row
    ? { allowed: true, matched_prefix: row.path_prefix, access: row.access }
    : { allowed: false, reason: "POLICY_BLOCKED_REPO_NOT_ALLOWED" };
}

export async function resolveRemotePolicy(env, tenantId, remote) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return { allowed: false, reason: "POLICY_BACKEND_UNAVAILABLE" };
  }
  const result = await env.DB.prepare(
    "SELECT pattern, match_type, allow_force FROM git_remote_allowlist WHERE tenant_id = ?",
  )
    .bind(tenantId)
    .all();

  for (const row of result.results || []) {
    if (typeof row.pattern !== "string") continue;
    const matches =
      row.match_type === "exact"
        ? remote.toLowerCase() === row.pattern.toLowerCase()
        : row.match_type === "prefix"
          ? remote.toLowerCase().startsWith(row.pattern.toLowerCase())
          : globToRegex(row.pattern).test(remote);
    if (matches) {
      return {
        allowed: true,
        matched_pattern: row.pattern,
        allow_force: Number(row.allow_force) === 1,
      };
    }
  }
  return { allowed: false, reason: "POLICY_BLOCKED_REMOTE_NOT_ALLOWED" };
}

export async function resolvePolicy(env, tenantId, operation) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return { ok: false, reason: "POLICY_BACKEND_UNAVAILABLE" };
  }

  const [repos, remotes, authors] = await Promise.all([
    env.DB.prepare(
      "SELECT path_prefix, access FROM git_repo_allowlist WHERE tenant_id = ?",
    ).bind(tenantId).all(),
    env.DB.prepare(
      "SELECT pattern, match_type, allow_force FROM git_remote_allowlist WHERE tenant_id = ?",
    ).bind(tenantId).all(),
    env.DB.prepare(
      "SELECT author_pattern FROM git_author_allowlist WHERE tenant_id = ? ORDER BY author_pattern LIMIT 1",
    ).bind(tenantId).all(),
  ]);

  return {
    ok: true,
    policy: {
      allowed_repos: (repos.results || [])
        .filter((row) => accessAllows(row.access, operation))
        .map((row) => row.path_prefix),
      allowed_remotes: (remotes.results || []).map((row) => row.pattern),
      force_push_allowed: (remotes.results || []).some(
        (row) => Number(row.allow_force) === 1,
      ),
      protected_branches: [],
      ...((authors.results || [])[0]?.author_pattern
        ? { default_author: authors.results[0].author_pattern }
        : {}),
    },
  };
}

export function validPolicyRequest(body) {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof body.tenant_id === "string" &&
      CHITTY_ID_RE.test(body.caller_chittyid || "") &&
      VALID_OPERATIONS.has(body.operation),
  );
}
