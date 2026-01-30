-- Migration: 011_context_behavioral_tracking.sql
-- Description: Behavioral tracking for context evolution over time
-- Date: 2026-01-24
-- D1-Compatible (SQLite syntax)
--
-- @canonical-uri chittycanon://core/services/chittyconnect/migrations/011-context-behavioral-tracking
-- @version 1.0.0
-- @status CERTIFIED
--
-- Contexts evolve based on what they're exposed to:
-- - Sources they interact with (x.com, github, etc.)
-- - Behavioral tendencies that develop over time
-- - Trend direction (improving, degrading, stable)
-- - Red flags or concerning patterns
--
-- ============================================================================
-- JSON FIELD SCHEMAS
-- ============================================================================
--
-- context_dna.behavioral_traits (object with trait scores 0.0-1.0):
-- {
--   "volatile": 0.7,           -- Tendency to change behavior rapidly
--   "compliant": 0.3,          -- Adherence to guidelines and rules
--   "creative": 0.8,           -- Novel approaches, unconventional solutions
--   "methodical": 0.5,         -- Structured, step-by-step approach
--   "resilient": 0.6,          -- Recovery from errors and setbacks
--   "trustAligned": 0.75       -- Alignment with trust policies
-- }
-- See: chittycanon://docs/tech/spec/behavioral-traits
--
-- context_dna.influence_sources (object tracking source exposure):
-- {
--   "github.com": {
--     "interactions": 150,
--     "impact": "positive",
--     "lastSeen": 1705603200,
--     "stabilityRating": 0.7
--   },
--   "x.com": {
--     "interactions": 20,
--     "impact": "neutral",
--     "lastSeen": 1705602000,
--     "stabilityRating": 0.3
--   },
--   "anthropic.com": {
--     "interactions": 50,
--     "impact": "positive",
--     "lastSeen": 1705603200,
--     "stabilityRating": 0.8
--   }
-- }
-- See: chittycanon://docs/tech/spec/source-influence-profiles
--
-- context_behavioral_events.previous_state (snapshot before event):
-- {
--   "behavioral_traits": {"volatile": 0.5, "compliant": 0.8},
--   "trend_direction": "stable",
--   "red_flag_count": 0,
--   "timestamp": 1705600000
-- }
--
-- context_behavioral_events.new_state (snapshot after event):
-- {
--   "behavioral_traits": {"volatile": 0.8, "compliant": 0.5},
--   "trend_direction": "degrading",
--   "red_flag_count": 1,
--   "timestamp": 1705603200
-- }
--
-- context_behavioral_events.trigger_factors (array of causes):
-- [
--   {
--     "type": "source_exposure",
--     "source": "x.com",
--     "weight": 0.6,
--     "description": "High exposure to volatile content source"
--   },
--   {
--     "type": "anomaly_detected",
--     "anomaly": "rapid_context_switching",
--     "weight": 0.4,
--     "description": "Frequent unplanned context changes"
--   }
-- ]
-- ============================================================================

-- ============================================================================
-- ALTER context_dna: Add behavioral tracking columns
-- ============================================================================

-- Behavioral traits (JSON object with trait scores 0.0-1.0)
-- Example: {"volatile": 0.7, "compliant": 0.3, "creative": 0.8, "methodical": 0.5}
ALTER TABLE context_dna ADD COLUMN behavioral_traits TEXT DEFAULT '{}';

-- Influence sources (JSON object tracking source exposure and impact)
-- Example: {"github.com": {"interactions": 150, "impact": "positive"}, "x.com": {"interactions": 20, "impact": "neutral"}}
ALTER TABLE context_dna ADD COLUMN influence_sources TEXT DEFAULT '{}';

-- Trend direction: is the context improving, degrading, or stable?
ALTER TABLE context_dna ADD COLUMN trend_direction TEXT DEFAULT 'stable'
  CHECK (trend_direction IN ('improving', 'stable', 'degrading', 'volatile'));

-- Trend confidence: how confident are we in the trend assessment (0.0-1.0)
ALTER TABLE context_dna ADD COLUMN trend_confidence REAL DEFAULT 0.5;

-- Red flag count: concerning behaviors detected
ALTER TABLE context_dna ADD COLUMN red_flag_count INTEGER DEFAULT 0;

-- Last behavioral assessment timestamp
ALTER TABLE context_dna ADD COLUMN last_behavior_assessment INTEGER;

-- ============================================================================
-- context_exposure_log: Track what sources a context interacts with
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_exposure_log (
  id TEXT PRIMARY KEY,

  -- Context reference
  context_id TEXT NOT NULL REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL,

  -- Exposure details
  source_domain TEXT NOT NULL,           -- e.g., "github.com", "x.com", "openai.com"
  source_type TEXT NOT NULL CHECK (source_type IN (
    'api', 'web', 'tool', 'model', 'service', 'database', 'file', 'other'
  )),
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'read', 'write', 'execute', 'query', 'chat', 'observe'
  )),

  -- Content assessment
  content_category TEXT,                  -- e.g., "code", "social", "news", "documentation"
  sentiment_score REAL,                   -- -1.0 (negative) to 1.0 (positive)
  compliance_alignment REAL,              -- 0.0 (against) to 1.0 (aligned)

  -- Session reference
  session_id TEXT,

  -- Temporal
  exposed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for exposure log
