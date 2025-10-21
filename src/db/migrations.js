/**
 * Database Migrations
 *
 * SQL migrations exported as JavaScript strings for Cloudflare Workers
 * Source: migrations/*.sql
 */

export const migration_0001_contexts = `
-- Migration: Create contexts table
-- Description: Store context records with ChittyID compliance
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS contexts (
  chitty_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  owner_chitty_id TEXT NOT NULL,
  data TEXT DEFAULT '[]',
  systems TEXT DEFAULT '[]',
  tools TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  chitty_dna_id TEXT DEFAULT NULL,
  chitty_chronicle_timeline_id TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_contexts_owner ON contexts(owner_chitty_id);
CREATE INDEX IF NOT EXISTS idx_contexts_name ON contexts(name);
CREATE INDEX IF NOT EXISTS idx_contexts_active ON contexts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_contexts_created ON contexts(created_at DESC);
`;

export const migration_0002_installations = `
-- Migration: Create installations table
-- Description: Store GitHub App installations with ChittyID tracking
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS installations (
  installation_id INTEGER PRIMARY KEY NOT NULL,
  chitty_id TEXT NOT NULL UNIQUE,
  chitty_dna_id TEXT DEFAULT NULL,
  account_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('User', 'Organization')),
  account_avatar_url TEXT DEFAULT NULL,
  repository_selection TEXT NOT NULL CHECK(repository_selection IN ('all', 'selected')),
  permissions TEXT DEFAULT '{}',
  events TEXT DEFAULT '[]',
  selected_repositories TEXT DEFAULT '[]',
  suspended_at TEXT DEFAULT NULL,
  suspended_by_chitty_id TEXT DEFAULT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_installations_chitty_id ON installations(chitty_id);
CREATE INDEX IF NOT EXISTS idx_installations_account ON installations(account_id);
CREATE INDEX IF NOT EXISTS idx_installations_account_login ON installations(account_login);
CREATE INDEX IF NOT EXISTS idx_installations_active ON installations(uninstalled_at) WHERE uninstalled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_installations_installed ON installations(installed_at DESC);
`;

export const migration_0003_actors = `
-- Migration: Create actors table
-- Description: Registry of actors (humans, AI agents, services) with capabilities
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS actors (
  chitty_id TEXT PRIMARY KEY NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('human', 'ai', 'service', 'system')),
  display_name TEXT DEFAULT NULL,
  email TEXT DEFAULT NULL,
  avatar_url TEXT DEFAULT NULL,
  capabilities TEXT DEFAULT '[]',
  chitty_dna_id TEXT DEFAULT NULL,
  chitty_auth_principal_id TEXT DEFAULT NULL,
  last_seen_at TEXT DEFAULT NULL,
  session_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_actors_type ON actors(actor_type);
CREATE INDEX IF NOT EXISTS idx_actors_email ON actors(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actors_active ON actors(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_actors_principal ON actors(chitty_auth_principal_id) WHERE chitty_auth_principal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actors_last_seen ON actors(last_seen_at DESC);
`;

export const migration_0004_connections = `
-- Migration: Create connections table
-- Description: Track active connections between contexts and services
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS connections (
  connection_id TEXT PRIMARY KEY NOT NULL,
  source_chitty_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('context', 'actor')),
  target_service TEXT NOT NULL,
  target_endpoint TEXT DEFAULT NULL,
  connection_type TEXT NOT NULL DEFAULT 'api' CHECK(connection_type IN ('api', 'webhook', 'oauth', 'direct')),
  credentials_kv_key TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'failed', 'disconnected')),
  last_health_check TEXT DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  error_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  last_used_at TEXT DEFAULT NULL,
  config TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_chitty_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_service);
CREATE INDEX IF NOT EXISTS idx_connections_active ON connections(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(connection_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_source_target_unique ON connections(source_chitty_id, target_service, target_endpoint) WHERE status = 'active' AND target_endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connections_health ON connections(last_health_check DESC);
`;

/**
 * All migrations in order
 */
export const allMigrations = [
  { name: '0001_create_contexts_table', sql: migration_0001_contexts },
  { name: '0002_create_installations_table', sql: migration_0002_installations },
  { name: '0003_create_actors_table', sql: migration_0003_actors },
  { name: '0004_create_connections_table', sql: migration_0004_connections },
];
