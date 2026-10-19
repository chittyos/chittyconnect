/**
 * SessionStateService - Wrapper for Cloudflare Actors integration
 *
 * Provides a clean interface for interacting with SessionStateActor
 * using direct RPC instead of HTTP fetch boilerplate.
 */

export class SessionStateService {
  constructor(env) {
    this.env = env;
    this.cache = new Map(); // Local cache for performance
  }

  /**
   * Get Actor stub for a ChittyID
   */
  getActor(chittyId) {
    if (!this.env.SESSION_STATE) {
      throw new Error("SESSION_STATE binding not available — phantom binding not yet provisioned");
    }
    // Use ChittyID as the Actor name for consistent routing
    const id = this.env.SESSION_STATE.idFromName(chittyId);
    return this.env.SESSION_STATE.get(id);
  }

  /**
   * Create a new session
   */
  async createSession(chittyId, sessionId, metadata = {}) {
    try {
      const actor = this.getActor(chittyId);
      const session = await actor.createSession(chittyId, sessionId, metadata);

      // Cache locally
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      console.error("[SessionStateService] Create session error:", error);

      // Fallback to KV storage if Actor fails
      return await this.createSessionKVFallback(chittyId, sessionId, metadata);
    }
  }

  /**
   * Update session state
   */
  async updateSession(chittyId, sessionId, updates) {
    try {
      const actor = this.getActor(chittyId);
      const session = await actor.updateSession(sessionId, updates);

      // Update cache
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      console.error("[SessionStateService] Update session error:", error);

      // Fallback to KV storage
      return await this.updateSessionKVFallback(chittyId, sessionId, updates);
    }
  }

  /**
   * Get session details
   */
  async getSession(chittyId, sessionId) {
    // Check cache first
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }

