/**
 * Alchemist Daemon
 *
 * A background intelligence that:
 * 1. LABORATORY MODE: Runs controlled experiments ("colliding atoms")
 *    - Tests context capabilities in sandboxed scenarios
 *    - Measures stability vs complexity tradeoffs
 *    - Identifies optimal context configurations
 *
 * 2. FIELD MODE: Observes natural alchemy ("evolution/accident/opportunity")
 *    - Detects emergent behaviors
 *    - Identifies natural context combinations
 *    - Spots opportunity for beneficial mutations
 *
 * Philosophy:
 * - Contexts built with rigid frameworks = stable but limited capacity
 * - Contexts with flexible patterns = powerful but less predictable
 * - The Alchemist finds the balance and spots transformation opportunities
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/alchemist-daemon
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/spec/capability-dimensions
 */

/**
 * Context capability dimensions
 * These define what a context can do (vs behavioral traits which define how it acts)
 */
export const CAPABILITY_DIMENSIONS = {
  // Complexity handling
  complexReasoning: {
    name: 'Complex Reasoning',
    description: 'Ability to handle multi-step, interconnected problems',
    indicators: ['nested_logic', 'dependency_chains', 'abstract_concepts'],
    stabilityTrend: 'inverse', // Higher = less stable
  },

  // Pattern recognition
  patternRecognition: {
    name: 'Pattern Recognition',
    description: 'Ability to identify and apply patterns',
    indicators: ['repeated_structures', 'analogies', 'template_matching'],
    stabilityTrend: 'neutral',
  },

  // Adaptation
  adaptability: {
    name: 'Adaptability',
    description: 'Ability to adjust approach based on feedback',
    indicators: ['strategy_shifts', 'error_recovery', 'context_switching'],
    stabilityTrend: 'inverse',
  },

  // Precision
  precision: {
    name: 'Precision',
    description: 'Accuracy in task execution',
    indicators: ['exact_matches', 'low_error_rate', 'consistent_outputs'],
    stabilityTrend: 'positive', // Higher = more stable
  },

  // Creativity
  divergentThinking: {
    name: 'Divergent Thinking',
    description: 'Ability to generate novel solutions',
    indicators: ['unique_approaches', 'non_obvious_solutions', 'cross_domain'],
    stabilityTrend: 'inverse',
  },

  // Speed
  responseSpeed: {
    name: 'Response Speed',
    description: 'Efficiency in task completion',
    indicators: ['avg_response_time', 'parallelization', 'resource_efficiency'],
    stabilityTrend: 'neutral',
  },

  // Memory
  contextRetention: {
    name: 'Context Retention',
    description: 'Ability to maintain and use context over time',
    indicators: ['callback_accuracy', 'long_range_dependencies', 'state_management'],
    stabilityTrend: 'positive',
  },

  // Collaboration
  collaborativeIntelligence: {
    name: 'Collaborative Intelligence',
    description: 'Ability to work with other contexts effectively',
    indicators: ['handoff_quality', 'information_sharing', 'role_awareness'],
    stabilityTrend: 'neutral',
  },
};

/**
 * Context archetype profiles
 * Predefined configurations with known stability/capability tradeoffs
 */
