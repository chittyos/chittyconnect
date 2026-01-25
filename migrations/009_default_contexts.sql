-- ChittyConnect Default Contexts
-- Migration 009: Seed default user and project contexts for ChittyOS
-- Purpose: Provide out-of-box contexts for ChittyOS framework

-- ============================================================================
-- Default User Context (Global)
-- ============================================================================
INSERT OR REPLACE INTO user_contexts (
  context_id,
  user_id,
  context_type,
  name,
  description,
  config,
  created_at,
  updated_at
) VALUES (
  'ctx_global_chittyos',
  'system',
  'global',
  'ChittyOS Global Context',
  'Default global context for all ChittyOS users',
  json_object(
    'agents', json_array(
      json_object(
        'name', 'chittyos-platform-guardian',
        'description', 'Ensures platform consistency and governance',
        'triggers', json_array('deployment', 'schema_change', 'security_event')
      ),
      json_object(
        'name', 'cloudflare-worker-architect',
        'description', 'Assists with Cloudflare Workers development',
        'triggers', json_array('worker_create', 'worker_deploy', 'performance_issue')
      ),
      json_object(
        'name', 'bullshit-detector',
        'description', 'Validates claims and identifies inconsistencies',
        'triggers', json_array('review', 'validation')
      )
    ),
    'commands', json_array(
      json_object('name', '/context', 'description', 'Manage session context'),
      json_object('name', '/chittycheck', 'description', 'Run ChittyOS health checks'),
      json_object('name', '/chittychat', 'description', 'Start collaborative session')
    ),
    'mcp_servers', json_array(
      json_object(
        'name', 'chittymcp',
        'url', 'https://mcp.chitty.cc',
        'tools', json_array('chronicle_log', 'evidence_submit', 'id_generate', 'context_get', 'context_set')
      )
    )
  ),
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================================================
-- ChittyOS Framework Project Context
-- ============================================================================
INSERT OR REPLACE INTO project_contexts (
  context_id,
  project_id,
  name,
  description,
  config,
  created_at,
  updated_at
) VALUES (
  'ctx_proj_chittyos_framework',
  'proj_chittyos_core',
  'ChittyOS Framework',
  'Core ChittyOS platform development context',
  json_object(
    'repositories', json_array(
      'CHITTYFOUNDATION/chittyid',
      'CHITTYFOUNDATION/chittyauth',
      'CHITTYFOUNDATION/chittyschema',
      'CHITTYOS/chittyconnect',
      'CHITTYOS/chittyagent',
      'CHITTYOS/chittyregistry'
    ),
    'services', json_array(
      json_object('name', 'ChittyID', 'url', 'https://id.chitty.cc'),
      json_object('name', 'ChittyAuth', 'url', 'https://auth.chitty.cc'),
      json_object('name', 'ChittyConnect', 'url', 'https://connect.chitty.cc'),
      json_object('name', 'ChittyRegistry', 'url', 'https://registry.chitty.cc')
    ),
    'conventions', json_object(
      'naming', 'chitty-{service}-{component}',
      'deployment', 'cloudflare_workers',
      'database', 'neon_postgresql'
    )
  ),
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================================================
-- ChittyRouter Project Context
-- ============================================================================
INSERT OR REPLACE INTO project_contexts (
  context_id,
  project_id,
  name,
  description,
  config,
  created_at,
  updated_at
) VALUES (
  'ctx_proj_chittyrouter',
  'proj_chittyrouter',
  'ChittyRouter',
  'AI gateway and message routing context',
  json_object(
    'repositories', json_array(
      'CHITTYOS/chittyrouter'
    ),
    'services', json_array(
      json_object('name', 'ChittyRouter', 'url', 'https://router.chitty.cc'),
      json_object('name', 'ChittyAgent', 'url', 'https://agent.chitty.cc')
    ),
    'integrations', json_array('openai', 'anthropic', 'cloudflare_ai')
  ),
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================================================
-- derail.me Project Context
-- ============================================================================
INSERT OR REPLACE INTO project_contexts (
  context_id,
  project_id,
  name,
  description,
  config,
  created_at,
  updated_at
) VALUES (
  'ctx_proj_derailme',
  'proj_derailme',
  'derail.me',
  'Personal productivity and focus tracking',
  json_object(
    'domain', 'derail.me',
    'features', json_array('focus_tracking', 'distraction_analysis', 'productivity_insights')
  ),
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================================================
-- Ensure tables exist (create if not present)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_contexts (
  context_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  context_type TEXT NOT NULL DEFAULT 'user',
  name TEXT NOT NULL,
  description TEXT,
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_contexts (
  context_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_contexts_user ON user_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_project_contexts_project ON project_contexts(project_id);
