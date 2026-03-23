-- 014_prompt_registry.sql — TY-VY-RY Governed Prompt Registry
-- Prompts are context provisioning: managed, versioned, composable artifacts
-- governed by the TY-VY-RY framework (Identity / Connectivity / Authority)

-- TY Plane (Identity): What IS this prompt?
-- RY Plane (Authority): Gate columns included inline
CREATE TABLE IF NOT EXISTS prompt_registry (
  id TEXT PRIMARY KEY,                    -- e.g. "litigation.synthesize"
  domain TEXT NOT NULL,                   -- e.g. "litigation", "scrape", "triage"
  version INTEGER NOT NULL DEFAULT 1,
  base TEXT NOT NULL,                     -- base system prompt template
  layers TEXT NOT NULL DEFAULT '[]',      -- JSON array of { id, content, order }
  fallback TEXT NOT NULL DEFAULT 'passthrough', -- passthrough | deterministic | error
  env_gate TEXT NOT NULL DEFAULT '{}',
    -- JSON: { "production": "ai", "staging": "ai", "dev": "configurable", "test": "deterministic" }
  author_gate TEXT NOT NULL DEFAULT '{}',
    -- JSON: { "domain": "litigation", "allowedAuthors": ["chittyId..."], "requireApproval": false }
  consumer_gate TEXT NOT NULL DEFAULT '{}',
    -- JSON: { "allowedServices": ["*"], "allowedAgents": ["*"], "scopeBoundaries": [] }
  created_by TEXT,                        -- ChittyID of author
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  changelog TEXT                          -- description of latest change
);
CREATE INDEX IF NOT EXISTS idx_prompt_registry_domain ON prompt_registry(domain);

-- TY Plane: Version history (immutable)
CREATE TABLE IF NOT EXISTS prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL REFERENCES prompt_registry(id),
  version INTEGER NOT NULL,
  base TEXT NOT NULL,
  layers TEXT NOT NULL DEFAULT '[]',
  fallback TEXT NOT NULL DEFAULT 'passthrough',
  env_gate TEXT NOT NULL DEFAULT '{}',
  author_gate TEXT NOT NULL DEFAULT '{}',
  consumer_gate TEXT NOT NULL DEFAULT '{}',
  changelog TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version);

-- VY Plane (Connectivity): How has the network experienced it?
CREATE TABLE IF NOT EXISTS prompt_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  consumer_id TEXT,                       -- ChittyID of consumer
  consumer_service TEXT NOT NULL,         -- e.g. "chittycommand", "chittyrouter"
  executed_by TEXT,                       -- agent that ran it, e.g. "chittyrouter/scrape-agent"
  mode TEXT NOT NULL DEFAULT 'resolve',   -- resolve | execute
  environment TEXT NOT NULL,              -- production | staging | dev | test
  input_hash TEXT,                        -- SHA-256 of input (not the input itself)
  layers_resolved TEXT NOT NULL DEFAULT '[]', -- JSON array of layer IDs used
  latency_ms INTEGER,
  output_quality REAL,                    -- 0.0-1.0 quality signal (async, nullable)
  quality_source TEXT,                    -- "qc_step" | "user_rating" | "auto_eval"
  error TEXT,                             -- error message if execution failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_prompt ON prompt_executions(prompt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_consumer ON prompt_executions(consumer_service, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_executions_quality ON prompt_executions(prompt_id, output_quality);
