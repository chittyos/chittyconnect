/**
 * Broker Primitives — REST endpoints under /api/v1/* implementing the
 * ChittyConnect authorization-server + credential-broker surface.
 *
 * Scope of this module (5/7 primitives — signing deferred to #228):
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

function prefixMatch(prefix, subject) {
  if (!prefix || !subject) return false;
  return subject.startsWith(prefix);
}

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
    protected_branches: (branchRows.results || []).map((r) => r.branch),
    force_push_allowed: scalar ? !!scalar.force_push_allowed : false,
    default_author: scalar ? scalar.default_author : null,
  };
}

async function auditEvent(env, row) {
  try {
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
  } catch (e) {
    console.error("[broker-audit] insert failed:", e.message);
  }
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
    const remoteOk = policy.remotes.some((r) => globMatch(r.pattern, remote));
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

  await c.env.TOKEN_KV.put(CAP_PREFIX + token, JSON.stringify(record), {
    expirationTtl: CAPABILITY_TTL_SECONDS,
  });

  await auditEvent(c.env, {
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
    return c.json({ active: false });
  }

  if (new Date(rec.expires_at).getTime() < Date.now()) {
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

  await c.env.TOKEN_KV.put(CONFIRM_PREFIX + token, JSON.stringify(record), {
    expirationTtl: CONFIRMATION_TTL_SECONDS,
  });

  await auditEvent(c.env, {
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

  const { tenant_id } = body;

  let policy;
  try {
    policy = await loadTenantPolicy(c.env, tenant_id);
  } catch (e) {
    console.error("[policy.resolve] load failed:", e.message);
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
  return c.json(out);
});

// ───────────────────────────────────────────────────────────────────────
// POST /ledger/emit
//
// Domain handshake placeholder for chittyledger#11 — this endpoint computes
// the real canonical entry hash + persists to broker_capability_audit
// (durable D1 record). When the chittyledger domain handshake lands, the
// audit row will be forwarded to ChittyLedger and the ledger_event_id will
// be replaced with the upstream id.
// TODO(chittyledger#11): forward entry to ChittyLedger domain projection
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

  await auditEvent(c.env, {
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

  return c.json({
    ledger_event_id: ledgerEventId,
    entry_hash: entryHash,
    domain: "git",
  });
});

export { broker as brokerPrimitivesRoutes };