CREATE INDEX IF NOT EXISTS idx_exposure_context ON context_exposure_log(context_id);
CREATE INDEX IF NOT EXISTS idx_exposure_chitty ON context_exposure_log(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_exposure_domain ON context_exposure_log(source_domain);
CREATE INDEX IF NOT EXISTS idx_exposure_type ON context_exposure_log(source_type);
CREATE INDEX IF NOT EXISTS idx_exposure_time ON context_exposure_log(exposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_exposure_session ON context_exposure_log(session_id);

-- ============================================================================
-- context_behavioral_events: Significant behavioral changes detected
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_behavioral_events (
  id TEXT PRIMARY KEY,

  -- Context reference
  context_id TEXT NOT NULL REFERENCES context_entities(id),
  context_chitty_id TEXT NOT NULL,

  -- Event details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'trait_shift',           -- A behavioral trait changed significantly
    'trend_change',          -- Overall trend direction changed
    'red_flag_detected',     -- A concerning pattern was detected
    'compliance_deviation',  -- Deviation from expected compliance
    'volatility_spike',      -- Sudden behavioral changes
    'influence_alert',       -- Concerning source exposure
    'recovery'               -- Context recovered from concerning state
  )),

  -- Event payload
  previous_state TEXT NOT NULL DEFAULT '{}',  -- JSON snapshot before
  new_state TEXT NOT NULL DEFAULT '{}',       -- JSON snapshot after
  trigger_factors TEXT NOT NULL DEFAULT '[]', -- JSON array of what caused this

  -- Severity (0-10)
  severity INTEGER DEFAULT 5 CHECK (severity BETWEEN 0 AND 10),

  -- Resolution
  acknowledged INTEGER DEFAULT 0,
  acknowledged_by TEXT,
  acknowledged_at INTEGER,
  resolution_notes TEXT,

  -- Temporal
  detected_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for behavioral events
CREATE INDEX IF NOT EXISTS idx_behavioral_context ON context_behavioral_events(context_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_chitty ON context_behavioral_events(context_chitty_id);
CREATE INDEX IF NOT EXISTS idx_behavioral_type ON context_behavioral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_behavioral_severity ON context_behavioral_events(severity DESC);
CREATE INDEX IF NOT EXISTS idx_behavioral_time ON context_behavioral_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavioral_unack ON context_behavioral_events(acknowledged)
  WHERE acknowledged = 0;

-- ============================================================================
-- Views for behavioral analysis
-- ============================================================================

-- Contexts with behavioral concerns
DROP VIEW IF EXISTS contexts_with_concerns;
CREATE VIEW contexts_with_concerns AS
SELECT
    ce.chitty_id,
    ce.project_path,
    ce.support_type,
    ce.trust_level,
    cd.trend_direction,
    cd.trend_confidence,
    cd.red_flag_count,
    cd.behavioral_traits,
    cd.anomaly_count,
    (SELECT COUNT(*) FROM context_behavioral_events cbe
     WHERE cbe.context_id = ce.id AND cbe.acknowledged = 0 AND cbe.severity >= 7) as critical_events
FROM context_entities ce
JOIN context_dna cd ON ce.id = cd.context_id
WHERE cd.trend_direction = 'degrading'
   OR cd.red_flag_count > 3
   OR cd.anomaly_count > 5
ORDER BY cd.red_flag_count DESC, cd.anomaly_count DESC;

-- Source influence summary
DROP VIEW IF EXISTS source_influence_summary;
CREATE VIEW source_influence_summary AS
SELECT
    source_domain,
    source_type,
    COUNT(*) as total_exposures,
    COUNT(DISTINCT context_id) as contexts_exposed,
    AVG(sentiment_score) as avg_sentiment,
    AVG(compliance_alignment) as avg_compliance
FROM context_exposure_log
WHERE exposed_at > (unixepoch() - 86400 * 30)  -- Last 30 days
GROUP BY source_domain, source_type
ORDER BY total_exposures DESC;

-- Behavioral event timeline
DROP VIEW IF EXISTS behavioral_event_timeline;
CREATE VIEW behavioral_event_timeline AS
SELECT
    cbe.detected_at,
    ce.chitty_id,
    ce.project_path,
    cbe.event_type,
    cbe.severity,
    cbe.trigger_factors,
    cbe.acknowledged
FROM context_behavioral_events cbe
JOIN context_entities ce ON cbe.context_id = ce.id
ORDER BY cbe.detected_at DESC;
