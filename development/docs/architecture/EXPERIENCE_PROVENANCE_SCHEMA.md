---
uri: chittycanon://docs/tech/architecture/experience-provenance-schema
namespace: chittycanon://docs/tech
type: architecture
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "Experience Provenance Schema"
author: "ChittyOS Foundation"
created: 2026-02-09T00:00:00Z
modified: 2026-02-23T00:00:00Z
visibility: INTERNAL
tags: [experience, provenance, chittydna, ledger]
---

# Experience Provenance Schema

## Purpose

Define the data structures for proving context expertise and ensuring accountability. This schema enables:

1. **Expertise Proof** - Verifiable credentials showing demonstrated capabilities
2. **Provenance Tracking** - Chain of custody for experience accumulation
3. **Accountability Audit** - Immutable records of actions and decisions

---

## Schema Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                   EXPERIENCE PROVENANCE MODEL                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │ expertise_attestations                                    │     │
│   │ ────────────────────────────────────────────────────────│     │
│   │ Verifiable proofs of demonstrated capabilities           │     │
│   │ - Domain competencies (code, legal, finance, etc.)       │     │
│   │ - Skill levels (novice → expert)                         │     │
│   │ - Attestation source (self, peer, system)                │     │
│   │ - Cryptographic proof (drand-signed)                     │     │
│   └──────────────────────────────────────────────────────────┘     │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │ experience_provenance                                     │     │
│   │ ────────────────────────────────────────────────────────│     │
│   │ Chain of custody for experience accumulation             │     │
│   │ - Parent-child linking (derived experience)              │     │
│   │ - Source attribution (platform, session, action)         │     │
│   │ - Verification status (pending, verified, disputed)      │     │
│   │ - Content-bound hashes                                   │     │
│   └──────────────────────────────────────────────────────────┘     │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │ accountability_records                                    │     │
│   │ ────────────────────────────────────────────────────────│     │
│   │ Immutable audit trail for actions                        │     │
│   │ - Action classification (read, write, delete, approve)   │     │
│   │ - Consequence tracking (success, failure, harm)          │     │
│   │ - Remediation records (if applicable)                    │     │
│   │ - Beacon-signed timestamps                               │     │
│   └──────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Tables

### expertise_attestations

```sql
-- Verifiable expertise attestations for ChittyID
CREATE TABLE IF NOT EXISTS expertise_attestations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ChittyID anchor
  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Expertise domain
  domain VARCHAR(64) NOT NULL, -- 'software_engineering', 'legal', 'finance', 'data_analysis', etc.
  subdomain VARCHAR(64), -- 'typescript', 'contract_law', 'accounting', etc.

  -- Skill assessment
  skill_level VARCHAR(16) NOT NULL CHECK (skill_level IN (
    'novice',      -- 0-20% proficiency
    'beginner',    -- 20-40% proficiency
    'intermediate',-- 40-60% proficiency
    'advanced',    -- 60-80% proficiency
    'expert'       -- 80-100% proficiency
  )),
  proficiency_score DECIMAL(5,2) CHECK (proficiency_score BETWEEN 0 AND 100),

  -- Evidence basis
  evidence_count INTEGER NOT NULL DEFAULT 0,
  evidence_summary JSONB NOT NULL DEFAULT '{}',
  -- Example: {"successful_tasks": 47, "failed_tasks": 3, "avg_complexity": 7.2, "domains_touched": ["api", "database", "frontend"]}

  -- Attestation source
  attestation_type VARCHAR(32) NOT NULL CHECK (attestation_type IN (
    'self_declared',   -- User claimed expertise
    'system_observed', -- System measured from interactions
    'peer_reviewed',   -- Another identity vouched
    'admin_granted'    -- Administrative override
  )),
  attester_id VARCHAR(32), -- ChittyID of attester (for peer reviews)

  -- Cryptographic proof
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 of evidence_summary
  drand_round BIGINT,
  drand_randomness VARCHAR(128),
  drand_signature VARCHAR(256),

  -- Validity
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP, -- NULL = never expires
  revoked_at TIMESTAMP,
  revocation_reason VARCHAR(256),

  -- Temporal
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_expertise_chitty ON expertise_attestations(chitty_id);
CREATE INDEX idx_expertise_domain ON expertise_attestations(domain);
CREATE INDEX idx_expertise_subdomain ON expertise_attestations(subdomain);
CREATE INDEX idx_expertise_level ON expertise_attestations(skill_level);
CREATE INDEX idx_expertise_type ON expertise_attestations(attestation_type);
CREATE INDEX idx_expertise_active ON expertise_attestations(expires_at, revoked_at)
  WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
  AND revoked_at IS NULL;
CREATE INDEX idx_expertise_evidence_gin ON expertise_attestations USING GIN(evidence_summary);
```

