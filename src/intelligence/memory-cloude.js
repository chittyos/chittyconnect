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

import { resolveAiModel, extractAiText } from "../lib/ai-model.js";
import { ChittyIDClient } from "../lib/chittyid-client.js";

/**
 * Instances that are NOT per-entity and must never be resolved from caller input.
 * These are the pre-scoping shared buckets; reaching one is a cross-entity read.
 */
const MEMORY_INSTANCE_DENYLIST = new Set(["memory-cloude", "memory-context-embeddings"]);
const CANONICAL_CHITTYID_RE =
  /^\d{2}-[A-Z0-9]-[A-Z]{3}-\d{4}-[PLTEA]-\d{3,4}-[0-5]-\d{1,2}$/;

export class MemoryCloude {
  constructor(env) {
    this.env = env;
    this.kv = env.MEMORY_KV || env.TOKEN_KV; // Fallback to TOKEN_KV for now
    this.db = env.DB;
    this.searchNamespace = env.AI_SEARCH; // Cloudflare AI Search namespace binding
    this.knownMemoryInstances = new Set();
    // Derived here, NOT in initialize(). src/index.js calls initialize() without
    // awaiting it (`.initialize().catch(...)`), so a request arriving first would see
    // this undefined and silently skip indexing — the same silent-skip that left
    // storeEmbedding dead behind `this.hasVectorize`. It is a synchronous derivation
    // from env; it has no reason to depend on an async call having completed.
    this.hasAiSearch = !!this.searchNamespace;
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

    // hasAiSearch is set in the constructor; re-deriving here would reintroduce the
    // ordering dependency this deliberately removed.
    if (!this.hasAiSearch) {
      console.warn(
        "[MemoryCloude™] AI Search not available, using KV-only mode",
      );
    }

    console.log("[MemoryCloude™] Ready for memory persistence");
  }

