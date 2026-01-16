# Context Anchor Model: ChittyID as Identity for Experience Accumulation

## Overview

The Context Anchor Model binds ChittyID as the **immutable identity anchor** for all experience accumulation across the ChittyOS ecosystem. This enables:

1. **Cross-platform memory portability** - Memory follows ChittyID, not ephemeral sessions
2. **Dynamic trust evolution** - Trust level updates based on accumulated experience
3. **Verifiable expertise proof** - Cryptographic proof of capabilities
4. **Reputation accountability** - ContextConsciousness tracks identity-level behavior

---

## Current Architecture Gaps

| Component | Current Key | Gap |
|-----------|-------------|-----|
| MemoryCloude | `sessionId` (ephemeral) | Memory dies when session ends |
| ContextConsciousness | Service health | No identity-level reputation |
| SessionSync | `userId-projectId-ts-random` | Not bound to ChittyID |
| ChittyID trust_level | Static (position 6) | No dynamic evolution |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CONTEXT ANCHOR MODEL                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ChittyID (03-C-CTX-0001-P-2601-3-82)                             │
│   ════════════════════════════════════                              │
│   │                                                                 │
│   ├── IDENTITY LAYER (immutable anchor)                            │
│   │   ├── technical_id: VRF-generated, content-bound               │
│   │   ├── legal_id: Mod-97 checksum, trust_level encoded           │
│   │   └── drand_beacon: Cryptographic timestamp                    │
│   │                                                                 │
│   ├── EXPERIENCE LAYER (MemoryCloude → ChittyID binding)           │
│   │   ├── interactions: 90-day retention, keyed by ChittyID        │
│   │   ├── decisions: 365-day retention, reasoning traces           │
│   │   ├── entities: Forever (knowledge graph)                      │
│   │   └── patterns: Semantic embeddings in Vectorize               │
│   │                                                                 │
│   ├── EXPERTISE LAYER (ChittyDNA → ChittyID sync)                  │
│   │   ├── workflows: success_rate, usage_count, confidence         │
│   │   ├── templates: Proven automation patterns                    │
│   │   └── competencies: Skill attestations                         │
│   │                                                                 │
│   └── ACCOUNTABILITY LAYER (ContextConsciousness)                  │
│       ├── behavior_profile: Pattern monitoring                     │
│       ├── risk_score: 0-100, rolling average                       │
│       ├── trust_evolution: Dynamic recalculation                   │
│       └── audit_trail: Beacon-signed, content-bound                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Extension

### experience_profiles table

```sql
-- Experience profiles linked to ChittyID
CREATE TABLE IF NOT EXISTS experience_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- ChittyID anchor (links to master_entities)
  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Experience metrics
  total_interactions INTEGER DEFAULT 0,
  total_decisions INTEGER DEFAULT 0,
  total_entities INTEGER DEFAULT 0,

  -- Trust evolution
  current_trust_level INTEGER DEFAULT 3 CHECK (current_trust_level BETWEEN 0 AND 5),
  trust_score DECIMAL(5,2) DEFAULT 50.00 CHECK (trust_score BETWEEN 0 AND 100),
  trust_last_calculated TIMESTAMP,
  trust_calculation_version VARCHAR(16) DEFAULT 'v1.0',

  -- Expertise metrics
  expertise_domains JSONB DEFAULT '[]',
  success_rate DECIMAL(5,4) DEFAULT 0.0000,
  confidence_score DECIMAL(5,2) DEFAULT 50.00,

  -- Risk and accountability
  risk_score DECIMAL(5,2) DEFAULT 0.00 CHECK (risk_score BETWEEN 0 AND 100),
  anomaly_count INTEGER DEFAULT 0,
  last_anomaly_at TIMESTAMP,

  -- Retention tracking
  oldest_interaction TIMESTAMP,
  newest_interaction TIMESTAMP,
  memory_utilization_bytes BIGINT DEFAULT 0,

  -- Temporal
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(chitty_id)
);

-- Indexes
CREATE INDEX idx_experience_profiles_chitty_id ON experience_profiles(chitty_id);
CREATE INDEX idx_experience_profiles_trust_level ON experience_profiles(current_trust_level);
CREATE INDEX idx_experience_profiles_trust_score ON experience_profiles(trust_score);
CREATE INDEX idx_experience_profiles_risk_score ON experience_profiles(risk_score);
CREATE INDEX idx_experience_profiles_expertise_gin ON experience_profiles USING GIN(expertise_domains);
```

### session_chittyid_bindings table

