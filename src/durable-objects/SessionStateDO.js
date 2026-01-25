/**
 * SessionStateDO - Durable Object for ContextConsciousness™ Session State
 *
 * Manages persistent session state per ChittyID with automatic hibernation
 * and WebSocket support for real-time updates.
 *
 * Storage Pattern:
 * - One DO instance per ChittyID (not per session)
 * - Multiple sessions per ChittyID tracked internally
 * - Automatic cleanup of expired sessions
 * - WebSocket connections for real-time state updates
 */

export class SessionStateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    // In-memory cache for active data
    this.sessions = new Map();
    this.decisions = [];
    this.context = {};
    this.lastActivity = Date.now();

    // WebSocket connections for real-time updates
    this.websockets = new Set();

    // Auto-hibernate after 60 seconds of inactivity
    this.hibernationTimeout = null;

    // Initialize from storage on first request
    this.initialized = false;

    // Alarm for periodic cleanup
    this.state.blockConcurrencyWhile(async () => {
      const currentAlarm = await this.state.storage.getAlarm();
      if (!currentAlarm) {
        // Set cleanup alarm for every hour
        await this.state.storage.setAlarm(Date.now() + 3600000);
      }
    });
  }

  /**
   * Initialize from persistent storage
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Load sessions from storage
      const storedSessions = await this.state.storage.get("sessions");
      if (storedSessions) {
        this.sessions = new Map(Object.entries(storedSessions));
      }

      // Load recent decisions
      this.decisions = (await this.state.storage.get("decisions")) || [];

      // Load context
      this.context = (await this.state.storage.get("context")) || {};

      this.initialized = true;
      console.log(
        `[SessionStateDO] Initialized with ${this.sessions.size} sessions`,
      );
    } catch (error) {
      console.error("[SessionStateDO] Initialization error:", error);
      this.initialized = true; // Mark as initialized to prevent loops
    }
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request) {
    await this.initialize();
    this.updateActivity();

    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrade requests
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    try {
      switch (path) {
        case "/session/create":
          return await this.createSession(request);
        case "/session/update":
          return await this.updateSession(request);
        case "/session/get":
          return await this.getSession(request);
        case "/session/list":
          return await this.listSessions(request);
        case "/decision/add":
          return await this.addDecision(request);
        case "/decision/list":
          return await this.listDecisions(request);
        case "/context/set":
          return await this.setContext(request);
        case "/context/get":
          return await this.getContext(request);
        case "/metrics":
          return await this.getMetrics(request);
        case "/cleanup":
          return await this.cleanupExpired(request);
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      console.error("[SessionStateDO] Request error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handle WebSocket connections for real-time updates
   */
  handleWebSocketUpgrade(_request) {
    const pair = new globalThis.WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.websockets.add(server);

    server.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleWebSocketMessage(server, message);
      } catch (error) {
        server.send(
          JSON.stringify({
            type: "error",
            message: error.message,
          }),
        );
      }
    });

    server.addEventListener("close", () => {
      this.websockets.delete(server);
    });

    // Send initial state
    server.send(
      JSON.stringify({
        type: "connected",
        sessions: Array.from(this.sessions.values()),
        context: this.context,
      }),
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle WebSocket messages
   */
  async handleWebSocketMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case "subscribe":
        // Client wants to subscribe to updates
        ws.send(
          JSON.stringify({
            type: "subscribed",
            sessionId: data.sessionId,
          }),
        );
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type: ${type}`,
          }),
        );
    }
  }

  /**
   * Broadcast updates to all connected WebSockets
   */
  broadcastUpdate(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });

    for (const ws of this.websockets) {
      try {
        ws.send(message);
      } catch (error) {
        // Remove dead connections
        this.websockets.delete(ws);
      }
    }
  }

  /**
   * Create a new session
   */
  async createSession(request) {
    const { sessionId, metadata } = await request.json();

    const session = {
      id: sessionId,
      chittyId: request.headers.get("X-ChittyID"),
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

    // Broadcast to WebSocket clients
    this.broadcastUpdate("session_created", session);

    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Update session state
   */
  async updateSession(request) {
    const { sessionId, updates } = await request.json();

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    Object.assign(session, updates, {
      updated: Date.now(),
      interactions: session.interactions + 1,
    });

    await this.persist();

    // Broadcast to WebSocket clients
    this.broadcastUpdate("session_updated", session);

    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get session details
   */
  async getSession(request) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * List all sessions for this ChittyID
   */
  async listSessions(_request) {
    const sessions = Array.from(this.sessions.values())
      .filter((s) => s.expires > Date.now())
      .sort((a, b) => b.updated - a.updated);

    return new Response(
      JSON.stringify({
        count: sessions.length,
        sessions,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Add a decision to the history
   */
  async addDecision(request) {
    const decision = await request.json();

    decision.timestamp = Date.now();
    decision.chittyId = request.headers.get("X-ChittyID");

    this.decisions.push(decision);

    // Keep only last 100 decisions
    if (this.decisions.length > 100) {
      this.decisions = this.decisions.slice(-100);
    }

    await this.persist();

    // Broadcast to WebSocket clients
    this.broadcastUpdate("decision_added", decision);

    return new Response(JSON.stringify(decision), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * List recent decisions
   */
  async listDecisions(request) {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");

    const recentDecisions = this.decisions.slice(-limit);

    return new Response(
      JSON.stringify({
        count: recentDecisions.length,
        decisions: recentDecisions,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Set context data
   */
  async setContext(request) {
    const { key, value } = await request.json();

    this.context[key] = value;
    this.context.updated = Date.now();

    await this.persist();

    // Broadcast to WebSocket clients
    this.broadcastUpdate("context_updated", { key, value });

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get context data
   */
  async getContext(request) {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");

    if (key) {
      return new Response(
        JSON.stringify({
          key,
          value: this.context[key],
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify(this.context), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get metrics for this Durable Object
   */
  async getMetrics(request) {
    const metrics = {
      chittyId: request.headers.get("X-ChittyID"),
      activeSessions: this.sessions.size,
      totalDecisions: this.decisions.length,
      contextKeys: Object.keys(this.context).length,
      websocketConnections: this.websockets.size,
      lastActivity: this.lastActivity,
      memoryUsage: this.estimateMemoryUsage(),
    };

    return new Response(JSON.stringify(metrics), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpired(_request) {
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

    return new Response(
      JSON.stringify({
        cleaned,
        remaining: this.sessions.size,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Handle scheduled alarm for periodic cleanup
   */
  async alarm() {
    console.log("[SessionStateDO] Running scheduled cleanup");

    // Cleanup expired sessions
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expires < now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    // Cleanup old decisions (older than 7 days)
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    this.decisions = this.decisions.filter((d) => d.timestamp > weekAgo);

    if (cleaned > 0 || this.decisions.length > 0) {
      await this.persist();
    }

    // Schedule next cleanup
    await this.state.storage.setAlarm(Date.now() + 3600000); // 1 hour
  }

  /**
   * Persist state to storage
   */
  async persist() {
    try {
      await this.state.storage.put({
        sessions: Object.fromEntries(this.sessions),
        decisions: this.decisions,
        context: this.context,
        lastPersisted: Date.now(),
      });
    } catch (error) {
      console.error("[SessionStateDO] Persist error:", error);
    }
  }

  /**
   * Update last activity timestamp and reset hibernation
   */
  updateActivity() {
    this.lastActivity = Date.now();

    // Reset hibernation timeout
    if (this.hibernationTimeout) {
      clearTimeout(this.hibernationTimeout);
    }

    // Set new hibernation timeout (60 seconds)
    this.hibernationTimeout = setTimeout(() => {
      console.log("[SessionStateDO] Entering hibernation");
      // The DO will automatically hibernate when no requests come in
    }, 60000);
  }

  /**
   * Estimate memory usage (for monitoring)
   */
  estimateMemoryUsage() {
    const sessionSize = JSON.stringify(
      Object.fromEntries(this.sessions),
    ).length;
    const decisionSize = JSON.stringify(this.decisions).length;
    const contextSize = JSON.stringify(this.context).length;

    return {
      sessions: `${(sessionSize / 1024).toFixed(2)} KB`,
      decisions: `${(decisionSize / 1024).toFixed(2)} KB`,
      context: `${(contextSize / 1024).toFixed(2)} KB`,
      total: `${((sessionSize + decisionSize + contextSize) / 1024).toFixed(2)} KB`,
    };
  }
}

// Export for Cloudflare Workers
export default SessionStateDO;
