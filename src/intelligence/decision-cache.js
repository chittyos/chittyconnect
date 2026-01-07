/**
 * DecisionCache - Decision Persistence and Reasoning Transparency
 *
 * Stores all ContextConsciousness decisions with reasoning, confidence,
 * and context for auditability and learning.
 *
 * @module intelligence/decision-cache
 */

export class DecisionCache {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.kv = env.CREDENTIAL_CACHE; // Use for hot decision cache
  }

  /**
   * Store a decision with full context
   */
  async storeDecision(decision) {
    const {
      sessionId,
      serviceName,
      decisionType,
      reasoning,
      confidence,
      context = {},
      actions = [],
      expiresIn = 86400000, // 24 hours default
    } = decision;

    const decisionId = `decision-${decisionType}-${serviceName}-${Date.now()}`;
    const expiresAt = Date.now() + expiresIn;

    try {
      // Store in D1 for persistence
      await this.db
        .prepare(
          `INSERT INTO decisions
           (id, session_id, service_name, decision_type, reasoning, confidence, context, actions, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          decisionId,
          sessionId || 'system',
          serviceName,
          decisionType,
          reasoning,
          confidence,
          JSON.stringify(context),
          JSON.stringify(actions),
          Date.now(),
          expiresAt
        )
        .run();

      // Cache high-confidence decisions in KV for fast access
      if (confidence > 0.75) {
        const cacheKey = `decision:${serviceName}:${decisionType}:latest`;
        await this.kv.put(
          cacheKey,
          JSON.stringify({
            id: decisionId,
            reasoning,
            confidence,
            timestamp: Date.now(),
          }),
          { expirationTtl: Math.floor(expiresIn / 1000) }
        );
      }

      console.log(`[DecisionCache] Stored decision ${decisionId} (confidence: ${confidence})`);
      return decisionId;
    } catch (error) {
      console.error('[DecisionCache] Failed to store decision:', error.message);
      throw error;
    }
  }

  /**
   * Get cached decision (fast path via KV)
   */
  async getCachedDecision(serviceName, decisionType) {
    const cacheKey = `decision:${serviceName}:${decisionType}:latest`;
    const cached = await this.kv.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Fallback to D1
    return await this.getLatestDecision(serviceName, decisionType);
  }

  /**
   * Get latest decision from D1
   */
  async getLatestDecision(serviceName, decisionType) {
    const result = await this.db
      .prepare(
        `SELECT * FROM decisions
         WHERE service_name = ? AND decision_type = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .bind(serviceName, decisionType)
      .first();

    return result ? this.parseDecision(result) : null;
  }

  /**
   * Get decision history for a service
   */
  async getDecisionHistory(serviceName, options = {}) {
    const { limit = 50, decisionType = null, minConfidence = null } = options;

    let query = `SELECT * FROM decisions WHERE service_name = ?`;
    const bindings = [serviceName];

    if (decisionType) {
      query += ` AND decision_type = ?`;
      bindings.push(decisionType);
    }

    if (minConfidence !== null) {
      query += ` AND confidence >= ?`;
      bindings.push(minConfidence);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    bindings.push(limit);

    const result = await this.db.prepare(query).bind(...bindings).all();

    return (result.results || []).map(d => this.parseDecision(d));
  }

  /**
   * Get recent high-confidence decisions
   */
  async getRecentHighConfidenceDecisions(options = {}) {
    const { limit = 20, minConfidence = 0.8, hours = 24 } = options;
    const since = Date.now() - hours * 3600000;

    const result = await this.db
      .prepare(
        `SELECT * FROM decisions
         WHERE confidence >= ? AND created_at >= ?
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`
      )
      .bind(minConfidence, since, limit)
      .all();

    return (result.results || []).map(d => this.parseDecision(d));
  }

  /**
   * Get decision by ID
   */
  async getDecision(decisionId) {
    const result = await this.db
      .prepare(`SELECT * FROM decisions WHERE id = ?`)
      .bind(decisionId)
      .first();

    return result ? this.parseDecision(result) : null;
  }

  /**
   * Get decisions by session
   */
  async getSessionDecisions(sessionId, limit = 50) {
    const result = await this.db
      .prepare(
        `SELECT * FROM decisions
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(sessionId, limit)
      .all();

    return (result.results || []).map(d => this.parseDecision(d));
  }

  /**
   * Parse decision from database row
   */
  parseDecision(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      serviceName: row.service_name,
      decisionType: row.decision_type,
      reasoning: row.reasoning,
      confidence: row.confidence,
      context: JSON.parse(row.context || '{}'),
      actions: JSON.parse(row.actions || '[]'),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Analyze decision patterns
   */
  async analyzeDecisionPatterns(serviceName) {
    // Get decision type distribution
    const typeDistribution = await this.db
      .prepare(
        `SELECT decision_type, COUNT(*) as count, AVG(confidence) as avg_confidence
         FROM decisions
         WHERE service_name = ?
         GROUP BY decision_type
         ORDER BY count DESC`
      )
      .bind(serviceName)
      .all();

    // Get confidence trend
    const confidenceTrend = await this.db
      .prepare(
        `SELECT decision_type, AVG(confidence) as avg_confidence
         FROM decisions
         WHERE service_name = ? AND created_at > ?
         GROUP BY decision_type`
      )
      .bind(serviceName, Date.now() - 7 * 86400000) // Last 7 days
      .all();

    // Get common reasoning patterns
    const recentDecisions = await this.getDecisionHistory(serviceName, { limit: 100 });
    const reasoningPatterns = this.extractReasoningPatterns(recentDecisions);

    return {
      serviceName,
      typeDistribution: typeDistribution.results || [],
      confidenceTrend: confidenceTrend.results || [],
      reasoningPatterns,
      totalDecisions: recentDecisions.length,
    };
  }

  /**
   * Extract common reasoning patterns
   */
  extractReasoningPatterns(decisions) {
    const patterns = new Map();

    for (const decision of decisions) {
      const keywords = this.extractKeywords(decision.reasoning);

      for (const keyword of keywords) {
        if (!patterns.has(keyword)) {
          patterns.set(keyword, {
            keyword,
            count: 0,
            avgConfidence: 0,
            decisionTypes: new Set(),
          });
        }

        const pattern = patterns.get(keyword);
        pattern.count++;
        pattern.avgConfidence += decision.confidence;
        pattern.decisionTypes.add(decision.decisionType);
      }
    }

    // Calculate averages
    const result = [];
    for (const [keyword, pattern] of patterns) {
      result.push({
        keyword,
        count: pattern.count,
        avgConfidence: pattern.avgConfidence / pattern.count,
        decisionTypes: Array.from(pattern.decisionTypes),
      });
    }

    // Sort by frequency
    return result.sort((a, b) => b.count - a.count).slice(0, 10);
  }

  /**
   * Extract keywords from reasoning text
   */
  extractKeywords(reasoning) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);

    const words = reasoning
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return [...new Set(words)];
  }

  /**
   * Get decision statistics
   */
  async getStats() {
    const total = await this.db
      .prepare(`SELECT COUNT(*) as count FROM decisions`)
      .first();

    const byType = await this.db
      .prepare(
        `SELECT decision_type, COUNT(*) as count, AVG(confidence) as avg_confidence
         FROM decisions
         GROUP BY decision_type
         ORDER BY count DESC`
      )
      .all();

    const highConfidence = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM decisions WHERE confidence >= 0.8`
      )
      .first();

    return {
      totalDecisions: total?.count || 0,
      highConfidenceCount: highConfidence?.count || 0,
      byType: byType.results || [],
    };
  }

  /**
   * Clean up expired decisions
   */
  async cleanup() {
    const now = Date.now();

    const result = await this.db
      .prepare(`DELETE FROM decisions WHERE expires_at < ?`)
      .bind(now)
      .run();

    console.log(`[DecisionCache] Cleaned up ${result.meta?.changes || 0} expired decisions`);
    return result.meta?.changes || 0;
  }
}

export default DecisionCache;
