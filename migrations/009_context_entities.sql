-- Migration: 009_context_entities.sql
-- Description: Context Entity Model - Context as Synthetic Entity with ChittyID
-- Date: 2026-01-18
-- D1-Compatible (SQLite syntax)
--
-- @canonical-uri chittycanon://core/services/chittyconnect/migrations/009-context-entities
-- @version 1.0.0
-- @status CERTIFIED
--
-- This migration implements the Context Accountability model from GOVERNANCE.md:
-- - Context is the persistent synthetic entity (not session)
-- - ChittyID is minted for CONTEXTS, not sessions
-- - Sessions bind to contexts and operate under their authority
-- - Trust/DNA accumulates at context level
--
-- ============================================================================
-- JSON FIELD SCHEMAS
-- ============================================================================
--
-- context_entities.current_sessions (array of session IDs):
-- [
--   "sess_abc123",
--   "sess_def456"
-- ]
--
-- context_dna.patterns (array of BehaviorPattern):
-- [
--   {
--     "name": "rapid_commits",
--     "frequency": 0.85,
--     "description": "Commits frequently during coding sessions",
--     "detected_at": 1705603200
--   }
-- ]
--
-- context_dna.traits (array of Trait):
-- [
--   {
--     "name": "meticulous",
--     "score": 0.75,
--     "evidence_count": 42
--   }
-- ]
--
-- context_dna.preferences (array of Preference):
-- [
--   {
--     "key": "editor",
--     "value": "neovim",
--     "confidence": 0.9
--   }
-- ]
--
-- context_dna.competencies (array of Competency):
-- [
--   {
--     "name": "typescript",
--     "level": 4,
--     "evidence": ["code_review", "feature_development"],
--     "last_demonstrated": 1705603200
--   }
-- ]
--
-- context_dna.expertise_domains (array of domain strings):
-- ["backend-development", "api-design", "cloudflare-workers"]
--
-- context_dna.peak_activity_hours (array of hour numbers 0-23):
-- [9, 10, 11, 14, 15, 16]
--
-- context_ledger.payload (event-specific JSON):
-- {
--   "action": "approve",
--   "resource": "deployment",
--   "risk_level": 2,
--   "auto_approved": true
-- }
--
-- context_trust_log.change_factors (breakdown of trust calculation):
-- {
--   "success_rate_impact": +5.2,
--   "anomaly_penalty": -2.0,
--   "consistency_bonus": +1.5,
--   "total_change": +4.7
-- }
-- ============================================================================

