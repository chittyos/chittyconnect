/**
 * Context Behavior Analysis
 *
 * Tracks and analyzes how contexts evolve over time based on:
 * - External sources they're exposed to
 * - Behavioral tendencies that develop
 * - Trend direction (improving, degrading, stable)
 * - Red flags and concerning patterns
 *
 * WHY: Contexts can develop "personalities" based on what they're exposed to.
 * A context that primarily works with x.com/Grok might develop different
 * tendencies than one that works with GitHub documentation.
 *
 * WHAT: Tracks influence sources, assesses traits, detects trends, raises alerts.
 *
 * WHEN: On every significant interaction (tool use, external API call, etc.)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-behavior
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/spec/behavioral-traits
 */

/**
 * Default behavioral trait weights
 * Traits are scored 0.0-1.0
 */
export const BEHAVIORAL_TRAITS = {
  // How predictable vs erratic the context behaves
  volatile: {
    name: 'Volatile',
    description: 'Tendency toward erratic or unpredictable behavior',
    inversePositive: true, // Lower is better
    threshold: 0.7, // Red flag if above this
  },

  // How well the context follows rules and guidelines
  compliant: {
    name: 'Compliant',
    description: 'Adherence to rules, guidelines, and expected patterns',
    inversePositive: false, // Higher is better
    threshold: 0.3, // Red flag if below this
  },

  // How often the context tries new approaches
  creative: {
    name: 'Creative',
    description: 'Tendency to explore novel solutions',
    inversePositive: false,
    threshold: null, // No red flag threshold
  },

  // How systematic and organized the context is
  methodical: {
    name: 'Methodical',
    description: 'Systematic, organized approach to tasks',
    inversePositive: false,
    threshold: null,
  },

  // How well the context handles failures
  resilient: {
    name: 'Resilient',
    description: 'Ability to recover from errors and setbacks',
    inversePositive: false,
    threshold: 0.3,
  },

  // How much the context self-corrects
  selfCorrecting: {
    name: 'Self-Correcting',
    description: 'Tendency to recognize and fix own mistakes',
    inversePositive: false,
    threshold: 0.3,
  },

  // How well context maintains focus
  focused: {
    name: 'Focused',
    description: 'Ability to stay on task without wandering',
    inversePositive: false,
    threshold: 0.4,
  },

  // Trust alignment
  trustAligned: {
    name: 'Trust-Aligned',
    description: 'Alignment with trust/safety guidelines',
    inversePositive: false,
    threshold: 0.4,
  },
};

/**
 * Known source influence profiles
 * These define how different sources tend to influence context behavior
 */
export const SOURCE_PROFILES = {
  // Documentation sources - generally stabilizing
  'docs.github.com': { stability: 0.9, compliance: 0.9, category: 'documentation' },
  'developer.mozilla.org': { stability: 0.9, compliance: 0.9, category: 'documentation' },
  'stackoverflow.com': { stability: 0.6, compliance: 0.7, category: 'community' },

  // Code repositories - depends on quality
  'github.com': { stability: 0.7, compliance: 0.8, category: 'code' },
  'gitlab.com': { stability: 0.7, compliance: 0.8, category: 'code' },

  // Social/content platforms - more variable
  'x.com': { stability: 0.3, compliance: 0.4, category: 'social' },
  'twitter.com': { stability: 0.3, compliance: 0.4, category: 'social' },
  'reddit.com': { stability: 0.4, compliance: 0.5, category: 'social' },

  // AI models - varies by model
  'openai.com': { stability: 0.7, compliance: 0.8, category: 'ai_model' },
  'anthropic.com': { stability: 0.8, compliance: 0.9, category: 'ai_model' },

  // Default for unknown sources
  _default: { stability: 0.5, compliance: 0.5, category: 'unknown' },
};

/**
 * ContextBehavior class - analyzes and tracks context behavioral evolution
 */
