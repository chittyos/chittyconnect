-- Migration: Create contexts table
-- Description: Store context records with ChittyID compliance
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS contexts (
  -- Primary identifier
  chitty_id TEXT PRIMARY KEY NOT NULL,

  -- Context metadata
  name TEXT NOT NULL UNIQUE,
  owner_chitty_id TEXT NOT NULL,

  -- Context configuration (JSON)
  data TEXT DEFAULT '[]',  -- JSON array of data sources
  systems TEXT DEFAULT '[]',  -- JSON array of ChittyOS systems
  tools TEXT DEFAULT '[]',  -- JSON array of available tools

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Soft delete support
  deleted_at TEXT DEFAULT NULL,

  -- ChittyOS integration metadata
  chitty_dna_id TEXT DEFAULT NULL,  -- Reference to ChittyDNA record
  chitty_chronicle_timeline_id TEXT DEFAULT NULL,  -- Reference to Chronicle timeline

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'deleted'))
);

-- Index for fast lookups by owner
CREATE INDEX IF NOT EXISTS idx_contexts_owner
ON contexts(owner_chitty_id);

-- Index for name lookups
CREATE INDEX IF NOT EXISTS idx_contexts_name
ON contexts(name);

-- Index for active contexts only
CREATE INDEX IF NOT EXISTS idx_contexts_active
ON contexts(status)
WHERE status = 'active';

-- Index for created timestamp (for pagination)
CREATE INDEX IF NOT EXISTS idx_contexts_created
ON contexts(created_at DESC);

-- Comments (SQLite doesn't support table comments, but this documents the schema)
-- chitty_id: ChittyID minted from id.chitty.cc (format: CHITTY-CONTEXT-{uuid})
-- name: Human-readable unique name for the context
-- owner_chitty_id: ChittyID of the actor who owns this context
-- data: JSON array of data sources (e.g., ["notion", "github", "google"])
-- systems: JSON array of ChittyOS systems (e.g., ["chittyid", "chittyauth"])
-- tools: JSON array of available tools (e.g., ["calculator", "search"])
-- created_at: ISO 8601 timestamp
-- updated_at: ISO 8601 timestamp
-- deleted_at: ISO 8601 timestamp (NULL if not deleted - soft delete pattern)
-- chitty_dna_id: ChittyID of the DNA record tracking this context's evolution
-- chitty_chronicle_timeline_id: ChittyID of the Chronicle timeline for this context
-- status: Current status of the context (active, inactive, deleted)