```sql
-- Binds ephemeral sessions to persistent ChittyID
CREATE TABLE IF NOT EXISTS session_chittyid_bindings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Session identifier (ephemeral)
  session_id VARCHAR(128) NOT NULL,

  -- ChittyID anchor (persistent)
  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Binding metadata
  platform VARCHAR(64) NOT NULL, -- 'claude_code', 'claude_desktop', 'custom_gpt', 'mcp'
  client_fingerprint VARCHAR(128),

  -- Session lifecycle
  bound_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  unbound_at TIMESTAMP,
  unbind_reason VARCHAR(64),

  -- Experience accumulation during session
  interactions_count INTEGER DEFAULT 0,
  decisions_count INTEGER DEFAULT 0,
  entities_discovered INTEGER DEFAULT 0,

  -- Session quality metrics
  session_risk_score DECIMAL(5,2) DEFAULT 0.00,
  session_success_rate DECIMAL(5,4),

  UNIQUE(session_id, chitty_id)
);

-- Indexes
CREATE INDEX idx_session_bindings_session ON session_chittyid_bindings(session_id);
CREATE INDEX idx_session_bindings_chitty ON session_chittyid_bindings(chitty_id);
CREATE INDEX idx_session_bindings_platform ON session_chittyid_bindings(platform);
CREATE INDEX idx_session_bindings_active ON session_chittyid_bindings(unbound_at) WHERE unbound_at IS NULL;
```

### trust_evolution_log table

```sql
-- Audit trail for trust level changes
CREATE TABLE IF NOT EXISTS trust_evolution_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  chitty_id VARCHAR(32) NOT NULL REFERENCES master_entities(technical_id),

  -- Trust change
  previous_trust_level INTEGER NOT NULL,
  new_trust_level INTEGER NOT NULL,
  previous_trust_score DECIMAL(5,2) NOT NULL,
  new_trust_score DECIMAL(5,2) NOT NULL,

  -- Change reasoning
  change_trigger VARCHAR(64) NOT NULL, -- 'session_complete', 'anomaly_detected', 'expertise_gained', 'admin_override'
  change_factors JSONB NOT NULL, -- Detailed breakdown of factors

  -- Cryptographic proof
  drand_round BIGINT,
  drand_randomness VARCHAR(128),
  content_hash VARCHAR(64) NOT NULL, -- Hash of change_factors

  -- Temporal
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Index for fast lookups
  INDEX idx_trust_evolution_chitty (chitty_id),
  INDEX idx_trust_evolution_time (changed_at)
);
```

---

## Trust Evolution Algorithm

### Trust Score Calculation

```javascript
/**
 * Calculate trust score based on accumulated experience
 *
 * Factors:
 * - Experience volume (interactions, decisions, entities)
 * - Success rate (completed tasks / total attempts)
 * - Anomaly frequency (lower is better)
 * - Session quality (average session risk scores)
 * - Time-weighted recency (recent experience weighs more)
 */
function calculateTrustScore(profile) {
  const weights = {
    experienceVolume: 0.20,
    successRate: 0.30,
    anomalyPenalty: 0.20,
    sessionQuality: 0.15,
    recency: 0.15
  };

  // Experience volume score (0-100)
  const volumeScore = Math.min(100,
    Math.log10(profile.total_interactions + 1) * 20 +
    Math.log10(profile.total_decisions + 1) * 15 +
    Math.log10(profile.total_entities + 1) * 10
  );

  // Success rate score (0-100)
  const successScore = profile.success_rate * 100;

  // Anomaly penalty (0 = no penalty, 100 = max penalty)
  const anomalyPenalty = Math.min(100, profile.anomaly_count * 10);
  const anomalyScore = 100 - anomalyPenalty;

  // Session quality (inverted risk score)
  const sessionQuality = 100 - profile.average_session_risk;

  // Recency score (days since last interaction)
  const daysSinceLastInteraction = (Date.now() - profile.newest_interaction) / 86400000;
  const recencyScore = Math.max(0, 100 - (daysSinceLastInteraction * 2));

  // Weighted combination
  const trustScore =
    weights.experienceVolume * volumeScore +
    weights.successRate * successScore +
    weights.anomalyPenalty * anomalyScore +
    weights.sessionQuality * sessionQuality +
    weights.recency * recencyScore;

  return Math.round(trustScore * 100) / 100;
}

/**
 * Map trust score (0-100) to trust level (0-5)
 */
function trustScoreToLevel(trustScore) {
  if (trustScore >= 90) return 5; // Exemplary
  if (trustScore >= 75) return 4; // Established
  if (trustScore >= 50) return 3; // Standard (default)
  if (trustScore >= 25) return 2; // Probationary
  if (trustScore >= 10) return 1; // Limited
  return 0; // Restricted
}
```

