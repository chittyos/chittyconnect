-- Migration: Create actors table
-- Description: Registry of actors (humans, AI agents, services) with capabilities
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS actors (
  -- Primary identifier (ChittyID from ChittyAuth)
  chitty_id TEXT PRIMARY KEY NOT NULL,

  -- Actor type
  actor_type TEXT NOT NULL CHECK(actor_type IN ('human', 'ai', 'service', 'system')),

  -- Display information
  display_name TEXT DEFAULT NULL,
  email TEXT DEFAULT NULL,
  avatar_url TEXT DEFAULT NULL,

  -- Capabilities (JSON array of capability strings)
  capabilities TEXT DEFAULT '[]',

  -- ChittyOS integration
  chitty_dna_id TEXT DEFAULT NULL,
  chitty_auth_principal_id TEXT DEFAULT NULL,  -- Principal ID in ChittyAuth

  -- Session management
  last_seen_at TEXT DEFAULT NULL,
  session_count INTEGER DEFAULT 0,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for actor type
CREATE INDEX IF NOT EXISTS idx_actors_type
ON actors(actor_type);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_actors_email
ON actors(email)
WHERE email IS NOT NULL;

-- Index for active actors
CREATE INDEX IF NOT EXISTS idx_actors_active
ON actors(status)
WHERE status = 'active';

-- Index for ChittyAuth principal
CREATE INDEX IF NOT EXISTS idx_actors_principal
ON actors(chitty_auth_principal_id)
WHERE chitty_auth_principal_id IS NOT NULL;

-- Index for last seen (for activity tracking)
CREATE INDEX IF NOT EXISTS idx_actors_last_seen
ON actors(last_seen_at DESC);

-- Comments:
-- chitty_id: ChittyID from ChittyAuth (format: CHITTY-PEO-{uuid} for humans, etc.)
-- actor_type: Type of actor (human, ai, service, system)
-- display_name: Human-readable name for the actor
-- email: Email address (for human actors)
-- avatar_url: URL to avatar image
-- capabilities: JSON array of capabilities (e.g., ["admin","developer","analyst"])
-- chitty_dna_id: ChittyID of DNA record tracking actor evolution
-- chitty_auth_principal_id: Principal ID in ChittyAuth system
-- last_seen_at: Last activity timestamp
-- session_count: Number of sessions created (for analytics)
-- status: Current actor status (active, suspended, deleted)
-- created_at: When the actor was first registered
-- updated_at: Last modification timestamp
