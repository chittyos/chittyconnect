/**
 * MemoryCloude™ - Perpetual Context System
 *
 * Provides 90-day semantic memory with vector storage, cross-session learning,
 * and intelligent context recall for ChittyConnect.
 *
 * @module intelligence/memory-cloude
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/memory-cloude
 * @canon chittycanon://gov/governance#core-types
 */

export class MemoryCloude {
  constructor(env) {
    this.env = env;
    this.kv = env.MEMORY_KV || env.TOKEN_KV; // Fallback to TOKEN_KV for now
    this.vectorStore = env.MEMORY_VECTORIZE; // Cloudflare Vectorize for semantic memory
    this.retention = {
      conversations: 90, // 90 days
      decisions: 365, // 1 year
      entities: Infinity, // Forever
    };
  }

  /**
   * Initialize MemoryCloude™
   */
  async initialize() {
    console.log("[MemoryCloude™] Initializing perpetual context system...");

    // Check for Vectorize availability
    this.hasVectorize = !!this.vectorStore;

    if (!this.hasVectorize) {
      console.warn(
        "[MemoryCloude™] Vectorize not available, using KV-only mode",
      );
    }

    console.log("[MemoryCloude™] Ready for memory persistence");
  }

  /**
   * Persist an interaction to memory
   */
  async persistInteraction(sessionId, interaction) {
    const timestamp = Date.now();
    const interactionId = `${sessionId}-${timestamp}`;

    // 1. Store raw interaction in KV
    await this.kv.put(
      `session:${sessionId}:${timestamp}`,
      JSON.stringify({
        ...interaction,
        id: interactionId,
        timestamp,
      }),
      { expirationTtl: this.retention.conversations * 86400 },
    );

    // 2. Generate and store embedding (if Vectorize available)
    if (this.hasVectorize) {
      await this.storeEmbedding(interactionId, sessionId, interaction);
    }

    // 3. Extract and persist entities
    if (interaction.entities) {
      await this.persistEntities(interaction.entities, sessionId);
    }

    // 4. Record decisions
    if (interaction.decisions) {
      await this.persistDecisions(sessionId, interaction.decisions);
    }

    // 5. Update session index
    await this.updateSessionIndex(sessionId, interactionId);

    console.log(`[MemoryCloude™] Persisted interaction ${interactionId}`);
  }

  /**
   * Store embedding in Vectorize
   */
  async storeEmbedding(interactionId, sessionId, interaction) {
    try {
      // Generate embedding using Cloudflare AI
      const text = this.extractTextContent(interaction);
      const embedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [text],
      });

