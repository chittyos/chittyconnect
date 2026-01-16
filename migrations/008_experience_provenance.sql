-- Migration: 008_experience_provenance.sql
-- Description: Experience Provenance Schema - expertise proof and accountability
-- Date: 2026-01-08
-- D1-Compatible (SQLite syntax)

-- ============================================================================
-- expertise_attestations: Verifiable expertise attestations for ChittyID
-- ============================================================================
CREATE TABLE IF NOT EXISTS expertise_attestations (
  id TEXT PRIMARY KEY,

  -- ChittyID anchor
  chitty_id TEXT NOT NULL,

  -- Expertise domain
  domain TEXT NOT NULL,
  subdomain TEXT,

  -- Skill assessment
  skill_level TEXT NOT NULL CHECK (skill_level IN (
    'novice', 'beginner', 'intermediate', 'advanced', 'expert'
  )),
  proficiency_score REAL CHECK (proficiency_score BETWEEN 0 AND 100),

  -- Evidence basis
  evidence_count INTEGER NOT NULL DEFAULT 0,
  evidence_summary TEXT NOT NULL DEFAULT '{}',

  -- Attestation source
  attestation_type TEXT NOT NULL CHECK (attestation_type IN (
    'self_declared', 'system_observed', 'peer_reviewed', 'admin_granted'
  )),
  attester_id TEXT,

  -- Cryptographic proof
  content_hash TEXT NOT NULL,
  drand_round INTEGER,
  drand_randomness TEXT,
  drand_signature TEXT,

  -- Validity
  granted_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER,
  revoked_at INTEGER,
  revocation_reason TEXT,

  -- Temporal
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for expertise_attestations
CREATE INDEX IF NOT EXISTS idx_expertise_chitty ON expertise_attestations(chitty_id);
CREATE INDEX IF NOT EXISTS idx_expertise_domain ON expertise_attestations(domain);
CREATE INDEX IF NOT EXISTS idx_expertise_subdomain ON expertise_attestations(subdomain);
CREATE INDEX IF NOT EXISTS idx_expertise_level ON expertise_attestations(skill_level);
CREATE INDEX IF NOT EXISTS idx_expertise_type ON expertise_attestations(attestation_type);
CREATE INDEX IF NOT EXISTS idx_expertise_active ON expertise_attestations(chitty_id, expires_at, revoked_at)
  WHERE revoked_at IS NULL;

-- ============================================================================
-- experience_provenance: Chain of custody for experience accumulation
-- ============================================================================
CREATE TABLE IF NOT EXISTS experience_provenance (
  id TEXT PRIMARY KEY,

  -- ChittyID anchor
  chitty_id TEXT NOT NULL,

  -- Experience chain
  parent_provenance_id TEXT REFERENCES experience_provenance(id),
  chain_depth INTEGER NOT NULL DEFAULT 0,
  chain_root_id TEXT,

  -- Experience type
  experience_type TEXT NOT NULL CHECK (experience_type IN (
    'interaction', 'decision', 'entity_discovery', 'pattern_learned',
    'skill_application', 'error_recovery', 'collaboration'
  )),

  -- Source attribution
  source_platform TEXT NOT NULL,
  source_session_id TEXT,
  source_action_id TEXT,

  -- Experience content
  experience_summary TEXT NOT NULL,
  experience_metadata TEXT NOT NULL DEFAULT '{}',

  -- Quality metrics
  complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 10),
  success_indicator INTEGER,
  confidence_level REAL CHECK (confidence_level BETWEEN 0 AND 100),

  -- Verification
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
    'pending', 'verified', 'disputed', 'invalidated'
  )),
  verified_by TEXT,
  verified_at INTEGER,
  dispute_details TEXT,

  -- Cryptographic proof
  content_hash TEXT NOT NULL,
  previous_hash TEXT,
  drand_round INTEGER NOT NULL,
  drand_randomness TEXT NOT NULL,

  -- Temporal
  experienced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for experience_provenance
CREATE INDEX IF NOT EXISTS idx_provenance_chitty ON experience_provenance(chitty_id);
CREATE INDEX IF NOT EXISTS idx_provenance_parent ON experience_provenance(parent_provenance_id);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_root ON experience_provenance(chain_root_id);
CREATE INDEX IF NOT EXISTS idx_provenance_type ON experience_provenance(experience_type);
CREATE INDEX IF NOT EXISTS idx_provenance_platform ON experience_provenance(source_platform);
CREATE INDEX IF NOT EXISTS idx_provenance_session ON experience_provenance(source_session_id);
CREATE INDEX IF NOT EXISTS idx_provenance_verification ON experience_provenance(verification_status);
CREATE INDEX IF NOT EXISTS idx_provenance_experienced ON experience_provenance(experienced_at DESC);

