/**
 * Learning Engine
 *
 * Cross-session learning for user behavior, preferences, and patterns.
 * Uses persisted interaction history plus incremental profile updates.
 *
 * @module intelligence/learning-engine
 */

export class LearningEngine {
  constructor(env, deps = {}) {
    this.env = env;
    this.memory = deps.memory || null;
    this.kv = env.MEMORY_KV || env.TOKEN_KV || null;
    this.stats = {
      updates: 0,
      profiles: 0,
      avgProfileConfidence: 0,
    };
  }

  async initialize() {
    if (!this.kv) {
      console.warn(
        "[LearningEngine] KV storage unavailable; learning features limited",
      );
    }
    console.log("[LearningEngine] Ready");
  }

  bindDependencies(deps = {}) {
    if (deps.memory) this.memory = deps.memory;
  }

  async learnFromInteraction(userId, interaction, options = {}) {
    if (!userId) {
      throw new Error("userId is required");
    }

    const profile = await this.getProfile(userId);
    const next = this.cloneProfile(profile || this.defaultProfile(userId));
    const timestamp = interaction?.timestamp || Date.now();

    next.lastUpdated = timestamp;
    next.totalInteractions += 1;
    next.sessions = [
      ...new Set(
        [...(next.sessions || []), interaction?.sessionId].filter(Boolean),
      ),
    ];

    this.updateTimePatterns(next, timestamp);
    this.updateServicePreferences(next, interaction);
    this.updateEntityPreferences(next, interaction);
    this.updateTopicPatterns(next, interaction);
    this.updateActionPatterns(next, interaction);
    this.updateOutcomeStats(next, interaction);
    this.updateTonePreferences(next, interaction);
    this.recalculateConfidence(next, options);

    await this.persistProfile(userId, next);

    // Optional periodic refresh using historical data.
    if (this.memory && next.totalInteractions % 10 === 0) {
      await this.refreshFromHistory(userId, next);
    }

    this.stats.updates += 1;
    return next;
  }

  async identifyPatterns(userId, options = {}) {
    const profile = await this.getProfile(userId);
    if (!profile) {
      return {
        userId,
        available: false,
        reason: "profile_not_found",
      };
    }

    const topHours = this.topEntries(profile.timeOfDay, 3);
    const topServices = this.topEntries(profile.serviceUsage, 5);
    const topEntities = this.topEntries(profile.entityUsage, 5);
    const topTopics = this.topEntries(profile.topics, 8);
    const topActions = this.topEntries(profile.actionUsage, 8);

    const sequencePatterns = this.extractSequencePatterns(
      profile.recentActionSequence || [],
      options.sequenceDepth || 3,
    );

    const preferences = {
      servicePriority: topServices.map(([name]) => name),
      defaultTone: profile.preferredTone || "direct",
      likelyFocusAreas: topTopics.map(([topic]) => topic),
      likelyEntityTypes: topEntities.map(([type]) => type),
    };

    return {
      userId,
      available: true,
      confidence: profile.confidence,
      totalInteractions: profile.totalInteractions,
      topHours,
      topServices,
      topEntities,
      topTopics,
      topActions,
      sequencePatterns,
      preferences,
      successRate: profile.successRate,
    };
  }

  async personalizeExperience(userId, context = {}) {
    const patterns = await this.identifyPatterns(userId);
    if (!patterns.available) {
      return {
        userId,
        available: false,
        defaults: {},
        suggestions: [],
        tone: "direct",
      };
    }

    const defaults = {
      preferred_services: patterns.preferences.servicePriority.slice(0, 4),
      active_hours: patterns.topHours.map(([h]) => h),
      likely_entities: patterns.preferences.likelyEntityTypes.slice(0, 4),
    };

    const suggestions = [];
    if (
      context.project_path &&
      patterns.preferences.servicePriority.length > 0
    ) {
      suggestions.push(
        `Prioritize ${patterns.preferences.servicePriority[0]} for ${context.project_path}`,
      );
    }
    if (patterns.sequencePatterns.length > 0) {
      const seq = patterns.sequencePatterns[0];
      suggestions.push(
        `Likely next action sequence: ${seq.sequence.join(" -> ")}`,
      );
    }
    if (patterns.preferences.likelyFocusAreas.length > 0) {
      suggestions.push(
        `Preload topic context: ${patterns.preferences.likelyFocusAreas.slice(0, 3).join(", ")}`,
      );
    }

    return {
      userId,
      available: true,
      defaults,
      suggestions,
      tone: patterns.preferences.defaultTone,
      confidence: patterns.confidence,
    };
  }

