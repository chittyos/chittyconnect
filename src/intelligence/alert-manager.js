/**
 * AlertManager - Intelligent Alert Routing and Notification
 *
 * Generates alerts from predictions and anomalies, manages deduplication,
 * and routes notifications to appropriate channels (MCP stream, webhook, email).
 *
 * @module intelligence/alert-manager
 */

export class AlertManager {
  constructor(env, streamingManager) {
    this.env = env;
    this.streamingManager = streamingManager;
    this.db = env.DB;
    this.alertDedupeWindow = 300000; // 5 minutes
  }

  /**
   * Generate alert from prediction
   */
  async alertFromPrediction(prediction) {
    // Check for duplicate
    if (
      await this.isDuplicate(
        "prediction",
        prediction.service_name,
        prediction.prediction_type,
      )
    ) {
      console.log("[AlertManager] Duplicate prediction alert suppressed");
      return null;
    }

    const severity = this.calculateSeverity("prediction", prediction);
    const alert = {
      id: `alert-pred-${prediction.id}`,
      alertType: "prediction",
      severity,
      sourceService: prediction.service_name,
      message: this.generatePredictionMessage(prediction),
      context: {
        predictionId: prediction.id,
        predictionType: prediction.prediction_type,
        confidence: prediction.confidence,
        timeToFailure: prediction.time_to_failure,
        details: JSON.parse(prediction.details || "{}"),
      },
      predictionId: prediction.id,
    };

    return await this.createAlert(alert);
  }

  /**
   * Generate alert from anomaly
   */
  async alertFromAnomaly(anomaly) {
    // Check for duplicate
    if (await this.isDuplicate("anomaly", anomaly.service, anomaly.type)) {
      console.log("[AlertManager] Duplicate anomaly alert suppressed");
      return null;
    }

    const severity = this.calculateSeverity("anomaly", anomaly);
    const alert = {
      id: `alert-anom-${anomaly.service}-${Date.now()}`,
      alertType: "anomaly",
      severity,
      sourceService: anomaly.service,
      message: `Anomaly detected: ${anomaly.type} in ${anomaly.service}`,
      context: {
        anomalyType: anomaly.type,
        metric: anomaly.metric,
        expected: anomaly.expected,
        actual: anomaly.actual,
        deviation: anomaly.deviation,
      },
    };

    return await this.createAlert(alert);
  }

  /**
   * Generate alert from service failure
   */
  async alertFromFailure(service, reason) {
    const alert = {
      id: `alert-fail-${service}-${Date.now()}`,
      alertType: "failure",
      severity: "critical",
      sourceService: service,
      message: `Service ${service} has failed: ${reason}`,
      context: {
        reason,
        timestamp: Date.now(),
      },
    };

    return await this.createAlert(alert);
  }

  /**
   * Generate alert from service recovery
   */
  async alertFromRecovery(service) {
    const alert = {
      id: `alert-recov-${service}-${Date.now()}`,
      alertType: "recovery",
      severity: "low",
      sourceService: service,
      message: `Service ${service} has recovered`,
      context: {
        timestamp: Date.now(),
      },
    };

    return await this.createAlert(alert);
  }