### Trust Level Definitions

| Level | Name | Score Range | Capabilities |
|-------|------|-------------|--------------|
| 5 | Exemplary | 90-100 | Full autonomy, can create child identities |
| 4 | Established | 75-89 | Extended permissions, reduced verification |
| 3 | Standard | 50-74 | Default permissions (new identities start here) |
| 2 | Probationary | 25-49 | Limited permissions, increased monitoring |
| 1 | Limited | 10-24 | Minimal permissions, manual approval required |
| 0 | Restricted | 0-9 | Read-only, investigation required |

---

## Implementation Components

### 1. ExperienceAnchor Class

```javascript
/**
 * ExperienceAnchor - Binds sessions to ChittyID for experience accumulation
 */
export class ExperienceAnchor {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.kv = env.MEMORY_KV;
  }

  /**
   * Resolve or create ChittyID for a session
   */
  async resolveAnchor(sessionId, context) {
    // Check if session already bound
    const existing = await this.getSessionBinding(sessionId);
    if (existing) {
      await this.updateLastActivity(sessionId);
      return existing.chitty_id;
    }

    // Try to resolve by context (user, platform, fingerprint)
    const resolved = await this.resolveByContext(context);
    if (resolved) {
      await this.bindSession(sessionId, resolved, context);
      return resolved;
    }

    // Mint new ChittyID for this context
    const newChittyId = await this.mintContextIdentity(context);
    await this.bindSession(sessionId, newChittyId, context);

    return newChittyId;
  }

  /**
   * Commit session experience to ChittyID profile
   */
  async commitExperience(sessionId) {
    const binding = await this.getSessionBinding(sessionId);
    if (!binding) return;

    // Load session interactions from MemoryCloude
    const interactions = await this.loadSessionInteractions(sessionId);

    // Update experience profile
    await this.updateExperienceProfile(binding.chitty_id, {
      interactions: interactions.length,
      decisions: interactions.filter(i => i.type === 'decision').length,
      entities: this.extractEntities(interactions).length,
      sessionRiskScore: binding.session_risk_score,
      sessionSuccessRate: this.calculateSessionSuccess(interactions)
    });

    // Recalculate trust if threshold reached
    await this.maybeEvolveTrust(binding.chitty_id);

    // Mark session as unbound
    await this.unbindSession(sessionId, 'session_complete');
  }
}
```

### 2. MemoryCloude Enhancement

```javascript
// Add to MemoryCloude class

/**
 * Persist interaction with ChittyID anchor
 */
async persistInteractionWithAnchor(chittyId, sessionId, interaction) {
  const timestamp = Date.now();
  const interactionId = `${chittyId}-${sessionId}-${timestamp}`;

  // Store with ChittyID as primary key (for cross-platform recall)
  await this.kv.put(
    `chitty:${chittyId}:${timestamp}`,
    JSON.stringify({
      ...interaction,
      id: interactionId,
      sessionId,
      timestamp
    }),
    { expirationTtl: this.retention.conversations * 86400 }
  );

  // Update ChittyID index for fast lookup
  await this.updateChittyIdIndex(chittyId, interactionId);

  // Standard session-based storage (backward compatible)
  await this.persistInteraction(sessionId, interaction);
}

/**
 * Recall context across all sessions for a ChittyID
 */
async recallContextByChittyId(chittyId, query, options = {}) {
  // Get ChittyID index
  const index = await this.kv.get(`chitty:${chittyId}:index`, 'json');
  if (!index) return [];

  // Use semantic search across all ChittyID interactions
  return this.semanticRecallByChittyId(chittyId, query, options.limit || 10);
}
```

### 3. ContextConsciousness Enhancement