  async getProfile(userId) {
    if (!this.kv || !userId) return null;
    return await this.kv.get(this.profileKey(userId), "json");
  }

  async getStats() {
    return {
      available: !!this.kv,
      ...this.stats,
    };
  }

  async refreshFromHistory(userId, baseProfile) {
    try {
      const history = await this.memory.getUserHistory(userId, 120);
      if (!Array.isArray(history) || history.length === 0) return baseProfile;

      const recomputed = this.defaultProfile(userId);
      for (const item of history) {
        recomputed.totalInteractions += 1;
        const ts = item.timestamp || Date.now();
        this.updateTimePatterns(recomputed, ts);
        this.updateServicePreferences(recomputed, item);
        this.updateEntityPreferences(recomputed, item);
        this.updateTopicPatterns(recomputed, item);
        this.updateActionPatterns(recomputed, item);
        this.updateOutcomeStats(recomputed, item);
        this.updateTonePreferences(recomputed, item);
      }
      recomputed.lastUpdated = Date.now();
      this.recalculateConfidence(recomputed, { boosted: true });

      // Preserve bounded recent sequence from existing profile if richer.
      if (
        (baseProfile?.recentActionSequence || []).length >
        (recomputed.recentActionSequence || []).length
      ) {
        recomputed.recentActionSequence = [
          ...baseProfile.recentActionSequence,
        ].slice(-50);
      }

      await this.persistProfile(userId, recomputed);
      return recomputed;
    } catch (error) {
      console.warn("[LearningEngine] History refresh failed:", error.message);
      return baseProfile;
    }
  }

  async persistProfile(userId, profile) {
    if (!this.kv) return;
    await this.kv.put(this.profileKey(userId), JSON.stringify(profile), {
      expirationTtl: 365 * 86400,
    });
    this.stats.profiles += 1;
    this.stats.avgProfileConfidence = this.runningAverage(
      this.stats.avgProfileConfidence,
      profile.confidence || 0,
      this.stats.profiles,
    );
  }

  defaultProfile(userId) {
    return {
      userId,
      totalInteractions: 0,
      sessions: [],
      timeOfDay: {},
      serviceUsage: {},
      entityUsage: {},
      actionUsage: {},
      topics: {},
      recentActionSequence: [],
      outcomes: {
        success: 0,
        neutral: 0,
        failure: 0,
      },
      successRate: 0,
      preferredTone: "direct",
      confidence: 0.2,
      lastUpdated: null,
    };
  }

  cloneProfile(profile) {
    return JSON.parse(JSON.stringify(profile));
  }

  updateTimePatterns(profile, timestamp) {
    const hour = new Date(Number(timestamp)).getHours();
    const key = String(hour).padStart(2, "0");
    profile.timeOfDay[key] = (profile.timeOfDay[key] || 0) + 1;
  }

  updateServicePreferences(profile, interaction) {
    for (const service of this.extractServices(interaction)) {
      profile.serviceUsage[service] = (profile.serviceUsage[service] || 0) + 1;
    }
  }

  updateEntityPreferences(profile, interaction) {
    for (const entity of interaction?.entities || []) {
      const type = String(entity?.type || entity || "")
        .toLowerCase()
        .trim();
      if (!type) continue;
      profile.entityUsage[type] = (profile.entityUsage[type] || 0) + 1;
    }
  }

