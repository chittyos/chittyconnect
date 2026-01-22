/**
 * ProactiveMonitor - Queue-Based Continuous Ecosystem Monitoring
 *
 * Monitors ChittyOS ecosystem health, generates predictions, and streams
 * real-time updates to connected clients. Works around Cloudflare Workers
 * timer limitations by using queue-based triggering.
 *
 * @module intelligence/proactive-monitor
 */

export class ProactiveMonitor {
  constructor(
    env,
    consciousness,
    predictionEngine,
    cacheWarmer,
    streamingManager,
  ) {
    this.env = env;
    this.consciousness = consciousness;
    this.predictionEngine = predictionEngine;
    this.cacheWarmer = cacheWarmer;
    this.streamingManager = streamingManager;
    this.db = env.DB;
  }

  /**
   * Execute monitoring cycle (called by queue handler)
   */
  async runMonitoringCycle(sessionId = null) {
    const cycleId = `cycle-${Date.now()}`;
    console.log(`[ProactiveMonitor] Starting monitoring cycle ${cycleId}`);

    const results = {
      cycleId,
      timestamp: Date.now(),
      steps: {},
    };

    try {
      // Step 1: Capture ecosystem snapshot
      results.steps.snapshot = await this.captureEcosystemSnapshot();

      // Step 2: Generate predictions
      results.steps.predictions =
        await this.predictionEngine.analyzePredictions(sessionId);

      // Step 3: Warm caches based on predictions
      if (results.steps.predictions.length > 0) {
        results.steps.cacheWarming = await this.cacheWarmer.warmCaches(
          results.steps.predictions,
        );
      }

      // Step 4: Detect anomalies
      results.steps.anomalies = await this.consciousness.detectAnomalies();

      // Step 5: Stream updates to connected clients
      if (this.streamingManager) {
        await this.streamUpdatesToClients(results);
      }

      // Step 6: Store monitoring snapshot in D1
      await this.storeMonitoringSnapshot(results);

      console.log(`[ProactiveMonitor] Cycle ${cycleId} completed successfully`);
    } catch (error) {
      console.error(
        `[ProactiveMonitor] Cycle ${cycleId} failed:`,
        error.message,
      );
      results.error = error.message;
    }

    return results;
  }

  /**
   * Capture ecosystem health snapshot
   */
  async captureEcosystemSnapshot() {
    const awareness = await this.consciousness.getAwareness();
    const snapshot = {
      timestamp: Date.now(),
      services: awareness.ecosystem.services,
      overallHealth: this.calculateOverallHealth(awareness.ecosystem.services),
      serviceCount: awareness.ecosystem.services.length,
    };

    return snapshot;
  }

  /**
   * Calculate overall ecosystem health
   */
  calculateOverallHealth(services) {
    const healthScores = {
      up: 1.0,
      degraded: 0.5,
      down: 0.0,
      unknown: 0.3,
    };

    let totalScore = 0;
    let count = 0;

    for (const service of services) {
      const status = service.health?.status || "unknown";
      totalScore += healthScores[status] || 0;
      count++;
    }

    const avgScore = count > 0 ? totalScore / count : 0;

    if (avgScore >= 0.9) return "healthy";
    if (avgScore >= 0.7) return "degraded";
    if (avgScore >= 0.4) return "critical";
    return "emergency";
  }

  /**
   * Stream updates to all connected MCP clients
   */
  async streamUpdatesToClients(results) {
    const { snapshot, predictions, anomalies } = results.steps;

    // Stream consciousness update
    if (snapshot) {
      await this.streamingManager.broadcast({
        type: "consciousness:snapshot",
        data: snapshot,
        timestamp: Date.now(),
      });
    }

    // Stream predictions
    if (predictions && predictions.length > 0) {
      const highConfidence = predictions.filter((p) => p.confidence > 0.7);

      for (const prediction of highConfidence) {
        await this.streamingManager.broadcast({
          type: "prediction:new",
          data: {
            ...prediction,
            details: JSON.parse(prediction.details),
          },
          timestamp: Date.now(),
        });
      }
    }

    // Stream anomalies
    if (anomalies && anomalies.length > 0) {
      for (const anomaly of anomalies) {
        await this.streamingManager.broadcast({
          type: "anomaly:detected",
          data: anomaly,
          timestamp: Date.now(),
        });
      }
    }

    console.log(
      `[ProactiveMonitor] Streamed updates to ${this.streamingManager.getActiveSessionCount()} clients`,
    );
  }

  /**
   * Store monitoring snapshot in D1
   */
  async storeMonitoringSnapshot(results) {
    const { snapshot } = results.steps;
    if (!snapshot || !snapshot.services) return;

    // Store snapshot for each service
    for (const service of snapshot.services) {
      try {
        await this.db
          .prepare(
            `INSERT INTO monitoring_snapshots
             (id, service_name, health_status, latency_ms, error_rate, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `snap-${service.name}-${Date.now()}`,
            service.name,
            service.health?.status || "unknown",
            service.health?.latency || null,
            service.health?.errorRate || null,
            JSON.stringify({
              endpoint: service.endpoint,
              version: service.version,
              capabilities: service.capabilities,
            }),
            Date.now(),
          )
          .run();
      } catch (error) {
        console.warn(
          `[ProactiveMonitor] Failed to store snapshot for ${service.name}:`,
          error.message,
        );
      }
    }
  }

  /**
   * Get monitoring statistics
   */
  async getStats() {
    const snapshotCount = await this.db
      .prepare(`SELECT COUNT(*) as count FROM monitoring_snapshots`)
      .first();

    const recentSnapshots = await this.db
      .prepare(
        `SELECT service_name, COUNT(*) as count
         FROM monitoring_snapshots
         WHERE created_at > ?
         GROUP BY service_name`,
      )
      .bind(Date.now() - 3600000) // Last hour
      .all();

    return {
      totalSnapshots: snapshotCount?.count || 0,
      lastHour: recentSnapshots.results || [],
      streamingClients: this.streamingManager?.getActiveSessionCount() || 0,
    };
  }

  /**
   * Trigger monitoring (for manual/external triggers)
   */
  async trigger(options = {}) {
    const { sessionId = null, immediate = true } = options;

    if (immediate) {
      // Run immediately
      return await this.runMonitoringCycle(sessionId);
    } else {
      // Queue for async processing
      await this.env.EVENT_Q.send({
        type: "monitoring:trigger",
        sessionId,
        timestamp: Date.now(),
      });

      return { queued: true, timestamp: Date.now() };
    }
  }

  /**
   * Schedule next monitoring cycle
   * Note: Cloudflare Workers don't support timers, so this returns
   * a recommendation for when to trigger next monitoring
   */
  getNextTriggerRecommendation() {
    const consciousness = this.consciousness;
    const ecosystemHealth = consciousness.services?.size || 0;

    // More frequent monitoring for degraded systems
    if (ecosystemHealth < 0.7) {
      return { interval: 60, unit: "seconds" }; // Every minute
    } else if (ecosystemHealth < 0.9) {
      return { interval: 5, unit: "minutes" }; // Every 5 minutes
    } else {
      return { interval: 15, unit: "minutes" }; // Every 15 minutes
    }
  }
}

export default ProactiveMonitor;
