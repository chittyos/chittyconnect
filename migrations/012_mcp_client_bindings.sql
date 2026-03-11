-- Migration 012: MCP Client Bindings (Zero-Trust State Hardening)
--
-- Source of truth for MCP client → ChittyID mappings.
-- KV is a fast-path cache; this table is the durable backing store.
-- Supports revocation, trust tracking, and audit.
--
-- @canon: chittycanon://gov/governance#core-types

CREATE TABLE IF NOT EXISTS mcp_client_bindings (
  id            SERIAL PRIMARY KEY,
  cache_key     TEXT NOT NULL UNIQUE,       -- KV key: mcp-client:{clientId}[:s:{spaceId}][:u:{userId}]
  client_id     TEXT NOT NULL,              -- OAuth client_id
  space_id      TEXT,                       -- Notion workspace (nullable)
  user_id       TEXT,                       -- Notion user (nullable)
  chitty_id     TEXT NOT NULL,              -- Minted ChittyID (type P / Synthetic)
  status        TEXT NOT NULL DEFAULT 'active',  -- active | revoked | suspended
  trust_level   INTEGER NOT NULL DEFAULT 2,      -- 0-5 per ChittyTrust scale
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,                       -- ChittyID of revoker
  revoke_reason TEXT,
  auth_count    INTEGER NOT NULL DEFAULT 1, -- Number of successful authorizations
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  minted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups by cache_key (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_mcp_client_bindings_cache_key
  ON mcp_client_bindings (cache_key);

-- Find all bindings for a client_id (admin/audit)
CREATE INDEX IF NOT EXISTS idx_mcp_client_bindings_client_id
  ON mcp_client_bindings (client_id);

-- Find all bindings for a ChittyID (reverse lookup)
CREATE INDEX IF NOT EXISTS idx_mcp_client_bindings_chitty_id
  ON mcp_client_bindings (chitty_id);

-- Active bindings only (zero-trust: filter revoked on every query)
CREATE INDEX IF NOT EXISTS idx_mcp_client_bindings_active
  ON mcp_client_bindings (cache_key) WHERE status = 'active';