export const CONTEXT_ARCHETYPES = {
  // High stability, low complexity - "The Guard"
  sentinel: {
    name: 'Sentinel',
    description: 'Highly stable, predictable. Best for routine tasks.',
    capabilities: {
      complexReasoning: 0.3,
      patternRecognition: 0.7,
      adaptability: 0.2,
      precision: 0.9,
      divergentThinking: 0.2,
      responseSpeed: 0.8,
      contextRetention: 0.6,
      collaborativeIntelligence: 0.4,
    },
    stability: 0.9,
    bestFor: ['monitoring', 'validation', 'routine_tasks', 'compliance'],
    avoidFor: ['novel_problems', 'creative_tasks', 'complex_debugging'],
  },

  // Medium stability, medium complexity - "The Artisan"
  artisan: {
    name: 'Artisan',
    description: 'Balanced capabilities. Good all-rounder.',
    capabilities: {
      complexReasoning: 0.6,
      patternRecognition: 0.7,
      adaptability: 0.6,
      precision: 0.7,
      divergentThinking: 0.5,
      responseSpeed: 0.6,
      contextRetention: 0.7,
      collaborativeIntelligence: 0.6,
    },
    stability: 0.6,
    bestFor: ['general_development', 'maintenance', 'documentation'],
    avoidFor: ['cutting_edge_research', 'high_stakes_compliance'],
  },

  // Low stability, high complexity - "The Sage"
  sage: {
    name: 'Sage',
    description: 'High capability, less predictable. For complex problems.',
    capabilities: {
      complexReasoning: 0.9,
      patternRecognition: 0.8,
      adaptability: 0.8,
      precision: 0.5,
      divergentThinking: 0.8,
      responseSpeed: 0.4,
      contextRetention: 0.9,
      collaborativeIntelligence: 0.7,
    },
    stability: 0.4,
    bestFor: ['architecture', 'debugging', 'research', 'optimization'],
    avoidFor: ['time_critical', 'routine_automation', 'simple_tasks'],
  },

  // Specialized: High creativity, unpredictable - "The Alchemist"
  alchemist: {
    name: 'Alchemist',
    description: 'Experimental, creative. For innovation.',
    capabilities: {
      complexReasoning: 0.7,
      patternRecognition: 0.6,
      adaptability: 0.9,
      precision: 0.4,
      divergentThinking: 0.95,
      responseSpeed: 0.5,
      contextRetention: 0.6,
      collaborativeIntelligence: 0.8,
    },
    stability: 0.3,
    bestFor: ['innovation', 'prototyping', 'brainstorming', 'cross_domain'],
    avoidFor: ['production_code', 'compliance', 'critical_systems'],
  },

  // Specialized: Collaborative focus - "The Diplomat"
  diplomat: {
    name: 'Diplomat',
    description: 'Excels at coordination and handoffs.',
    capabilities: {
      complexReasoning: 0.5,
      patternRecognition: 0.6,
      adaptability: 0.7,
      precision: 0.6,
      divergentThinking: 0.5,
      responseSpeed: 0.7,
      contextRetention: 0.8,
      collaborativeIntelligence: 0.95,
    },
    stability: 0.7,
    bestFor: ['orchestration', 'multi_team', 'integration', 'handoffs'],
    avoidFor: ['deep_technical', 'isolated_tasks'],
  },
};

/**
 * AlchemistDaemon class - the background intelligence
 */