### experience_provenance

```sql
-- Chain of custody for experience accumulation
CREATE TABLE IF NOT EXISTS experience_provenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ChittyID anchor
  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Experience chain
  parent_provenance_id UUID REFERENCES experience_provenance(id),
  chain_depth INTEGER NOT NULL DEFAULT 0,
  chain_root_id UUID, -- Root of this experience chain

  -- Experience type
  experience_type VARCHAR(32) NOT NULL CHECK (experience_type IN (
    'interaction',    -- User interaction (chat, command)
    'decision',       -- Decision made with reasoning
    'entity_discovery', -- New entity learned
    'pattern_learned', -- New pattern recognized
    'skill_application', -- Applied existing skill
    'error_recovery',  -- Recovered from error
    'collaboration'    -- Collaborated with other identity
  )),

  -- Source attribution
  source_platform VARCHAR(64) NOT NULL, -- 'claude_code', 'claude_desktop', 'custom_gpt', 'mcp'
  source_session_id VARCHAR(128),
  source_action_id VARCHAR(128),

  -- Experience content
  experience_summary TEXT NOT NULL,
  experience_metadata JSONB NOT NULL DEFAULT '{}',
  -- Example: {"tokens_processed": 2500, "tools_used": ["Bash", "Read"], "files_touched": 3}

  -- Quality metrics
  complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 10),
  success_indicator BOOLEAN,
  confidence_level DECIMAL(5,2) CHECK (confidence_level BETWEEN 0 AND 100),

  -- Verification
  verification_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
    'pending',    -- Not yet verified
    'verified',   -- Confirmed valid
    'disputed',   -- Challenged by another party
    'invalidated' -- Proven false
  )),
  verified_by VARCHAR(32), -- ChittyID of verifier
  verified_at TIMESTAMP,
  dispute_details JSONB,

  -- Cryptographic proof
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 of experience_summary + metadata
  previous_hash VARCHAR(64), -- Hash of parent provenance (chain linking)
  drand_round BIGINT NOT NULL,
  drand_randomness VARCHAR(128) NOT NULL,

  -- Temporal
  experienced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_provenance_chitty ON experience_provenance(chitty_id);
CREATE INDEX idx_provenance_parent ON experience_provenance(parent_provenance_id);
CREATE INDEX idx_provenance_chain_root ON experience_provenance(chain_root_id);
CREATE INDEX idx_provenance_type ON experience_provenance(experience_type);
CREATE INDEX idx_provenance_platform ON experience_provenance(source_platform);
CREATE INDEX idx_provenance_session ON experience_provenance(source_session_id);
CREATE INDEX idx_provenance_verification ON experience_provenance(verification_status);
CREATE INDEX idx_provenance_experienced ON experience_provenance(experienced_at);
CREATE INDEX idx_provenance_metadata_gin ON experience_provenance USING GIN(experience_metadata);
```

### accountability_records

