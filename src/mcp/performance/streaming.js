/**
 * MCP Streaming Handler
 *
 * Advanced streaming handler for real-time updates, batching, and
 * Server-Sent Events (SSE) support for MCP connections.
 *
 * @module mcp/performance/streaming
 */

import { ContextConsciousness } from '../../intelligence/context-consciousness.js';

/**
 * StreamingManager - Manages SSE streams and real-time updates
 */
export class StreamingManager {
  constructor(env) {
    this.env = env;
    this.streams = new Map();
    this.consciousness = new ContextConsciousness(env);
  }

  /**
   * Create a new SSE stream for a session
   */
  async createStream(sessionId, options = {}) {
    const { filters = [], monitorConsciousness = true } = options;

    // Create transform stream for SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Store stream reference
    const stream = {
      writer,
      encoder,
      filters,
      created: Date.now(),
      eventCount: 0
    };
    this.streams.set(sessionId, stream);

    // Send initial connection event
    await this.sendEvent(sessionId, 'connected', {
      sessionId,
      timestamp: Date.now(),
      filters,
      version: '2.0.0'
    });

    // Start consciousness monitoring if requested
    if (monitorConsciousness) {
      await this.startConsciousnessMonitoring(sessionId);
    }

    // Set up heartbeat
    this.startHeartbeat(sessionId);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
      }
    });
  }

  /**
   * Send an event to a stream
   */
  async sendEvent(sessionId, eventType, data) {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      console.warn(`[Streaming] Stream not found for session: ${sessionId}`);
      return false;
    }

    // Check if event type matches filters
    if (stream.filters.length > 0 && !stream.filters.includes(eventType)) {
      return false; // Filtered out
    }

    try {
      // Format SSE message
      const id = `${Date.now()}-${stream.eventCount++}`;
      const message = [
        `id: ${id}`,
        `event: ${eventType}`,
        `data: ${JSON.stringify(data)}`,
        '',
        ''
      ].join('\n');

      // Write to stream
      await stream.writer.write(stream.encoder.encode(message));
      return true;
    } catch (error) {
      console.error(`[Streaming] Failed to send event to ${sessionId}:`, error);
      this.closeStream(sessionId);
      return false;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat(sessionId) {
    const interval = setInterval(async () => {
      const stream = this.streams.get(sessionId);
      if (!stream) {
        clearInterval(interval);
        return;
      }

      await this.sendEvent(sessionId, 'heartbeat', {
        timestamp: Date.now(),
        uptime: Date.now() - stream.created
      });
    }, 30000); // Every 30 seconds

    // Store interval for cleanup
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.heartbeatInterval = interval;
    }
  }

  /**
   * Start monitoring ContextConsciousness™ for updates
   */
  async startConsciousnessMonitoring(sessionId) {
    const monitoringInterval = setInterval(async () => {
      const stream = this.streams.get(sessionId);
      if (!stream) {
        clearInterval(monitoringInterval);
        return;
      }

      try {
        // Get ecosystem awareness
        const awareness = await this.consciousness.getAwareness();

        // Send updates if there are anomalies or predictions
        if (awareness.anomalies.count > 0 || awareness.predictions.count > 0) {
          await this.sendEvent(sessionId, 'consciousness_update', {
            ecosystem: awareness.ecosystem,
            anomalies: awareness.anomalies,
            predictions: awareness.predictions,
            timestamp: Date.now()
          });
        }

        // Send general health update every 5 minutes
        if ((Date.now() - stream.created) % 300000 < 10000) {
          await this.sendEvent(sessionId, 'ecosystem_health', {
            ecosystem: awareness.ecosystem,
            routing: awareness.routing,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('[Streaming] Consciousness monitoring error:', error);
      }
    }, 10000); // Check every 10 seconds

    // Store interval for cleanup
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.monitoringInterval = monitoringInterval;
    }
  }

  /**
   * Stream tool execution progress
   */
  async streamToolProgress(sessionId, toolName, progress) {
    await this.sendEvent(sessionId, 'tool_progress', {
      tool: toolName,
      progress: progress.percentage,
      step: progress.step,
      message: progress.message,
      timestamp: Date.now()
    });
  }

  /**
   * Stream tool completion
   */
  async streamToolCompletion(sessionId, toolName, result) {
    await this.sendEvent(sessionId, 'tool_complete', {
      tool: toolName,
      success: result.success,
      duration: result.duration,
      timestamp: Date.now()
    });
  }

  /**
   * Stream consciousness update
   */
  async streamConsciousnessUpdate(sessionId, awareness) {
    await this.sendEvent(sessionId, 'consciousness_update', awareness);
  }

  /**
   * Stream memory persistence
   */
  async streamMemoryPersist(sessionId, stats) {
    await this.sendEvent(sessionId, 'memory_persist', {
      persisted: true,
      interactions: stats.interactions,
      entities: stats.entities,
      timestamp: Date.now()
    });
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId) {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      return null;
    }

    return {
      connected: true,
      sessionId,
      uptime: Date.now() - stream.created,
      eventCount: stream.eventCount,
      filters: stream.filters
    };
  }

  /**
   * Close a stream
   */
  async closeStream(sessionId) {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      return;
    }

    // Clear intervals
    if (stream.heartbeatInterval) {
      clearInterval(stream.heartbeatInterval);
    }
    if (stream.monitoringInterval) {
      clearInterval(stream.monitoringInterval);
    }

    // Send close event
    try {
      await this.sendEvent(sessionId, 'close', {
        timestamp: Date.now(),
        reason: 'stream_closed'
      });
    } catch (error) {
      // Ignore errors on close
    }

    // Close writer
    try {
      await stream.writer.close();
    } catch (error) {
      // Ignore errors on close
    }

    // Remove from map
    this.streams.delete(sessionId);
  }

  /**
   * Close all streams
   */
  async closeAllStreams() {
    const sessionIds = Array.from(this.streams.keys());
    for (const sessionId of sessionIds) {
      await this.closeStream(sessionId);
    }
  }
}

