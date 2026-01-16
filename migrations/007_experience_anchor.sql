-- Migration: 007_experience_anchor.sql
-- Description: Experience Anchor Model - ChittyID binding for experience accumulation
-- Date: 2026-01-08
-- D1-Compatible (SQLite syntax)

-- ============================================================================
-- experience_profiles: Links ChittyID to accumulated experience metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS experience_profiles (
  id TEXT PRIMARY KEY,

  -- ChittyID anchor (links to master_entities in chittyos-core)
  chitty_id TEXT NOT NULL UNIQUE,

  -- Experience metrics
  total_interactions INTEGER DEFAULT 0,
  total_decisions INTEGER DEFAULT 0,
  total_entities INTEGER DEFAULT 0,

  -- Trust evolution
  current_trust_level INTEGER DEFAULT 3 CHECK (current_trust_level BETWEEN 0 AND 5),
  trust_score REAL DEFAULT 50.00 CHECK (trust_score BETWEEN 0 AND 100),
  trust_last_calculated INTEGER,
  trust_calculation_version TEXT DEFAULT 'v1.0',
  interactions_at_last_calc INTEGER DEFAULT 0,

  -- Expertise metrics
  expertise_domains TEXT DEFAULT '[]',
  success_rate REAL DEFAULT 0.0,
  confidence_score REAL DEFAULT 50.00,

  -- Risk and accountability
  risk_score REAL DEFAULT 0.00 CHECK (risk_score BETWEEN 0 AND 100),
  anomaly_count INTEGER DEFAULT 0,
  last_anomaly_at INTEGER,

  -- Retention tracking
  first_seen INTEGER DEFAULT (unixepoch()),
  oldest_interaction INTEGER,
  newest_interaction INTEGER,
  memory_utilization_bytes INTEGER DEFAULT 0,

  -- Temporal
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for experience_profiles
CREATE INDEX IF NOT EXISTS idx_experience_profiles_chitty_id ON experience_profiles(chitty_id);
CREATE INDEX IF NOT EXISTS idx_experience_profiles_trust_level ON experience_profiles(current_trust_level);
CREATE INDEX IF NOT EXISTS idx_experience_profiles_trust_score ON experience_profiles(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_experience_profiles_risk_score ON experience_profiles(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_experience_profiles_newest ON experience_profiles(newest_interaction DESC);

-- ============================================================================
-- session_chittyid_bindings: Binds ephemeral sessions to persistent ChittyID
-- ============================================================================
CREATE TABLE IF NOT EXISTS session_chittyid_bindings (
  id TEXT PRIMARY KEY,

  -- Session identifier (ephemeral)
  session_id TEXT NOT NULL,

  -- ChittyID anchor (persistent)
  chitty_id TEXT NOT NULL,

  -- Binding metadata
  platform TEXT NOT NULL DEFAULT 'unknown',
  client_fingerprint TEXT,

  -- Session lifecycle
  bound_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity INTEGER NOT NULL DEFAULT (unixepoch()),
  unbound_at INTEGER,
  unbind_reason TEXT,

  -- Experience accumulation during session
  interactions_count INTEGER DEFAULT 0,
  decisions_count INTEGER DEFAULT 0,
  entities_discovered INTEGER DEFAULT 0,

  -- Session quality metrics
  session_risk_score REAL DEFAULT 0.00,
  session_success_rate REAL,

  -- Constraints
  UNIQUE(session_id, chitty_id)
);

-- Indexes for session_chittyid_bindings
CREATE INDEX IF NOT EXISTS idx_session_bindings_session ON session_chittyid_bindings(session_id);
CREATE INDEX IF NOT EXISTS idx_session_bindings_chitty ON session_chittyid_bindings(chitty_id);
CREATE INDEX IF NOT EXISTS idx_session_bindings_platform ON session_chittyid_bindings(platform);
CREATE INDEX IF NOT EXISTS idx_session_bindings_bound_at ON session_chittyid_bindings(bound_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_bindings_active ON session_chittyid_bindings(session_id, chitty_id)
  WHERE unbound_at IS NULL;

-- ============================================================================
-- trust_evolution_log: Audit trail for trust level changes
-- ============================================================================
CREATE TABLE IF NOT EXISTS trust_evolution_log (
  id TEXT PRIMARY KEY,

  chitty_id TEXT NOT NULL,

  -- Trust change
  previous_trust_level INTEGER NOT NULL,
  new_trust_level INTEGER NOT NULL,
  previous_trust_score REAL NOT NULL,
  new_trust_score REAL NOT NULL,

  -- Change reasoning
  change_trigger TEXT NOT NULL,
  change_factors TEXT NOT NULL DEFAULT '{}',

  -- Cryptographic proof
  drand_round INTEGER,
  drand_randomness TEXT,
  content_hash TEXT NOT NULL,

  -- Temporal
  changed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for trust_evolution_log
CREATE INDEX IF NOT EXISTS idx_trust_evolution_chitty ON trust_evolution_log(chitty_id);
CREATE INDEX IF NOT EXISTS idx_trust_evolution_time ON trust_evolution_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_evolution_trigger ON trust_evolution_log(change_trigger);

-- ============================================================================
-- Update trigger for experience_profiles.updated_at
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trigger_experience_profiles_updated_at
  AFTER UPDATE ON experience_profiles
  FOR EACH ROW
BEGIN
  UPDATE experience_profiles SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- ============================================================================
-- Views for common queries
-- ============================================================================

-- Active sessions with ChittyID context
DROP VIEW IF EXISTS active_session_bindings;
CREATE VIEW active_session_bindings AS
SELECT
    scb.session_id,
    scb.chitty_id,
    scb.platform,
    scb.bound_at,
    scb.last_activity,
    scb.interactions_count,
    scb.decisions_count,
    scb.session_risk_score,
    ep.current_trust_level,
    ep.trust_score,
    ep.total_interactions as lifetime_interactions,
    ep.expertise_domains
FROM session_chittyid_bindings scb
LEFT JOIN experience_profiles ep ON scb.chitty_id = ep.chitty_id
WHERE scb.unbound_at IS NULL;

-- Trust level distribution
DROP VIEW IF EXISTS trust_level_distribution;
CREATE VIEW trust_level_distribution AS
SELECT
    current_trust_level,
    COUNT(*) as count,
    AVG(trust_score) as avg_score,
    AVG(total_interactions) as avg_interactions,
    AVG(risk_score) as avg_risk
FROM experience_profiles
GROUP BY current_trust_level
ORDER BY current_trust_level DESC;

-- Recent trust changes
DROP VIEW IF EXISTS recent_trust_changes;
CREATE VIEW recent_trust_changes AS
SELECT
    tel.chitty_id,
    tel.previous_trust_level,
    tel.new_trust_level,
    tel.previous_trust_score,
    tel.new_trust_score,
    tel.change_trigger,
    tel.changed_at,
    ep.total_interactions,
    ep.anomaly_count
FROM trust_evolution_log tel
LEFT JOIN experience_profiles ep ON tel.chitty_id = ep.chitty_id
ORDER BY tel.changed_at DESC
LIMIT 100;
