-- Migration: 006_github_actions_audit
-- Description: Track GitHub Actions OIDC credential access
-- Created: 2026-01-06

-- GitHub Actions credential access log
CREATE TABLE IF NOT EXISTS github_actions_credential_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository TEXT NOT NULL,
    workflow TEXT NOT NULL,
    run_id TEXT,
    actor TEXT,
    credentials TEXT NOT NULL, -- Comma-separated list
    timestamp TEXT DEFAULT (datetime('now')),

    -- Indexes
    UNIQUE(repository, run_id)
);

CREATE INDEX IF NOT EXISTS idx_gha_repository
    ON github_actions_credential_access(repository);

CREATE INDEX IF NOT EXISTS idx_gha_timestamp
    ON github_actions_credential_access(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_gha_actor
    ON github_actions_credential_access(actor);

-- Summary view for GitHub Actions access
CREATE VIEW IF NOT EXISTS github_actions_access_summary AS
SELECT
    repository,
    COUNT(*) as total_accesses,
    COUNT(DISTINCT workflow) as unique_workflows,
    COUNT(DISTINCT actor) as unique_actors,
    MAX(timestamp) as last_access
FROM github_actions_credential_access
GROUP BY repository
ORDER BY total_accesses DESC;

-- Recent access view
CREATE VIEW IF NOT EXISTS github_actions_recent_access AS
SELECT
    id,
    repository,
    workflow,
    actor,
    credentials,
    timestamp
FROM github_actions_credential_access
ORDER BY timestamp DESC
LIMIT 100;