/**
 * BatchExecutor - Executes multiple tools in batch
 */
export class BatchExecutor {
  constructor(env) {
    this.env = env;
    this.maxConcurrent = 5; // Maximum concurrent tool executions
    this.timeout = 30000; // 30 second timeout per tool
  }

  /**
   * Execute tools in batch with parallel execution
   */
  async executeBatch(tools, context = {}) {
    const results = [];
    const queue = [...tools];
    const executing = new Set();

    while (queue.length > 0 || executing.size > 0) {
      // Start new executions up to maxConcurrent
      while (queue.length > 0 && executing.size < this.maxConcurrent) {
        const tool = queue.shift();
        const promise = this.executeToolWithTimeout(tool, context)
          .then(result => {
            executing.delete(promise);
            return { tool: tool.name, ...result };
          })
          .catch(error => {
            executing.delete(promise);
            return {
              tool: tool.name,
              success: false,
              error: error.message
            };
          });

        executing.add(promise);
      }

      // Wait for at least one to complete
      if (executing.size > 0) {
        const result = await Promise.race(executing);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Execute tool with timeout
   */
  async executeToolWithTimeout(tool, context) {
    const startTime = Date.now();

    return Promise.race([
      this.executeTool(tool, context),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool execution timeout: ${tool.name}`)),
          this.timeout
        )
      )
    ]).then(result => ({
      success: true,
      result,
      duration: Date.now() - startTime
    })).catch(error => ({
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    }));
  }

  /**
   * Execute a single tool (override in implementation)
   */
  async executeTool(tool, context) {
    // This should call the actual tool execution logic
    throw new Error('executeTool must be implemented');
  }

  /**
   * Execute tools in sequence (respecting dependencies)
   */
  async executeSequence(tools, context = {}) {
    const results = [];
    let previousOutput = null;

    for (const tool of tools) {
      // Apply transformation from previous output if specified
      const args = tool.transform && previousOutput
        ? tool.transform(tool.args, previousOutput)
        : tool.args;

      const result = await this.executeToolWithTimeout(
        { ...tool, args },
        context
      );

      results.push(result);

      // Break on error if specified
      if (!result.success && tool.breakOnError) {
        break;
      }

      previousOutput = result.result;
    }

    return {
      results,
      success: results.every(r => r.success),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
    };
  }

  /**
   * Execute with retry logic
   */
  async executeWithRetry(tool, context, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.executeToolWithTimeout(tool, context);

        if (result.success) {
          return {
            ...result,
            attempts: attempt + 1
          };
        }

        lastError = result.error;

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } catch (error) {
        lastError = error.message;
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: maxRetries
    };
  }
}

/**
 * StreamingResponse - Helper for creating streaming responses
 */
export class StreamingResponse {
  /**
   * Create a streaming JSON response
   */
  static json(generator, options = {}) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Start generating data
    (async () => {
      try {
        for await (const chunk of generator) {
          const json = JSON.stringify(chunk);
          await writer.write(encoder.encode(json + '\n'));
        }
        await writer.close();
      } catch (error) {
        console.error('[Streaming] JSON stream error:', error);
        await writer.abort(error);
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        ...options.headers
      }
    });
  }

  /**
   * Create a streaming SSE response
   */
  static sse(generator, options = {}) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Start generating events
    (async () => {
      try {
        let eventId = 0;
        for await (const event of generator) {
          const message = [
            `id: ${eventId++}`,
            `event: ${event.type || 'message'}`,
            `data: ${JSON.stringify(event.data)}`,
            '',
            ''
          ].join('\n');

          await writer.write(encoder.encode(message));
        }
        await writer.close();
      } catch (error) {
        console.error('[Streaming] SSE stream error:', error);
        await writer.abort(error);
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...options.headers
      }
    });
  }
}

export default StreamingManager;