      if (embedding && embedding.data && embedding.data[0]) {
        // Store in Vectorize
        await this.vectorStore.insert([
          {
            id: interactionId,
            values: embedding.data[0],
            metadata: {
              sessionId,
              timestamp: Date.now(),
              userId: interaction.userId,
              type: interaction.type,
              entities: JSON.stringify(interaction.entities || []),
              actions: JSON.stringify(interaction.actions || []),
            },
          },
        ]);

        console.log(`[MemoryCloude™] Stored embedding for ${interactionId}`);
      }
    } catch (error) {
      console.warn("[MemoryCloude™] Embedding storage failed:", error.message);
    }
  }

  /**
   * Extract text content from interaction for embedding
   */
  extractTextContent(interaction) {
    const parts = [];

    if (interaction.content) parts.push(interaction.content);
    if (interaction.input) parts.push(interaction.input);
    if (interaction.output) parts.push(interaction.output);
    if (interaction.actions)
      parts.push(interaction.actions.map((a) => a.type).join(", "));

    return parts.join("\n");
  }

  /**
   * Persist entities from interaction
   */
  async persistEntities(entities, sessionId) {
    for (const entity of entities) {
      const entityKey = `entity:${entity.type}:${entity.id}`;

      // Get existing entity data
      const existing = await this.kv.get(entityKey, "json");

      const entityData = {
        ...entity,
        sessions: [...new Set([...(existing?.sessions || []), sessionId])],
        lastSeen: Date.now(),
        occurrences: (existing?.occurrences || 0) + 1,
      };

      // Store without expiration (entities live forever)
      await this.kv.put(entityKey, JSON.stringify(entityData));
    }
  }

  /**
   * Persist decisions made during interaction
   */
  async persistDecisions(sessionId, decisions) {
    const timestamp = Date.now();

    for (const decision of decisions) {
      const decisionKey = `decision:${sessionId}:${timestamp}:${decision.id || Date.now()}`;

      await this.kv.put(
        decisionKey,
        JSON.stringify({
          ...decision,
          sessionId,
          timestamp,
        }),
        { expirationTtl: this.retention.decisions * 86400 },
      );
    }
  }

  /**
   * Update session index for fast lookup
   */
  async updateSessionIndex(sessionId, interactionId) {
    const indexKey = `session:${sessionId}:index`;

    const existing = (await this.kv.get(indexKey, "json")) || {
      interactions: [],
    };
    existing.interactions.push(interactionId);
    existing.lastUpdate = Date.now();

    await this.kv.put(indexKey, JSON.stringify(existing), {
      expirationTtl: this.retention.conversations * 86400,
    });
  }

  /**
   * Recall relevant context for a query
   */
  async recallContext(sessionId, query, options = {}) {
    const limit = options.limit || 5;
    const useSemanticSearch = options.semantic !== false && this.hasVectorize;

    if (useSemanticSearch) {
      return await this.semanticRecall(sessionId, query, limit);
    } else {
      return await this.keywordRecall(sessionId, query, limit);
    }
  }

  /**
   * Semantic search using vector embeddings
   */
  async semanticRecall(sessionId, query, limit) {
    try {
      // Generate query embedding
      const embedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [query],
      });

      if (!embedding || !embedding.data || !embedding.data[0]) {
        throw new Error("Failed to generate query embedding");
      }

      // Query Vectorize
      const matches = await this.vectorStore.query(embedding.data[0], {
        topK: limit * 2, // Get more, then filter by session
        returnMetadata: true,
      });

      // Filter by session and re-rank
      const sessionMatches = matches
        .filter((m) => m.metadata.sessionId === sessionId)
        .map((m) => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata,
        }));

      // Re-rank by recency and relevance
      const reranked = this.rerank(sessionMatches, {
        recencyWeight: 0.3,
        relevanceWeight: 0.7,
      });

      // Fetch full interaction data
      const contexts = [];
      for (const match of reranked.slice(0, limit)) {
        const parts = match.id.split("-");
        const timestamp = parts[parts.length - 1];
        const data = await this.kv.get(
          `session:${sessionId}:${timestamp}`,
          "json",
        );

        if (data) {
          contexts.push({
            ...data,
            relevanceScore: match.score,
          });
        }
      }

      return contexts;
    } catch (error) {
      console.warn("[MemoryCloude™] Semantic recall failed:", error.message);
      return await this.keywordRecall(sessionId, query, limit);
    }
  }

  /**
   * Keyword-based recall (fallback)
   */
  async keywordRecall(sessionId, query, limit) {
    // Get session index
    const index = await this.kv.get(`session:${sessionId}:index`, "json");

    if (!index || !index.interactions) {
      return [];
    }

    // Fetch recent interactions
    const interactions = [];
    const keywords = query.toLowerCase().split(/\s+/);

    for (const interactionId of index.interactions.slice(-20)) {
      const parts = interactionId.split("-");
      const timestamp = parts[parts.length - 1];
      const data = await this.kv.get(
        `session:${sessionId}:${timestamp}`,
        "json",
      );

      if (data) {
        const content = this.extractTextContent(data).toLowerCase();
        const matches = keywords.filter((k) => content.includes(k)).length;

        if (matches > 0) {
          interactions.push({
            ...data,
            relevanceScore: matches / keywords.length,
          });
        }
      }
    }

    // Sort by relevance
    interactions.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return interactions.slice(0, limit);
  }

  /**
   * Re-rank results by recency and relevance
   */
  rerank(matches, weights) {
    const now = Date.now();
    const maxAge = 90 * 86400 * 1000; // 90 days

    return matches
      .map((match) => {
        const age = now - match.metadata.timestamp;
        const recencyScore = 1 - age / maxAge;
        const relevanceScore = match.score;

        const combinedScore =
          weights.recencyWeight * recencyScore +
          weights.relevanceWeight * relevanceScore;

        return {
          ...match,
          combinedScore,
        };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Summarize a session using AI
   */
  async summarizeSession(sessionId) {
    // Get all interactions
    const interactions = await this.getSessionInteractions(sessionId);

    if (interactions.length === 0) {
      return "No interactions found for this session.";
    }

    try {
      // Use AI to generate summary
      const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "You are a session summarizer. Summarize this conversation session, highlighting key decisions, actions taken, and outcomes. Be concise but comprehensive.",
          },
          {
            role: "user",
            content: JSON.stringify(interactions),
          },
        ],
      });

      const summary = response.response;

      // Store summary
      await this.kv.put(`session:${sessionId}:summary`, summary, {
        expirationTtl: this.retention.conversations * 86400,
      });

      return summary;
    } catch (error) {
      console.warn(
        "[MemoryCloude™] Session summarization failed:",
        error.message,
      );
      return "Failed to generate summary.";
    }
  }

  /**
   * Get all interactions for a session
   */
  async getSessionInteractions(sessionId, limit = 100) {
    const index = await this.kv.get(`session:${sessionId}:index`, "json");

    if (!index || !index.interactions) {
      return [];
    }

    const interactions = [];
    const toFetch = index.interactions.slice(-limit);

    for (const interactionId of toFetch) {
      const parts = interactionId.split("-");
      const timestamp = parts[parts.length - 1];
      const data = await this.kv.get(
        `session:${sessionId}:${timestamp}`,
        "json",
      );

      if (data) {
        interactions.push(data);
      }
    }

    return interactions;
  }

  /**
   * Get user history across sessions
   */
  async getUserHistory(_userId, _limit = 100) {
    // This would require a user index, which we can implement
    // For now, return empty array
    console.warn("[MemoryCloude™] User history not yet implemented");
    return [];
  }

  /**
   * Get session summary
   */
  async getSessionSummary(sessionId) {
    const summary = await this.kv.get(`session:${sessionId}:summary`);

    if (!summary) {
      return await this.summarizeSession(sessionId);
    }

    return summary;
  }

  /**
   * Learn patterns from interaction
   */
  async learnFromInteraction(userId, interaction) {
    // Pattern learning implementation
    // This would analyze interaction and extract patterns

    const patterns = {
      timeOfDay: new Date(interaction.timestamp).getHours(),
      type: interaction.type,
      entities: interaction.entities?.map((e) => e.type) || [],
      actions: interaction.actions?.map((a) => a.type) || [],
    };

    // Store pattern
    await this.kv.put(
      `pattern:${userId}:${Date.now()}`,
      JSON.stringify(patterns),
      { expirationTtl: this.retention.conversations * 86400 },
    );

    return patterns;
  }

  /**
   * Recall similar decompositions for Cognitive-Coordination™
   */
  async recallSimilarDecompositions(subtask) {
    // Search for similar task decompositions in memory
    if (!this.hasVectorize) {
      return [];
    }

    try {
      const embedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [JSON.stringify(subtask)],
      });

      if (!embedding || !embedding.data || !embedding.data[0]) {
        return [];
      }

      const matches = await this.vectorStore.query(embedding.data[0], {
        topK: 5,
        returnMetadata: true,
        filter: { type: "task_decomposition" },
      });

      return matches.map((m) => ({
        task: m.metadata.task,
        approach: m.metadata.approach,
        performance: m.metadata.performance,
      }));
    } catch (error) {
      console.warn(
        "[MemoryCloude™] Similar decomposition recall failed:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(sessionId) {
    const index = await this.kv.get(`session:${sessionId}:index`, "json");

    return {
      interactions: index?.interactions?.length || 0,
      lastUpdate: index?.lastUpdate || null,
      hasVectorize: this.hasVectorize,
      retentionDays: this.retention.conversations,
    };
  }
}

export default MemoryCloude;