```sql
-- Immutable accountability audit trail
CREATE TABLE IF NOT EXISTS accountability_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ChittyID anchor
  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Related provenance
  provenance_id UUID REFERENCES experience_provenance(id),

  -- Action classification
  action_category VARCHAR(32) NOT NULL CHECK (action_category IN (
    'read',         -- Information access
    'write',        -- Content creation/modification
    'delete',       -- Content removal
    'execute',      -- Code/command execution
    'approve',      -- Decision approval
    'reject',       -- Decision rejection
    'delegate',     -- Delegated to another identity
    'escalate',     -- Escalated to higher authority
    'remediate'     -- Corrective action
  )),
  action_type VARCHAR(64) NOT NULL, -- Specific action (e.g., 'file_edit', 'api_call', 'database_query')

  -- Action details
  action_target VARCHAR(256), -- What was acted upon (file path, API endpoint, etc.)
  action_parameters JSONB DEFAULT '{}',
  action_result JSONB DEFAULT '{}',

  -- Consequence tracking
  consequence_status VARCHAR(16) NOT NULL CHECK (consequence_status IN (
    'success',    -- Action completed successfully
    'partial',    -- Partially successful
    'failure',    -- Action failed
    'harm',       -- Caused unintended harm
    'pending'     -- Outcome not yet determined
  )),
  consequence_details JSONB DEFAULT '{}',
  harm_severity INTEGER CHECK (harm_severity BETWEEN 0 AND 10), -- NULL if no harm

  -- Attribution chain
  initiated_by VARCHAR(32) NOT NULL, -- ChittyID that initiated (usually same as chitty_id)
  on_behalf_of VARCHAR(32), -- ChittyID this was done for (delegation)
  authorized_by VARCHAR(32), -- ChittyID that authorized (if applicable)

  -- Remediation (if harm occurred)
  remediation_required BOOLEAN DEFAULT FALSE,
  remediation_status VARCHAR(16) CHECK (remediation_status IN (
    'not_required',
    'pending',
    'in_progress',
    'completed',
    'failed'
  )),
  remediation_details JSONB,
  remediated_at TIMESTAMP,

  -- Cryptographic proof
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 of action + result
  chain_previous_hash VARCHAR(64), -- Hash of previous accountability record for this ChittyID
  drand_round BIGINT NOT NULL,
  drand_randomness VARCHAR(128) NOT NULL,
  drand_signature VARCHAR(256),

  -- Temporal
  action_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Immutability marker
  is_sealed BOOLEAN DEFAULT FALSE,
  sealed_at TIMESTAMP,
  seal_hash VARCHAR(64) -- Hash after sealing
);

-- Indexes
CREATE INDEX idx_accountability_chitty ON accountability_records(chitty_id);
CREATE INDEX idx_accountability_provenance ON accountability_records(provenance_id);
CREATE INDEX idx_accountability_category ON accountability_records(action_category);
CREATE INDEX idx_accountability_type ON accountability_records(action_type);
CREATE INDEX idx_accountability_consequence ON accountability_records(consequence_status);
CREATE INDEX idx_accountability_harm ON accountability_records(harm_severity) WHERE harm_severity IS NOT NULL;
CREATE INDEX idx_accountability_remediation ON accountability_records(remediation_status)
  WHERE remediation_required = TRUE;
CREATE INDEX idx_accountability_action_time ON accountability_records(action_at);
CREATE INDEX idx_accountability_sealed ON accountability_records(is_sealed);
```

---

## Expertise Domain Taxonomy

```javascript
const ExpertiseDomains = {
  software_engineering: {
    subdomains: [
      'typescript', 'javascript', 'python', 'rust', 'go',
      'frontend', 'backend', 'fullstack', 'devops', 'infrastructure',
      'database', 'api_design', 'testing', 'security', 'performance'
    ],
    assessment_criteria: [
      'code_quality', 'problem_solving', 'architecture', 'debugging', 'documentation'
    ]
  },

  legal: {
    subdomains: [
      'contract_law', 'intellectual_property', 'corporate_law', 'litigation',
      'compliance', 'regulatory', 'employment_law', 'real_estate'
    ],
    assessment_criteria: [
      'case_analysis', 'document_drafting', 'research', 'citation_accuracy'
    ]
  },

  finance: {
    subdomains: [
      'accounting', 'financial_analysis', 'investment', 'tax',
      'budgeting', 'forecasting', 'risk_management', 'audit'
    ],
    assessment_criteria: [
      'calculation_accuracy', 'analysis_depth', 'compliance', 'reporting'
    ]
  },

  data_analysis: {
    subdomains: [
      'statistics', 'machine_learning', 'visualization', 'etl',
      'sql', 'business_intelligence', 'predictive_modeling'
    ],
    assessment_criteria: [
      'methodology', 'accuracy', 'insight_quality', 'communication'
    ]
  },

  project_management: {
    subdomains: [
      'agile', 'scrum', 'kanban', 'waterfall',
      'resource_planning', 'risk_management', 'stakeholder_management'
    ],
    assessment_criteria: [
      'planning', 'execution', 'communication', 'delivery'
    ]
  },

  communication: {
    subdomains: [
      'technical_writing', 'documentation', 'presentation',
      'negotiation', 'conflict_resolution', 'customer_service'
    ],
    assessment_criteria: [
      'clarity', 'completeness', 'audience_awareness', 'persuasiveness'
    ]
  }
};
```

---

## Provenance Chain Algorithm

