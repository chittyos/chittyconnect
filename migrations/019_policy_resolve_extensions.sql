-- 019_policy_resolve_extensions.sql — Policy fields required by /api/v1/policy/resolve
--
-- Extends 018_git_tenant_allowlists.sql in place (ADD ONLY — no reshape, no data migration).
--
-- 018 covers tuple-keyed allowlists (remote/repo/author). The CHARTER policy.resolve
-- output schema also requires two scalar/list fields per tenant that don't fit any
-- existing 018 table:
--   - force_push_allowed (bool, scalar per tenant)
--   - default_author (string, scalar per tenant)
--   - protected_branches (list per tenant)
--
-- D1 is SQLite. We use a one-row-per-tenant table for scalars, and a tuple table
-- for protected_branches. Both default fail-closed: missing row → force denied,
-- no protected branches set → resource server still honors the CHARTER hard-deny
-- defaults (main/master).
--
-- Implements chittyos/chittyconnect#211 per CHARTER "Git Broker Surface (REST, sensitive) — SPEC".

CREATE TABLE IF NOT EXISTS git_tenant_policy (
  tenant_id           TEXT PRIMARY KEY,
  force_push_allowed  INTEGER NOT NULL DEFAULT 0,       -- 0 = denied (fail-closed default)
  default_author      TEXT,                              -- 'Name <email>'; NULL = caller must supply
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS git_protected_branches (
  tenant_id   TEXT NOT NULL,
  branch      TEXT NOT NULL,                             -- canonical ref form, e.g. 'refs/heads/main'
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, branch)
);

CREATE INDEX IF NOT EXISTS idx_git_protected_branches_tenant
  ON git_protected_branches(tenant_id);

-- Seed chittyos-default to mirror the 018 seed posture: force denied,
-- main + master hard-protected per CHARTER "Force-push to main/master is hard-denied."
INSERT OR IGNORE INTO git_tenant_policy (tenant_id, force_push_allowed, default_author, notes)
VALUES
  ('chittyos-default', 0, 'ChittyOps <ops@chitty.cc>', 'CHARTER default — force denied unless explicitly enabled');

INSERT OR IGNORE INTO git_protected_branches (tenant_id, branch, notes)
VALUES
  ('chittyos-default', 'refs/heads/main',   'CHARTER hard-deny default'),
  ('chittyos-default', 'refs/heads/master', 'CHARTER hard-deny default');

-- Capability + confirmation token audit (broker-side ledger of mint/introspect/confirm).
-- TOKEN_KV holds the live opaque tokens (consistent with git-confirm.js pattern);
-- this table is the durable audit trail. Tokens themselves are NOT stored here —
-- only their sha256 fingerprint + scope claims.
CREATE TABLE IF NOT EXISTS broker_capability_audit (
  id                   TEXT PRIMARY KEY,                -- random UUID
  event_type           TEXT NOT NULL CHECK(event_type IN ('mint','introspect','confirm','ledger_emit','policy_resolve')),
  token_fingerprint    TEXT,                            -- sha256 hex of opaque token; NULL for ledger_emit
  caller_chittyid      TEXT NOT NULL,
  tenant_id            TEXT NOT NULL,
  operation            TEXT,                            -- read|commit|tag|push (NULL for confirm/ledger_emit)
  repo_path            TEXT,
  remote               TEXT,
  ref                  TEXT,
  force_class          TEXT,
  outcome              TEXT NOT NULL CHECK(outcome IN ('ok','denied','expired','invalid')),
  reason_code          TEXT,                            -- e.g. POLICY_BLOCKED_REPO_NOT_ALLOWED
  ledger_event_id      TEXT,                            -- set on ledger_emit
  entry_hash           TEXT,                            -- sha256 hex of canonicalized ledger entry
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_broker_audit_tenant_created
  ON broker_capability_audit(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broker_audit_caller_created
  ON broker_capability_audit(caller_chittyid, created_at);
CREATE INDEX IF NOT EXISTS idx_broker_audit_event
  ON broker_capability_audit(event_type, created_at);
