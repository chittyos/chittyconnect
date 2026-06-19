import { Actor, handler } from "@cloudflare/actors";

/**
 * SessionStateActor - Actor Model implementation for Session State
 *
 * Migrated from SessionStateDO to use @cloudflare/actors framework.
 * Eliminates fetch/routing boilerplate, exposes direct RPC methods.
 */
export class SessionStateActor extends Actor {
  // In-memory cache for active data
  sessions = new Map();
  decisions = [];
  context = {};
  lastActivity = Date.now();

  // WebSocket connections for real-time updates
  websockets = new Set();
  hibernationTimeout = null;
  initialized = false;

  /**
   * Initialize from persistent storage when the Actor wakes up
   */
  async onInit() {
    if (this.initialized) return;

    try {
      // Access storage via this.ctx (standard DurableObject context)
      const storedSessions = await this.ctx.storage.get("sessions");
      if (storedSessions) {
        this.sessions = new Map(Object.entries(storedSessions));
      }

      this.decisions = (await this.ctx.storage.get("decisions")) || [];
      this.context = (await this.ctx.storage.get("context")) || {};

      this.initialized = true;
      console.log(`[SessionStateActor] Initialized with ${this.sessions.size} sessions`);

      // Set cleanup alarm if none exists
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm) {
        await this.ctx.storage.setAlarm(Date.now() + 3600000);
      }
    } catch (error) {
      console.error("[SessionStateActor] Initialization error:", error);
      this.initialized = true;
    }
  }

  /**
   * Persist state to storage
   */
  async persist() {
    try {
      await this.ctx.storage.put({
        sessions: Object.fromEntries(this.sessions),
        decisions: this.decisions,
        context: this.context,
        lastPersisted: Date.now(),
      });
    } catch (error) {
      console.error("[SessionStateActor] Persist error:", error);
    }
  }

  updateActivity() {
    this.lastActivity = Date.now();
    if (this.hibernationTimeout) {
      clearTimeout(this.hibernationTimeout);
    }
    this.hibernationTimeout = setTimeout(() => {
      console.log("[SessionStateActor] Entering hibernation");
    }, 60000);
  }

  // --- RPC Methods ---

  /**
   * Create a new session
   */
  async createSession(chittyId, sessionId, metadata) {
    this.updateActivity();

    const session = {
      id: sessionId,
      chittyId,
      created: Date.now(),
      updated: Date.now(),
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      metadata,
      state: "active",
      decisions: [],
      interactions: 0,
    };

    this.sessions.set(sessionId, session);
    await this.persist();
    this.broadcastUpdate("session_created", session);

    return session;
  }

  /**
   * Update session state
   */
  async updateSession(sessionId, updates) {
    this.updateActivity();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    Object.assign(session, updates, {
      updated: Date.now(),
      interactions: session.interactions + 1,
    });

    await this.persist();
    this.broadcastUpdate("session_updated", session);

    return session;
  }

  /**
   * Get session details
   */
  async getSession(sessionId) {
    this.updateActivity();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    return session;
  }

  /**
   * List all sessions
   */
  async listSessions() {
    this.updateActivity();
    const sessions = Array.from(this.sessions.values())
      .filter((s) => s.expires > Date.now())
      .sort((a, b) => b.updated - a.updated);

    return {
      count: sessions.length,
      sessions,
    };
  }

  /**
   * Add a decision to the history
   */
  async addDecision(chittyId, decision) {
    this.updateActivity();

    decision.timestamp = Date.now();
    decision.chittyId = chittyId;

    this.decisions.push(decision);

    if (this.decisions.length > 100) {
      this.decisions = this.decisions.slice(-100);
    }

    await this.persist();
    this.broadcastUpdate("decision_added", decision);

    return decision;
  }

  /**
   * List recent decisions
   */
  async listDecisions(limit = 10) {
    this.updateActivity();
    const recentDecisions = this.decisions.slice(-limit);
    return {
      count: recentDecisions.length,
      decisions: recentDecisions,
    };
  }

  /**
   * Set context data
   */
  async setContext(key, value) {
    this.updateActivity();
    this.context[key] = value;
    this.context.updated = Date.now();

    await this.persist();
    this.broadcastUpdate("context_updated", { key, value });

    return { success: true };
  }

  /**
   * Get context data
   */
  async getContext(key = null) {
    this.updateActivity();
    if (key) {
      return {
        key,
        value: this.context[key],
      };
    }
    return this.context;
  }

  /**
   * Get metrics
   */
  async getMetrics(chittyId) {
    this.updateActivity();
    const metrics = {
      chittyId,
      activeSessions: this.sessions.size,
      totalDecisions: this.decisions.length,
      contextKeys: Object.keys(this.context).length,
      websocketConnections: this.websockets.size,
      lastActivity: this.lastActivity,
      memoryUsage: this.estimateMemoryUsage(),
    };
    return metrics;
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpired() {
    this.updateActivity();
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expires < now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.persist();
      this.broadcastUpdate("cleanup", { cleaned });
    }

    return {
      cleaned,
      remaining: this.sessions.size,
    };
  }

  /**
   * Handle scheduled alarm for periodic cleanup
   */
  async onAlarm() {
    console.log("[SessionStateActor] Running scheduled cleanup");

    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expires < now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    this.decisions = this.decisions.filter((d) => d.timestamp > weekAgo);

    if (cleaned > 0 || this.decisions.length > 0) {
      await this.persist();
    }

    await this.ctx.storage.setAlarm(Date.now() + 3600000);
  }

  estimateMemoryUsage() {
    const sessionSize = JSON.stringify(Object.fromEntries(this.sessions)).length;
    const decisionSize = JSON.stringify(this.decisions).length;
    const contextSize = JSON.stringify(this.context).length;

    return {
      sessions: `${(sessionSize / 1024).toFixed(2)} KB`,
      decisions: `${(decisionSize / 1024).toFixed(2)} KB`,
      context: `${(contextSize / 1024).toFixed(2)} KB`,
      total: `${((sessionSize + decisionSize + contextSize) / 1024).toFixed(2)} KB`,
    };
  }

  // --- WebSocket Handling ---

  /**
   * By default, @cloudflare/actors provides web socket support, but we can override
   * HTTP routing for the raw fetch if we need to. However, let's allow fetch to catch WS upgrades.
   * Or if Actor handles it, we can just intercept fetch.
   */
  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);
      this.websockets.add(server);

      server.addEventListener("message", async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleWebSocketMessage(server, message);
        } catch (error) {
          server.send(JSON.stringify({ type: "error", message: error.message }));
        }
      });

      server.addEventListener("close", () => {
        this.websockets.delete(server);
      });

      server.send(JSON.stringify({
        type: "connected",
        sessions: Array.from(this.sessions.values()),
        context: this.context,
      }));

      return new Response(null, { status: 101, webSocket: client });
    }

    // Fall back to Actor's default RPC fetch handler
    return super.fetch(request);
  }

  async handleWebSocketMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case "subscribe":
        ws.send(JSON.stringify({ type: "subscribed", sessionId: data.sessionId }));
        break;
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      default:
        ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${type}` }));
    }
  }

  broadcastUpdate(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });

    for (const ws of this.websockets) {
      try {
        ws.send(message);
      } catch (error) {
        this.websockets.delete(ws);
      }
    }
  }
}

export default handler(SessionStateActor);