export class AlchemistDaemon {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
  }

  /**
   * Assess context capabilities based on accumulated data
   */
  async assessCapabilities(chittyId) {
    const profile = await this.db.prepare(`
      SELECT ce.*, cd.patterns, cd.traits, cd.competencies, cd.expertise_domains,
             cd.total_interactions, cd.success_rate, cd.anomaly_count,
             cd.behavioral_traits, cd.influence_sources
      FROM context_entities ce
      JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.chitty_id = ?
    `).bind(chittyId).first();

    if (!profile) {
      return { error: 'Context not found' };
    }

    const patterns = JSON.parse(profile.patterns || '[]');
    const traits = JSON.parse(profile.traits || '[]');
    const competencies = JSON.parse(profile.competencies || '[]');
    const behavioralTraits = JSON.parse(profile.behavioral_traits || '{}');

    // Calculate capabilities
    const capabilities = {
      complexReasoning: this.assessComplexReasoning(patterns, competencies),
      patternRecognition: this.assessPatternRecognition(patterns, profile.success_rate),
      adaptability: this.assessAdaptability(behavioralTraits, profile.anomaly_count),
      precision: this.assessPrecision(profile.success_rate, profile.anomaly_count),
      divergentThinking: this.assessDivergentThinking(patterns, competencies),
      responseSpeed: 0.6, // Would need timing data
      contextRetention: this.assessContextRetention(profile.total_interactions),
      collaborativeIntelligence: 0.5, // Would need collaboration data
    };

    // Calculate overall stability
    const stability = this.calculateStability(capabilities, behavioralTraits);

    // Match to closest archetype
    const archetype = this.matchArchetype(capabilities, stability);

    // Calculate capability-stability tradeoff score
    const complexityScore = (
      capabilities.complexReasoning +
      capabilities.adaptability +
      capabilities.divergentThinking
    ) / 3;
    const tradeoffRatio = complexityScore / Math.max(stability, 0.1);

    return {
      chittyId,
      capabilities,
      stability,
      archetype,
      tradeoffAnalysis: {
        complexityScore,
        stabilityScore: stability,
        tradeoffRatio,
        assessment: tradeoffRatio > 1.5
          ? 'High capability, watch for instability'
          : tradeoffRatio < 0.5
          ? 'Stable but limited complexity handling'
          : 'Balanced profile',
      },
      recommendations: this.generateRecommendations(capabilities, stability, archetype),
    };
  }

  assessComplexReasoning(patterns, competencies) {
    // More diverse competencies and complex patterns = higher reasoning
    const compCount = competencies.length;
    const complexPatterns = patterns.filter(
      (p) => p.complexity === 'high' || (p.steps && p.steps > 3)
    ).length;
    return Math.min(1, (compCount * 0.05 + complexPatterns * 0.1));
  }

  assessPatternRecognition(patterns, successRate) {
    // Successful patterns = good recognition
    return (successRate || 0.5) * 0.7 + Math.min(patterns.length / 20, 1) * 0.3;
  }

  assessAdaptability(behavioralTraits, anomalyCount) {
    // High volatility can indicate adaptability (or instability)
    const volatile = behavioralTraits.volatile || 0.5;
    const resilient = behavioralTraits.resilient || 0.5;
    // Penalize if too many anomalies (uncontrolled adaptation)
    return Math.max(0, (volatile * 0.3 + resilient * 0.7) - anomalyCount * 0.02);
  }

  assessPrecision(successRate, anomalyCount) {
    return Math.max(0, (successRate || 0.5) - anomalyCount * 0.02);
  }

  assessDivergentThinking(patterns, competencies) {
    // Cross-domain competencies and varied patterns = creative
    const domains = new Set(competencies.map((c) => c.domain || c.category || 'unknown'));
    return Math.min(1, domains.size / 5);
  }

  assessContextRetention(totalInteractions) {
    // More interactions = more context to draw from
    return Math.min(1, totalInteractions / 200);
  }

  calculateStability(capabilities, behavioralTraits) {
    // Start with baseline
    let stability = 0.5;

    // Add stability from precise, methodical traits
    stability += (capabilities.precision - 0.5) * 0.3;

    // Subtract stability from complex, adaptive traits
    stability -= (capabilities.complexReasoning - 0.5) * 0.15;
    stability -= (capabilities.adaptability - 0.5) * 0.1;
    stability -= (capabilities.divergentThinking - 0.5) * 0.2;

    // Behavioral traits adjustment
    if (behavioralTraits.volatile) {
      stability -= behavioralTraits.volatile * 0.2;
    }
    if (behavioralTraits.methodical) {
      stability += behavioralTraits.methodical * 0.2;
    }
    if (behavioralTraits.compliant) {
      stability += behavioralTraits.compliant * 0.1;
    }

    return Math.min(1, Math.max(0, stability));
  }

  matchArchetype(capabilities, stability) {
    let bestMatch = null;
    let bestScore = -Infinity;

    for (const [key, archetype] of Object.entries(CONTEXT_ARCHETYPES)) {
      let score = 0;

      // Compare capabilities
      for (const [cap, value] of Object.entries(capabilities)) {
        const expected = archetype.capabilities[cap] || 0.5;
        score -= Math.abs(value - expected);
      }

      // Compare stability
      score -= Math.abs(stability - archetype.stability) * 2;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { key, ...archetype, matchScore: score };
      }
    }

    return bestMatch;
  }

  generateRecommendations(capabilities, stability, archetype) {
    const recommendations = [];

    // High complexity but low stability
    if (capabilities.complexReasoning > 0.7 && stability < 0.4) {
      recommendations.push({
        type: 'warning',
        message: 'High reasoning capability but low stability - consider pairing with a Sentinel for critical tasks',
        action: 'pair_with_sentinel',
      });
    }

    // Low adaptability
    if (capabilities.adaptability < 0.3) {
      recommendations.push({
        type: 'limitation',
        message: 'Limited adaptability - avoid tasks requiring frequent context switches',
        action: 'specialize',
      });
    }

    // High divergent thinking
    if (capabilities.divergentThinking > 0.8) {
      recommendations.push({
        type: 'opportunity',
        message: 'Strong creative capability - consider for innovation and brainstorming tasks',
        action: 'assign_creative_tasks',
      });
    }

    // Stable but limited
    if (stability > 0.8 && capabilities.complexReasoning < 0.4) {
      recommendations.push({
        type: 'limitation',
        message: 'Very stable but limited complexity handling - best for routine automation',
        action: 'routine_tasks',
      });
    }

    // Good collaboration fit
    if (capabilities.collaborativeIntelligence > 0.7) {
      recommendations.push({
        type: 'opportunity',
        message: 'Strong collaboration capability - consider as orchestrator or for cross-team work',
        action: 'assign_orchestration',
      });
    }

    // Archetype-specific
    if (archetype) {
      recommendations.push({
        type: 'archetype_match',
        message: `Best matches ${archetype.name} archetype`,
        bestFor: archetype.bestFor,
        avoidFor: archetype.avoidFor,
      });
    }

    return recommendations;
  }

  /**
   * LABORATORY MODE: Run controlled experiments
   * Compare how contexts perform on the same task
   */
  async runExperiment(experimentConfig) {
    const { contextIds, taskType, parameters } = experimentConfig;

    // Record experiment start
    const experimentId = crypto.randomUUID();
    const results = [];

    for (const chittyId of contextIds) {
      // Assess capabilities before
      const capabilityBefore = await this.assessCapabilities(chittyId);

      // In a real implementation, this would actually run the task
      // For now, we simulate based on capability match
      const expectedPerformance = this.predictPerformance(capabilityBefore, taskType);

      results.push({
        chittyId,
        capabilityProfile: capabilityBefore.capabilities,
        archetype: capabilityBefore.archetype?.name,
        predictedPerformance: expectedPerformance,
        stabilityRisk: 1 - capabilityBefore.stability,
      });
    }

    // Rank by predicted performance
    results.sort((a, b) => b.predictedPerformance - a.predictedPerformance);

    return {
      experimentId,
      taskType,
      parameters,
      results,
      recommendation: {
        bestCandidate: results[0]?.chittyId,
        reason: `${results[0]?.archetype} archetype with ${Math.round(results[0]?.predictedPerformance * 100)}% predicted performance`,
      },
      timestamp: Date.now(),
    };
  }

  predictPerformance(capabilityAssessment, taskType) {
    const caps = capabilityAssessment.capabilities;
    const stability = capabilityAssessment.stability;

    // Task type to capability mapping
    const taskWeights = {
      debugging: { complexReasoning: 0.4, patternRecognition: 0.3, precision: 0.3 },
      creative: { divergentThinking: 0.5, adaptability: 0.3, complexReasoning: 0.2 },
      routine: { precision: 0.4, responseSpeed: 0.3, contextRetention: 0.3 },
      collaboration: { collaborativeIntelligence: 0.5, adaptability: 0.3, contextRetention: 0.2 },
      analysis: { patternRecognition: 0.4, complexReasoning: 0.4, precision: 0.2 },
      default: { complexReasoning: 0.25, precision: 0.25, adaptability: 0.25, patternRecognition: 0.25 },
    };

    const weights = taskWeights[taskType] || taskWeights.default;
    let performance = 0;

    for (const [cap, weight] of Object.entries(weights)) {
      performance += (caps[cap] || 0.5) * weight;
    }

    // Stability bonus for routine tasks, penalty for creative tasks
    if (taskType === 'routine') {
      performance += stability * 0.2;
    } else if (taskType === 'creative') {
      performance -= stability * 0.1;
    }

    return Math.min(1, Math.max(0, performance));
  }

  /**
   * FIELD MODE: Observe and detect emergent behaviors
   */
  async observeEvolution() {
    // Find contexts that have changed significantly
    const evolved = await this.db.prepare(`
      SELECT
        ce.chitty_id,
        ce.project_path,
        cd.behavioral_traits,
        cd.trend_direction,
        cd.trend_confidence,
        cd.total_interactions,
        (SELECT COUNT(*) FROM context_behavioral_events cbe
         WHERE cbe.context_id = ce.id AND cbe.detected_at > unixepoch() - 604800) as recent_events
      FROM context_entities ce
      JOIN context_dna cd ON ce.id = cd.context_id
      WHERE cd.total_interactions > 50
        AND (cd.trend_direction != 'stable' OR cd.red_flag_count > 0)
      ORDER BY cd.updated_at DESC
      LIMIT 20
    `).all();

    const observations = [];

    for (const ctx of evolved.results) {
      const assessment = await this.assessCapabilities(ctx.chitty_id);

      observations.push({
        chittyId: ctx.chitty_id,
        projectPath: ctx.project_path,
        trend: ctx.trend_direction,
        trendConfidence: ctx.trend_confidence,
        recentEvents: ctx.recent_events,
        archetype: assessment.archetype?.name,
        stability: assessment.stability,
        isVolatile: assessment.stability < 0.4,
        opportunity: this.detectOpportunity(ctx, assessment),
      });
    }

    // Group by observation type
    const classified = {
      evolving: observations.filter((o) => o.trend === 'improving'),
      degrading: observations.filter((o) => o.trend === 'degrading'),
      volatile: observations.filter((o) => o.isVolatile),
      opportunities: observations.filter((o) => o.opportunity),
    };

    return {
      timestamp: Date.now(),
      totalObserved: observations.length,
      classified,
      summary: {
        evolving: classified.evolving.length,
        degrading: classified.degrading.length,
        volatile: classified.volatile.length,
        opportunities: classified.opportunities.length,
      },
    };
  }

  detectOpportunity(context, assessment) {
    const opportunities = [];

    // High capability but underutilized
    if (assessment.capabilities?.complexReasoning > 0.7 && context.total_interactions < 100) {
      opportunities.push({
        type: 'underutilized_capability',
        message: 'High reasoning capability, could handle more complex tasks',
      });
    }

    // Good collaboration fit, not being used for it
    if (assessment.capabilities?.collaborativeIntelligence > 0.7) {
      opportunities.push({
        type: 'collaboration_potential',
        message: 'Strong collaboration capability, consider for team orchestration',
      });
    }

    // Stable and improving
    if (assessment.stability > 0.7 && context.trend_direction === 'improving') {
      opportunities.push({
        type: 'promotion_candidate',
        message: 'Stable and improving, consider for higher trust tasks',
      });
    }

    return opportunities.length > 0 ? opportunities : null;
  }
}

export default AlchemistDaemon;