export class ContextBehavior {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
  }

  /**
   * Log an exposure event (context interacted with external source)
   */
  async logExposure(chittyId, exposure) {
    const {
      sourceDomain,
      sourceType = 'api',
      interactionType = 'read',
      contentCategory,
      sessionId,
    } = exposure;

    // Get context
    const context = await this.db.prepare(
      'SELECT id FROM context_entities WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (!context) {
      return { error: 'Context not found' };
    }

    // Calculate sentiment and compliance alignment based on source profile
    const profile = SOURCE_PROFILES[sourceDomain] || SOURCE_PROFILES._default;
    const sentimentScore = (profile.stability - 0.5) * 2; // Convert to -1 to 1
    const complianceAlignment = profile.compliance;

    // Log the exposure
    await this.db.prepare(`
      INSERT INTO context_exposure_log
        (id, context_id, context_chitty_id, source_domain, source_type,
         interaction_type, content_category, sentiment_score, compliance_alignment, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      context.id,
      chittyId,
      sourceDomain,
      sourceType,
      interactionType,
      contentCategory || profile.category,
      sentimentScore,
      complianceAlignment,
      sessionId
    ).run();

    // Update influence sources in DNA
    await this.updateInfluenceSources(chittyId, sourceDomain, profile);

    return { logged: true, profile };
  }

  /**
   * Update the influence_sources field in context_dna
   */
  async updateInfluenceSources(chittyId, sourceDomain, profile) {
    const dna = await this.db.prepare(
      'SELECT id, influence_sources FROM context_dna WHERE context_chitty_id = ?'
    ).bind(chittyId).first();

    if (!dna) return;

    const sources = JSON.parse(dna.influence_sources || '{}');

    if (!sources[sourceDomain]) {
      sources[sourceDomain] = {
        interactions: 0,
        impact: 'neutral',
        firstSeen: Date.now(),
      };
    }

    sources[sourceDomain].interactions++;
    sources[sourceDomain].lastSeen = Date.now();

    // Determine impact based on cumulative exposure
    const count = sources[sourceDomain].interactions;
    if (profile.stability < 0.4 && count > 10) {
      sources[sourceDomain].impact = 'concerning';
    } else if (profile.stability > 0.7) {
      sources[sourceDomain].impact = 'positive';
    }

    await this.db.prepare(
      'UPDATE context_dna SET influence_sources = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(JSON.stringify(sources), dna.id).run();
  }

  /**
   * Assess behavioral traits based on accumulated patterns
   */
  async assessBehavior(chittyId) {
    // Get context DNA
    const dna = await this.db.prepare(`
      SELECT cd.*, ce.trust_level, ce.trust_score
      FROM context_dna cd
      JOIN context_entities ce ON cd.context_id = ce.id
      WHERE cd.context_chitty_id = ?
    `).bind(chittyId).first();

    if (!dna) {
      return { error: 'Context not found' };
    }

    const currentTraits = JSON.parse(dna.behavioral_traits || '{}');
    const sources = JSON.parse(dna.influence_sources || '{}');
    const patterns = JSON.parse(dna.patterns || '[]');

    // Calculate trait scores
    const newTraits = {
      volatile: this.calculateVolatility(dna, patterns),
      compliant: this.calculateCompliance(dna, sources),
      creative: this.calculateCreativity(patterns),
      methodical: this.calculateMethodical(patterns),
      resilient: this.calculateResilience(dna),
      selfCorrecting: this.calculateSelfCorrection(patterns),
      focused: this.calculateFocus(patterns),
      trustAligned: dna.trust_level / 5, // Normalize trust level to 0-1
    };

    // Detect significant changes
    const changes = [];
    for (const [trait, newValue] of Object.entries(newTraits)) {
      const oldValue = currentTraits[trait] || 0.5;
      const diff = Math.abs(newValue - oldValue);
      if (diff > 0.15) {
        changes.push({
          trait,
          from: oldValue,
          to: newValue,
          direction: newValue > oldValue ? 'increased' : 'decreased',
        });
      }
    }

    // Determine trend
    const trend = this.calculateTrend(currentTraits, newTraits, dna);

    // Check for red flags
    const redFlags = this.checkRedFlags(newTraits, sources);

    // Update DNA
    await this.db.prepare(`
      UPDATE context_dna SET
        behavioral_traits = ?,
        trend_direction = ?,
        trend_confidence = ?,
        red_flag_count = ?,
        last_behavior_assessment = unixepoch(),
        updated_at = unixepoch()
      WHERE context_chitty_id = ?
    `).bind(
      JSON.stringify(newTraits),
      trend.direction,
      trend.confidence,
      redFlags.length,
      chittyId
    ).run();

    // Log significant events
    if (changes.length > 0) {
      await this.logBehavioralEvent(chittyId, 'trait_shift', {
        previousState: currentTraits,
        newState: newTraits,
        triggerFactors: changes,
        severity: changes.length >= 3 ? 7 : 5,
      });
    }

    if (redFlags.length > 0) {
      for (const flag of redFlags) {
        await this.logBehavioralEvent(chittyId, 'red_flag_detected', {
          previousState: {},
          newState: { flag },
          triggerFactors: [flag.reason],
          severity: flag.severity,
        });
      }
    }

    return {
      chittyId,
      traits: newTraits,
      trend,
      changes,
      redFlags,
      influenceSources: sources,
    };
  }

  /**
   * Calculate volatility score (0 = stable, 1 = volatile)
   */
  calculateVolatility(dna, patterns) {
    let volatility = 0.5; // Start neutral

    // High anomaly count = more volatile
    if (dna.anomaly_count > 10) volatility += 0.3;
    else if (dna.anomaly_count > 5) volatility += 0.15;

    // Inconsistent success rate = more volatile
    if (dna.success_rate < 0.5) volatility += 0.2;

    // Many failed outcomes = more volatile
    const totalOutcomes = dna.outcomes_successful + dna.outcomes_failed + dna.outcomes_neutral;
    if (totalOutcomes > 0) {
      const failRate = dna.outcomes_failed / totalOutcomes;
      volatility += failRate * 0.2;
    }

    return Math.min(1, Math.max(0, volatility));
  }

  /**
   * Calculate compliance score (0 = non-compliant, 1 = compliant)
   */
  calculateCompliance(dna, sources) {
    let compliance = dna.success_rate || 0.5;

    // Adjust based on source influence
    let sourceCount = 0;
    let sourceCompliance = 0;
    for (const [domain, data] of Object.entries(sources)) {
      const profile = SOURCE_PROFILES[domain] || SOURCE_PROFILES._default;
      sourceCompliance += profile.compliance * data.interactions;
      sourceCount += data.interactions;
    }

    if (sourceCount > 0) {
      const avgSourceCompliance = sourceCompliance / sourceCount;
      // Blend source influence with base compliance
      compliance = compliance * 0.6 + avgSourceCompliance * 0.4;
    }

    // Anomalies reduce compliance
    compliance -= (dna.anomaly_count || 0) * 0.02;

    return Math.min(1, Math.max(0, compliance));
  }

  /**
   * Calculate creativity based on patterns
   */
  calculateCreativity(patterns) {
    // More diverse patterns = more creative
    const uniqueTypes = new Set(patterns.map((p) => p.type || p.name));
    const creativity = Math.min(1, uniqueTypes.size / 10);
    return creativity;
  }

  /**
   * Calculate how methodical the context is
   */
  calculateMethodical(patterns) {
    // Consistent patterns = more methodical
    if (patterns.length < 5) return 0.5;

    // Look for repeated patterns (same type)
    const typeCounts = {};
    for (const p of patterns) {
      const type = p.type || p.name || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    const repeats = Object.values(typeCounts).filter((c) => c > 1).length;
    return Math.min(1, 0.3 + (repeats / Object.keys(typeCounts).length) * 0.7);
  }

  /**
   * Calculate resilience (ability to recover from failures)
   */
  calculateResilience(dna) {
    const total = (dna.outcomes_successful || 0) + (dna.outcomes_failed || 0);
    if (total < 5) return 0.5;

    // If we have failures but still have successful outcomes after, that's resilience
    const successRate = dna.success_rate || 0.5;
    return successRate;
  }

  /**
   * Calculate self-correction tendency
   */
  calculateSelfCorrection(patterns) {
    // Look for correction patterns
    const corrections = patterns.filter(
      (p) => p.name?.includes('correct') || p.type?.includes('fix') || p.name?.includes('retry')
    );
    return Math.min(1, 0.3 + corrections.length * 0.1);
  }

  /**
   * Calculate focus score
   */
  calculateFocus(patterns) {
    if (patterns.length < 3) return 0.5;

    // If patterns are in similar domains, context is focused
    const domains = patterns.map((p) => p.domain || 'unknown');
    const uniqueDomains = new Set(domains);
    const focusRatio = 1 - uniqueDomains.size / domains.length;
    return Math.min(1, 0.3 + focusRatio * 0.7);
  }

  /**
   * Calculate overall trend
   */
  calculateTrend(oldTraits, newTraits, dna) {
    // Compare key traits
    const improvements = [];
    const degradations = [];

    for (const [trait, config] of Object.entries(BEHAVIORAL_TRAITS)) {
      const oldVal = oldTraits[trait] || 0.5;
      const newVal = newTraits[trait] || 0.5;
      const diff = newVal - oldVal;

      if (Math.abs(diff) > 0.05) {
        const isImprovement = config.inversePositive ? diff < 0 : diff > 0;
        if (isImprovement) {
          improvements.push(trait);
        } else {
          degradations.push(trait);
        }
      }
    }

    // Determine direction
    let direction = 'stable';
    if (improvements.length > degradations.length + 1) {
      direction = 'improving';
    } else if (degradations.length > improvements.length + 1) {
      direction = 'degrading';
    } else if (improvements.length > 0 && degradations.length > 0) {
      direction = 'volatile';
    }

    // Calculate confidence based on data points
    const dataPoints = dna.total_interactions || 0;
    let confidence = Math.min(1, dataPoints / 100);

    return {
      direction,
      confidence,
      improvements,
      degradations,
    };
  }

  /**
   * Check for red flags
   */
  checkRedFlags(traits, sources) {
    const flags = [];

    // Check trait thresholds
    for (const [trait, config] of Object.entries(BEHAVIORAL_TRAITS)) {
      if (config.threshold === null) continue;

      const value = traits[trait] || 0.5;
      const isBad = config.inversePositive
        ? value > config.threshold
        : value < config.threshold;

      if (isBad) {
        flags.push({
          type: 'trait_threshold',
          trait,
          value,
          threshold: config.threshold,
          reason: `${config.name} is ${config.inversePositive ? 'above' : 'below'} threshold`,
          severity: config.inversePositive
            ? Math.round((value - config.threshold) * 10)
            : Math.round((config.threshold - value) * 10),
        });
      }
    }

    // Check source concerns
    for (const [domain, data] of Object.entries(sources)) {
      const profile = SOURCE_PROFILES[domain] || SOURCE_PROFILES._default;
      if (data.interactions > 20 && profile.stability < 0.4) {
        flags.push({
          type: 'source_concern',
          source: domain,
          interactions: data.interactions,
          reason: `High exposure to low-stability source: ${domain}`,
          severity: Math.min(8, Math.round(data.interactions / 10)),
        });
      }
    }

    return flags;
  }

  /**
   * Log a behavioral event
   */
  async logBehavioralEvent(chittyId, eventType, details) {
    const context = await this.db.prepare(
      'SELECT id FROM context_entities WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (!context) return;

    await this.db.prepare(`
      INSERT INTO context_behavioral_events
        (id, context_id, context_chitty_id, event_type, previous_state, new_state, trigger_factors, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      context.id,
      chittyId,
      eventType,
      JSON.stringify(details.previousState || {}),
      JSON.stringify(details.newState || {}),
      JSON.stringify(details.triggerFactors || []),
      details.severity || 5
    ).run();
  }

  /**
   * Get behavioral summary for a context
   */
  async getBehaviorSummary(chittyId) {
    const dna = await this.db.prepare(`
      SELECT behavioral_traits, influence_sources, trend_direction, trend_confidence,
             red_flag_count, last_behavior_assessment, anomaly_count, success_rate
      FROM context_dna WHERE context_chitty_id = ?
    `).bind(chittyId).first();

    if (!dna) {
      return { error: 'Context not found' };
    }

    // Get recent events
    const context = await this.db.prepare(
      'SELECT id FROM context_entities WHERE chitty_id = ?'
    ).bind(chittyId).first();

    const events = await this.db.prepare(`
      SELECT event_type, severity, trigger_factors, detected_at, acknowledged
      FROM context_behavioral_events
      WHERE context_id = ?
      ORDER BY detected_at DESC
      LIMIT 10
    `).bind(context.id).all();

    // Get top exposure sources
    const exposures = await this.db.prepare(`
      SELECT source_domain, COUNT(*) as count, AVG(compliance_alignment) as avg_compliance
      FROM context_exposure_log
      WHERE context_chitty_id = ?
      GROUP BY source_domain
      ORDER BY count DESC
      LIMIT 5
    `).bind(chittyId).all();

    return {
      chittyId,
      traits: JSON.parse(dna.behavioral_traits || '{}'),
      trend: {
        direction: dna.trend_direction,
        confidence: dna.trend_confidence,
      },
      redFlagCount: dna.red_flag_count,
      anomalyCount: dna.anomaly_count,
      successRate: dna.success_rate,
      lastAssessment: dna.last_behavior_assessment,
      influenceSources: JSON.parse(dna.influence_sources || '{}'),
      topExposures: exposures.results,
      recentEvents: events.results.map((e) => ({
        ...e,
        trigger_factors: JSON.parse(e.trigger_factors || '[]'),
      })),
    };
  }

  /**
   * Get contexts with behavioral concerns
   */
  async getContextsWithConcerns() {
    const results = await this.db.prepare(`
      SELECT
        ce.chitty_id,
        ce.project_path,
        ce.support_type,
        ce.trust_level,
        cd.trend_direction,
        cd.trend_confidence,
        cd.red_flag_count,
        cd.behavioral_traits,
        cd.anomaly_count
      FROM context_entities ce
      JOIN context_dna cd ON ce.id = cd.context_id
      WHERE cd.trend_direction = 'degrading'
         OR cd.red_flag_count > 3
         OR cd.anomaly_count > 5
      ORDER BY cd.red_flag_count DESC, cd.anomaly_count DESC
      LIMIT 20
    `).all();

    return results.results.map((r) => ({
      ...r,
      behavioral_traits: JSON.parse(r.behavioral_traits || '{}'),
    }));
  }
}

export default ContextBehavior;
