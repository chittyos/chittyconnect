/**
 * Intent Predictor
 *
 * Predicts user intent, suggested services, preload data, and likely next actions
 * using deterministic scoring plus optional AI refinement.
 *
 * @module intelligence/intent-predictor
 */

export class IntentPredictor {
  constructor(env, deps = {}) {
    this.env = env;
    this.ai = env.AI;
    this.memory = deps.memory || null;
    this.consciousness = deps.consciousness || null;
    this.relationshipEngine = deps.relationshipEngine || null;
    this.learningEngine = deps.learningEngine || null;
    this.stats = {
      requests: 0,
      aiRefinements: 0,
      fallbacks: 0,
      avgConfidence: 0,
    };
    this.intentLibrary = this.buildIntentLibrary();
  }

  async initialize() {
    console.log("[IntentPredictor] Initializing...");
    console.log("[IntentPredictor] Ready");
  }

  bindDependencies(deps = {}) {
    if (deps.memory) this.memory = deps.memory;
    if (deps.consciousness) this.consciousness = deps.consciousness;
    if (deps.relationshipEngine)
      this.relationshipEngine = deps.relationshipEngine;
    if (deps.learningEngine) this.learningEngine = deps.learningEngine;
  }

  async predictIntent(input, options = {}) {
    this.stats.requests++;

    const userId = options.userId || null;
    const sessionId = options.sessionId || null;
    const context = options.context || {};
    const text = String(input || "").trim();

    if (!text) {
      throw new Error("input is required");
    }

    const normalized = this.normalizeText(text);
    const ruleCandidates = this.scoreByRules(normalized);
    const history = await this.loadUserHistory(
      userId,
      options.historyLimit || 30,
    );
    const historySignals = this.extractHistorySignals(history);
    let mergedCandidates = this.mergeRuleAndHistoryScores(
      ruleCandidates,
      historySignals,
      normalized,
    );
    const learning = await this.loadLearningSignals(userId);
    mergedCandidates = this.applyLearningBias(mergedCandidates, learning);

    const primary = mergedCandidates[0] || {
      name: "general_query",
      score: 0.35,
      matches: [],
    };

    let prediction = {
      intent: {
        name: primary.name,
        score: Number(primary.score.toFixed(3)),
        rationale: this.buildRationale(primary, historySignals),
      },
      candidateIntents: mergedCandidates.slice(0, 5).map((c) => ({
        name: c.name,
        score: Number(c.score.toFixed(3)),
        matches: c.matches,
      })),
      suggestedServices: this.rankServices(
        primary,
        historySignals,
        context,
        learning,
      ),
      preloadData: this.derivePreloadData(
        primary,
        context,
        historySignals,
        learning,
      ),
      nextActions: this.deriveNextActions(primary, context),
      confidence: this.calculateConfidence(primary, historySignals, normalized),
      signals: {
        keywordHits: primary.matches.length,
        historyInteractions: historySignals.totalInteractions,
        recurrentTopics: historySignals.recurrentTopics,
        learningConfidence: learning?.confidence || 0,
      },
      historySummary: {
        available: historySignals.totalInteractions > 0,
        totalInteractions: historySignals.totalInteractions,
        topActionTypes: historySignals.topActionTypes.slice(0, 5),
        topEntityTypes: historySignals.topEntityTypes.slice(0, 5),
      },
    };

    if (this.ai && options.aiRefine !== false) {
      const refined = await this.tryAiRefinement(prediction, text, context);
      if (refined) {
        prediction = refined;
      }
    }

    // Optionally bias service ordering based on current ecosystem health.
    if (this.consciousness && options.useServiceAwareness === true) {
      prediction.suggestedServices = await this.applyServiceAwareness(
        prediction.suggestedServices,
      );
    }

    this.updateConfidenceStats(prediction.confidence);

    return prediction;
  }

  async getStats() {
    return {
      available: true,
      ...this.stats,
      intentTypes: Object.keys(this.intentLibrary).length,
    };
  }

