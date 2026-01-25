/**
 * SessionStateService - Wrapper for Durable Objects integration
 *
 * Provides a clean interface for interacting with SessionStateDO
 * and handles migration from KV-based storage.
 */

export class SessionStateService {
  constructor(env) {
    this.env = env;
    this.cache = new Map(); // Local cache for performance
  }

  /**
   * Get or create Durable Object for a ChittyID
   */
  getDurableObject(chittyId) {
    // Use ChittyID as the Durable Object name for consistent routing
    const id = this.env.SESSION_STATE.idFromName(chittyId);
    return this.env.SESSION_STATE.get(id);
  }

  /**
   * Create a new session
   */
  async createSession(chittyId, sessionId, metadata = {}) {
    try {
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/session/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ChittyID": chittyId,
        },
        body: JSON.stringify({ sessionId, metadata }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const session = await response.json();

      // Cache locally
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      console.error("[SessionStateService] Create session error:", error);

      // Fallback to KV storage if DO fails
      return await this.createSessionKVFallback(chittyId, sessionId, metadata);
    }
  }

  /**
   * Update session state
   */
  async updateSession(chittyId, sessionId, updates) {
    try {
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/session/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ChittyID": chittyId,
        },
        body: JSON.stringify({ sessionId, updates }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update session: ${response.status}`);
      }

      const session = await response.json();

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
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch(
        `https://do/session/get?sessionId=${sessionId}`,
        {
          method: "GET",
          headers: { "X-ChittyID": chittyId },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get session: ${response.status}`);
      }

      const session = await response.json();

      // Cache for future requests
      this.cache.set(sessionId, session);

      return session;
    } catch (error) {
      console.error("[SessionStateService] Get session error:", error);

      // Fallback to KV storage
      return await this.getSessionKVFallback(sessionId);
    }
  }

  /**
   * List all sessions for a ChittyID
   */
  async listSessions(chittyId) {
    try {
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/session/list", {
        method: "GET",
        headers: { "X-ChittyID": chittyId },
      });

      if (!response.ok) {
        throw new Error(`Failed to list sessions: ${response.status}`);
      }

      return await response.json();
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
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/decision/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ChittyID": chittyId,
        },
        body: JSON.stringify(decision),
      });

      if (!response.ok) {
        throw new Error(`Failed to add decision: ${response.status}`);
      }

      return await response.json();
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
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch(
        `https://do/decision/list?limit=${limit}`,
        {
          method: "GET",
          headers: { "X-ChittyID": chittyId },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get decisions: ${response.status}`);
      }

      return await response.json();
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
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/context/set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ChittyID": chittyId,
        },
        body: JSON.stringify({ key, value }),
      });

      if (!response.ok) {
        throw new Error(`Failed to set context: ${response.status}`);
      }

      return await response.json();
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
      const durableObject = this.getDurableObject(chittyId);

      const url = key
        ? `https://do/context/get?key=${key}`
        : "https://do/context/get";

      const response = await durableObject.fetch(url, {
        method: "GET",
        headers: { "X-ChittyID": chittyId },
      });

      if (!response.ok) {
        throw new Error(`Failed to get context: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("[SessionStateService] Get context error:", error);

      // Fallback to KV
      return await this.getContextKVFallback(chittyId, key);
    }
  }

  /**
   * Establish WebSocket connection to DO for real-time updates
   */
  async connectWebSocket(chittyId, sessionId) {
    try {
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/ws", {
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
   * Get metrics for a ChittyID's Durable Object
   */
  async getMetrics(chittyId) {
    try {
      const durableObject = this.getDurableObject(chittyId);

      const response = await durableObject.fetch("https://do/metrics", {
        method: "GET",
        headers: { "X-ChittyID": chittyId },
      });

      if (!response.ok) {
        throw new Error(`Failed to get metrics: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("[SessionStateService] Get metrics error:", error);
      return null;
    }
  }

  /**
   * Migrate existing KV session to Durable Object
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

      // Create session in DO
      const session = await this.createSession(
        chittyId,
        sessionId,
        existingData,
      );

      // Delete from KV after successful migration
      await this.env.TOKEN_KV.delete(kvKey);

      console.log(`[SessionStateService] Migrated session ${sessionId} to DO`);
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