-- ============================================================================
-- context_entities: The persistent synthetic entity with ChittyID
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_entities (
  id TEXT PRIMARY KEY,

  -- Identity (minted once per context)
  chitty_id TEXT NOT NULL UNIQUE,
  context_hash TEXT NOT NULL UNIQUE,  -- Hash of static anchors (for lookup)

  -- Static Anchors (immutable after creation)
  project_path TEXT NOT NULL,
  workspace TEXT,
  support_type TEXT NOT NULL CHECK (support_type IN (
    'development', 'operations', 'legal', 'research', 'administrative', 'financial'
  )),
  organization TEXT,

  -- Signature Proof
  signature TEXT NOT NULL,             -- Ed25519 signature from ChittyID service
  issuer TEXT NOT NULL DEFAULT 'chittyid',
  minted_at INTEGER NOT NULL DEFAULT (unixepoch()),

  -- Trust (dynamic, evolves over time)
  trust_score REAL DEFAULT 50.00 CHECK (trust_score BETWEEN 0 AND 100),
  trust_level INTEGER DEFAULT 3 CHECK (trust_level BETWEEN 0 AND 5),

  -- Session Tracking
  total_sessions INTEGER DEFAULT 0,
  current_sessions TEXT DEFAULT '[]',  -- JSON array of active session IDs
  last_activity INTEGER DEFAULT (unixepoch()),

  -- Lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived', 'revoked')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for context_entities
CREATE INDEX IF NOT EXISTS idx_context_entities_chitty_id ON context_entities(chitty_id);
CREATE INDEX IF NOT EXISTS idx_context_entities_hash ON context_entities(context_hash);
CREATE INDEX IF NOT EXISTS idx_context_entities_project ON context_entities(project_path);
CREATE INDEX IF NOT EXISTS idx_context_entities_workspace ON context_entities(workspace);
CREATE INDEX IF NOT EXISTS idx_context_entities_org ON context_entities(organization);
CREATE INDEX IF NOT EXISTS idx_context_entities_support ON context_entities(support_type);
CREATE INDEX IF NOT EXISTS idx_context_entities_trust ON context_entities(trust_level DESC, trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_context_entities_status ON context_entities(status);
CREATE INDEX IF NOT EXISTS idx_context_entities_active ON context_entities(context_hash)
  WHERE status = 'active';

-- ============================================================================
-- context_ledger: Immutable ledger of context events (chained)
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_ledger (
  id TEXT PRIMARY KEY,

  -- Context reference
  context_id TEXT NOT NULL REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL,

  -- Session that created this entry
  session_id TEXT NOT NULL,

  -- Event details
  event_type TEXT NOT NULL CHECK (event_type IN ('transaction', 'decision', 'outcome', 'anomaly')),
  payload TEXT NOT NULL DEFAULT '{}',  -- JSON payload

  -- Chain integrity
  hash TEXT NOT NULL,                  -- Hash of this entry
  previous_hash TEXT NOT NULL,         -- Hash of previous entry (chain)

  -- Temporal
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE(context_id, hash)
);

-- Indexes for context_ledger
CREATE INDEX IF NOT EXISTS idx_context_ledger_context ON context_ledger(context_id);
CREATE INDEX IF NOT EXISTS idx_context_ledger_chitty ON context_ledger(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_context_ledger_session ON context_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_context_ledger_type ON context_ledger(event_type);
CREATE INDEX IF NOT EXISTS idx_context_ledger_time ON context_ledger(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_context_ledger_chain ON context_ledger(context_id, timestamp DESC);

-- ============================================================================
-- context_dna: Accumulated patterns, traits, and character
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_dna (
  id TEXT PRIMARY KEY,

  -- Context reference
  context_id TEXT NOT NULL UNIQUE REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL UNIQUE,

  -- Patterns (JSON arrays)
  patterns TEXT DEFAULT '[]',          -- BehaviorPattern[]
  traits TEXT DEFAULT '[]',            -- Trait[]
  preferences TEXT DEFAULT '[]',       -- Preference[]
  competencies TEXT DEFAULT '[]',      -- Competency[]

  -- Experience metrics
  total_interactions INTEGER DEFAULT 0,
  total_decisions INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0.0,

  -- Expertise domains (JSON array)
  expertise_domains TEXT DEFAULT '[]',

  -- Behavioral metrics
  avg_session_duration INTEGER DEFAULT 0,
  peak_activity_hours TEXT DEFAULT '[]',
  anomaly_count INTEGER DEFAULT 0,
  last_anomaly_at INTEGER,

  -- Outcomes
  outcomes_successful INTEGER DEFAULT 0,
  outcomes_failed INTEGER DEFAULT 0,
  outcomes_neutral INTEGER DEFAULT 0,

  -- Temporal
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for context_dna
CREATE INDEX IF NOT EXISTS idx_context_dna_context ON context_dna(context_id);
CREATE INDEX IF NOT EXISTS idx_context_dna_chitty ON context_dna(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_context_dna_success ON context_dna(success_rate DESC);

-- ============================================================================
-- context_session_bindings: Sessions bound to contexts (replaces direct ChittyID binding)
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_session_bindings (
  id TEXT PRIMARY KEY,

  -- Session identifier (ephemeral)
  session_id TEXT NOT NULL,

  -- Context reference (session operates under context's authority)
  context_id TEXT NOT NULL REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL,
  context_hash TEXT NOT NULL,

  -- Binding lifecycle
  bound_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity INTEGER NOT NULL DEFAULT (unixepoch()),
  unbound_at INTEGER,
  unbind_reason TEXT CHECK (unbind_reason IN ('session_complete', 'timeout', 'error', 'revoked')),

  -- Session metrics (rolled up to context DNA on unbind)
  interactions_count INTEGER DEFAULT 0,
  decisions_count INTEGER DEFAULT 0,
  session_success_rate REAL,

  -- Platform/client info
  platform TEXT DEFAULT 'unknown',
  client_fingerprint TEXT,

  UNIQUE(session_id)
);

-- Indexes for context_session_bindings
CREATE INDEX IF NOT EXISTS idx_context_session_session ON context_session_bindings(session_id);
CREATE INDEX IF NOT EXISTS idx_context_session_context ON context_session_bindings(context_id);
CREATE INDEX IF NOT EXISTS idx_context_session_chitty ON context_session_bindings(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_context_session_hash ON context_session_bindings(context_hash);
CREATE INDEX IF NOT EXISTS idx_context_session_bound ON context_session_bindings(bound_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_session_active ON context_session_bindings(session_id)
  WHERE unbound_at IS NULL;

-- ============================================================================
-- context_trust_log: Audit trail for context trust changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_trust_log (
  id TEXT PRIMARY KEY,

  -- Context reference
  context_id TEXT NOT NULL REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL,

  -- Trust change
  previous_trust_level INTEGER NOT NULL,
  new_trust_level INTEGER NOT NULL,
  previous_trust_score REAL NOT NULL,
  new_trust_score REAL NOT NULL,

  -- Change details
  change_trigger TEXT NOT NULL,        -- What caused the change
  change_factors TEXT NOT NULL DEFAULT '{}',  -- JSON breakdown

  -- Session that triggered change (if applicable)
  session_id TEXT,

  -- Cryptographic proof
  content_hash TEXT NOT NULL,

  -- Temporal
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for context_trust_log
CREATE INDEX IF NOT EXISTS idx_context_trust_context ON context_trust_log(context_id);
CREATE INDEX IF NOT EXISTS idx_context_trust_chitty ON context_trust_log(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_context_trust_time ON context_trust_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_trust_trigger ON context_trust_log(change_trigger);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trigger_context_entities_updated
  AFTER UPDATE ON context_entities
  FOR EACH ROW
BEGIN
  UPDATE context_entities SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trigger_context_dna_updated
  AFTER UPDATE ON context_dna
  FOR EACH ROW
BEGIN
  UPDATE context_dna SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- ============================================================================
-- Views for common queries
-- ============================================================================

-- Active contexts with their DNA and session count
DROP VIEW IF EXISTS active_contexts;
CREATE VIEW active_contexts AS
SELECT
    ce.id,
    ce.chitty_id,
    ce.context_hash,
    ce.project_path,
    ce.workspace,
    ce.support_type,
    ce.organization,
    ce.trust_score,
    ce.trust_level,
    ce.total_sessions,
    ce.last_activity,
    cd.total_interactions,
    cd.success_rate,
    cd.expertise_domains,
    (SELECT COUNT(*) FROM context_session_bindings csb
     WHERE csb.context_id = ce.id AND csb.unbound_at IS NULL) as active_sessions
FROM context_entities ce
LEFT JOIN context_dna cd ON ce.id = cd.context_id
WHERE ce.status = 'active';

-- Sessions with their context info
DROP VIEW IF EXISTS sessions_with_context;
CREATE VIEW sessions_with_context AS
SELECT
    csb.session_id,
    csb.context_id,
    csb.context_chitty_id,
    csb.bound_at,
    csb.last_activity,
    csb.interactions_count,
    csb.platform,
    ce.project_path,
    ce.workspace,
    ce.support_type,
    ce.trust_level,
    ce.trust_score
FROM context_session_bindings csb
JOIN context_entities ce ON csb.context_id = ce.id
WHERE csb.unbound_at IS NULL;

-- Context trust history
DROP VIEW IF EXISTS context_trust_history;
CREATE VIEW context_trust_history AS
SELECT
    ctl.context_chitty_id,
    ce.project_path,
    ctl.previous_trust_level,
    ctl.new_trust_level,
    ctl.previous_trust_score,
    ctl.new_trust_score,
    ctl.change_trigger,
    ctl.changed_at,
    ctl.session_id
FROM context_trust_log ctl
JOIN context_entities ce ON ctl.context_id = ce.id
ORDER BY ctl.changed_at DESC;

-- Context by support type distribution
DROP VIEW IF EXISTS contexts_by_support_type;
CREATE VIEW contexts_by_support_type AS
SELECT
    support_type,
    COUNT(*) as count,
    AVG(trust_score) as avg_trust,
    SUM(total_sessions) as total_sessions,
    AVG(CASE WHEN status = 'active' THEN 1.0 ELSE 0.0 END) as active_rate
FROM context_entities
GROUP BY support_type;
