-- Migration: Enhanced Credential Provisions Audit Table
-- Created: 2025-11-08
-- Purpose: Add ContextConsciousness™ analysis fields to audit trail

-- Add new columns to existing table
ALTER TABLE credential_provisions ADD COLUMN risk_score INTEGER DEFAULT 0;
ALTER TABLE credential_provisions ADD COLUMN anomaly_detected INTEGER DEFAULT 0;
ALTER TABLE credential_provisions ADD COLUMN context_analysis TEXT;

-- Index for risk score queries
CREATE INDEX IF NOT EXISTS idx_credential_provisions_risk_score
  ON credential_provisions(risk_score DESC);

-- Index for anomaly detection queries
CREATE INDEX IF NOT EXISTS idx_credential_provisions_anomaly
  ON credential_provisions(anomaly_detected);

-- Create table for credential access patterns (for ContextConsciousness™ learning)
CREATE TABLE IF NOT EXISTS credential_access_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  service TEXT NOT NULL,
  credential_path TEXT NOT NULL,
  purpose TEXT,

  -- Pattern metrics
  access_count INTEGER DEFAULT 1,
  first_access DATETIME NOT NULL DEFAULT (datetime('now')),
  last_access DATETIME NOT NULL DEFAULT (datetime('now')),
  average_interval_seconds INTEGER,

  -- Context tracking
  environments TEXT, -- JSON array
  ip_addresses TEXT, -- JSON array
  user_agents TEXT, -- JSON array

  -- Risk metrics
  anomaly_count INTEGER DEFAULT 0,
  average_risk_score INTEGER DEFAULT 0,
  max_risk_score INTEGER DEFAULT 0,

  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),

  UNIQUE(service, credential_path) ON CONFLICT REPLACE
);

-- Index for pattern lookups
CREATE INDEX IF NOT EXISTS idx_credential_access_patterns_service
  ON credential_access_patterns(service);

CREATE INDEX IF NOT EXISTS idx_credential_access_patterns_path
  ON credential_access_patterns(credential_path);

-- Create table for 1Password cache metadata
CREATE TABLE IF NOT EXISTS onepassword_cache_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  credential_path TEXT NOT NULL UNIQUE,

  -- Cache statistics
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  last_cache_hit DATETIME,
  last_cache_miss DATETIME,

  -- Performance metrics
  average_fetch_time_ms INTEGER,
  last_fetch_time_ms INTEGER,

  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Index for cache performance queries
CREATE INDEX IF NOT EXISTS idx_onepassword_cache_metadata_path
  ON onepassword_cache_metadata(credential_path);
