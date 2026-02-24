/**
 * ExperienceAnchor™ - Session-to-ChittyID Binding
 *
 * Binds ephemeral sessions to persistent ChittyID for experience accumulation.
 * Enables cross-platform memory portability and dynamic trust evolution.
 *
 * @module intelligence/experience-anchor
 */

export class ExperienceAnchor {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.kv = env.MEMORY_KV || env.TOKEN_KV;

    // Trust calculation weights
    this.trustWeights = {
      experienceVolume: 0.2,
      successRate: 0.3,
      anomalyPenalty: 0.2,
      sessionQuality: 0.15,
      recency: 0.15,
    };

    // Trust level thresholds
    this.trustThresholds = [
      { level: 5, minScore: 90, name: "Exemplary" },
      { level: 4, minScore: 75, name: "Established" },
      { level: 3, minScore: 50, name: "Standard" },
      { level: 2, minScore: 25, name: "Probationary" },
      { level: 1, minScore: 10, name: "Limited" },
      { level: 0, minScore: 0, name: "Restricted" },
    ];
  }

  /**
   * Initialize ExperienceAnchor™
   */
  async initialize() {
    console.log(
      "[ExperienceAnchor™] Initializing session-to-ChittyID binding...",
    );
    console.log("[ExperienceAnchor™] Ready for experience accumulation");
  }

  // ============================================================================
  // Session Binding
  // ============================================================================

  /**
   * Resolve or create ChittyID anchor for a session
   *
   * @param {string} sessionId - Ephemeral session identifier
   * @param {object} context - Session context (platform, user, fingerprint)
   * @returns {Promise<string>} ChittyID anchor
   */
  async resolveAnchor(sessionId, context) {
    // Check if session already bound
    const existing = await this.getSessionBinding(sessionId);
    if (existing) {
      await this.updateLastActivity(sessionId);
      console.log(
        `[ExperienceAnchor™] Session ${sessionId} already bound to ${existing.chitty_id}`,
      );
      return existing.chitty_id;
    }

    // Try to resolve by context (user, platform, fingerprint)
    const resolved = await this.resolveByContext(context);
    if (resolved) {
      await this.bindSession(sessionId, resolved, context);
      console.log(
        `[ExperienceAnchor™] Session ${sessionId} bound to existing ${resolved}`,
      );
      return resolved;
    }

    // Mint new ChittyID for this context
    const newChittyId = await this.mintContextIdentity(context);
    await this.bindSession(sessionId, newChittyId, context);
    await this.createExperienceProfile(newChittyId);

    console.log(
      `[ExperienceAnchor™] Session ${sessionId} bound to new ${newChittyId}`,
    );
    return newChittyId;
  }

  /**
   * Get existing session binding
   */
  async getSessionBinding(sessionId) {
    try {
      // Check KV cache first
      const cached = await this.kv?.get(`binding:${sessionId}`, "json");
      if (cached) return cached;

      // Check database
      if (this.db) {
        const result = await this.db
          .prepare(
            `
          SELECT * FROM session_chittyid_bindings
          WHERE session_id = ? AND unbound_at IS NULL
          LIMIT 1
        `,
          )
          .bind(sessionId)
          .first();

        if (result) {
          // Cache for future lookups
          await this.kv?.put(`binding:${sessionId}`, JSON.stringify(result), {
            expirationTtl: 3600, // 1 hour
          });
        }

        return result;
      }

      return null;
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] Get session binding failed:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Resolve ChittyID by context (user ID, platform, fingerprint)
   */
  async resolveByContext(context) {
    if (!context || !this.db) return null;

    try {
      // Try to find existing ChittyID by user ID first
      if (context.userId) {
        const result = await this.db
          .prepare(
            `
          SELECT DISTINCT chitty_id FROM session_chittyid_bindings
          WHERE client_fingerprint LIKE ?
          ORDER BY last_activity DESC
          LIMIT 1
        `,
          )
          .bind(`%user:${context.userId}%`)
          .first();

        if (result) return result.chitty_id;
      }

      // Try by fingerprint
      if (context.fingerprint) {
        const result = await this.db
          .prepare(
            `
          SELECT DISTINCT chitty_id FROM session_chittyid_bindings
          WHERE client_fingerprint = ?
          ORDER BY last_activity DESC
          LIMIT 1
        `,
          )
          .bind(context.fingerprint)
          .first();

        if (result) return result.chitty_id;
      }

      return null;
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] Resolve by context failed:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Mint new ChittyID for context
   */
  async mintContextIdentity(context) {
    try {
      // Call ChittyID service to mint
      const chittyIdUrl =
        this.env.CHITTYID_SERVICE_URL || "https://id.chitty.cc";
      const response = await fetch(`${chittyIdUrl}/api/v1/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTY_ID_SERVICE_TOKEN}`,
          "User-Agent": "ChittyConnect/1.0 (ExperienceAnchor)",
        },
        body: JSON.stringify({
          entity_type: "P",
          characterization: "Synthetic",
          classification: "internal",
          metadata: {
            platform: context.platform,
            created_by: "experience_anchor",
            initial_trust_level: 3,
          },
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return result.technical_id || result.chitty_id;
      }

      // Fallback: generate local ID
      return this.generateLocalChittyId(context);
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] ChittyID mint failed, using fallback:",
        error.message,
      );
      return this.generateLocalChittyId(context);
    }
  }

  /**
   * Generate local ChittyID (fallback when service unavailable)
   */
  generateLocalChittyId(context) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);

    // Canonical format: VV-G-LLL-SSSS-T-YYMM-C-X where T is P (Person/Synthetic)
    // @canon: chittycanon://gov/governance#core-types
    const now = new Date();
    const yearMonth = `${now.getFullYear() % 100}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
    const sequence = timestamp.substring(0, 4).toUpperCase();

    return `03-1-USA-${sequence}-P-${yearMonth}-0-${random.substring(0, 1).toUpperCase()}`;
  }

  /**
   * Bind session to ChittyID
   */
  async bindSession(sessionId, chittyId, context) {
    const binding = {
      session_id: sessionId,
      chitty_id: chittyId,
      platform: context.platform || "unknown",
      client_fingerprint: this.buildFingerprint(context),
      bound_at: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      interactions_count: 0,
      decisions_count: 0,
      entities_discovered: 0,
      session_risk_score: 0,
    };

    try {
      // Store in database
      if (this.db) {
        await this.db
          .prepare(
            `
          INSERT INTO session_chittyid_bindings
          (session_id, chitty_id, platform, client_fingerprint, bound_at, last_activity)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .bind(
            binding.session_id,
            binding.chitty_id,
            binding.platform,
            binding.client_fingerprint,
            binding.bound_at,
            binding.last_activity,
          )
          .run();
      }

      // Cache in KV
      await this.kv?.put(`binding:${sessionId}`, JSON.stringify(binding), {
        expirationTtl: 86400, // 24 hours
      });

      return binding;
    } catch (error) {
      console.error("[ExperienceAnchor™] Bind session failed:", error.message);
      throw error;
    }
  }

  /**
   * Build fingerprint from context
   */
  buildFingerprint(context) {
    const parts = [];
    if (context.userId) parts.push(`user:${context.userId}`);
    if (context.platform) parts.push(`platform:${context.platform}`);
    if (context.fingerprint) parts.push(`fp:${context.fingerprint}`);
    if (context.ipHash) parts.push(`ip:${context.ipHash}`);
    return parts.join("|") || "unknown";
  }

  /**
   * Update last activity timestamp
   */
  async updateLastActivity(sessionId) {
    const now = new Date().toISOString();

    try {
      if (this.db) {
        await this.db
          .prepare(
            `
          UPDATE session_chittyid_bindings
          SET last_activity = ?
          WHERE session_id = ? AND unbound_at IS NULL
        `,
          )
          .bind(now, sessionId)
          .run();
      }

      // Update cache
      const cached = await this.kv?.get(`binding:${sessionId}`, "json");
      if (cached) {
        cached.last_activity = now;
        await this.kv?.put(`binding:${sessionId}`, JSON.stringify(cached), {
          expirationTtl: 86400,
        });
      }
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] Update last activity failed:",
        error.message,
      );
    }
  }

  // ============================================================================
  // Experience Profile Management
  // ============================================================================

  /**
   * Create new experience profile for ChittyID
   */
  async createExperienceProfile(chittyId) {
    const profile = {
      chitty_id: chittyId,
      total_interactions: 0,
      total_decisions: 0,
      total_entities: 0,
      current_trust_level: 3,
      trust_score: 50.0,
      expertise_domains: [],
      success_rate: 0,
      confidence_score: 50.0,
      risk_score: 0,
      anomaly_count: 0,
    };

    try {
      if (this.db) {
        await this.db
          .prepare(
            `
          INSERT INTO experience_profiles
          (chitty_id, total_interactions, total_decisions, total_entities,
           current_trust_level, trust_score, expertise_domains, success_rate,
           confidence_score, risk_score, anomaly_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (chitty_id) DO NOTHING
        `,
          )
          .bind(
            profile.chitty_id,
            profile.total_interactions,
            profile.total_decisions,
            profile.total_entities,
            profile.current_trust_level,
            profile.trust_score,
            JSON.stringify(profile.expertise_domains),
            profile.success_rate,
            profile.confidence_score,
            profile.risk_score,
            profile.anomaly_count,
          )
          .run();
      }

      // Cache
      await this.kv?.put(`profile:${chittyId}`, JSON.stringify(profile), {
        expirationTtl: 3600,
      });

      return profile;
    } catch (error) {
      console.error(
        "[ExperienceAnchor™] Create profile failed:",
        error.message,
      );
      return profile; // Return default even on error
    }
  }

  /**
   * Load experience profile for ChittyID
   */
  async loadExperienceProfile(chittyId) {
    try {
      // Check cache first
      const cached = await this.kv?.get(`profile:${chittyId}`, "json");
      if (cached) return cached;

      // Load from database
      if (this.db) {
        const result = await this.db
          .prepare(
            `
          SELECT * FROM experience_profiles WHERE chitty_id = ?
        `,
          )
          .bind(chittyId)
          .first();

        if (result) {
          // Parse JSONB fields
          if (typeof result.expertise_domains === "string") {
            result.expertise_domains = JSON.parse(result.expertise_domains);
          }

          // Cache
          await this.kv?.put(`profile:${chittyId}`, JSON.stringify(result), {
            expirationTtl: 3600,
          });

          return result;
        }
      }

      return null;
    } catch (error) {
      console.warn("[ExperienceAnchor™] Load profile failed:", error.message);
      return null;
    }
  }

  /**
   * Update experience profile with session metrics
   */
  async updateExperienceProfile(chittyId, sessionMetrics) {
    try {
      const profile = await this.loadExperienceProfile(chittyId);
      if (!profile) {
        console.warn(`[ExperienceAnchor™] No profile found for ${chittyId}`);
        return;
      }

      // Calculate new totals
      const newInteractions =
        profile.total_interactions + (sessionMetrics.interactions || 0);
      const newDecisions =
        profile.total_decisions + (sessionMetrics.decisions || 0);
      const newEntities =
        profile.total_entities + (sessionMetrics.entities || 0);

      // Calculate rolling success rate
      const totalAttempts = newInteractions;
      const previousSuccesses =
        profile.success_rate * profile.total_interactions;
      const sessionSuccesses =
        (sessionMetrics.sessionSuccessRate || 0) *
        (sessionMetrics.interactions || 0);
      const newSuccessRate =
        totalAttempts > 0
          ? (previousSuccesses + sessionSuccesses) / totalAttempts
          : 0;

      // Update risk score (weighted average)
      const sessionWeight = 0.3;
      const newRiskScore =
        profile.risk_score * (1 - sessionWeight) +
        (sessionMetrics.sessionRiskScore || 0) * sessionWeight;

      // Update in database
      if (this.db) {
        await this.db
          .prepare(
            `
          UPDATE experience_profiles SET
            total_interactions = ?,
            total_decisions = ?,
            total_entities = ?,
            success_rate = ?,
            risk_score = ?,
            newest_interaction = CURRENT_TIMESTAMP,
            oldest_interaction = COALESCE(oldest_interaction, CURRENT_TIMESTAMP)
          WHERE chitty_id = ?
        `,
          )
          .bind(
            newInteractions,
            newDecisions,
            newEntities,
            newSuccessRate,
            newRiskScore,
            chittyId,
          )
          .run();
      }

      // Invalidate cache
      await this.kv?.delete(`profile:${chittyId}`);

      console.log(
        `[ExperienceAnchor™] Updated profile for ${chittyId}: +${sessionMetrics.interactions || 0} interactions`,
      );
    } catch (error) {
      console.error(
        "[ExperienceAnchor™] Update profile failed:",
        error.message,
      );
    }
  }

  // ============================================================================
  // Session Completion & Experience Commit
  // ============================================================================

  /**
   * Commit session experience to ChittyID profile
   *
   * @param {string} sessionId - Session to commit
   * @param {object} memoryCloude - MemoryCloude instance for loading interactions
   */
  async commitExperience(sessionId, memoryCloude) {
    const binding = await this.getSessionBinding(sessionId);
    if (!binding) {
      console.warn(
        `[ExperienceAnchor™] No binding found for session ${sessionId}`,
      );
      return;
    }

    try {
      // Load session interactions from MemoryCloude
      const interactions = memoryCloude
        ? await memoryCloude.getSessionInteractions(sessionId)
        : [];

      // Calculate session metrics
      const sessionMetrics = {
        interactions: interactions.length,
        decisions: interactions.filter((i) => i.type === "decision").length,
        entities: this.extractUniqueEntities(interactions).length,
        sessionRiskScore: binding.session_risk_score || 0,
        sessionSuccessRate: this.calculateSessionSuccess(interactions),
      };

      // Update experience profile
      await this.updateExperienceProfile(binding.chitty_id, sessionMetrics);

      // Recalculate trust if threshold reached
      await this.maybeEvolveTrust(binding.chitty_id);

      // Mark session as unbound
      await this.unbindSession(sessionId, "session_complete");

      console.log(
        `[ExperienceAnchor™] Committed experience for ${binding.chitty_id} from session ${sessionId}`,
      );

      return {
        chittyId: binding.chitty_id,
        sessionId,
        metrics: sessionMetrics,
        committed: true,
      };
    } catch (error) {
      console.error(
        "[ExperienceAnchor™] Commit experience failed:",
        error.message,
      );
      throw error;
    }
  }

  /**
   * Extract unique entities from interactions
   */
  extractUniqueEntities(interactions) {
    const entities = new Set();

    for (const interaction of interactions) {
      if (interaction.entities) {
        for (const entity of interaction.entities) {
          entities.add(`${entity.type}:${entity.id}`);
        }
      }
    }

    return Array.from(entities);
  }

  /**
   * Calculate session success rate
   */
  calculateSessionSuccess(interactions) {
    if (interactions.length === 0) return 0;

    const successful = interactions.filter(
      (i) =>
        i.success === true || i.result === "success" || i.completed === true,
    ).length;

    return successful / interactions.length;
  }

  /**
   * Unbind session
   */
  async unbindSession(sessionId, reason) {
    const now = new Date().toISOString();

    try {
      if (this.db) {
        await this.db
          .prepare(
            `
          UPDATE session_chittyid_bindings
          SET unbound_at = ?, unbind_reason = ?
          WHERE session_id = ? AND unbound_at IS NULL
        `,
          )
          .bind(now, reason, sessionId)
          .run();
      }

      // Remove from cache
      await this.kv?.delete(`binding:${sessionId}`);

      console.log(
        `[ExperienceAnchor™] Unbound session ${sessionId}: ${reason}`,
      );
    } catch (error) {
      console.error(
        "[ExperienceAnchor™] Unbind session failed:",
        error.message,
      );
    }
  }

  // ============================================================================
  // Trust Evolution
  // ============================================================================

  /**
   * Maybe evolve trust level based on accumulated experience
   */
  async maybeEvolveTrust(chittyId) {
    const profile = await this.loadExperienceProfile(chittyId);
    if (!profile) return;

    // Only recalculate if enough interactions since last calculation
    const interactionsSinceLastCalc =
      profile.total_interactions - (profile.interactions_at_last_calc || 0);

    if (interactionsSinceLastCalc < 10) {
      return; // Not enough new data
    }

    await this.evolveTrust(chittyId, profile);
  }

  /**
   * Calculate and update trust level
   */
  async evolveTrust(chittyId, profile) {
    const previousLevel = profile.current_trust_level;
    const previousScore = profile.trust_score;

    // Calculate new trust score
    const newScore = this.calculateTrustScore(profile);
    const newLevel = this.trustScoreToLevel(newScore);

    // Only update if changed
    if (Math.abs(newScore - previousScore) < 1 && newLevel === previousLevel) {
      return; // No significant change
    }

    try {
      // Update profile
      if (this.db) {
        await this.db
          .prepare(
            `
          UPDATE experience_profiles SET
            trust_score = ?,
            current_trust_level = ?,
            trust_last_calculated = CURRENT_TIMESTAMP,
            trust_calculation_version = 'v1.0'
          WHERE chitty_id = ?
        `,
          )
          .bind(newScore, newLevel, chittyId)
          .run();

        // Log evolution
        const changeFactors = {
          experienceVolume: profile.total_interactions,
          successRate: profile.success_rate,
          anomalyCount: profile.anomaly_count,
          riskScore: profile.risk_score,
          calculationVersion: "v1.0",
        };

        const contentHash = await this.hashContent(
          JSON.stringify(changeFactors),
        );

        await this.db
          .prepare(
            `
          INSERT INTO trust_evolution_log
          (chitty_id, previous_trust_level, new_trust_level,
           previous_trust_score, new_trust_score, change_trigger,
           change_factors, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .bind(
            chittyId,
            previousLevel,
            newLevel,
            previousScore,
            newScore,
            "experience_accumulated",
            JSON.stringify(changeFactors),
            contentHash,
          )
          .run();
      }

      // Invalidate cache
      await this.kv?.delete(`profile:${chittyId}`);

      console.log(
        `[ExperienceAnchor™] Trust evolved for ${chittyId}: ${previousLevel} → ${newLevel} (${previousScore.toFixed(1)} → ${newScore.toFixed(1)})`,
      );

      return { previousLevel, newLevel, previousScore, newScore };
    } catch (error) {
      console.error("[ExperienceAnchor™] Evolve trust failed:", error.message);
    }
  }

  /**
   * Calculate trust score based on profile metrics
   */
  calculateTrustScore(profile) {
    // Experience volume score (0-100)
    const volumeScore = Math.min(
      100,
      Math.log10(profile.total_interactions + 1) * 20 +
        Math.log10(profile.total_decisions + 1) * 15 +
        Math.log10(profile.total_entities + 1) * 10,
    );

    // Success rate score (0-100)
    const successScore = (profile.success_rate || 0) * 100;

    // Anomaly penalty (0 = no penalty, 100 = max penalty)
    const anomalyPenalty = Math.min(100, (profile.anomaly_count || 0) * 10);
    const anomalyScore = 100 - anomalyPenalty;

    // Session quality (inverted risk score)
    const sessionQuality = 100 - (profile.risk_score || 0);

    // Recency score (based on newest_interaction)
    let recencyScore = 100;
    if (profile.newest_interaction) {
      const daysSinceLastInteraction =
        (Date.now() - new Date(profile.newest_interaction).getTime()) /
        86400000;
      recencyScore = Math.max(0, 100 - daysSinceLastInteraction * 2);
    }

    // Weighted combination
    const trustScore =
      this.trustWeights.experienceVolume * volumeScore +
      this.trustWeights.successRate * successScore +
      this.trustWeights.anomalyPenalty * anomalyScore +
      this.trustWeights.sessionQuality * sessionQuality +
      this.trustWeights.recency * recencyScore;

    return Math.round(trustScore * 100) / 100;
  }

  /**
   * Map trust score to trust level
   */
  trustScoreToLevel(trustScore) {
    for (const threshold of this.trustThresholds) {
      if (trustScore >= threshold.minScore) {
        return threshold.level;
      }
    }
    return 0;
  }

  /**
   * Hash content for cryptographic proof
   */
  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get ChittyID for session (convenience method)
   */
  async getChittyIdForSession(sessionId) {
    const binding = await this.getSessionBinding(sessionId);
    return binding?.chitty_id || null;
  }

  /**
   * Get all active sessions for ChittyID
   */
  async getActiveSessionsForChittyId(chittyId) {
    try {
      if (this.db) {
        const result = await this.db
          .prepare(
            `
          SELECT * FROM session_chittyid_bindings
          WHERE chitty_id = ? AND unbound_at IS NULL
          ORDER BY last_activity DESC
        `,
          )
          .bind(chittyId)
          .all();

        return result.results || [];
      }
      return [];
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] Get active sessions failed:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Get trust level name
   */
  getTrustLevelName(level) {
    const threshold = this.trustThresholds.find((t) => t.level === level);
    return threshold?.name || "Unknown";
  }

  /**
   * Increment session metric
   */
  async incrementSessionMetric(sessionId, metric, amount = 1) {
    try {
      if (this.db) {
        await this.db
          .prepare(
            `
          UPDATE session_chittyid_bindings
          SET ${metric} = ${metric} + ?
          WHERE session_id = ? AND unbound_at IS NULL
        `,
          )
          .bind(amount, sessionId)
          .run();
      }

      // Update cache
      const cached = await this.kv?.get(`binding:${sessionId}`, "json");
      if (cached) {
        cached[metric] = (cached[metric] || 0) + amount;
        await this.kv?.put(`binding:${sessionId}`, JSON.stringify(cached), {
          expirationTtl: 86400,
        });
      }
    } catch (error) {
      console.warn(
        "[ExperienceAnchor™] Increment metric failed:",
        error.message,
      );
    }
  }
}

export default ExperienceAnchor;
