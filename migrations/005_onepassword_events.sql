-- Migration: 005_onepassword_events
-- Description: Tables for 1Password Events API integration with ChittyChronicle
-- Created: 2026-01-06

-- Chronicle events table for storing 1Password audit events
CREATE TABLE IF NOT EXISTS chronicle_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '1password-events-api',
    data TEXT NOT NULL, -- JSON blob
    service TEXT NOT NULL,
    category TEXT NOT NULL, -- security, credential_access, audit
    severity TEXT NOT NULL DEFAULT 'info', -- info, warning, error, critical
    action TEXT,
    created_at TEXT DEFAULT (datetime('now')),

    -- Indexes for common queries
    UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_timestamp
    ON chronicle_events(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_type
    ON chronicle_events(type);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_category
    ON chronicle_events(category);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_severity
    ON chronicle_events(severity);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_service
    ON chronicle_events(service);

-- Events sync cursor tracking
CREATE TABLE IF NOT EXISTS onepassword_sync_cursors (
    event_type TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    last_sync TEXT DEFAULT (datetime('now')),
    events_synced INTEGER DEFAULT 0
);

-- Pre-populate cursor tracking for each event type
INSERT OR IGNORE INTO onepassword_sync_cursors (event_type, cursor, events_synced)
VALUES
    ('signinattempts', '', 0),
    ('itemusages', '', 0),
    ('auditevents', '', 0);

-- Chronicle event summary view for quick insights
CREATE VIEW IF NOT EXISTS chronicle_event_summary AS
SELECT
    date(timestamp) as event_date,
    type,
    category,
    severity,
    COUNT(*) as event_count
FROM chronicle_events
GROUP BY date(timestamp), type, category, severity
ORDER BY event_date DESC, event_count DESC;

-- Security events view (sign-ins and failures)
CREATE VIEW IF NOT EXISTS security_events AS
SELECT
    id,
    timestamp,
    json_extract(data, '$.userEmail') as user_email,
    json_extract(data, '$.userName') as user_name,
    json_extract(data, '$.category') as signin_result,
    json_extract(data, '$.ipAddress') as ip_address,
    json_extract(data, '$.country') as country,
    json_extract(data, '$.clientApp') as client_app,
    json_extract(data, '$.clientPlatform') as platform
FROM chronicle_events
WHERE type = 'onepassword.signin'
ORDER BY timestamp DESC;

-- Credential access events view
CREATE VIEW IF NOT EXISTS credential_access_events AS
SELECT
    id,
    timestamp,
    json_extract(data, '$.userEmail') as user_email,
    json_extract(data, '$.vaultUuid') as vault_uuid,
    json_extract(data, '$.itemUuid') as item_uuid,
    json_extract(data, '$.action') as access_action,
    json_extract(data, '$.clientApp') as client_app,
    json_extract(data, '$.ipAddress') as ip_address
FROM chronicle_events
WHERE type = 'onepassword.item_usage'
ORDER BY timestamp DESC;

-- Failed sign-in attempts (security alert worthy)
CREATE VIEW IF NOT EXISTS failed_signin_attempts AS
SELECT
    id,
    timestamp,
    json_extract(data, '$.userEmail') as user_email,
    json_extract(data, '$.category') as failure_reason,
    json_extract(data, '$.ipAddress') as ip_address,
    json_extract(data, '$.country') as country,
    json_extract(data, '$.city') as city,
    json_extract(data, '$.clientApp') as client_app
FROM chronicle_events
WHERE type = 'onepassword.signin'
  AND json_extract(data, '$.category') != 'success'
ORDER BY timestamp DESC;
