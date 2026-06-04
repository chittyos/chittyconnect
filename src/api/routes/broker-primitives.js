/**
 * Broker Primitives — REST endpoints under /api/v1/* implementing the
 * ChittyConnect authorization-server + credential-broker surface.
 *
 * Scope of this module (5/7 primitives — signing deferred to #242):
 *   POST /api/v1/capabilities/mint        (part of #209)
 *   POST /api/v1/capabilities/introspect  (part of #209)
 *   POST /api/v1/capabilities/confirm     (closes #210; supersedes /api/git/confirm)
 *   POST /api/v1/policy/resolve           (closes #211)
 *   POST /api/v1/ledger/emit              (part of #209; placeholder domain handshake)
 *
 * Storage:
 *   - TOKEN_KV  → live opaque capability + confirmation tokens (short-TTL)
 *   - DB (D1)   → tenant policy (018+019), audit trail (broker_capability_audit)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/v1/broker-primitives
 * @canon chittycanon://gov/governance#core-types
 * @spec CHARTER.md "Git Broker Surface (REST, sensitive) — SPEC"
 */

import { Hono } from "hono";
import { mcpAuthMiddleware } from "../../middleware/mcp-auth.js";
import { validate } from "../../schemas/v1/index.js";

const broker = new Hono();
broker.use("*", mcpAuthMiddleware);

// ── Token lifetimes (CHARTER binding) ─────────────────────────────────
const CAPABILITY_TTL_SECONDS = 300; // ≤ 300s per CHARTER
const CONFIRMATION_TTL_SECONDS = 120; // ≤ 120s per CHARTER
const TOKEN_BYTES = 24;

// ── KV namespaces (string prefixes; never colliding with legacy code) ─
const CAP_PREFIX = "broker:cap:";
const CONFIRM_PREFIX = "broker:confirm:";

// ── helpers ───────────────────────────────────────────────────────────
function jerror(c, status, code, message, extra = {}) {
  return c.json({ error: { code, message, ...extra } }, status);
}

function jvalidate(c, schemaName, data) {
  const r = validate(schemaName, data);
  if (r.valid) return null;
  return jerror(c, 400, "SCHEMA_VALIDATION_FAILED", `Request failed schema ${schemaName}`, {
    errors: r.errors,
  });
}

function newOpaqueToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newUuid() {
  return crypto.randomUUID();
}

/**
 * Canonical JSON serialization for ledger entry hashing.
 * Stable key ordering, no whitespace.
 */
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") +
    "}"
  );
}

function globMatch(pattern, subject) {
  if (!pattern || !subject) return false;
  if (pattern === subject) return true;
  const re = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return re.test(subject);
}

function exactMatch(pattern, subject) {
  if (!pattern || !subject) return false;
  return pattern === subject;
}

function prefixMatch(prefix, subject) {
  if (!prefix || !subject) return false;
  return subject.startsWith(prefix);
}

/**
 * Dispatch remote-allowlist match by configured match_type.
 * Fails closed on unknown match_type — never falls back to glob.
 */
function remoteMatches(entry, remote) {
  switch (entry.match_type) {
    case "exact":
      return exactMatch(entry.pattern, remote);
    case "prefix":
      return prefixMatch(entry.pattern, remote);
    case "glob":
      return globMatch(entry.pattern, remote);
    default:
      // Unknown match_type → fail closed (CHARTER fail-closed default).
      return false;
  }
}

// Universal hard-deny branches per CHARTER "Force-push to main/master is
// hard-denied." Applied as a union with per-tenant protected_branches so the
// constant cannot be regressed by a tenant config row being absent. Both bare
// and refs/heads/ forms are included because git tooling passes both.
const UNIVERSAL_PROTECTED_BRANCHES = Object.freeze([
  "main",
  "master",
  "refs/heads/main",
  "refs/heads/master",
]);

