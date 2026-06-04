-- 018_git_tenant_allowlists.sql — Per-tenant policy for the Git Tool Surface
--
-- Implements chittyos/chittyconnect#211 per the Git Tool Surface in CHARTER.md
-- (see "Policy gates"):
--   - Remote allowlist  → which `remote_url` patterns a tenant may push to
--   - Repo allowlist    → which absolute `repo_path` prefixes are readable/writable
--   - Author allowlist  → which `author` identities a tenant may commit as
--   - CF gateway tag    → controls surface membership (chittymcp + ch1tty include,
--                         chittymsg excludes) for the chittyagent-git upstream
--
-- Tenant rows in `tenant_projects` (016_tenant_registry.sql) are the parent.
-- These tables are independent per-tenant policy; a tenant with no rows in
-- `git_remote_allowlist` cannot push anywhere (fail-closed default).

CREATE TABLE IF NOT EXISTS git_remote_allowlist (
  tenant_id       TEXT NOT NULL,
  pattern         TEXT NOT NULL,                     -- e.g. 'github.com/CHITTYOS/*', 'github.com/CHITTYFOUNDATION/*'
  match_type      TEXT NOT NULL DEFAULT 'glob' CHECK(match_type IN ('glob', 'exact', 'prefix')),
  allow_force     INTEGER NOT NULL DEFAULT 0,        -- 1 = force allowed (still requires confirm token + non-default-branch)
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, pattern)
);

CREATE INDEX IF NOT EXISTS idx_git_remote_allowlist_tenant
  ON git_remote_allowlist(tenant_id);

CREATE TABLE IF NOT EXISTS git_repo_allowlist (
  tenant_id       TEXT NOT NULL,
  path_prefix     TEXT NOT NULL,                     -- absolute path prefix; canonicalized at check time
  access          TEXT NOT NULL DEFAULT 'read' CHECK(access IN ('read', 'write', 'readwrite')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, path_prefix)
);

CREATE INDEX IF NOT EXISTS idx_git_repo_allowlist_tenant
  ON git_repo_allowlist(tenant_id);

CREATE TABLE IF NOT EXISTS git_author_allowlist (
  tenant_id       TEXT NOT NULL,
  author_pattern  TEXT NOT NULL,                     -- e.g. 'Name <email@domain>' or glob 'ChittyOps <*@chitty.cc>'
  match_type      TEXT NOT NULL DEFAULT 'glob' CHECK(match_type IN ('glob', 'exact')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, author_pattern)
);

CREATE INDEX IF NOT EXISTS idx_git_author_allowlist_tenant
  ON git_author_allowlist(tenant_id);

-- CF gateway membership tags — drives whether the chittyagent-git upstream is
-- surfaced through a given aggregator for a given tenant. Read by the gateway
-- registration helper at deploy time, NOT at request time.
--
-- Canonical tags (matches docs/upstreams/chittyagent-git.md in chittymcp):
--   surface:all          → include in chittymcp
--   audience:human       → include in ch1tty slim-MCP (search+execute)
--   auth:oauth-ok        → include where OAuth is the auth model
--   domain:messaging     → opt-in to chittymsg (chittyagent-git should NOT have this)
CREATE TABLE IF NOT EXISTS git_gateway_tags (
  tenant_id       TEXT NOT NULL,
  tag             TEXT NOT NULL,                     -- 'surface:all', 'audience:human', 'auth:oauth-ok', etc.
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_git_gateway_tags_tenant
  ON git_gateway_tags(tenant_id);

-- Seed: ChittyOS default tenant gets the spec defaults from CHARTER.md.
-- "Default allowlist: github.com/CHITTYOS/*, github.com/CHITTYFOUNDATION/*"
INSERT OR IGNORE INTO git_remote_allowlist (tenant_id, pattern, match_type, allow_force, notes)
VALUES
  ('chittyos-default', 'github.com/CHITTYOS/*',         'glob', 0, 'CHARTER.md default'),
  ('chittyos-default', 'github.com/CHITTYFOUNDATION/*', 'glob', 0, 'CHARTER.md default');

INSERT OR IGNORE INTO git_repo_allowlist (tenant_id, path_prefix, access, notes)
VALUES
  ('chittyos-default', '/home/ubuntu/projects/github.com/CHITTYOS/',         'readwrite', 'VM canonical project root'),
  ('chittyos-default', '/home/ubuntu/projects/github.com/CHITTYFOUNDATION/', 'readwrite', 'VM canonical project root');

INSERT OR IGNORE INTO git_gateway_tags (tenant_id, tag)
VALUES
  ('chittyos-default', 'surface:all'),
  ('chittyos-default', 'audience:human'),
  ('chittyos-default', 'auth:oauth-ok');
-- Explicitly NOT inserting 'domain:messaging' — chittyagent-git must not
-- surface in chittymsg per the spec.