```javascript
// Add to ContextConsciousness class

/**
 * Analyze identity-level behavior patterns
 */
async analyzeIdentityBehavior(chittyId) {
  // Load experience profile
  const profile = await this.loadExperienceProfile(chittyId);
  if (!profile) return null;

  // Load recent session bindings
  const recentSessions = await this.loadRecentSessions(chittyId, 30); // Last 30 days

  // Calculate behavioral metrics
  const behavior = {
    chittyId,
    profile,
    metrics: {
      averageSessionDuration: this.calculateAvgSessionDuration(recentSessions),
      peakActivityHours: this.calculatePeakHours(recentSessions),
      platformDistribution: this.calculatePlatformDistribution(recentSessions),
      anomalyFrequency: profile.anomaly_count / Math.max(1, recentSessions.length),
      successTrend: this.calculateSuccessTrend(recentSessions)
    },
    riskAssessment: {
      currentRiskScore: profile.risk_score,
      riskTrend: this.calculateRiskTrend(recentSessions),
      riskFactors: this.identifyRiskFactors(profile, recentSessions)
    },
    trustRecommendation: this.recommendTrustAction(profile)
  };

  return behavior;
}

/**
 * Monitor ChittyID reputation in real-time
 */
async monitorReputation(chittyId, action) {
  const profile = await this.loadExperienceProfile(chittyId);

  // Analyze action for anomalies
  const anomaly = await this.detectBehavioralAnomaly(chittyId, action, profile);

  if (anomaly.detected) {
    // Update anomaly count
    await this.incrementAnomalyCount(chittyId);

    // Log anomaly
    await this.logAnomaly(chittyId, anomaly);

    // Check if trust demotion needed
    if (anomaly.severity === 'high') {
      await this.triggerTrustReview(chittyId, anomaly);
    }
  }

  return anomaly;
}
```

---

## Session Lifecycle Flow

```
┌───────────────────────────────────────┐
│ 1. SESSION START                      │
│ ─────────────────────────────────────│
│ → Receive sessionId from client       │
│ → ExperienceAnchor.resolveAnchor()    │
│   ├── Check existing binding          │
│   ├── Resolve by context (user, fp)   │
│   └── Mint new ChittyID if needed     │
│ → Load experience profile             │
│ → Load MemoryCloude history           │
│ → Initialize ContextConsciousness     │
└───────────────────────────────────────┘
          │
          ▼
┌───────────────────────────────────────┐
│ 2. SESSION ACTIVE                     │
│ ─────────────────────────────────────│
│ → MemoryCloude.persistWithAnchor()    │
│   ├── Store by ChittyID (portable)    │
│   └── Store by sessionId (compat)     │
│ → ContextConsciousness.monitor()      │
│   ├── Behavioral pattern analysis     │
│   └── Real-time anomaly detection     │
│ → Update session metrics              │
└───────────────────────────────────────┘
          │
          ▼
┌───────────────────────────────────────┐
│ 3. SESSION END                        │
│ ─────────────────────────────────────│
│ → ExperienceAnchor.commitExperience() │
│   ├── Aggregate session metrics       │
│   ├── Update experience_profiles      │
│   ├── Recalculate trust_score         │
│   └── Log trust evolution if changed  │
│ → MemoryCloude.summarizeSession()     │
│ → Unbind session                      │
│ → Sign audit trail with drand beacon  │
└───────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Schema Deployment
1. Deploy `experience_profiles` table
2. Deploy `session_chittyid_bindings` table
3. Deploy `trust_evolution_log` table

### Phase 2: Backward Compatible Integration
1. Add ChittyID resolution to session init
2. Dual-write to both sessionId and ChittyID keys
3. Maintain existing sessionId-based queries

### Phase 3: ChittyID-First Migration
1. Enable ChittyID-based memory recall
2. Migrate historical sessions to ChittyID bindings
3. Enable trust evolution calculations

### Phase 4: Full Activation
1. Enable ContextConsciousness reputation monitoring
2. Activate dynamic trust level updates
3. Enable expertise proof generation

---

## API Endpoints

### Experience Anchor

```
POST /api/v1/experience/resolve
  → Resolve/mint ChittyID for session

GET /api/v1/experience/{chittyId}/profile
  → Get experience profile

POST /api/v1/experience/{chittyId}/commit
  → Commit session experience

GET /api/v1/experience/{chittyId}/history
  → Get cross-session interaction history
```

### Trust Evolution

```
GET /api/v1/trust/{chittyId}/score
  → Get current trust score and level

GET /api/v1/trust/{chittyId}/evolution
  → Get trust evolution history

POST /api/v1/trust/{chittyId}/recalculate
  → Trigger trust recalculation
```

### Reputation Monitoring

```
GET /api/v1/reputation/{chittyId}
  → Get reputation analysis

GET /api/v1/reputation/{chittyId}/anomalies
  → Get anomaly history

POST /api/v1/reputation/{chittyId}/review
  → Trigger reputation review
```

---

## Next Steps

1. [ ] Review and approve this design
2. [ ] Create database migration scripts
3. [ ] Implement ExperienceAnchor class
4. [ ] Enhance MemoryCloude with ChittyID binding
5. [ ] Enhance ContextConsciousness with reputation monitoring
6. [ ] Implement trust evolution algorithm
7. [ ] Create API endpoints
8. [ ] Write integration tests
9. [ ] Deploy to staging
10. [ ] Migration of existing sessions