// ── policy loader (shared by mint + policy/resolve) ──────────────────
async function loadTenantPolicy(env, tenantId) {
  const [repoRows, remoteRows, branchRows, scalar] = await Promise.all([
    env.DB.prepare(
      "SELECT path_prefix, access FROM git_repo_allowlist WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .all(),
    env.DB.prepare(
      "SELECT pattern, match_type, allow_force FROM git_remote_allowlist WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .all(),
    env.DB.prepare(
      "SELECT branch FROM git_protected_branches WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .all(),
    env.DB.prepare(
      "SELECT force_push_allowed, default_author FROM git_tenant_policy WHERE tenant_id = ?",
    )
      .bind(tenantId)
      .first(),
  ]);

  // Union per-tenant protected_branches with UNIVERSAL set so a tenant
  // with no explicit rows still gets main/master hard-denied (CHARTER).
  const tenantBranches = (branchRows.results || []).map((r) => r.branch);
  const protectedSet = new Set([
    ...UNIVERSAL_PROTECTED_BRANCHES,
    ...tenantBranches,
  ]);

  return {
    repos: (repoRows.results || []).map((r) => ({
      path_prefix: r.path_prefix,
      access: r.access,
    })),
    remotes: (remoteRows.results || []).map((r) => ({
      pattern: r.pattern,
      match_type: r.match_type,
      allow_force: !!r.allow_force,
    })),
    protected_branches: [...protectedSet],
    force_push_allowed: scalar ? !!scalar.force_push_allowed : false,
    default_author: scalar ? scalar.default_author : null,
  };
}

/**
 * Audit insert with two outcome modes.
 *
 * - `critical:true` (default for success paths): throw on D1 failure so the
 *   route can return 503 AUDIT_WRITE_FAILED. Preserves the audit-before-issue
 *   invariant — we never hand out a token or ledger id without a durable row.
 * - `critical:false`: best-effort log to tagged console.error. Used for
 *   denied/expired/invalid outcomes where the response itself is the
 *   security-relevant signal and a missed audit row is a degraded-mode bug.
 */
async function auditEventCore(env, row) {
  await env.DB.prepare(
    `INSERT INTO broker_capability_audit
     (id, event_type, token_fingerprint, caller_chittyid, tenant_id,
      operation, repo_path, remote, ref, force_class, outcome, reason_code,
      ledger_event_id, entry_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id || newUuid(),
      row.event_type,
      row.token_fingerprint || null,
      row.caller_chittyid,
      row.tenant_id,
      row.operation || null,
      row.repo_path || null,
      row.remote || null,
      row.ref || null,
      row.force_class || null,
      row.outcome,
      row.reason_code || null,
      row.ledger_event_id || null,
      row.entry_hash || null,
    )
    .run();
}

/**
 * Best-effort audit (for denied/expired/invalid outcomes).
 * Never throws — the response is the security signal.
 */
async function auditEvent(env, row) {
  try {
    await auditEventCore(env, row);
  } catch (e) {
    console.error(
      "[broker-audit] best-effort insert failed:",
      e.message,
      "event=",
      row.event_type,
      "outcome=",
      row.outcome,
    );
  }
}

/**
 * Critical audit (for ok mint/confirm/ledger_emit). Throws on failure so
 * the caller route can return 503 AUDIT_WRITE_FAILED rather than issue a
 * token without a durable audit row.
 *
 * @throws Error from D1 insert
 */
async function auditEventCritical(env, row) {
  try {
    await auditEventCore(env, row);
  } catch (e) {
    console.error(
      "[broker-audit] CRITICAL insert failed:",
      e.message,
      "event=",
      row.event_type,
    );
    throw e;
  }
}

/**
 * Map a critical-audit failure to a 503 response. Used by route handlers
 * after auditEventCritical throws.
 */
function auditWriteFailedResponse(c) {
  return jerror(
    c,
    503,
    "AUDIT_WRITE_FAILED",
    "Durable audit row could not be written; token not issued",
  );
}

// ── credential redaction (CHARTER §7) ────────────────────────────────
const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[bpars]-[A-Za-z0-9-]{10,}/g,
];

function redactString(s) {
  if (typeof s !== "string") return s;
  let out = s.replace(/(https?:\/\/)[^@\s/]+@/g, "$1");
  for (const p of TOKEN_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}

function redactPayload(obj) {
  if (obj === null || typeof obj !== "object") return redactString(obj);
  if (Array.isArray(obj)) return obj.map(redactPayload);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = redactPayload(obj[k]);
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// POST /capabilities/mint
// ───────────────────────────────────────────────────────────────────────
broker.post("/capabilities/mint", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jerror(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const verr = jvalidate(c, "capabilities.mint.input", body);
  if (verr) return verr;

  const {
    caller_chittyid,
    tenant_id,
    operation,
    repo_path,
    remote,
    ref,
    confirmation_token,
  } = body;
  const force_class = body.force_class || "none";

  let policy;
  try {
    policy = await loadTenantPolicy(c.env, tenant_id);
  } catch (e) {
    console.error("[mint] policy load failed:", e.message);
    return jerror(
      c,
      503,
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "Policy store unavailable",
    );
  }

  const repoOk = policy.repos.some((r) => prefixMatch(r.path_prefix, repo_path));
  if (!repoOk) {
    await auditEvent(c.env, {
      event_type: "mint",
      caller_chittyid,
      tenant_id,
      operation,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "denied",
      reason_code: "POLICY_BLOCKED_REPO_NOT_ALLOWED",
    });
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_REPO_NOT_ALLOWED",
      "repo_path is not in tenant repo allowlist",
    );
  }

  if (operation === "push") {
    const remoteOk = policy.remotes.some((r) => remoteMatches(r, remote));
    if (!remoteOk) {
      await auditEvent(c.env, {
        event_type: "mint",
        caller_chittyid,
        tenant_id,
        operation,
        repo_path,
        remote,
        ref,
        force_class,
        outcome: "denied",
        reason_code: "POLICY_BLOCKED_REMOTE_NOT_ALLOWED",
      });
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_REMOTE_NOT_ALLOWED",
        "Remote URL not in tenant allowlist",
      );
    }
  }

  if (force_class !== "none") {
    if (!policy.force_push_allowed) {
      await auditEvent(c.env, {
        event_type: "mint",
        caller_chittyid,
        tenant_id,
        operation,
        repo_path,
        remote,
        ref,
        force_class,
        outcome: "denied",
        reason_code: "POLICY_BLOCKED_FORCE_TO_PROTECTED",
      });
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_FORCE_TO_PROTECTED",
        "Tenant policy disallows force-push",
      );
    }
    if (ref && policy.protected_branches.includes(ref)) {
      await auditEvent(c.env, {
        event_type: "mint",
        caller_chittyid,
        tenant_id,
        operation,
        repo_path,
        remote,
        ref,
        force_class,
        outcome: "denied",
        reason_code: "POLICY_BLOCKED_FORCE_TO_PROTECTED",
      });
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_FORCE_TO_PROTECTED",
        "Force-push to protected branch is hard-denied",
      );
    }
    const ckey = CONFIRM_PREFIX + confirmation_token;
    const craw = await c.env.TOKEN_KV.get(ckey);
    if (!craw) {
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_CONFIRMATION_INVALID",
        "Confirmation token missing or expired",
      );
    }
    let crec;
    try {
      crec = JSON.parse(craw);
    } catch {
      await c.env.TOKEN_KV.delete(ckey);
      await auditEvent(c.env, {
        event_type: "mint",
        caller_chittyid,
        tenant_id,
        operation,
        repo_path,
        remote,
        ref,
        force_class,
        outcome: "invalid",
        reason_code: "CONFIRMATION_RECORD_UNREADABLE",
      });
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_CONFIRMATION_INVALID",
        "Confirmation token unreadable",
      );
    }
    const scopeMatches =
      crec.caller_chittyid === caller_chittyid &&
      crec.tenant_id === tenant_id &&
      crec.repo_path === repo_path &&
      crec.remote === remote &&
      crec.ref === ref &&
      crec.force_class === force_class;
    if (!scopeMatches) {
      return jerror(
        c,
        403,
        "POLICY_BLOCKED_CONFIRMATION_INVALID",
        "Confirmation token scope mismatch",
      );
    }
    await c.env.TOKEN_KV.delete(ckey);
  }

  const token = newOpaqueToken();
  const fingerprint = await sha256Hex(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CAPABILITY_TTL_SECONDS * 1000);

  const scope = {
    caller_chittyid,
    tenant_id,
    operation,
    repo_path,
    ...(remote ? { remote } : {}),
    ...(ref ? { ref } : {}),
    force_class,
  };

  const record = {
    scope,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    fingerprint,
  };

  try {
    await c.env.TOKEN_KV.put(CAP_PREFIX + token, JSON.stringify(record), {
      expirationTtl: CAPABILITY_TTL_SECONDS,
    });
  } catch (e) {
    console.error("[mint] TOKEN_KV.put failed:", e.message);
    await auditEvent(c.env, {
      event_type: "mint",
      caller_chittyid,
      tenant_id,
      operation,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "denied",
      reason_code: "TOKEN_STORE_UNAVAILABLE",
    });
    return jerror(
      c,
      503,
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "Token store unavailable",
    );
  }

  try {
    await auditEventCritical(c.env, {
      event_type: "mint",
      token_fingerprint: fingerprint,
      caller_chittyid,
      tenant_id,
      operation,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "ok",
    });
  } catch {
    // Roll back the KV write so we never return a token whose audit row failed.
    try {
      await c.env.TOKEN_KV.delete(CAP_PREFIX + token);
    } catch (delErr) {
      console.error("[mint] rollback KV.delete failed:", delErr.message);
    }
    return auditWriteFailedResponse(c);
  }

  return c.json(
    {
      token,
      token_type: "chittyconnect-capability",
      expires_at: expiresAt.toISOString(),
      scope,
    },
    201,
  );
});

// ───────────────────────────────────────────────────────────────────────
// POST /capabilities/introspect
// ───────────────────────────────────────────────────────────────────────
broker.post("/capabilities/introspect", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jerror(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const verr = jvalidate(c, "capabilities.introspect.input", body);
  if (verr) return verr;

  const raw = await c.env.TOKEN_KV.get(CAP_PREFIX + body.token);
  if (!raw) return c.json({ active: false });

  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    // Corrupt record — emit invalid audit (best-effort) and report inactive.
    await auditEvent(c.env, {
      event_type: "introspect",
      caller_chittyid: "unknown",
      tenant_id: "unknown",
      outcome: "invalid",
      reason_code: "TOKEN_RECORD_UNREADABLE",
    });
    return c.json({ active: false });
  }

  // Validate expires_at parses to a finite number. `new Date(undefined)` and
  // any malformed value yields NaN, and `NaN < Date.now()` is false — which
  // would otherwise fail open and treat the token as active.
  const expMs = rec && rec.expires_at ? new Date(rec.expires_at).getTime() : NaN;
  if (!Number.isFinite(expMs) || expMs < Date.now()) {
    const outcome = !Number.isFinite(expMs) ? "invalid" : "expired";
    await auditEvent(c.env, {
      event_type: "introspect",
      token_fingerprint: rec && rec.fingerprint,
      caller_chittyid: (rec && rec.scope && rec.scope.caller_chittyid) || "unknown",
      tenant_id: (rec && rec.scope && rec.scope.tenant_id) || "unknown",
      operation: rec && rec.scope && rec.scope.operation,
      repo_path: rec && rec.scope && rec.scope.repo_path,
      remote: rec && rec.scope && rec.scope.remote,
      ref: rec && rec.scope && rec.scope.ref,
      force_class: rec && rec.scope && rec.scope.force_class,
      outcome,
      reason_code:
        outcome === "invalid"
          ? "TOKEN_EXPIRES_AT_MALFORMED"
          : "TOKEN_EXPIRED",
    });
    return c.json({ active: false });
  }

  const scope = {
    caller_chittyid: rec.scope.caller_chittyid,
    tenant_id: rec.scope.tenant_id,
    operation: rec.scope.operation,
    repo_path: rec.scope.repo_path,
    ...(rec.scope.remote ? { remote: rec.scope.remote } : {}),
    ...(rec.scope.ref ? { ref: rec.scope.ref } : {}),
    force_class: rec.scope.force_class,
  };

  await auditEvent(c.env, {
    event_type: "introspect",
    token_fingerprint: rec.fingerprint,
    caller_chittyid: rec.scope.caller_chittyid,
    tenant_id: rec.scope.tenant_id,
    operation: rec.scope.operation,
    repo_path: rec.scope.repo_path,
    remote: rec.scope.remote,
    ref: rec.scope.ref,
    force_class: rec.scope.force_class,
    outcome: "ok",
  });

  return c.json({ active: true, expires_at: rec.expires_at, scope });
});

// ───────────────────────────────────────────────────────────────────────
// POST /capabilities/confirm
// ───────────────────────────────────────────────────────────────────────
broker.post("/capabilities/confirm", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jerror(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const verr = jvalidate(c, "capabilities.confirm.input", body);
  if (verr) return verr;

  const { caller_chittyid, tenant_id, repo_path, remote, ref, force_class } = body;

  let policy;
  try {
    policy = await loadTenantPolicy(c.env, tenant_id);
  } catch (e) {
    console.error("[confirm] policy load failed:", e.message);
    return jerror(
      c,
      503,
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "Policy store unavailable",
    );
  }

  if (policy.protected_branches.includes(ref)) {
    await auditEvent(c.env, {
      event_type: "confirm",
      caller_chittyid,
      tenant_id,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "denied",
      reason_code: "POLICY_BLOCKED_FORCE_TO_PROTECTED",
    });
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_FORCE_TO_PROTECTED",
      "Force-push to protected branch is hard-denied",
    );
  }

  // Tenant scalar policy gate: if force-push is globally disabled, refuse
  // to mint a confirmation token at all. Mint would catch this later, but
  // the earlier rejection matches the broker invariant "confirmation tokens
  // only exist when their use is potentially permissible."
  if (!policy.force_push_allowed) {
    await auditEvent(c.env, {
      event_type: "confirm",
      caller_chittyid,
      tenant_id,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "denied",
      reason_code: "POLICY_BLOCKED_FORCE_DISABLED",
    });
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_FORCE_DISABLED",
      "Tenant policy disallows force-push",
    );
  }

  const token = newOpaqueToken();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CONFIRMATION_TTL_SECONDS * 1000);
  const bound_scope = {
    caller_chittyid,
    tenant_id,
    repo_path,
    remote,
    ref,
    force_class,
  };
  const record = {
    ...bound_scope,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  try {
    await c.env.TOKEN_KV.put(CONFIRM_PREFIX + token, JSON.stringify(record), {
      expirationTtl: CONFIRMATION_TTL_SECONDS,
    });
  } catch (e) {
    console.error("[confirm] TOKEN_KV.put failed:", e.message);
    await auditEvent(c.env, {
      event_type: "confirm",
      caller_chittyid,
      tenant_id,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "denied",
      reason_code: "TOKEN_STORE_UNAVAILABLE",
    });
    return jerror(
      c,
      503,
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "Token store unavailable",
    );
  }

  try {
    await auditEventCritical(c.env, {
      event_type: "confirm",
      token_fingerprint: await sha256Hex(token),
      caller_chittyid,
      tenant_id,
      repo_path,
      remote,
      ref,
      force_class,
      outcome: "ok",
    });
  } catch {
    try {
      await c.env.TOKEN_KV.delete(CONFIRM_PREFIX + token);
    } catch (delErr) {
      console.error("[confirm] rollback KV.delete failed:", delErr.message);
    }
    return auditWriteFailedResponse(c);
  }

  return c.json(
    {
      confirmation_token: token,
      expires_at: expiresAt.toISOString(),
      bound_scope,
    },
    201,
  );
});

// ───────────────────────────────────────────────────────────────────────
// POST /policy/resolve
// ───────────────────────────────────────────────────────────────────────
broker.post("/policy/resolve", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jerror(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const verr = jvalidate(c, "policy.resolve.input", body);
  if (verr) return verr;

  const { tenant_id, caller_chittyid, operation } = body;

  // Tenant-membership enforcement: there is no caller↔tenant membership
  // table in the schema yet (016 tenant_projects only maps tenant→Neon
  // project). Fail-closed: only allow callers to resolve policy for the
  // canonical `chittyos-default` tenant until membership lands. Other
  // tenant_ids return 403 with a clear follow-up reason. Tracked: tenant
  // membership lookup must be implemented before this gate is widened.
  //
  // This is the explicit "fail-closed and file a follow-up" path called for
  // by the PR review rather than fabricating a check.
  const MEMBERSHIP_ALLOWED_TENANTS = new Set(["chittyos-default"]);
  if (!MEMBERSHIP_ALLOWED_TENANTS.has(tenant_id)) {
    await auditEvent(c.env, {
      event_type: "policy_resolve",
      caller_chittyid,
      tenant_id,
      operation,
      outcome: "denied",
      reason_code: "POLICY_BLOCKED_TENANT_MEMBERSHIP_UNVERIFIED",
    });
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_TENANT_MEMBERSHIP_UNVERIFIED",
      "Caller-tenant membership cannot be verified; policy resolution denied",
    );
  }

  let policy;
  try {
    policy = await loadTenantPolicy(c.env, tenant_id);
  } catch (e) {
    console.error("[policy.resolve] load failed:", e.message);
    await auditEvent(c.env, {
      event_type: "policy_resolve",
      caller_chittyid,
      tenant_id,
      operation,
      outcome: "invalid",
      reason_code: "POLICY_LOAD_FAILED",
    });
    return jerror(
      c,
      503,
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "Policy store unavailable",
    );
  }

  const out = {
    allowed_repos: policy.repos.map((r) => r.path_prefix),
    allowed_remotes: policy.remotes.map((r) => r.pattern),
    force_push_allowed: policy.force_push_allowed,
    protected_branches: policy.protected_branches,
    ...(policy.default_author ? { default_author: policy.default_author } : {}),
  };

  await auditEvent(c.env, {
    event_type: "policy_resolve",
    caller_chittyid,
    tenant_id,
    operation,
    outcome: "ok",
  });

  return c.json(out);
});

// ───────────────────────────────────────────────────────────────────────
// POST /ledger/emit
//
// Domain handshake — this endpoint computes the real canonical entry hash
// + persists to broker_capability_audit (durable D1 record). When the
// ChittyLedger domain handshake lands, the audit row will be forwarded to
// ChittyLedger and the ledger_event_id will be replaced with the upstream
// id. (Forward-handshake tracking issue not yet filed; the previous
// reference to chittyledger#11 was incorrect — that was a merged
// Dependabot PR, not a tracking issue.)
// ───────────────────────────────────────────────────────────────────────
broker.post("/ledger/emit", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jerror(c, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const verr = jvalidate(c, "ledger.emit.input", body);
  if (verr) return verr;

  const { capability_token, event_type, payload } = body;

  const capRaw = await c.env.TOKEN_KV.get(CAP_PREFIX + capability_token);
  if (!capRaw) {
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_CAPABILITY_INVALID",
      "Capability token missing or expired",
    );
  }
  let capRec;
  try {
    capRec = JSON.parse(capRaw);
  } catch {
    await auditEvent(c.env, {
      event_type: "ledger_emit",
      caller_chittyid: "unknown",
      tenant_id: "unknown",
      outcome: "invalid",
      reason_code: "CAPABILITY_RECORD_UNREADABLE",
    });
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_CAPABILITY_INVALID",
      "Capability token unreadable",
    );
  }

  const required = {
    "git.commit": "commit",
    "git.push": "push",
    "git.tag": "tag",
  }[event_type];
  if (capRec.scope.operation !== required) {
    return jerror(
      c,
      403,
      "POLICY_BLOCKED_CAPABILITY_INVALID",
      `Capability operation '${capRec.scope.operation}' does not match event_type '${event_type}'`,
    );
  }

  const safePayload = redactPayload(payload);
  const ledgerEventId = newUuid();
  const entry = {
    ledger_event_id: ledgerEventId,
    domain: "git",
    event_type,
    scope: capRec.scope,
    payload: safePayload,
    issued_at: new Date().toISOString(),
  };
  const entryHash = await sha256Hex(canonicalize(entry));

  try {
    await auditEventCritical(c.env, {
      id: ledgerEventId,
      event_type: "ledger_emit",
      token_fingerprint: capRec.fingerprint,
      caller_chittyid: capRec.scope.caller_chittyid,
      tenant_id: capRec.scope.tenant_id,
      operation: capRec.scope.operation,
      repo_path: capRec.scope.repo_path,
      remote: capRec.scope.remote,
      ref: capRec.scope.ref,
      force_class: capRec.scope.force_class,
      outcome: "ok",
      ledger_event_id: ledgerEventId,
      entry_hash: entryHash,
    });
  } catch {
    return auditWriteFailedResponse(c);
  }

  return c.json({
    ledger_event_id: ledgerEventId,
    entry_hash: entryHash,
    domain: "git",
  });
});

export { broker as brokerPrimitivesRoutes };