```javascript
/**
 * Create a new experience provenance record with chain linking
 */
async function createProvenance(chittyId, experience, parentProvenanceId = null) {
  // Get drand beacon
  const beacon = await getDrandBeacon();

  // Calculate content hash
  const contentHash = await sha256(
    experience.summary + JSON.stringify(experience.metadata)
  );

  // Get previous hash for chain linking
  let previousHash = null;
  let chainDepth = 0;
  let chainRootId = null;

  if (parentProvenanceId) {
    const parent = await getProvenance(parentProvenanceId);
    previousHash = parent.content_hash;
    chainDepth = parent.chain_depth + 1;
    chainRootId = parent.chain_root_id || parent.id;
  }

  const provenance = {
    chitty_id: chittyId,
    parent_provenance_id: parentProvenanceId,
    chain_depth: chainDepth,
    chain_root_id: chainRootId,
    experience_type: experience.type,
    source_platform: experience.platform,
    source_session_id: experience.sessionId,
    source_action_id: experience.actionId,
    experience_summary: experience.summary,
    experience_metadata: experience.metadata,
    complexity_score: experience.complexity,
    success_indicator: experience.success,
    confidence_level: experience.confidence,
    verification_status: 'pending',
    content_hash: contentHash,
    previous_hash: previousHash,
    drand_round: beacon.round,
    drand_randomness: beacon.randomness,
    experienced_at: experience.timestamp || new Date()
  };

  return await insertProvenance(provenance);
}

/**
 * Verify provenance chain integrity
 */
async function verifyProvenanceChain(chittyId, provenanceId) {
  const chain = [];
  let current = await getProvenance(provenanceId);

  while (current) {
    // Verify content hash
    const expectedHash = await sha256(
      current.experience_summary + JSON.stringify(current.experience_metadata)
    );

    if (expectedHash !== current.content_hash) {
      return {
        valid: false,
        error: 'content_hash_mismatch',
        failedAt: current.id
      };
    }

    // Verify chain link
    if (current.parent_provenance_id) {
      const parent = await getProvenance(current.parent_provenance_id);
      if (parent.content_hash !== current.previous_hash) {
        return {
          valid: false,
          error: 'chain_link_broken',
          failedAt: current.id
        };
      }
      current = parent;
    } else {
      current = null;
    }

    chain.unshift(current);
  }

  return {
    valid: true,
    chain: chain,
    depth: chain.length
  };
}
```

---

## Expertise Assessment Algorithm

```javascript
/**
 * Assess expertise level based on accumulated experience
 */
async function assessExpertise(chittyId, domain, subdomain = null) {
  // Get relevant provenance records
  const experiences = await getExperiencesByDomain(chittyId, domain, subdomain);

  if (experiences.length === 0) {
    return null; // No experience in this domain
  }

  // Calculate metrics
  const metrics = {
    totalExperiences: experiences.length,
    successfulExperiences: experiences.filter(e => e.success_indicator).length,
    avgComplexity: average(experiences.map(e => e.complexity_score)),
    avgConfidence: average(experiences.map(e => e.confidence_level)),
    verifiedExperiences: experiences.filter(e => e.verification_status === 'verified').length,
    recentExperiences: experiences.filter(e => isWithinDays(e.experienced_at, 90)).length
  };

  // Calculate success rate
  const successRate = metrics.successfulExperiences / metrics.totalExperiences;

  // Calculate verification rate
  const verificationRate = metrics.verifiedExperiences / metrics.totalExperiences;

  // Calculate proficiency score (0-100)
  const proficiencyScore =
    (successRate * 0.35) +           // 35% weight on success
    (metrics.avgComplexity / 10 * 0.25) + // 25% weight on complexity handled
    (verificationRate * 0.20) +      // 20% weight on verification
    (Math.min(1, metrics.recentExperiences / 20) * 0.20); // 20% weight on recency

  const proficiency = proficiencyScore * 100;

  // Map to skill level
  const skillLevel = proficiencyToLevel(proficiency);

  return {
    domain,
    subdomain,
    skillLevel,
    proficiencyScore: proficiency,
    evidenceCount: metrics.totalExperiences,
    evidenceSummary: {
      successful_tasks: metrics.successfulExperiences,
      failed_tasks: metrics.totalExperiences - metrics.successfulExperiences,
      avg_complexity: metrics.avgComplexity,
      verification_rate: verificationRate,
      recent_activity: metrics.recentExperiences
    }
  };
}

function proficiencyToLevel(proficiency) {
  if (proficiency >= 80) return 'expert';
  if (proficiency >= 60) return 'advanced';
  if (proficiency >= 40) return 'intermediate';
  if (proficiency >= 20) return 'beginner';
  return 'novice';
}
```

---

## Accountability Sealing

