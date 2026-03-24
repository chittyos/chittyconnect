-- Migration: 014_doctrine_lifecycle_states.sql
-- Description: Align entity lifecycle states with synthetic-continuity doctrine
-- Date: 2026-03-22
-- D1-Compatible (SQLite syntax)
--
-- @canonical-uri chittycanon://core/services/chittyconnect/migrations/014-doctrine-lifecycle
-- @canon-ref chittycanon://doctrine/synthetic-continuity
-- @version 1.0.0
-- @status DRAFT
--
-- Doctrine lifecycle states: fresh → active → dormant → stale → retired
-- Previous states (archived, revoked) mapped to: retired
--
-- SQLite CHECK constraints cannot be altered in-place. This migration:
-- 1. Creates a new table with correct CHECK constraint
-- 2. Copies data (mapping old states to new)
-- 3. Drops old table, renames new
-- ============================================================================

-- Step 1: Create new table with doctrine-compliant lifecycle states
CREATE TABLE IF NOT EXISTS context_entities_v2 (
  id TEXT PRIMARY KEY,
  chitty_id TEXT NOT NULL UNIQUE,
  context_hash TEXT,
  anchor_hash TEXT,

  -- Context metadata
  project_path TEXT,
  workspace TEXT,
  support_type TEXT DEFAULT 'development',
  organization TEXT,

  -- Identity
  signature TEXT,
  issuer TEXT,

  -- Trust (behavioral, earned through cycles — NOT credential verification)
  trust_score REAL DEFAULT 0,
  trust_level INTEGER DEFAULT 0,

  -- Session tracking
  current_sessions TEXT DEFAULT '[]',
  total_sessions INTEGER DEFAULT 0,

  -- Lifecycle: per chittycanon://doctrine/synthetic-continuity
  -- fresh: newly minted, no sessions yet
  -- active: has active sessions, accumulating experience
  -- dormant: no active sessions, but reconstitutable (instinct preserved)
  -- stale: dormant long enough that reconstitution may lose fidelity
  -- retired: consumed by supernova/fission, or composted after decay
  status TEXT DEFAULT 'fresh' CHECK (status IN ('fresh', 'active', 'dormant', 'stale', 'retired', 'dissolved')),

  -- Temporal
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity INTEGER,

  -- Anomaly tracking
  anomaly_count INTEGER DEFAULT 0
);

-- Step 2: Copy data with state mapping
INSERT OR IGNORE INTO context_entities_v2
SELECT
  id,
  chitty_id,
  context_hash,
  anchor_hash,
  project_path,
  workspace,
  support_type,
  organization,
  signature,
  issuer,
  trust_score,
  trust_level,
  current_sessions,
  total_sessions,
  CASE status
    WHEN 'active' THEN 'active'
    WHEN 'dormant' THEN 'dormant'
    WHEN 'archived' THEN 'retired'
    WHEN 'revoked' THEN 'retired'
    ELSE 'dormant'
  END,
  created_at,
  last_activity,
  anomaly_count
FROM context_entities;

-- Step 3: Drop old, rename new
DROP TABLE IF EXISTS context_entities;
ALTER TABLE context_entities_v2 RENAME TO context_entities;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_entities_chitty_id ON context_entities(chitty_id);
CREATE INDEX IF NOT EXISTS idx_entities_hash ON context_entities(context_hash);
CREATE INDEX IF NOT EXISTS idx_entities_status ON context_entities(status);
CREATE INDEX IF NOT EXISTS idx_entities_project ON context_entities(project_path);
CREATE INDEX IF NOT EXISTS idx_entities_activity ON context_entities(last_activity DESC);
