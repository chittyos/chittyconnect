-- Migration: Create connections table
-- Description: Track active connections between contexts and services
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS connections (
  -- Primary identifier
  connection_id TEXT PRIMARY KEY NOT NULL,

  -- Source (context or actor)
  source_chitty_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('context', 'actor')),

  -- Target (service or system)
  target_service TEXT NOT NULL,  -- Service name (e.g., 'chittychronicle', 'github', 'notion')
  target_endpoint TEXT DEFAULT NULL,  -- Optional specific endpoint

  -- Connection metadata
  connection_type TEXT NOT NULL DEFAULT 'api' CHECK(connection_type IN ('api', 'webhook', 'oauth', 'direct')),

  -- Credentials (encrypted or reference to KV)
  credentials_kv_key TEXT DEFAULT NULL,  -- Key in API_KEYS KV namespace

  -- Health and status
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'failed', 'disconnected')),
  last_health_check TEXT DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  error_count INTEGER DEFAULT 0,

  -- Usage tracking
  request_count INTEGER DEFAULT 0,
  last_used_at TEXT DEFAULT NULL,

  -- Configuration (JSON)
  config TEXT DEFAULT '{}',

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at TEXT DEFAULT NULL
);

-- Index for source lookups
CREATE INDEX IF NOT EXISTS idx_connections_source
ON connections(source_chitty_id);

-- Index for target service
CREATE INDEX IF NOT EXISTS idx_connections_target
ON connections(target_service);

-- Index for active connections
CREATE INDEX IF NOT EXISTS idx_connections_active
ON connections(status)
WHERE status = 'active';

-- Index for connection type
CREATE INDEX IF NOT EXISTS idx_connections_type
ON connections(connection_type);

-- Index for source+target combo (unique active connections)
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_source_target_unique
ON connections(source_chitty_id, target_service, target_endpoint)
WHERE status = 'active' AND target_endpoint IS NOT NULL;

-- Index for health status
CREATE INDEX IF NOT EXISTS idx_connections_health
ON connections(last_health_check DESC);

-- Comments:
-- connection_id: Unique identifier for this connection (UUID format)
-- source_chitty_id: ChittyID of the context or actor making the connection
-- source_type: Whether source is a 'context' or 'actor'
-- target_service: Name of the target service (e.g., 'chittychronicle', 'github')
-- target_endpoint: Specific endpoint if applicable (e.g., '/api/v1/events')
-- connection_type: How the connection is established (api, webhook, oauth, direct)
-- credentials_kv_key: Key to retrieve credentials from API_KEYS KV namespace
-- status: Current connection status (active, inactive, failed, disconnected)
-- last_health_check: Last time connection health was verified
-- last_error: Last error message if connection failed
-- error_count: Number of consecutive errors (for circuit breaker logic)
-- request_count: Total requests made through this connection (analytics)
-- last_used_at: Last time this connection was used
-- config: JSON configuration object for connection-specific settings
-- created_at: When connection was established
-- updated_at: Last modification timestamp
-- disconnected_at: When connection was disconnected (NULL if active)