-- ============================================================================
-- accountability_records: Immutable accountability audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS accountability_records (
  id TEXT PRIMARY KEY,

  -- ChittyID anchor
  chitty_id TEXT NOT NULL,

  -- Related provenance
  provenance_id TEXT REFERENCES experience_provenance(id),

  -- Action classification
  action_category TEXT NOT NULL CHECK (action_category IN (
    'read', 'write', 'delete', 'execute', 'approve', 'reject',
    'delegate', 'escalate', 'remediate'
  )),
  action_type TEXT NOT NULL,

  -- Action details
  action_target TEXT,
  action_parameters TEXT DEFAULT '{}',
  action_result TEXT DEFAULT '{}',

  -- Consequence tracking
  consequence_status TEXT NOT NULL CHECK (consequence_status IN (
    'success', 'partial', 'failure', 'harm', 'pending'
  )),
  consequence_details TEXT DEFAULT '{}',
  harm_severity INTEGER CHECK (harm_severity BETWEEN 0 AND 10),

  -- Attribution chain
  initiated_by TEXT NOT NULL,
  on_behalf_of TEXT,
  authorized_by TEXT,

  -- Remediation
  remediation_required INTEGER DEFAULT 0,
  remediation_status TEXT CHECK (remediation_status IN (
    'not_required', 'pending', 'in_progress', 'completed', 'failed'
  )),
  remediation_details TEXT,
  remediated_at INTEGER,

  -- Cryptographic proof
  content_hash TEXT NOT NULL,
  chain_previous_hash TEXT,
  drand_round INTEGER NOT NULL,
  drand_randomness TEXT NOT NULL,
  drand_signature TEXT,

  -- Temporal
  action_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),

  -- Immutability
  is_sealed INTEGER DEFAULT 0,
  sealed_at INTEGER,
  seal_hash TEXT
);

-- Indexes for accountability_records
CREATE INDEX IF NOT EXISTS idx_accountability_chitty ON accountability_records(chitty_id);
CREATE INDEX IF NOT EXISTS idx_accountability_provenance ON accountability_records(provenance_id);
CREATE INDEX IF NOT EXISTS idx_accountability_category ON accountability_records(action_category);
CREATE INDEX IF NOT EXISTS idx_accountability_type ON accountability_records(action_type);
CREATE INDEX IF NOT EXISTS idx_accountability_consequence ON accountability_records(consequence_status);
CREATE INDEX IF NOT EXISTS idx_accountability_harm ON accountability_records(harm_severity)
  WHERE harm_severity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accountability_remediation ON accountability_records(remediation_status)
  WHERE remediation_required = 1;
CREATE INDEX IF NOT EXISTS idx_accountability_action_time ON accountability_records(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_accountability_sealed ON accountability_records(is_sealed);

-- ============================================================================
-- Update trigger for expertise_attestations.updated_at
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trigger_expertise_attestations_updated_at
  AFTER UPDATE ON expertise_attestations
  FOR EACH ROW
BEGIN
  UPDATE expertise_attestations SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- ============================================================================
-- Views for common queries
-- ============================================================================

-- Active expertise by ChittyID
DROP VIEW IF EXISTS active_expertise;
CREATE VIEW active_expertise AS
SELECT
    ea.chitty_id,
    ea.domain,
    ea.subdomain,
    ea.skill_level,
    ea.proficiency_score,
    ea.evidence_count,
    ea.attestation_type,
    ea.granted_at,
    ep.current_trust_level,
    ep.trust_score
FROM expertise_attestations ea
LEFT JOIN experience_profiles ep ON ea.chitty_id = ep.chitty_id
WHERE (ea.expires_at IS NULL OR ea.expires_at > unixepoch())
  AND ea.revoked_at IS NULL;

-- Provenance chain summary
DROP VIEW IF EXISTS provenance_summary;
CREATE VIEW provenance_summary AS
SELECT
    chitty_id,
    COUNT(*) as total_records,
    COUNT(DISTINCT source_session_id) as unique_sessions,
    SUM(CASE WHEN success_indicator = 1 THEN 1 ELSE 0 END) as successful_experiences,
    AVG(complexity_score) as avg_complexity,
    AVG(confidence_level) as avg_confidence,
    SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_count,
    MAX(experienced_at) as last_experience
FROM experience_provenance
GROUP BY chitty_id;

-- Accountability metrics
DROP VIEW IF EXISTS accountability_metrics;
CREATE VIEW accountability_metrics AS
SELECT
    chitty_id,
    COUNT(*) as total_actions,
    SUM(CASE WHEN consequence_status = 'success' THEN 1 ELSE 0 END) as successful_actions,
    SUM(CASE WHEN consequence_status = 'harm' THEN 1 ELSE 0 END) as harm_incidents,
    SUM(CASE WHEN remediation_required = 1 THEN 1 ELSE 0 END) as remediation_needed,
    SUM(CASE WHEN remediation_status = 'completed' THEN 1 ELSE 0 END) as remediation_completed,
    SUM(CASE WHEN is_sealed = 1 THEN 1 ELSE 0 END) as sealed_records,
    MAX(action_at) as last_action
FROM accountability_records
GROUP BY chitty_id;

-- High-risk identities (for monitoring)
DROP VIEW IF EXISTS high_risk_identities;
CREATE VIEW high_risk_identities AS
SELECT
    ep.chitty_id,
    ep.current_trust_level,
    ep.trust_score,
    ep.risk_score,
    ep.anomaly_count,
    am.harm_incidents,
    am.total_actions,
    CASE
        WHEN am.total_actions > 0 THEN
            (CAST(am.successful_actions AS REAL) / am.total_actions) * 100
        ELSE 0
    END as success_rate
FROM experience_profiles ep
LEFT JOIN accountability_metrics am ON ep.chitty_id = am.chitty_id
WHERE ep.risk_score >= 50
   OR ep.current_trust_level <= 1
   OR ep.anomaly_count >= 5
ORDER BY ep.risk_score DESC;
