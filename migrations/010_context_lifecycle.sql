-- Migration: 010_context_lifecycle.sql
-- Description: Context Lifecycle Operations - Collaborations, Pairs, Supernova/Fission
-- Date: 2026-01-24
-- D1-Compatible (SQLite syntax)
--
-- @canonical-uri chittycanon://core/services/chittyconnect/migrations/010-context-lifecycle
-- @version 1.0.0
-- @status CERTIFIED
--
-- ============================================================================
-- JSON FIELD SCHEMAS
-- ============================================================================
--
-- context_collaborations.scope (delegation scope):
-- {
--   "type": "solution",
--   "members": ["chid1", "chid2"],
--   "roles": {
--     "chid1": "lead",
--     "chid2": "support"
--   },
--   "boundaries": ["read", "write"],
--   "restrictions": ["no_deploy", "no_delete"]
-- }
--
-- context_collaborations.permissions (array of permission strings):
-- ["read", "write", "review", "approve", "collaborate"]
--
-- context_pairs.overlap_competencies (array of shared competencies):
-- ["typescript", "api-design", "testing"]
--
-- context_pairs.unique_competencies_1 (array of ctx1-only competencies):
-- ["react", "css", "frontend"]
--
-- context_pairs.unique_competencies_2 (array of ctx2-only competencies):
-- ["postgresql", "deployment", "cloudflare"]
--
-- context_lifecycle_events.source_chitty_ids (array of source ChittyIDs):
-- ["03-1-USA-0001-T-2601-0-01", "03-1-USA-0002-T-2601-0-02"]
--
-- context_lifecycle_events.result_chitty_ids (array of result ChittyIDs):
-- ["03-1-USA-0003-S-2601-0-01"]  -- 'S' = supernova (merged)
--
-- context_lifecycle_events.analysis (operation analysis results):
-- {
--   "risks": [
--     {"type": "trust_dilution", "severity": "high"},
--     {"type": "role_conflict", "severity": "medium"}
--   ],
--   "riskLevel": "warning",
--   "recommendation": "caution",
--   "mergedPreview": {
--     "competencies": ["typescript", "react", "postgresql"],
--     "domains": ["frontend", "backend"],
--     "trustLevel": 3
--   }
-- }
--
-- context_lifecycle_events.decision (decision details):
-- {
--   "action": "execute_supernova",
--   "confirmedBy": "user",
--   "confirmationToken": "tok_abc123",
--   "timestamp": 1705603200
-- }
-- ============================================================================

-- ============================================================================
-- context_collaborations: Delegation relationships between contexts
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_collaborations (
  id TEXT PRIMARY KEY,

  -- Parent context (the delegator)
  parent_context_id TEXT NOT NULL REFERENCES context_entities(id),
  parent_chitty_id TEXT NOT NULL,

  -- Child context (the delegatee)
  child_context_id TEXT NOT NULL REFERENCES context_entities(id),
  child_chitty_id TEXT NOT NULL,

  -- Project scope
  project_id TEXT,
  scope TEXT DEFAULT '{}',           -- JSON: what's being delegated
  permissions TEXT DEFAULT '[]',     -- JSON: what the child can do

  -- Lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'revoked')),
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT,

  -- Metrics
  interactions_delegated INTEGER DEFAULT 0,
  decisions_delegated INTEGER DEFAULT 0,
  success_rate REAL
);

CREATE INDEX IF NOT EXISTS idx_collab_parent ON context_collaborations(parent_chitty_id);
CREATE INDEX IF NOT EXISTS idx_collab_child ON context_collaborations(child_chitty_id);
CREATE INDEX IF NOT EXISTS idx_collab_project ON context_collaborations(project_id);
CREATE INDEX IF NOT EXISTS idx_collab_status ON context_collaborations(status);
CREATE INDEX IF NOT EXISTS idx_collab_active ON context_collaborations(parent_chitty_id) WHERE status = 'active';

