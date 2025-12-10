-- Migration: Credential Provisioning Audit Table
-- Created: 2025-11-06
-- Purpose: Track all credential provisioning operations for ChittyOS services

-- Table: credential_provisions
-- Stores audit log of all provisioned credentials
CREATE TABLE IF NOT EXISTS credential_provisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Credential information
  type TEXT NOT NULL,                    -- e.g., 'cloudflare_workers_deploy', 'github_deploy_token'
  service TEXT NOT NULL,                 -- Target service name (e.g., 'chittyregister')
  purpose TEXT,                          -- Purpose description (e.g., 'github_actions')

  -- Request tracking
  requesting_service TEXT NOT NULL,      -- Service that requested the credential

  -- Token tracking (for Cloudflare tokens)
  token_id TEXT,                         -- Cloudflare token ID for revocation

  -- Lifecycle
  expires_at DATETIME,                   -- When the credential expires
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  revoked_at DATETIME,                   -- When the credential was revoked (if applicable)

  -- Indexes for common queries
  UNIQUE(token_id) ON CONFLICT IGNORE
);

-- Index for service lookups
CREATE INDEX IF NOT EXISTS idx_credential_provisions_service
  ON credential_provisions(service);

-- Index for type lookups
CREATE INDEX IF NOT EXISTS idx_credential_provisions_type
  ON credential_provisions(type);

-- Index for requesting service lookups
CREATE INDEX IF NOT EXISTS idx_credential_provisions_requesting_service
  ON credential_provisions(requesting_service);

-- Index for expiration tracking
CREATE INDEX IF NOT EXISTS idx_credential_provisions_expires_at
  ON credential_provisions(expires_at);

-- Index for revocation tracking
CREATE INDEX IF NOT EXISTS idx_credential_provisions_revoked_at
  ON credential_provisions(revoked_at);

-- Index for chronological queries
CREATE INDEX IF NOT EXISTS idx_credential_provisions_created_at
  ON credential_provisions(created_at DESC);