  updateActionPatterns(profile, interaction) {
    for (const action of interaction?.actions || []) {
      const type = String(action?.type || action || "")
        .toLowerCase()
        .trim();
      if (!type) continue;
      profile.actionUsage[type] = (profile.actionUsage[type] || 0) + 1;
      profile.recentActionSequence.push(type);
    }
    if (profile.recentActionSequence.length > 50) {
      profile.recentActionSequence = profile.recentActionSequence.slice(-50);
    }
  }

  updateTopicPatterns(profile, interaction) {
    const text = this.normalizeText(
      interaction?.content || interaction?.input || interaction?.output || "",
    );
    if (!text) return;

    const tokens = text
      .split(/\s+/)
      .filter((w) => w.length >= 5)
      .slice(0, 60);

    for (const token of tokens) {
      profile.topics[token] = (profile.topics[token] || 0) + 1;
    }
  }

  updateOutcomeStats(profile, interaction) {
    const outcome = String(
      interaction?.outcome || interaction?.status || "neutral",
    )
      .toLowerCase()
      .trim();
    if (outcome.includes("success")) profile.outcomes.success += 1;
    else if (outcome.includes("fail") || outcome.includes("error"))
      profile.outcomes.failure += 1;
    else profile.outcomes.neutral += 1;

    const total =
      profile.outcomes.success +
      profile.outcomes.neutral +
      profile.outcomes.failure;
    profile.successRate =
      total > 0 ? Number((profile.outcomes.success / total).toFixed(3)) : 0;
  }

  updateTonePreferences(profile, interaction) {
    const tone = String(
      interaction?.preferences?.tone || interaction?.tone || "",
    ).toLowerCase();
    if (!tone) return;
    profile.preferredTone = tone;
  }

  recalculateConfidence(profile, options = {}) {
    const interactionsFactor = Math.min(1, profile.totalInteractions / 40);
    const serviceDiversity = Math.min(
      1,
      Object.keys(profile.serviceUsage || {}).length / 8,
    );
    const topicDepth = Math.min(
      1,
      Object.keys(profile.topics || {}).length / 30,
    );
    const outcomesFactor = profile.successRate || 0;

    let confidence =
      interactionsFactor * 0.45 +
      serviceDiversity * 0.15 +
      topicDepth * 0.15 +
      outcomesFactor * 0.25;

    if (options.boosted) confidence += 0.03;
    profile.confidence = Number(
      Math.max(0.2, Math.min(0.96, confidence)).toFixed(3),
    );
  }

  extractServices(interaction) {
    const out = new Set();

    for (const action of interaction?.actions || []) {
      const raw = String(
        action?.service || action?.tool || action?.type || "",
      ).toLowerCase();
      if (!raw) continue;

      if (raw.includes("finance")) out.add("chittyfinance");
      if (raw.includes("evidence")) out.add("chittyevidence");
      if (raw.includes("ledger")) out.add("chittyledger");
      if (raw.includes("context")) out.add("chittycontext");
      if (raw.includes("auth") || raw.includes("token")) out.add("chittyauth");
      if (raw.includes("relationship")) out.add("relationship-engine");
      if (raw.includes("intent")) out.add("intent-predictor");
    }

    for (const svc of interaction?.suggestedServices || []) {
      out.add(String(svc).toLowerCase());
    }

    return [...out];
  }

  extractSequencePatterns(sequence, depth = 3) {
    const n = Math.max(2, Math.min(5, Number(depth) || 3));
    if (!Array.isArray(sequence) || sequence.length < n) return [];

    const counts = new Map();
    for (let i = 0; i <= sequence.length - n; i++) {
      const slice = sequence.slice(i, i + n);
      const key = slice.join(" -> ");
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([key, count]) => ({
        sequence: key.split(" -> "),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  topEntries(map, limit = 5) {
    return Object.entries(map || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  profileKey(userId) {
    return `learning:user:${userId}:profile`;
  }

  runningAverage(current, value, n) {
    if (!n || n <= 1) return Number(value.toFixed(3));
    return Number((((current || 0) * (n - 1) + value) / n).toFixed(3));
  }

  normalizeText(input) {
    return String(input || "")
      .toLowerCase()
      .replace(/[^\w\s.-]/g, " ");
  }
}

export default LearningEngine;