```javascript
/**
 * Seal an accountability record (makes it immutable)
 */
async function sealAccountabilityRecord(recordId) {
  const record = await getAccountabilityRecord(recordId);

  if (record.is_sealed) {
    throw new Error('Record already sealed');
  }

  // Get drand beacon for timestamp
  const beacon = await getDrandBeacon();

  // Calculate seal hash (includes all fields)
  const sealContent = JSON.stringify({
    ...record,
    sealed_with_drand_round: beacon.round,
    sealed_at: new Date().toISOString()
  });

  const sealHash = await sha256(sealContent);

  // Update record
  await updateAccountabilityRecord(recordId, {
    is_sealed: true,
    sealed_at: new Date(),
    seal_hash: sealHash
  });

  // Log sealing event
  await logSealingEvent(recordId, beacon, sealHash);

  return {
    recordId,
    sealHash,
    sealedAt: new Date(),
    drandRound: beacon.round
  };
}

/**
 * Verify accountability record seal
 */
async function verifySeal(recordId) {
  const record = await getAccountabilityRecord(recordId);

  if (!record.is_sealed) {
    return { sealed: false };
  }

  // Reconstruct seal content
  const sealContent = JSON.stringify({
    ...record,
    is_sealed: false, // Original state before sealing
    sealed_at: null,
    seal_hash: null,
    sealed_with_drand_round: await getDrandRoundFromTimestamp(record.sealed_at),
    sealed_at: record.sealed_at.toISOString()
  });

  const expectedHash = await sha256(sealContent);

  return {
    sealed: true,
    valid: expectedHash === record.seal_hash,
    sealedAt: record.sealed_at,
    sealHash: record.seal_hash
  };
}
```

---

## Integration with ChittyDNA

```javascript
/**
 * Sync expertise attestations to ChittyDNA vault
 */
async function syncToChittyDNA(chittyId) {
  // Get all active expertise attestations
  const attestations = await getActiveAttestations(chittyId);

  // Get experience provenance summary
  const provenanceSummary = await getProvenanceSummary(chittyId);

  // Get accountability metrics
  const accountabilityMetrics = await getAccountabilityMetrics(chittyId);

  // Create DNA profile
  const dnaProfile = {
    chittyId,
    expertise: attestations.map(a => ({
      domain: a.domain,
      subdomain: a.subdomain,
      level: a.skill_level,
      proficiency: a.proficiency_score,
      evidenceCount: a.evidence_count,
      lastUpdated: a.updated_at
    })),
    experience: {
      totalInteractions: provenanceSummary.total,
      successRate: provenanceSummary.successRate,
      verificationRate: provenanceSummary.verificationRate,
      domainDistribution: provenanceSummary.byDomain
    },
    accountability: {
      totalActions: accountabilityMetrics.total,
      successRate: accountabilityMetrics.successRate,
      harmIncidents: accountabilityMetrics.harmCount,
      remediationRate: accountabilityMetrics.remediationRate
    },
    generatedAt: new Date(),
    contentHash: await generateProfileHash(chittyId)
  };

  // Sync to ChittyDNA service
  await chittyDNAClient.syncProfile(chittyId, dnaProfile);

  return dnaProfile;
}
```

---

## API Endpoints

### Expertise

```
GET /api/v1/expertise/{chittyId}
  → List all active expertise attestations

GET /api/v1/expertise/{chittyId}/{domain}
  → Get expertise for specific domain

POST /api/v1/expertise/{chittyId}/assess
  → Trigger expertise assessment

POST /api/v1/expertise/{chittyId}/attest
  → Create peer attestation (requires attester auth)
```

### Provenance

```
GET /api/v1/provenance/{chittyId}
  → List experience provenance records

GET /api/v1/provenance/{chittyId}/chain/{provenanceId}
  → Get provenance chain from specific record

POST /api/v1/provenance/{chittyId}/verify
  → Verify provenance chain integrity

GET /api/v1/provenance/{chittyId}/summary
  → Get provenance summary statistics
```

### Accountability

```
GET /api/v1/accountability/{chittyId}
  → List accountability records

GET /api/v1/accountability/{chittyId}/sealed
  → List sealed (immutable) records

POST /api/v1/accountability/{recordId}/seal
  → Seal an accountability record

GET /api/v1/accountability/{recordId}/verify
  → Verify record seal integrity

GET /api/v1/accountability/{chittyId}/metrics
  → Get accountability metrics summary
```

---

## Next Steps

1. [x] Define experience provenance schema
2. [ ] Create database migration scripts
3. [ ] Implement provenance chain algorithm
4. [ ] Implement expertise assessment
5. [ ] Implement accountability sealing
6. [ ] Create API endpoints
7. [ ] Integrate with ChittyDNA sync