-- ============================================================================
-- context_pairs: Complementary context relationships
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_pairs (
  id TEXT PRIMARY KEY,

  -- First context
  context_id_1 TEXT NOT NULL REFERENCES context_entities(id),
  chitty_id_1 TEXT NOT NULL,

  -- Second context
  context_id_2 TEXT NOT NULL REFERENCES context_entities(id),
  chitty_id_2 TEXT NOT NULL,

  -- Relationship
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'pair_programming', 'review_partner', 'mentor_mentee',
    'specialist_generalist', 'dev_ops', 'frontend_backend', 'custom'
  )),
  complementarity TEXT CHECK (complementarity IN ('complementary', 'overlapping', 'synergistic')),

  -- Analysis
  overlap_competencies TEXT DEFAULT '[]',     -- JSON: shared competencies
  unique_competencies_1 TEXT DEFAULT '[]',    -- JSON: ctx1 only
  unique_competencies_2 TEXT DEFAULT '[]',    -- JSON: ctx2 only
  synergy_score REAL,

  -- Lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'dissolved')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  dissolved_at INTEGER,
  dissolve_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_pairs_ctx1 ON context_pairs(chitty_id_1);
CREATE INDEX IF NOT EXISTS idx_pairs_ctx2 ON context_pairs(chitty_id_2);
CREATE INDEX IF NOT EXISTS idx_pairs_type ON context_pairs(relationship_type);
CREATE INDEX IF NOT EXISTS idx_pairs_status ON context_pairs(status);

-- ============================================================================
-- context_lifecycle_events: Audit trail for lifecycle operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_lifecycle_events (
  id TEXT PRIMARY KEY,

  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN (
    'supernova_analysis', 'supernova_executed',
    'fission_analysis', 'fission_executed',
    'collaboration_created', 'collaboration_ended',
    'pair_created', 'pair_dissolved',
    'drift_detected', 'context_switched'
  )),

  -- Contexts involved
  source_chitty_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array
  result_chitty_ids TEXT DEFAULT '[]',           -- JSON array (for supernova/fission)

  -- Event data
  analysis TEXT DEFAULT '{}',      -- JSON: analysis details
  decision TEXT DEFAULT '{}',      -- JSON: decision made
  user_confirmed INTEGER DEFAULT 0,

  -- Temporal
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),

  -- Actor (who triggered this)
  triggered_by TEXT,               -- session_id or system
  trigger_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_type ON context_lifecycle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lifecycle_time ON context_lifecycle_events(created_at DESC);

-- ============================================================================
-- Views for lifecycle operations
-- ============================================================================

-- Active collaborations with context details
DROP VIEW IF EXISTS active_collaborations;
CREATE VIEW active_collaborations AS
SELECT
  cc.id as collaboration_id,
  cc.parent_chitty_id,
  ce_p.project_path as parent_project,
  ce_p.trust_level as parent_trust,
  cc.child_chitty_id,
  ce_c.project_path as child_project,
  ce_c.trust_level as child_trust,
  cc.project_id,
  cc.scope,
  cc.permissions,
  cc.started_at,
  cc.expires_at
FROM context_collaborations cc
JOIN context_entities ce_p ON cc.parent_context_id = ce_p.id
JOIN context_entities ce_c ON cc.child_context_id = ce_c.id
WHERE cc.status = 'active'
  AND (cc.expires_at IS NULL OR cc.expires_at > unixepoch());

-- Context pairs with analysis
DROP VIEW IF EXISTS context_pair_analysis;
CREATE VIEW context_pair_analysis AS
SELECT
  cp.id as pair_id,
  cp.chitty_id_1,
  ce1.support_type as support_type_1,
  cp.chitty_id_2,
  ce2.support_type as support_type_2,
  cp.relationship_type,
  cp.complementarity,
  cp.synergy_score,
  cp.overlap_competencies,
  cp.unique_competencies_1,
  cp.unique_competencies_2
FROM context_pairs cp
JOIN context_entities ce1 ON cp.context_id_1 = ce1.id
JOIN context_entities ce2 ON cp.context_id_2 = ce2.id
WHERE cp.status = 'active';

-- Recent lifecycle events
DROP VIEW IF EXISTS recent_lifecycle_events;
CREATE VIEW recent_lifecycle_events AS
SELECT
  event_type,
  source_chitty_ids,
  result_chitty_ids,
  user_confirmed,
  trigger_reason,
  created_at
FROM context_lifecycle_events
ORDER BY created_at DESC
LIMIT 100;
