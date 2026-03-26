-- Migration 013: Connections Registry
-- Unified registry of all ChittyOS services and third-party integrations

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('chittyos_service', 'thirdparty', 'database', 'ai_provider')),
  provider TEXT,
  base_url TEXT,
  health_endpoint TEXT,
  api_version TEXT,
  config_json TEXT DEFAULT '{}',
  credential_source TEXT DEFAULT 'env' CHECK (credential_source IN ('onepassword', 'env', 'oauth', 'none')),
  credential_path TEXT,
  credential_env_var TEXT,
  service_token_pattern TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  last_health_check DATETIME,
  last_health_status TEXT,
  last_health_latency_ms INTEGER,
  last_used_at DATETIME,
  error_count INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  description TEXT,
  icon TEXT,
  tier INTEGER,
  tags TEXT DEFAULT '[]',
  depends_on TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connection_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  status TEXT NOT NULL,
  latency_ms INTEGER,
  status_code INTEGER,
  error_message TEXT,
  checked_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_connections_category ON connections(category);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
CREATE INDEX IF NOT EXISTS idx_connections_slug ON connections(slug);
CREATE INDEX IF NOT EXISTS idx_health_log_connection ON connection_health_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_health_log_checked ON connection_health_log(checked_at);

-- Seed: ChittyOS Services (Tier 0-5)
INSERT OR IGNORE INTO connections (id, name, slug, category, provider, base_url, health_endpoint, tier, credential_source, service_token_pattern, status, description, icon, depends_on) VALUES
  ('conn-chittyid', 'ChittyID', 'chittyid', 'chittyos_service', 'chittyos', 'https://id.chitty.cc', '/health', 0, 'env', 'CHITTY_ID_TOKEN', 'active', 'Identity minting and validation', 'ID', '[]'),
  ('conn-chittytrust', 'ChittyTrust', 'chittytrust', 'chittyos_service', 'chittyos', 'https://trust.chitty.cc', '/health', 0, 'env', 'CHITTY_TRUST_TOKEN', 'active', 'Trust level resolution and scoring', 'TR', '["conn-chittyid"]'),
  ('conn-chittyschema', 'ChittySchema', 'chittyschema', 'chittyos_service', 'chittyos', 'https://schema.chitty.cc', '/health', 0, 'env', NULL, 'active', 'Schema validation and canonical types', 'SC', '[]'),
  ('conn-chittyauth', 'ChittyAuth', 'chittyauth', 'chittyos_service', 'chittyos', 'https://auth.chitty.cc', '/health', 1, 'env', 'CHITTY_AUTH_SERVICE_TOKEN', 'active', 'Authentication and authorization', 'AU', '["conn-chittyid", "conn-chittytrust"]'),
  ('conn-chittyregistry', 'ChittyRegistry', 'chittyregistry', 'chittyos_service', 'chittyos', 'https://registry.chitty.cc', '/health', 1, 'env', NULL, 'active', 'Service discovery and catalog', 'RG', '["conn-chittyid"]'),
  ('conn-chittyconnect', 'ChittyConnect', 'chittyconnect', 'chittyos_service', 'chittyos', 'https://connect.chitty.cc', '/api/health', 2, 'env', NULL, 'active', 'AI-intelligent spine with ContextConsciousness', 'CN', '["conn-chittyid", "conn-chittyauth"]'),
  ('conn-chittyrouter', 'ChittyRouter', 'chittyrouter', 'chittyos_service', 'chittyos', 'https://router.chitty.cc', '/health', 2, 'env', NULL, 'active', 'Request routing and gateway', 'RT', '["conn-chittyauth"]'),
  ('conn-chittygateway', 'ChittyGateway', 'chittygateway', 'chittyos_service', 'chittyos', 'https://gateway.chitty.cc', '/health', 2, 'env', NULL, 'active', 'API gateway and rate limiting', 'GW', '["conn-chittyauth"]'),
  ('conn-chittychronicle', 'ChittyChronicle', 'chittychronicle', 'chittyos_service', 'chittyos', 'https://chronicle.chitty.cc', '/health', 3, 'env', 'CHITTY_CHRONICLE_TOKEN', 'active', 'Event logging and audit trail', 'CH', '["conn-chittyid"]'),
  ('conn-chittycontextual', 'ChittyContextual', 'chittycontextual', 'chittyos_service', 'chittyos', 'https://contextual.chitty.cc', '/health', 3, 'env', NULL, 'active', 'Timeline and topic analysis', 'CX', '["conn-chittyid"]'),
  ('conn-chittysync', 'ChittySync', 'chittysync', 'chittyos_service', 'chittyos', 'https://sync.chitty.cc', '/health', 3, 'env', NULL, 'active', 'Data synchronization across services', 'SY', '["conn-chittyid"]'),
  ('conn-chittyevidence', 'ChittyEvidence', 'chittyevidence', 'chittyos_service', 'chittyos', 'https://evidence.chitty.cc', '/health', 4, 'env', 'CHITTY_EVIDENCE_TOKEN', 'active', 'Evidence management and verification', 'EV', '["conn-chittyid", "conn-chittyledger"]'),
  ('conn-chittyledger', 'ChittyLedger', 'chittyledger', 'chittyos_service', 'chittyos', 'https://ledger.chitty.cc', '/health', 4, 'env', NULL, 'active', 'Universal ledger for things, evidence, cases', 'LD', '["conn-chittyid"]'),
  ('conn-chittyscore', 'ChittyScore', 'chittyscore', 'chittyos_service', 'chittyos', 'https://score.chitty.cc', '/health', 4, 'env', NULL, 'active', 'Scoring and analytics', 'SR', '["conn-chittyid", "conn-chittytrust"]'),
  ('conn-chittychain', 'ChittyChain', 'chittychain', 'chittyos_service', 'chittyos', 'https://chain.chitty.cc', '/health', 4, 'env', NULL, 'active', 'Blockchain anchoring and proof chain', 'BC', '["conn-chittyid"]'),
  ('conn-chittycases', 'ChittyCases', 'chittycases', 'chittyos_service', 'chittyos', 'https://cases.chitty.cc', '/health', 5, 'env', 'CHITTY_CASES_TOKEN', 'active', 'Legal case management', 'CS', '["conn-chittyid", "conn-chittyevidence"]'),
  ('conn-chittyfinance', 'ChittyFinance', 'chittyfinance', 'chittyos_service', 'chittyos', 'https://finance.chitty.cc', '/health', 5, 'env', 'CHITTY_FINANCE_TOKEN', 'active', 'Banking and financial operations', 'FN', '["conn-chittyid", "conn-chittyauth"]'),
  ('conn-chittytrack', 'ChittyTrack', 'chittytrack', 'chittyos_service', 'chittyos', 'https://track.chitty.cc', '/health', 5, 'env', NULL, 'active', 'Activity and issue tracking', 'TK', '["conn-chittyid"]');