  /**
   * Create alert and route notifications
   */
  async createAlert(alert) {
    const {
      id,
      alertType,
      severity,
      sourceService,
      message,
      context = {},
      predictionId = null,
      decisionId = null,
    } = alert;

    try {
      // Store alert in D1
      await this.db
        .prepare(
          `INSERT INTO alerts
           (id, alert_type, severity, source_service, message, context, prediction_id, decision_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          alertType,
          severity,
          sourceService,
          message,
          JSON.stringify(context),
          predictionId,
          decisionId,
          Date.now(),
        )
        .run();

      console.log(`[AlertManager] Created alert ${id} (${severity})`);

      // Route notifications based on severity
      await this.routeNotifications(alert);

      // Stream to connected clients
      if (this.streamingManager) {
        await this.streamingManager.broadcast({
          type: "alert:new",
          data: alert,
          timestamp: Date.now(),
        });
      }

      return id;
    } catch (error) {
      console.error("[AlertManager] Failed to create alert:", error.message);
      throw error;
    }
  }

  /**
   * Route notifications to appropriate channels
   */
  async routeNotifications(alert) {
    const { id, severity } = alert;
    const channels = this.determineChannels(severity);

    for (const channel of channels) {
      await this.createNotification(id, channel);
    }
  }

  /**
   * Determine notification channels based on severity
   */
  determineChannels(severity) {
    const channels = [];

    // Always send to MCP stream
    channels.push({ type: "mcp_stream", recipient: "all" });

    // Critical and high severity get webhook notifications
    if (severity === "critical" || severity === "high") {
      channels.push({
        type: "webhook",
        recipient: process.env.ALERT_WEBHOOK_URL || null,
      });
    }

    // Critical gets email (if configured)
    if (severity === "critical") {
      channels.push({
        type: "email",
        recipient: process.env.ALERT_EMAIL || null,
      });
    }

    return channels.filter((c) => c.recipient);
  }

  /**
   * Create notification record
   */
  async createNotification(alertId, channel) {
    const { type, recipient } = channel;
    const notificationId = `notif-${alertId}-${type}-${Date.now()}`;

    try {
      await this.db
        .prepare(
          `INSERT INTO notifications
           (id, alert_id, channel, recipient, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          notificationId,
          alertId,
          type,
          recipient || "all",
          "pending",
          Date.now(),
        )
        .run();

      // Immediately process MCP stream notifications
      if (type === "mcp_stream") {
        await this.markNotificationSent(notificationId);
      }

      console.log(
        `[AlertManager] Created notification ${notificationId} via ${type}`,
      );
      return notificationId;
    } catch (error) {
      console.warn(
        "[AlertManager] Failed to create notification:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Mark notification as sent
   */
  async markNotificationSent(notificationId) {
    await this.db
      .prepare(
        `UPDATE notifications
         SET status = 'sent', sent_at = ?
         WHERE id = ?`,
      )
      .bind(Date.now(), notificationId)
      .run();
  }

  /**
   * Check for duplicate alert within window
   */
  async isDuplicate(alertType, service, _subtype) {
    const since = Date.now() - this.alertDedupeWindow;

    const existing = await this.db
      .prepare(
        `SELECT id FROM alerts
         WHERE alert_type = ? AND source_service = ? AND created_at > ?
         LIMIT 1`,
      )
      .bind(alertType, service, since)
      .first();

    return !!existing;
  }

  /**
   * Calculate alert severity
   */
  calculateSeverity(type, data) {
    if (type === "prediction") {
      const { confidence, time_to_failure, prediction_type } = data;

      // Critical: high confidence failure prediction with short time
      if (
        prediction_type === "failure" &&
        confidence > 0.8 &&
        time_to_failure < 600
      ) {
        return "critical";
      }

      // High: cascade or high-confidence failures
      if (
        (prediction_type === "cascade" || prediction_type === "failure") &&
        confidence > 0.7
      ) {
        return "high";
      }

      // Medium: latency or moderate confidence
      if (prediction_type === "latency" || confidence > 0.5) {
        return "medium";
      }

      return "low";
    }

    if (type === "anomaly") {
      const { deviation } = data;

      if (deviation > 3) return "critical";
      if (deviation > 2) return "high";
      if (deviation > 1) return "medium";
      return "low";
    }

    return "medium";
  }

  /**
   * Generate human-readable prediction message
   */
  generatePredictionMessage(prediction) {
    const details = JSON.parse(prediction.details || "{}");
    const confidence = Math.round(prediction.confidence * 100);

    switch (prediction.prediction_type) {
      case "failure": {
        const minutes = Math.floor((prediction.time_to_failure || 0) / 60);
        return `${prediction.service_name} predicted to fail in ${minutes} minutes (${confidence}% confidence)`;
      }

      case "latency":
        return `${prediction.service_name} experiencing latency issues (${confidence}% confidence)`;

      case "cascade": {
        const affected = details.affected_services?.length || 0;
        return `${prediction.service_name} failure may cascade to ${affected} services (${confidence}% confidence)`;
      }

      case "anomaly":
        return `Anomaly detected in ${prediction.service_name} (${confidence}% confidence)`;

      default:
        return `Prediction for ${prediction.service_name}: ${prediction.prediction_type}`;
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(options = {}) {
    const { severity = null, service = null, limit = 50 } = options;

    let query = `SELECT * FROM alerts WHERE resolved_at IS NULL`;
    const bindings = [];

    if (severity) {
      query += ` AND severity = ?`;
      bindings.push(severity);
    }

    if (service) {
      query += ` AND source_service = ?`;
      bindings.push(service);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    bindings.push(limit);

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .all();

    return (result.results || []).map((a) => this.parseAlert(a));
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId) {
    await this.db
      .prepare(
        `UPDATE alerts
         SET acknowledged_at = ?
         WHERE id = ?`,
      )
      .bind(Date.now(), alertId)
      .run();

    console.log(`[AlertManager] Alert ${alertId} acknowledged`);
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId) {
    await this.db
      .prepare(
        `UPDATE alerts
         SET resolved_at = ?
         WHERE id = ?`,
      )
      .bind(Date.now(), alertId)
      .run();

    // Stream resolution
    if (this.streamingManager) {
      await this.streamingManager.broadcast({
        type: "alert:resolved",
        data: { alertId },
        timestamp: Date.now(),
      });
    }

    console.log(`[AlertManager] Alert ${alertId} resolved`);
  }

  /**
   * Parse alert from database row
   */
  parseAlert(row) {
    return {
      id: row.id,
      alertType: row.alert_type,
      severity: row.severity,
      sourceService: row.source_service,
      message: row.message,
      context: JSON.parse(row.context || "{}"),
      predictionId: row.prediction_id,
      decisionId: row.decision_id,
      acknowledgedAt: row.acknowledged_at,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Get alert statistics
   */
  async getStats() {
    const total = await this.db
      .prepare(`SELECT COUNT(*) as count FROM alerts`)
      .first();

    const active = await this.db
      .prepare(`SELECT COUNT(*) as count FROM alerts WHERE resolved_at IS NULL`)
      .first();

    const bySeverity = await this.db
      .prepare(
        `SELECT severity, COUNT(*) as count
         FROM alerts
         WHERE resolved_at IS NULL
         GROUP BY severity`,
      )
      .all();

    return {
      totalAlerts: total?.count || 0,
      activeAlerts: active?.count || 0,
      bySeverity: bySeverity.results || [],
    };
  }
}

export default AlertManager;
