-- ChittyConnect Intelligence System Tables
-- Decisions, Predictions, Alerts, and Notifications

-- Decisions and Reasoning Cache
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  decision_type TEXT NOT NULL, -- anomaly, routing, failover, risk, credential
  reasoning TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  context TEXT, -- JSON string
  actions TEXT, -- JSON array of action IDs
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_service ON decisions(service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_confidence ON decisions(confidence DESC, created_at DESC);

-- Predictions Cache
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  prediction_type TEXT NOT NULL, -- failure, latency, cascade, anomaly
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  time_to_failure INTEGER, -- seconds until predicted failure (null if not failure prediction)
  details TEXT, -- JSON string with prediction details
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_service ON predictions(service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON predictions(prediction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_active ON predictions(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_confidence ON predictions(confidence DESC, created_at DESC);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL, -- prediction, anomaly, failure, recovery, credential
  severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
  source_service TEXT,
  message TEXT NOT NULL,
  context TEXT, -- JSON string
  prediction_id TEXT, -- Reference to predictions table
  decision_id TEXT, -- Reference to decisions table
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_service ON alerts(source_service, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type, created_at DESC);

-- Notification Queue
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  channel TEXT NOT NULL, -- mcp_stream, webhook, email, sms
  recipient TEXT, -- session_id for mcp_stream, URL for webhook, email/phone for others
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notifications_alert ON notifications(alert_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel, status);

-- Service Dependencies (for cascade failure prediction)
CREATE TABLE IF NOT EXISTS service_dependencies (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  depends_on TEXT NOT NULL, -- Service that this service depends on
  dependency_type TEXT NOT NULL, -- critical, optional, fallback
  weight REAL NOT NULL DEFAULT 1.0, -- Impact weight (0-1)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(service_name, depends_on)
);

CREATE INDEX IF NOT EXISTS idx_deps_service ON service_dependencies(service_name);
CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON service_dependencies(depends_on);
CREATE INDEX IF NOT EXISTS idx_deps_type ON service_dependencies(dependency_type);

-- Monitoring Snapshots (for trend analysis)
CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  health_status TEXT NOT NULL,
  latency_ms REAL,
  error_rate REAL,
  cpu_usage REAL,
  memory_usage REAL,
  request_count INTEGER,
  metadata TEXT, -- JSON string with additional metrics
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_snapshots_service ON monitoring_snapshots(service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_health ON monitoring_snapshots(health_status, created_at DESC);

-- Insert default service dependencies
INSERT OR IGNORE INTO service_dependencies (id, service_name, depends_on, dependency_type, weight) VALUES
  ('dep-connect-id', 'chittyconnect', 'chittyid', 'critical', 1.0),
  ('dep-connect-auth', 'chittyconnect', 'chittyauth', 'critical', 1.0),
  ('dep-connect-registry', 'chittyconnect', 'chittyregistry', 'critical', 0.8),
  ('dep-auth-id', 'chittyauth', 'chittyid', 'critical', 1.0),
  ('dep-cases-auth', 'chittycases', 'chittyauth', 'critical', 1.0),
  ('dep-cases-id', 'chittycases', 'chittyid', 'critical', 0.9),
  ('dep-finance-auth', 'chittyfinance', 'chittyauth', 'critical', 1.0),
  ('dep-verify-id', 'chittyverify', 'chittyid', 'critical', 0.9),
  ('dep-score-id', 'chittyscore', 'chittyid', 'optional', 0.5);
