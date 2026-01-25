/**
 * StreamingManager - Server-Sent Events (SSE) for Real-Time MCP Communication
 *
 * Manages SSE connections for streaming consciousness updates, predictions,
 * and alerts to connected MCP clients in real-time.
 *
 * @module intelligence/streaming-manager
 */

export class StreamingManager {
  constructor(env) {
    this.env = env;
    this.connections = new Map(); // sessionId -> { writer, controller, lastActivity }
    this.heartbeatInterval = 15000; // 15 seconds (within 30s Worker timeout)
  }

  /**
   * Create SSE stream for a session
   * NOTE: In Cloudflare Workers, we must return the Response immediately,
   * then write to the stream asynchronously. Awaiting writes before returning
   * the Response causes worker exceptions.
   */
  createStream(sessionId, options = {}) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Store connection
    this.connections.set(sessionId, {
      writer,
      encoder,
      lastActivity: Date.now(),
      filters: options.filters || [],
    });

    // Send initial connection event asynchronously (don't await!)
    // This runs after we return the Response
    (async () => {
      try {
        const event = `data: ${JSON.stringify({
          type: "connected",
          sessionId,
          timestamp: Date.now(),
          message: "ChittyConnect streaming active",
        })}\n\n`;
        await writer.write(encoder.encode(event));
        console.log(
          `[StreamingManager] Initial event sent for session ${sessionId}`,
        );
      } catch (err) {
        console.error(
          `[StreamingManager] Failed to send initial event:`,
          err?.message || err,
        );
      }
    })();

    // Start heartbeat (also async, runs after response)
    this.startHeartbeat(sessionId);

    console.log(`[StreamingManager] Stream created for session ${sessionId}`);

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  /**
   * Send event to specific session
   */
  async sendEvent(sessionId, data) {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      console.warn(`[StreamingManager] No connection for session ${sessionId}`);
      return false;
    }

    const { writer, filters } = connection;

    // Apply filters if specified
    if (filters.length > 0 && !filters.includes(data.type)) {
      return false;
    }

    try {
      const event = `data: ${JSON.stringify(data)}\n\n`;
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(event));

      // Update last activity
      connection.lastActivity = Date.now();

      return true;
    } catch (error) {
      console.error(
        `[StreamingManager] Failed to send event to ${sessionId}:`,
        error.message,
      );
      this.closeStream(sessionId);
      return false;
    }
  }

  /**
   * Broadcast event to all sessions
   */
  async broadcast(data, options = {}) {
    const { excludeSessions = [] } = options;
    let sent = 0;

    for (const [sessionId] of this.connections) {
      if (!excludeSessions.includes(sessionId)) {
        const success = await this.sendEvent(sessionId, data);
        if (success) sent++;
      }
    }

    console.log(`[StreamingManager] Broadcast to ${sent} sessions`);
    return sent;
  }

  /**
   * Start heartbeat for connection health
   */
  startHeartbeat(sessionId) {
    const sendHeartbeat = async () => {
      const connection = this.connections.get(sessionId);
      if (!connection) return;

      const timeSinceActivity = Date.now() - connection.lastActivity;

      // Close if inactive for too long (25 seconds - within 30s timeout)
      if (timeSinceActivity > 25000) {
        console.log(`[StreamingManager] Closing inactive session ${sessionId}`);
        this.closeStream(sessionId);
        return;
      }

      // Send heartbeat
      await this.sendEvent(sessionId, {
        type: "heartbeat",
        timestamp: Date.now(),
        uptime: timeSinceActivity,
      });

      // Schedule next heartbeat (within Worker execution)
      // Note: This only works during active request processing
      // Clients should reconnect after 30s timeout
    };

    // Send first heartbeat
    setTimeout(sendHeartbeat, this.heartbeatInterval);
  }

  /**
   * Close stream for session
   */
  async closeStream(sessionId) {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    try {
      await connection.writer.close();
    } catch (error) {
      console.warn(
        `[StreamingManager] Error closing stream for ${sessionId}:`,
        error.message,
      );
    }

    this.connections.delete(sessionId);
    console.log(`[StreamingManager] Stream closed for session ${sessionId}`);
  }

  /**
   * Get active session count
   */
  getActiveSessionCount() {
    return this.connections.size;
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId) {
    const connection = this.connections.get(sessionId);
    if (!connection) return null;

    return {
      sessionId,
      connected: true,
      lastActivity: connection.lastActivity,
      uptime: Date.now() - connection.lastActivity,
      filters: connection.filters,
    };
  }

  /**
   * Stream consciousness updates
   */
  async streamConsciousnessUpdate(sessionId, awareness) {
    return await this.sendEvent(sessionId, {
      type: "consciousness:update",
      data: awareness,
      timestamp: Date.now(),
    });
  }

  /**
   * Stream prediction
   */
  async streamPrediction(sessionId, prediction) {
    return await this.sendEvent(sessionId, {
      type: "prediction:new",
      data: prediction,
      timestamp: Date.now(),
    });
  }

  /**
   * Stream alert
   */
  async streamAlert(sessionId, alert) {
    return await this.sendEvent(sessionId, {
      type: "alert:new",
      data: alert,
      timestamp: Date.now(),
    });
  }

  /**
   * Stream decision
   */
  async streamDecision(sessionId, decision) {
    return await this.sendEvent(sessionId, {
      type: "decision:made",
      data: decision,
      timestamp: Date.now(),
    });
  }

  /**
   * Stream memory update
   */
  async streamMemoryUpdate(sessionId, memory) {
    return await this.sendEvent(sessionId, {
      type: "memory:update",
      data: memory,
      timestamp: Date.now(),
    });
  }

  /**
   * Cleanup inactive streams
   */
  async cleanup() {
    const now = Date.now();
    const timeout = 25000; // 25 seconds

    for (const [sessionId, connection] of this.connections) {
      if (now - connection.lastActivity > timeout) {
        await this.closeStream(sessionId);
      }
    }
  }

  /**
   * Get streaming statistics
   */
  getStats() {
    const sessions = [];

    for (const [sessionId, connection] of this.connections) {
      sessions.push({
        sessionId,
        uptime: Date.now() - connection.lastActivity,
        filters: connection.filters,
      });
    }

    return {
      activeSessions: this.connections.size,
      sessions,
      heartbeatInterval: this.heartbeatInterval,
    };
  }
}

export default StreamingManager;