  buildIntentLibrary() {
    return {
      evidence_analysis: {
        keywords: [
          "evidence",
          "ledger",
          "contradiction",
          "verify",
          "proof",
          "document",
          "court",
          "filing",
        ],
        services: ["chittyevidence", "chittyledger", "chittyproof"],
        preloadData: ["evidence_index", "recent_facts", "contradiction_log"],
        nextActions: ["retrieve_related_evidence", "verify_evidence_integrity"],
      },
      finance_analysis: {
        keywords: [
          "finance",
          "balance",
          "cash flow",
          "transaction",
          "bank",
          "transfer",
          "spend",
          "reconcile",
        ],
        services: ["chittyfinance", "chittyledger"],
        preloadData: [
          "recent_transactions",
          "entity_balances",
          "flow_of_funds",
        ],
        nextActions: ["run_finance_analyze", "detect_inter_entity_transfers"],
      },
      identity_trust: {
        keywords: [
          "chittyid",
          "identity",
          "certificate",
          "proof chain",
          "trust",
          "seal",
          "verify id",
        ],
        services: ["chittyid", "chittycert", "chittyproof", "chittytrust"],
        preloadData: ["id_registry", "certificate_chain", "proof_status"],
        nextActions: ["validate_chitty_id", "check_proof_integrity"],
      },
      context_management: {
        keywords: [
          "context",
          "checkpoint",
          "restore",
          "resume",
          "session",
          "memory",
          "continue where we left off",
        ],
        services: ["chittycontext", "memorycloude", "context-consciousness"],
        preloadData: ["session_history", "recent_decisions", "context_dna"],
        nextActions: ["resolve_context", "restore_latest_checkpoint"],
      },
      relationship_intelligence: {
        keywords: [
          "relationship",
          "related",
          "dependency",
          "graph",
          "linked",
          "correlation",
          "peer",
        ],
        services: [
          "relationship-engine",
          "context-consciousness",
          "memorycloude",
        ],
        preloadData: [
          "relationship_snapshot",
          "temporal_events",
          "exposure_map",
        ],
        nextActions: ["discover_relationships", "analyze_strongest_links"],
      },
      deployment_operations: {
        keywords: [
          "deploy",
          "release",
          "worker",
          "wrangler",
          "cloudflare",
          "production",
          "build",
          "ci",
        ],
        services: ["cloudflare", "github-actions", "chittyconnect"],
        preloadData: ["build_status", "deployment_history", "service_health"],
        nextActions: ["check_current_build", "validate_production_health"],
      },
      security_credential_ops: {
        keywords: [
          "credential",
          "token",
          "secret",
          "oauth",
          "auth",
          "api key",
          "permission",
        ],
        services: ["chittyauth", "chittyconnect", "onepassword"],
        preloadData: ["credential_audit", "token_status", "access_patterns"],
        nextActions: ["run_credential_audit", "validate_token_scope"],
      },
      general_query: {
        keywords: ["help", "analyze", "summarize", "review", "investigate"],
        services: ["chittyconnect"],
        preloadData: ["recent_activity"],
        nextActions: ["clarify_scope"],
      },
    };
  }

  normalizeText(input) {
    return input.toLowerCase().replace(/[^\w\s.-]/g, " ");
  }