-- Seed: Third-Party Integrations
INSERT OR IGNORE INTO connections (id, name, slug, category, provider, base_url, health_endpoint, credential_source, credential_path, credential_env_var, status, description, icon) VALUES
  ('conn-notion', 'Notion', 'notion', 'thirdparty', 'notion', 'https://api.notion.com', '/v1/users/me', 'onepassword', 'integrations/notion/api_key', 'NOTION_TOKEN', 'active', 'Workspace and database management', 'NT'),
  ('conn-github', 'GitHub', 'github', 'thirdparty', 'github', 'https://api.github.com', '/user', 'onepassword', 'integrations/github/token', 'GITHUB_TOKEN', 'active', 'Repository and webhook management', 'GH'),
  ('conn-openai', 'OpenAI', 'openai', 'ai_provider', 'openai', 'https://api.openai.com', '/v1/models', 'onepassword', 'integrations/openai/api_key', 'OPENAI_API_KEY', 'active', 'GPT models and chat completions', 'OA'),
  ('conn-cloudflare', 'Cloudflare', 'cloudflare', 'thirdparty', 'cloudflare', 'https://api.cloudflare.com', '/client/v4/user/tokens/verify', 'env', NULL, 'CLOUDFLARE_MAKE_API_KEY', 'active', 'Workers, KV, D1, R2 infrastructure', 'CF'),
  ('conn-neon', 'Neon', 'neon', 'database', 'neon', NULL, NULL, 'onepassword', 'database/neon/chittyos_core', 'NEON_DATABASE_URL', 'active', 'Serverless PostgreSQL database', 'NE'),
  ('conn-onepassword', '1Password Connect', 'onepassword', 'thirdparty', '1password', NULL, '/v1/heartbeat', 'env', NULL, 'OP_CONNECT_TOKEN', 'active', 'Secret management and credential vault', '1P'),
  ('conn-google-calendar', 'Google Calendar', 'google-calendar', 'thirdparty', 'google', 'https://www.googleapis.com/calendar/v3', NULL, 'onepassword', 'integrations/google/access_token', 'GOOGLE_ACCESS_TOKEN', 'active', 'Calendar event management', 'GC'),
  ('conn-stripe', 'Stripe', 'stripe', 'thirdparty', 'stripe', 'https://api.stripe.com', NULL, 'onepassword', 'integrations/stripe/api_key', 'STRIPE_API_KEY', 'active', 'Payment processing', 'ST'),
  ('conn-twilio', 'Twilio', 'twilio', 'thirdparty', 'twilio', 'https://api.twilio.com', NULL, 'onepassword', 'integrations/twilio/account_sid', 'TWILIO_ACCOUNT_SID', 'active', 'SMS and voice communications', 'TW'),
  ('conn-cloudflare-ai', 'Cloudflare AI', 'cloudflare-ai', 'ai_provider', 'cloudflare', NULL, NULL, 'env', NULL, NULL, 'active', 'Workers AI inference models', 'AI');
