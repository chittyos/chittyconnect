-- 016_tenant_registry.sql — Neon Project-Per-Tenant Registry
-- Tracks tenant → Neon project mappings for the two-layer data ownership model.
-- Layer 1 (tenant): evidence originals, custody logs, client documents
-- Layer 2 (platform): work product, analysis, trust scores, context DNA

CREATE TABLE IF NOT EXISTS tenant_projects (
  tenant_id TEXT PRIMARY KEY,
  neon_project_id TEXT NOT NULL UNIQUE,
  neon_region TEXT NOT NULL DEFAULT 'aws-us-east-2',
  connection_uri_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deprovisioned')),
  pg_version TEXT NOT NULL DEFAULT '16',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_projects_status ON tenant_projects(status);
CREATE INDEX IF NOT EXISTS idx_tenant_projects_neon_id ON tenant_projects(neon_project_id);