  scoreByRules(normalized) {
    const candidates = [];

    for (const [name, def] of Object.entries(this.intentLibrary)) {
      const matches = def.keywords.filter((kw) => normalized.includes(kw));
      const tokenBoost =
        matches.length / Math.max(1, Math.min(6, def.keywords.length));
      const countBoost = Math.min(0.7, matches.length * 0.22);
      const phraseBoost = matches.some((m) => m.includes(" ")) ? 0.08 : 0;
      let score = countBoost + tokenBoost * 0.3 + phraseBoost;
      if (name === "general_query") {
        score *= 0.55;
      }

      if (score > 0) {
        candidates.push({
          name,
          score: Math.min(1, score),
          matches,
        });
      }
    }

    if (candidates.length === 0) {
      candidates.push({
        name: "general_query",
        score: 0.2,
        matches: [],
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  async loadUserHistory(userId, limit) {
    if (
      !userId ||
      !this.memory ||
      typeof this.memory.getUserHistory !== "function"
    ) {
      return [];
    }
    try {
      return (await this.memory.getUserHistory(userId, limit)) || [];
    } catch (error) {
      console.warn(
        "[IntentPredictor] User history load failed:",
        error.message,
      );
      this.stats.fallbacks++;
      return [];
    }
  }

  async loadLearningSignals(userId) {
    if (!userId || !this.learningEngine) return null;
    try {
      const patterns = await this.learningEngine.identifyPatterns(userId);
      if (!patterns?.available) return null;
      return patterns;
    } catch (error) {
      console.warn(
        "[IntentPredictor] Learning profile load failed:",
        error.message,
      );
      return null;
    }
  }

  extractHistorySignals(history) {
    const signals = {
      totalInteractions: history.length,
      topActionTypes: [],
      topEntityTypes: [],
      recurrentTopics: [],
      intentAffinity: {},
    };

    if (history.length === 0) return signals;

    const actionCounts = new Map();
    const entityCounts = new Map();
    const topicCounts = new Map();

    for (const item of history) {
      for (const action of item.actions || []) {
        const key = String(action?.type || action || "").trim();
        if (key) actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
      }
      for (const entity of item.entities || []) {
        const key = String(entity?.type || entity || "").trim();
        if (key) entityCounts.set(key, (entityCounts.get(key) || 0) + 1);
      }

      const content = this.normalizeText(
        item.content || item.input || item.output || "",
      );
      if (content) {
        const terms = content
          .split(/\s+/)
          .filter((w) => w.length >= 5)
          .slice(0, 40);
        for (const term of terms) {
          topicCounts.set(term, (topicCounts.get(term) || 0) + 1);
        }
      }
    }

    signals.topActionTypes = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
    signals.topEntityTypes = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
    signals.recurrentTopics = [...topicCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term);

    for (const [intentName, def] of Object.entries(this.intentLibrary)) {
      const overlap = def.keywords.filter(
        (kw) =>
          signals.recurrentTopics.some(
            (t) => t.includes(kw) || kw.includes(t),
          ) || signals.topActionTypes.some((a) => a.includes(kw)),
      ).length;
      if (overlap > 0) {
        signals.intentAffinity[intentName] = overlap / def.keywords.length;
      }
    }

    return signals;
  }

  mergeRuleAndHistoryScores(ruleCandidates, historySignals, normalized) {
    const merged = [];
    for (const cand of ruleCandidates) {
      const affinity = historySignals.intentAffinity[cand.name] || 0;
      const recurrence = historySignals.recurrentTopics.filter((topic) =>
        cand.matches.some((m) => topic.includes(m) || m.includes(topic)),
      ).length;
      const recurrenceScore =
        recurrence > 0 ? Math.min(0.25, recurrence * 0.06) : 0;
      const score =
        cand.score * 0.75 + affinity * 0.18 + recurrenceScore * 0.07;

      merged.push({
        ...cand,
        score: Math.min(1, score),
      });
    }

    // Inject intents with strong history affinity that weren't matched by rules
    for (const [intentName, affinity] of Object.entries(
      historySignals.intentAffinity,
    )) {
      if (!merged.some((c) => c.name === intentName) && affinity > 0.15) {
        merged.push({
          name: intentName,
          score: Math.min(1, affinity * 0.35),
          matches: [],
        });
      }
    }

    const strongestSpecific = merged
      .filter((m) => m.name !== "general_query")
      .sort((a, b) => b.score - a.score)[0];
    const general = merged.find((m) => m.name === "general_query");
    if (general && strongestSpecific && strongestSpecific.score >= 0.2) {
      general.score = Math.max(0.05, general.score * 0.45);
    }

    // If user explicitly mentions "relationship", prioritize the relationship intent.
    if (normalized.includes("relationship")) {
      const rel = merged.find((m) => m.name === "relationship_intelligence");
      if (rel) rel.score = Math.min(1, rel.score + 0.25);
    }

    return merged.sort((a, b) => b.score - a.score);
  }

  applyLearningBias(candidates, learning) {
    if (!learning || !learning.available) {
      return candidates;
    }

    const focusAreas = new Set(
      (learning.preferences?.likelyFocusAreas || []).map((x) =>
        String(x).toLowerCase(),
      ),
    );
    const servicePriority = new Set(
      (learning.preferences?.servicePriority || []).map((x) =>
        String(x).toLowerCase(),
      ),
    );

    const adjusted = candidates.map((c) => {
      let score = c.score;
      const matches = c.matches || [];
      if (matches.some((m) => focusAreas.has(String(m).toLowerCase()))) {
        score += 0.08;
      }
      const intentServices = this.intentLibrary[c.name]?.services || [];
      if (
        intentServices.some((svc) =>
          servicePriority.has(String(svc).toLowerCase()),
        )
      ) {
        score += 0.08;
      }
      return { ...c, score: Math.min(1, score) };
    });

    return adjusted.sort((a, b) => b.score - a.score);
  }

  rankServices(primary, historySignals, context, learning) {
    const base = [
      ...(this.intentLibrary[primary.name]?.services || ["chittyconnect"]),
    ];
    const boosts = new Map(base.map((name, idx) => [name, 1 - idx * 0.05]));

    // History-based service boosts.
    for (const action of historySignals.topActionTypes) {
      const lower = action.toLowerCase();
      if (lower.includes("finance")) this.bump(boosts, "chittyfinance", 0.2);
      if (lower.includes("evidence") || lower.includes("ledger")) {
        this.bump(boosts, "chittyevidence", 0.15);
        this.bump(boosts, "chittyledger", 0.15);
      }
      if (lower.includes("context")) this.bump(boosts, "chittycontext", 0.12);
      if (lower.includes("auth") || lower.includes("token")) {
        this.bump(boosts, "chittyauth", 0.12);
      }
    }

    if (
      context?.prioritize_services &&
      Array.isArray(context.prioritize_services)
    ) {
      for (const svc of context.prioritize_services) {
        this.bump(boosts, svc, 0.2);
      }
    }

    if (learning?.available) {
      for (const svc of learning.preferences?.servicePriority || []) {
        this.bump(boosts, svc, 0.16);
      }
    }

    return [...boosts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 8);
  }

  derivePreloadData(primary, context, historySignals, learning) {
    const preload = new Set(
      this.intentLibrary[primary.name]?.preloadData || [],
    );
    if (context?.chitty_id) preload.add("entity_profile");
    if (context?.case_id) preload.add("case_summary");
    if (historySignals.totalInteractions > 0)
      preload.add("recent_user_history");
    if (learning?.available) preload.add("learned_user_profile");
    return [...preload];
  }

  deriveNextActions(primary, context) {
    const actions = [...(this.intentLibrary[primary.name]?.nextActions || [])];
    if (context?.chitty_id && primary.name !== "context_management") {
      actions.push("load_entity_context");
    }
    return [...new Set(actions)].slice(0, 6);
  }

  buildRationale(primary, historySignals) {
    if (
      primary.matches.length === 0 &&
      historySignals.totalInteractions === 0
    ) {
      return "No strong domain markers found; defaulted to general query handling.";
    }
    const matchText =
      primary.matches.length > 0
        ? `Matched keywords: ${primary.matches.slice(0, 5).join(", ")}.`
        : "No direct keyword match.";
    const historyText =
      historySignals.totalInteractions > 0
        ? ` History contributed from ${historySignals.totalInteractions} prior interactions.`
        : "";
    return `${matchText}${historyText}`;
  }

  calculateConfidence(primary, historySignals, normalized) {
    let confidence = 0.35 + primary.score * 0.45;
    if (primary.matches.length >= 3) confidence += 0.08;
    if (historySignals.totalInteractions >= 5) confidence += 0.08;
    if (historySignals.recurrentTopics.length >= 3) confidence += 0.04;
    if (normalized.length > 120) confidence += 0.03;
    return Number(Math.max(0.2, Math.min(0.95, confidence)).toFixed(3));
  }

  async tryAiRefinement(prediction, input, context) {
    try {
      const prompt = `Refine this intent prediction JSON for accuracy and consistency.
Input: ${input}
Context: ${JSON.stringify(context)}
Prediction: ${JSON.stringify(prediction)}

Return strict JSON with keys:
intent, candidateIntents, suggestedServices, preloadData, nextActions, confidence, signals, historySummary`;
      const response = await this.ai.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "You are an intent prediction refinement engine. Keep outputs concise, deterministic, and JSON-only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const text = String(response?.response || "").trim();
      const json = this.extractJson(text);
      if (!json) return null;

      this.stats.aiRefinements++;
      return this.sanitizePrediction(json, prediction);
    } catch (error) {
      console.warn("[IntentPredictor] AI refinement failed:", error.message);
      this.stats.fallbacks++;
      return null;
    }
  }

  async applyServiceAwareness(services) {
    try {
      const awareness = await this.consciousness.getAwareness();
      const downServices = new Set(
        (awareness?.anomalies?.details || [])
          .filter((a) => a.type === "service_down")
          .map((a) => String(a.service || "").toLowerCase()),
      );

      const scored = services.map((svc, idx) => {
        const isDown = downServices.has(String(svc).toLowerCase());
        const penalty = isDown ? 0.4 : 0;
        return {
          svc,
          score: 1 - idx * 0.05 - penalty,
        };
      });

      return scored.sort((a, b) => b.score - a.score).map((s) => s.svc);
    } catch {
      return services;
    }
  }

  sanitizePrediction(candidate, fallback) {
    return {
      intent: candidate.intent || fallback.intent,
      candidateIntents: Array.isArray(candidate.candidateIntents)
        ? candidate.candidateIntents.slice(0, 6)
        : fallback.candidateIntents,
      suggestedServices: Array.isArray(candidate.suggestedServices)
        ? candidate.suggestedServices.slice(0, 10)
        : fallback.suggestedServices,
      preloadData: Array.isArray(candidate.preloadData)
        ? candidate.preloadData.slice(0, 10)
        : fallback.preloadData,
      nextActions: Array.isArray(candidate.nextActions)
        ? candidate.nextActions.slice(0, 8)
        : fallback.nextActions,
      confidence: Number(
        Math.max(
          0.2,
          Math.min(0.95, Number(candidate.confidence || fallback.confidence)),
        ),
      ),
      signals: candidate.signals || fallback.signals,
      historySummary: candidate.historySummary || fallback.historySummary,
    };
  }

  extractJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  updateConfidenceStats(confidence) {
    const n = this.stats.requests;
    this.stats.avgConfidence =
      n <= 1
        ? confidence
        : Number(
            ((this.stats.avgConfidence * (n - 1) + confidence) / n).toFixed(3),
          );
  }

  bump(map, key, delta) {
    map.set(key, (map.get(key) || 0) + delta);
  }
}

export default IntentPredictor;