    try {
      const actor = this.getActor(chittyId);
      const session = await actor.getSession(sessionId);

      // Cache for future requests
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      console.error("[SessionStateService] Get session error:", error);

      if (error.message && error.message.includes("Session not found")) {
        return null;
      }

      // Fallback to KV storage
      return await this.getSessionKVFallback(sessionId);
    }
  }

  /**
   * List all sessions for a ChittyID
   */
  async listSessions(chittyId) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.listSessions();
    } catch (error) {
      console.error("[SessionStateService] List sessions error:", error);
      return { count: 0, sessions: [] };
    }
  }

  /**
   * Add a decision to the history
   */
  async addDecision(chittyId, decision) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.addDecision(chittyId, decision);
    } catch (error) {
      console.error("[SessionStateService] Add decision error:", error);

      // Store in D1 as fallback
      return await this.addDecisionD1Fallback(chittyId, decision);
    }
  }

  /**
   * Get recent decisions
   */
  async getDecisions(chittyId, limit = 10) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.listDecisions(limit);
    } catch (error) {
      console.error("[SessionStateService] Get decisions error:", error);
      return { count: 0, decisions: [] };
    }
  }

  /**
   * Set context data
   */
  async setContext(chittyId, key, value) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.setContext(key, value);
    } catch (error) {
      console.error("[SessionStateService] Set context error:", error);

      // Fallback to KV
      return await this.setContextKVFallback(chittyId, key, value);
    }
  }

  /**
   * Get context data
   */
  async getContext(chittyId, key = null) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.getContext(key);
    } catch (error) {
      console.error("[SessionStateService] Get context error:", error);

      // Fallback to KV
      return await this.getContextKVFallback(chittyId, key);
    }
  }

  /**
   * Establish WebSocket connection to Actor for real-time updates
   */
  async connectWebSocket(chittyId, sessionId) {
    try {
      const actor = this.getActor(chittyId);

      const response = await actor.fetch("https://do/ws", {
        headers: {
          Upgrade: "websocket",
          "X-ChittyID": chittyId,
          "X-Session-ID": sessionId,
        },
      });

      const webSocket = response.webSocket;
      if (!webSocket) {
        throw new Error("WebSocket upgrade failed");
      }

      // Accept the WebSocket connection
      webSocket.accept();

      return webSocket;
    } catch (error) {
      console.error("[SessionStateService] WebSocket connection error:", error);
      return null;
    }
  }

  /**
   * Get metrics for a ChittyID's Actor
   */
  async getMetrics(chittyId) {
    try {
      const actor = this.getActor(chittyId);
      return await actor.getMetrics(chittyId);
    } catch (error) {
      console.error("[SessionStateService] Get metrics error:", error);
      return null;
    }
  }

  /**
   * Migrate existing KV session to Actor
   */
  async migrateSession(chittyId, sessionId) {
    try {
      // Get existing session from KV
      const kvKey = `session:${sessionId}`;
      const existingData = await this.env.TOKEN_KV.get(kvKey, { type: "json" });

      if (!existingData) {
        console.log(
          `[SessionStateService] No KV session to migrate: ${sessionId}`,
        );
        return null;
      }

      // Create session in Actor
      const session = await this.createSession(
        chittyId,
        sessionId,
        existingData,
      );

      // Delete from KV after successful migration
      await this.env.TOKEN_KV.delete(kvKey);

      console.log(`[SessionStateService] Migrated session ${sessionId} to Actor`);
      return session;
    } catch (error) {
      console.error("[SessionStateService] Migration error:", error);
      return null;
    }
  }

  // ============ Fallback Methods ============

  /**
   * KV Fallback: Create session
   */
  async createSessionKVFallback(chittyId, sessionId, metadata) {
    const session = {
      id: sessionId,
      chittyId,
      created: Date.now(),
      updated: Date.now(),
      expires: Date.now() + 24 * 60 * 60 * 1000,
      metadata,
      state: "active",
    };

    await this.env.TOKEN_KV.put(
      `session:${sessionId}`,
      JSON.stringify(session),
      { expirationTtl: 86400 }, // 24 hours
    );

    return session;
  }

  /**
   * KV Fallback: Update session
   */
  async updateSessionKVFallback(chittyId, sessionId, updates) {
    const existing = await this.env.TOKEN_KV.get(`session:${sessionId}`, {
      type: "json",
    });

    if (!existing) {
      throw new Error("Session not found");
    }

    const updated = {
      ...existing,
      ...updates,
      updated: Date.now(),
    };

    await this.env.TOKEN_KV.put(
      `session:${sessionId}`,
      JSON.stringify(updated),
      { expirationTtl: 86400 },
    );

    return updated;
  }

  /**
   * KV Fallback: Get session
   */
  async getSessionKVFallback(sessionId) {
    return await this.env.TOKEN_KV.get(`session:${sessionId}`, {
      type: "json",
    });
  }

  /**
   * KV Fallback: Set context
   */
  async setContextKVFallback(chittyId, key, value) {
    await this.env.TOKEN_KV.put(
      `context:${chittyId}:${key}`,
      JSON.stringify(value),
      { expirationTtl: 86400 },
    );

    return { success: true };
  }

  /**
   * KV Fallback: Get context
   */
  async getContextKVFallback(chittyId, key) {
    if (key) {
      const value = await this.env.TOKEN_KV.get(`context:${chittyId}:${key}`, {
        type: "json",
      });
      return { key, value };
    }

    // List all context keys for this ChittyID (limited operation)
    return {};
  }

  /**
   * D1 Fallback: Add decision
   */
  async addDecisionD1Fallback(chittyId, decision) {
    const id = crypto.randomUUID();

    await this.env.DB.prepare(
      `
      INSERT INTO decisions (
        id, session_id, service_name, decision_type,
        reasoning, confidence, context, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        id,
        decision.sessionId || "unknown",
        "chittyconnect",
        decision.type || "general",
        decision.reasoning || "",
        decision.confidence || 0.5,
        JSON.stringify(decision.context || {}),
        Date.now(),
      )
      .run();

    return { ...decision, id, timestamp: Date.now() };
  }

  /**
   * Clear local cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize() {
    return this.cache.size;
  }
}

export default SessionStateService;