  /**
   * Persist an interaction to memory
   */
  async idempotencyDigest(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  interactionStorageKey(sessionId, interactionId) {
    const marker = `${sessionId}-idem-`;
    if (interactionId.startsWith(marker)) {
      return `session:${sessionId}:id:${interactionId.slice(marker.length)}`;
    }

    // Legacy format: interaction id ended in the millisecond timestamp and the
    // raw KV key used that timestamp directly.
    const parts = interactionId.split("-");
    const timestamp = parts[parts.length - 1];
    return `session:${sessionId}:${timestamp}`;
  }

  async persistInteraction(sessionId, interaction, options = {}) {
    const idempotencyKey =
      options.idempotencyKey || interaction?.idempotencyKey || interaction?.idempotency_key;
    const timestamp = Date.now();
    const syntheticPersonId =
      options.syntheticPersonId || (await this.resolveSessionSyntheticPerson(sessionId));
    let semanticIndexed = false;

    if (this.hasAiSearch && !syntheticPersonId) {
      const error = new Error(
        "Session is not bound to an active Synthetic Person; memory persistence refused",
      );
      error.code = "MEMORY_SCOPE_UNRESOLVED";
      throw error;
    }

    let interactionId;
    let rawKey;
    if (idempotencyKey) {
      const digest = await this.idempotencyDigest(idempotencyKey);
      interactionId = `${sessionId}-idem-${digest}`;
      rawKey = `session:${sessionId}:id:${digest}`;
    } else {
      interactionId = `${sessionId}-${timestamp}`;
      rawKey = `session:${sessionId}:${timestamp}`;
    }

    const existingRaw = idempotencyKey ? await this.kv.get(rawKey, "json") : null;
    const deduplicated = !!existingRaw;

    if (!existingRaw) {
      // 1. Deterministic raw key is the replay convergence point.
      await this.kv.put(
        rawKey,
        JSON.stringify({
          ...interaction,
          id: interactionId,
          timestamp,
        }),
        { expirationTtl: this.retention.conversations * 86400 },
      );

      // 2. AI Search item id is deterministic on idempotent writes.
      if (this.hasAiSearch && syntheticPersonId) {
        semanticIndexed = await this.storeEmbedding(
          interactionId,
          sessionId,
          interaction,
          syntheticPersonId,
        );
      } else if (this.hasAiSearch) {
        console.warn(
          "[MemoryCloude™] Session is not bound to a Synthetic Person; semantic persistence refused",
        );
      }

      // These derivative counters are legacy non-transactional behavior. They
      // execute once for a normal first write; replays do not increment them.
      if (interaction.entities) {
        await this.persistEntities(interaction.entities, sessionId);
      }
      if (interaction.decisions) {
        await this.persistDecisions(sessionId, interaction.decisions);
      }
    } else if (this.hasAiSearch && syntheticPersonId) {
      // A replay also repairs semantic indexing. This covers a first-write race
      // where KV succeeded but instance provisioning/upload lost a conflict.
      semanticIndexed = await this.storeEmbedding(
        interactionId,
        sessionId,
        existingRaw,
        syntheticPersonId,
      );
    }

    // Index repair is safe on replay because both methods deduplicate by id.
    await this.updateSessionIndex(sessionId, interactionId);
    await this.updateUserIndex(interaction.userId, sessionId, interactionId);

    console.log(
      `[MemoryCloude™] Persisted interaction ${interactionId}${deduplicated ? " (deduplicated)" : ""}`,
    );
    return { interactionId, deduplicated, syntheticPersonId, semanticIndexed };
  }

  /**
   * Store interaction in AI Search
   */
  /**
   * Resolve the AI Search instance for one primary synthetic entity.
   *
   * Scope is the instance, never a query filter — see
   * chittysearch/docs/NAMESPACE-STRATEGY.md rule 1. Between entities is a real trust
   * boundary and gets a separate instance; between sessions of one entity is the
   * product (90-day continuity), so session narrowing is ranking, not scope.
   *
   * Returns null when no entity can be identified. Callers must then skip the AI
   * Search path entirely rather than fall back to a shared instance — an unscoped
   * write is how one entity's context becomes another's recall.
   *
   * THIS SCOPES; IT DOES NOT AUTHORIZE. It maps an entity id to that entity's
   * instance and validates the id's shape. It cannot know whether the caller is
   * entitled to that entity — the route must pass an entity from authenticated
   * context, never straight from a request body. Validation here bounds the damage
   * of a caller mistake; it is not a substitute for authorization at the edge.
   *
   * @param {{entityId?: string, userId?: string}} interaction
   * @returns {string|null} instance id, or null when unscoped
   */
  isCanonicalPersonId(entityId) {
    if (typeof entityId !== "string" || !CANONICAL_CHITTYID_RE.test(entityId)) {
      return false;
    }
    const parsed = ChittyIDClient.parse(entityId);
    return !!parsed && parsed.entityType === "P";
  }

  async resolveSessionSyntheticPerson(sessionId) {
    if (!sessionId || !this.db?.prepare) return null;

    try {
      const row = await this.db
        .prepare(
          `
          SELECT ce.chitty_id, csb.context_chitty_id
          FROM context_session_bindings csb
          JOIN context_entities ce ON ce.id = csb.context_id
          WHERE csb.session_id = ?
            AND csb.unbound_at IS NULL
            AND ce.status = 'active'
            AND ce.chitty_id = csb.context_chitty_id
          LIMIT 1
        `,
        )
        .bind(sessionId)
        .first();

      const chittyId = row?.chitty_id;
      return this.isCanonicalPersonId(chittyId) ? chittyId : null;
    } catch (error) {
      console.warn(
        "[MemoryCloude™] Failed to resolve session Synthetic Person:",
        error.message,
      );
      return null;
    }
  }

  memoryInstanceFor(syntheticPersonId) {
    if (!this.isCanonicalPersonId(syntheticPersonId)) return null;
    const instance = `memory-${syntheticPersonId.toLowerCase()}`;
    if (MEMORY_INSTANCE_DENYLIST.has(instance)) return null;
    return instance;
  }

  experienceItemKey(sessionId, interactionId) {
    return `experiences/${encodeURIComponent(sessionId)}/${encodeURIComponent(interactionId)}.txt`;
  }

  parseExperienceItemKey(key) {
    if (typeof key !== "string" || !key.startsWith("experiences/")) return null;
    const parts = key.split("/");
    if (parts.length !== 3) return null;
    try {
      const sessionId = decodeURIComponent(parts[1]);
      const interactionId = decodeURIComponent(parts[2].replace(/\.txt$/, ""));
      return { sessionId, interactionId };
    } catch {
      return null;
    }
  }

  isNotFoundError(error) {
    const status = error?.status || error?.statusCode || error?.cause?.status;
    return status === 404 || /not found|404/i.test(String(error?.message || ""));
  }

  async getOrCreateMemoryInstance(instanceId) {
    if (!this.searchNamespace || !instanceId) return null;
    if (this.knownMemoryInstances.has(instanceId)) {
      return this.searchNamespace.get(instanceId);
    }

    const instance = this.searchNamespace.get(instanceId);
    try {
      await instance.info();
      this.knownMemoryInstances.add(instanceId);
      return instance;
    } catch (error) {
      if (!this.isNotFoundError(error)) throw error;
    }

    try {
      const created = await this.searchNamespace.create({ id: instanceId });
      this.knownMemoryInstances.add(instanceId);
      console.log("[MemoryCloude™] Provisioned isolated AI Search instance " + instanceId);
      return created;
    } catch (error) {
      // Multiple Worker isolates may race on first use. If another isolate won,
      // resolve the now-existing instance and continue rather than dropping indexing.
      const status = error?.status || error?.statusCode || error?.cause?.status;
      if (
        status === 409 ||
        /already exists|conflict|409/i.test(String(error?.message || ""))
      ) {
        const existing = this.searchNamespace.get(instanceId);
        await existing.info();
        this.knownMemoryInstances.add(instanceId);
        return existing;
      }
      throw error;
    }
  }

  async storeEmbedding(interactionId, sessionId, interaction, syntheticPersonId) {
    try {
      if (!this.hasAiSearch) return false;

      const instanceId = this.memoryInstanceFor(syntheticPersonId);
      if (!instanceId) {
        console.warn(
          "[MemoryCloude™] Invalid Synthetic Person scope; AI Search write refused",
        );
        return false;
      }

      const text = this.extractTextContent(interaction);
      const instance = await this.getOrCreateMemoryInstance(instanceId);
      await instance.items.upload(
        this.experienceItemKey(sessionId, interactionId),
        text,
      );
      console.log(
        "[MemoryCloude™] Stored experience " + interactionId + " in " + instanceId,
      );
      return true;
    } catch (error) {
      console.warn("[MemoryCloude™] Experience storage failed:", error.message);
      return false;
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
    if (!existing.interactions.includes(interactionId)) {
      existing.interactions.push(interactionId);
    }
    existing.lastUpdate = Date.now();

    await this.kv.put(indexKey, JSON.stringify(existing), {
      expirationTtl: this.retention.conversations * 86400,
    });
  }

  /**
   * Update user index for cross-session history lookups
   */
  async updateUserIndex(userId, sessionId, interactionId) {
    if (!userId) return;
    const indexKey = `user:${userId}:index`;

    const existing = (await this.kv.get(indexKey, "json")) || {
      sessions: [],
      interactions: [],
    };
    if (!existing.sessions.includes(sessionId)) {
      existing.sessions.push(sessionId);
    }
    if (!existing.interactions.some((entry) =>
      (typeof entry === "string" ? entry : entry?.id) === interactionId
    )) {
      existing.interactions.push({
        id: interactionId,
        sessionId,
        timestamp: Date.now(),
      });
    }
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
    const syntheticPersonId =
      options.syntheticPersonId || (await this.resolveSessionSyntheticPerson(sessionId));
    const instanceId = this.memoryInstanceFor(syntheticPersonId);
    const wantsSemantic = options.semantic !== false && this.hasAiSearch;

    if (wantsSemantic && !instanceId) {
      const error = new Error(
        "Session is not bound to an active Synthetic Person; semantic memory scope unresolved",
      );
      error.code = "MEMORY_SCOPE_UNRESOLVED";
      throw error;
    }

    if (wantsSemantic) {
      return await this.semanticRecall(sessionId, query, limit, instanceId);
    }

    return await this.keywordRecall(sessionId, query, limit);
  }

  /**
   * Semantic search within ONE entity's memory instance.
   *
   * Federation is deliberately absent. An earlier revision passed
   * `instance_ids: ["memory-cloude", "context-embeddings"]` and then isolated sessions
   * with a post-hoc `chunk.item.metadata.sessionId === sessionId` filter. Both halves
   * were wrong: chittysearch's CHARTER forbids fanning out across instances, and a
   * caller-supplied filter is not a scope boundary because it fails open the moment it
   * is omitted. The session filter below is retained only as *ranking* — every chunk it
   * sees already belongs to this entity, so dropping it would widen recall within the
   * entity, never across entities.
   */
  async semanticRecall(sessionId, query, limit, instanceId) {
    try {
      const instance = await this.getOrCreateMemoryInstance(instanceId);
      const searchResults = await instance.search({
        messages: [{ role: "user", content: query }],
        ai_search_options: {
          retrieval: { top_k: Math.max(limit * 3, limit) },
        },
      });

      if (!searchResults || !searchResults.chunks) return [];

      const matches = searchResults.chunks
        .map((chunk) => {
          const parsed = this.parseExperienceItemKey(chunk.item?.key);
          if (!parsed) return null;
          return {
            id: parsed.interactionId,
            sourceSessionId: parsed.sessionId,
            score:
              Number(chunk.score || 0) +
              (parsed.sessionId === sessionId ? 0.05 : 0),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      const contexts = [];
      for (const match of matches.slice(0, limit)) {
        const data = await this.kv.get(
          this.interactionStorageKey(match.sourceSessionId, match.id),
          "json",
        );

        if (data) {
          contexts.push({
            ...data,
            sourceSessionId: match.sourceSessionId,
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
      const data = await this.kv.get(
        this.interactionStorageKey(sessionId, interactionId),
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
      const response = await this.env.AI.run(resolveAiModel(this.env), {
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

      const summary = extractAiText(response);
      if (!summary.trim()) {
        // An empty envelope must not be cached as a valid summary — fall through
        // to the catch below so the failure stays visible instead of persisting "".
        // Whitespace-only counts as empty: a blank summary cached for the full
        // retention period is the silent failure this guard exists to prevent,
        // and `!summary` alone would let " " through.
        throw new Error("Workers AI returned no summary text");
      }

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
      const data = await this.kv.get(
        this.interactionStorageKey(sessionId, interactionId),
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
  async getUserHistory(userId, limit = 100) {
    if (!userId) return [];

    const indexKey = `user:${userId}:index`;
    const index = await this.kv.get(indexKey, "json");

    if (!index || !index.interactions || index.interactions.length === 0) {
      return [];
    }

    const interactions = [];

    // Iterate in reverse — newest entries are appended last
    const entries = index.interactions.slice(-limit * 2).reverse();

    for (const entry of entries) {
      // Support both object entries { id, sessionId, timestamp } and legacy string IDs
      const sessionId =
        typeof entry === "string"
          ? index.sessions?.[0] || null
          : entry.sessionId;
      const interactionId = typeof entry === "string" ? entry : entry.id;

      if (!sessionId || !interactionId) continue;

      // Extract timestamp from interaction ID (format: sessionId-timestamp)
      const data = await this.kv.get(
        this.interactionStorageKey(sessionId, interactionId),
        "json",
      );

      if (data) {
        interactions.push(data);
        if (interactions.length >= limit) break;
      }
    }

    return interactions;
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
  async recallSimilarDecompositions(subtask, syntheticPersonId) {
    // Search for similar task decompositions in memory
    if (!this.hasAiSearch) {
      return [];
    }

    // Same rule as semanticRecall: no entity, no instance, no search. Returning []
    // is correct here — a decomposition hint is an optimisation, and losing it costs
    // nothing next to answering from another entity's memory.
    const instanceId = this.memoryInstanceFor(syntheticPersonId);
    if (!instanceId) return [];

    try {
      const instance = this.searchNamespace.get(instanceId);
      const searchResults = await instance.search({
        messages: [{ role: "user", content: JSON.stringify(subtask) }],
        ai_search_options: {
          retrieval: {
            top_k: 5,
            filters: { type: "task_decomposition" }
          }
        }
      });

      if (!searchResults || !searchResults.chunks) {
        return [];
      }

      return searchResults.chunks.map((chunk) => ({
        task: chunk.item.metadata.task,
        approach: chunk.item.metadata.approach,
        performance: chunk.item.metadata.performance,
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
      hasVectorize: this.hasAiSearch,
      retentionDays: this.retention.conversations,
    };
  }
}

export default MemoryCloude;
