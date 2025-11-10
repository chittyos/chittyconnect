/**
 * MCP Session Durable Object
 *
 * Provides persistent session state management for MCP connections
 * using Cloudflare Durable Objects. Maintains conversation context,
 * tool history, and automatic persistence to MemoryCloude™.
 *
 * @module mcp/session/durable-object
 */

import { MemoryCloude } from '../../intelligence/memory-cloude.js';

/**
 * MCPSessionDurableObject - Durable Object for MCP Session State
 *
 * Key Features:
 * - Persistent session state across MCP calls
 * - Automatic context propagation between tools
 * - Integration with MemoryCloude™ for long-term storage
 * - Real-time session updates via WebSocket
 * - Session analytics and insights
 */
export class MCPSessionDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.websockets = new Map(); // WebSocket connections for real-time updates
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    // Handle WebSocket upgrade for real-time session updates
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, sessionId);
    }

    switch (url.pathname) {
      case '/session/create':
        return this.createSession(sessionId, await request.json());

      case '/session/update':
        const update = await request.json();
        return this.updateSession(sessionId, update);

      case '/session/get':
        return this.getSession(sessionId);

      case '/session/persist':
        return this.persistToMemoryCloude(sessionId);

      case '/session/history':
        const limit = parseInt(url.searchParams.get('limit') || '100');
        return this.getSessionHistory(sessionId, limit);

      case '/session/context':
        return this.getSessionContext(sessionId);

      case '/session/insights':
        return this.getSessionInsights(sessionId);

      case '/session/close':
        return this.closeSession(sessionId);

      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Create a new session
   */
  async createSession(sessionId, options = {}) {
    const session = {
      id: sessionId,
      created: Date.now(),
      lastUpdate: Date.now(),
      platform: options.platform || 'unknown',
      userId: options.userId,
      interactions: [],
      toolHistory: [],
      context: {
        entities: new Map(),
        decisions: [],
        variables: {},
        previousToolOutputs: []
      },
      metadata: {
        toolCount: 0,
        entityCount: 0,
        decisionCount: 0
      },
      settings: {
        autoSave: options.autoSave !== false,
        saveInterval: options.saveInterval || 10, // Save every 10 interactions
        enableRealtime: options.enableRealtime || false
      }
    };

    // Store in Durable Object storage
    await this.state.storage.put(`session:${sessionId}`, session);
    this.sessions.set(sessionId, session);

    return Response.json({
      success: true,
      sessionId,
      created: true
    });
  }

  /**
   * Update session with new interaction or tool execution
   */
  async updateSession(sessionId, update) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update based on type
    if (update.interaction) {
      session.interactions.push({
        ...update.interaction,
        timestamp: Date.now(),
        index: session.interactions.length
      });
    }

    if (update.tool) {
      session.toolHistory.push({
        name: update.tool.name,
        args: update.tool.args,
        result: update.tool.result,
        timestamp: Date.now(),
        duration: update.tool.duration
      });
      session.metadata.toolCount++;

      // Store tool output for context propagation
      session.context.previousToolOutputs.push({
        tool: update.tool.name,
        output: update.tool.result,
        timestamp: Date.now()
      });

      // Keep only last 10 outputs
      if (session.context.previousToolOutputs.length > 10) {
        session.context.previousToolOutputs.shift();
      }
    }

    if (update.entities) {
      for (const entity of update.entities) {
        const key = `${entity.type}:${entity.id}`;
        const existing = session.context.entities.get(key) || {
          ...entity,
          occurrences: 0
        };

        existing.occurrences++;
        existing.lastSeen = Date.now();
        session.context.entities.set(key, existing);
      }
      session.metadata.entityCount = session.context.entities.size;
    }

    if (update.decision) {
      session.context.decisions.push({
        ...update.decision,
        timestamp: Date.now()
      });
      session.metadata.decisionCount++;
    }

    if (update.variables) {
      session.context.variables = {
        ...session.context.variables,
        ...update.variables
      };
    }

    session.lastUpdate = Date.now();

    // Persist to storage
    await this.state.storage.put(`session:${sessionId}`, session);
    this.sessions.set(sessionId, session);

    // Broadcast update to connected WebSockets
    this.broadcastUpdate(sessionId, {
      type: 'session_update',
      update,
      metadata: session.metadata
    });

    // Auto-persist to MemoryCloude™ if enabled and threshold reached
    if (session.settings.autoSave &&
        session.interactions.length % session.settings.saveInterval === 0) {
      await this.persistToMemoryCloude(sessionId);
    }

    return Response.json({
      success: true,
      session: this.sanitizeSession(session)
    });
  }

  /**
   * Get session data
   */
  async getSession(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    return Response.json({
      success: true,
      session: this.sanitizeSession(session)
    });
  }

  /**
   * Get session history
   */
  async getSessionHistory(sessionId, limit = 100) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const history = session.interactions.slice(-limit);

    return Response.json({
      success: true,
      history,
      total: session.interactions.length,
      returned: history.length
    });
  }

  /**
   * Get session context for tool execution
   */
  async getSessionContext(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Build context object for tool execution
    const context = {
      sessionId,
      created: session.created,
      duration: Date.now() - session.created,
      toolCount: session.metadata.toolCount,
      entities: Array.from(session.context.entities.values()),
      recentTools: session.toolHistory.slice(-5),
      variables: session.context.variables,
      previousOutputs: session.context.previousToolOutputs.slice(-3),
      decisions: session.context.decisions.slice(-10)
    };

    return Response.json({
      success: true,
      context
    });
  }

  /**
   * Get session insights and analytics
   */
  async getSessionInsights(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Calculate insights
    const insights = {
      duration: Date.now() - session.created,
      totalInteractions: session.interactions.length,
      totalTools: session.metadata.toolCount,
      uniqueEntities: session.metadata.entityCount,
      decisionsCount: session.metadata.decisionCount,
      toolDistribution: this.calculateToolDistribution(session),
      entityDistribution: this.calculateEntityDistribution(session),
      activityTimeline: this.calculateActivityTimeline(session),
      recommendations: this.generateRecommendations(session)
    };

    return Response.json({
      success: true,
      insights
    });
  }

  /**
   * Persist session to MemoryCloude™
   */
  async persistToMemoryCloude(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const memory = new MemoryCloude(this.env);

    try {
      // Persist complete session state
      await memory.persistInteraction(sessionId, {
        type: 'mcp_session',
        userId: session.userId,
        content: JSON.stringify({
          toolHistory: session.toolHistory,
          interactions: session.interactions
        }),
        entities: Array.from(session.context.entities.values()),
        actions: session.toolHistory.map(t => ({
          type: t.name,
          timestamp: t.timestamp
        })),
        decisions: session.context.decisions
      });

      // Update session metadata
      session.lastPersist = Date.now();
      await this.state.storage.put(`session:${sessionId}`, session);

      return Response.json({
        success: true,
        persisted: true,
        interactions: session.interactions.length,
        timestamp: session.lastPersist
      });
    } catch (error) {
      console.error('[MCP Session] Failed to persist to MemoryCloude™:', error);
      return Response.json({
        success: false,
        error: 'Failed to persist session',
        details: error.message
      }, { status: 500 });
    }
  }

  /**
   * Close session and perform final persistence
   */
  async closeSession(sessionId) {
    // Final persist to MemoryCloude™
    await this.persistToMemoryCloude(sessionId);

    // Close any WebSocket connections
    const ws = this.websockets.get(sessionId);
    if (ws) {
      ws.close();
      this.websockets.delete(sessionId);
    }

    // Keep session in storage but mark as closed
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }

    if (session) {
      session.closed = Date.now();
      await this.state.storage.put(`session:${sessionId}`, session);
    }

    // Remove from active sessions
    this.sessions.delete(sessionId);

    return Response.json({
      success: true,
      sessionId,
      closed: true
    });
  }

  /**
   * Handle WebSocket connection for real-time updates
   */
  async handleWebSocket(request, sessionId) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // Store WebSocket connection
    this.websockets.set(sessionId, server);

    // Send initial session state
    const session = await this.getSessionData(sessionId);
    if (session) {
      server.send(JSON.stringify({
        type: 'session_state',
        session: this.sanitizeSession(session)
      }));
    }

    // Handle WebSocket messages
    server.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleWebSocketMessage(sessionId, message);
      } catch (error) {
        console.error('[MCP Session] WebSocket message error:', error);
      }
    });

    server.addEventListener('close', () => {
      this.websockets.delete(sessionId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  /**
   * Broadcast update to WebSocket clients
   */
  broadcastUpdate(sessionId, data) {
    const ws = this.websockets.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Helper: Get session data (from cache or storage)
   */
  async getSessionData(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.state.storage.get(`session:${sessionId}`);
    }
    return session;
  }

  /**
   * Helper: Sanitize session for external consumption
   */
  sanitizeSession(session) {
    // Convert Map to Array for JSON serialization
    return {
      ...session,
      context: {
        ...session.context,
        entities: Array.from(session.context.entities.values())
      }
    };
  }

  /**
   * Analytics: Calculate tool distribution
   */
  calculateToolDistribution(session) {
    const distribution = {};
    for (const tool of session.toolHistory) {
      distribution[tool.name] = (distribution[tool.name] || 0) + 1;
    }
    return distribution;
  }

  /**
   * Analytics: Calculate entity distribution
   */
  calculateEntityDistribution(session) {
    const distribution = {};
    for (const entity of session.context.entities.values()) {
      distribution[entity.type] = (distribution[entity.type] || 0) + 1;
    }
    return distribution;
  }

  /**
   * Analytics: Calculate activity timeline
   */
  calculateActivityTimeline(session) {
    const timeline = [];
    const bucketSize = 60000; // 1 minute buckets

    const startTime = session.created;
    const endTime = session.lastUpdate;
    const buckets = Math.ceil((endTime - startTime) / bucketSize);

    for (let i = 0; i < buckets; i++) {
      const bucketStart = startTime + (i * bucketSize);
      const bucketEnd = bucketStart + bucketSize;

      const activity = session.toolHistory.filter(
        t => t.timestamp >= bucketStart && t.timestamp < bucketEnd
      ).length;

      timeline.push({
        start: bucketStart,
        end: bucketEnd,
        activity
      });
    }

    return timeline;
  }

  /**
   * Analytics: Generate recommendations
   */
  generateRecommendations(session) {
    const recommendations = [];

    // Recommend persistence if many unpersisted interactions
    const lastPersist = session.lastPersist || session.created;
    const timeSinceLastPersist = Date.now() - lastPersist;
    const interactionsSinceLastPersist = session.interactions.filter(
      i => i.timestamp > lastPersist
    ).length;

    if (interactionsSinceLastPersist > 20) {
      recommendations.push({
        type: 'persistence',
        priority: 'high',
        message: 'Consider persisting session to MemoryCloude™',
        action: 'persist_session'
      });
    }

    // Recommend context cleanup if too many entities
    if (session.metadata.entityCount > 100) {
      recommendations.push({
        type: 'optimization',
        priority: 'medium',
        message: 'Session has many entities, consider cleanup',
        action: 'cleanup_entities'
      });
    }

    return recommendations;
  }
}

export default MCPSessionDurableObject;