/**
 * PredictionEngine - Multi-Service Failure Prediction and Cascade Analysis
 *
 * Predicts service failures, latency issues, and cascade scenarios using
 * service dependency graphs and historical trend analysis.
 *
 * @module intelligence/prediction-engine
 */

export class PredictionEngine {
  constructor(env, consciousness) {
    this.env = env;
    this.consciousness = consciousness;
    this.db = env.DB;
    this.predictionCache = env.CREDENTIAL_CACHE; // Reuse KV for caching
  }

  /**
   * Analyze ecosystem and generate predictions
   */
  async analyzePredictions(sessionId = null) {
    const predictions = [];

    // Get current service health from ContextConsciousness
    const awareness = await this.consciousness.getAwareness();
    const services = awareness.ecosystem.services;

    // Individual service predictions
    for (const service of services) {
      const servicePredictions = await this.predictServiceFailure(service);
      predictions.push(...servicePredictions);
    }

    // Cascade failure predictions
    const cascadePredictions = await this.predictCascadeFailures(services);
    predictions.push(...cascadePredictions);

    // Store predictions in D1
    for (const prediction of predictions) {
      await this.storePrediction(prediction, sessionId);
    }

    // Cache high-confidence predictions
    await this.cacheHighConfidencePredictions(predictions);

    return predictions;
  }

  /**
   * Predict individual service failure
   */
  async predictServiceFailure(service) {
    const predictions = [];
    const now = Date.now();

    // Failure prediction based on health status
    if (service.health?.status === 'degraded') {
      const confidence = 0.65 + (service.health.errorRate || 0) * 0.3;
      const timeToFailure = this.estimateTimeToFailure(service);

      predictions.push({
        id: `pred-${service.name}-failure-${now}`,
        service_name: service.name,
        prediction_type: 'failure',
        confidence: Math.min(confidence, 0.95),
        time_to_failure: timeToFailure,
        details: JSON.stringify({
          current_status: service.health.status,
          error_rate: service.health.errorRate,
          latency: service.health.latency,
          trend: 'declining',
          reasoning: 'Service health degraded with increasing error rate',
        }),
        expires_at: now + (24 * 3600 * 1000), // 24 hours
      });
    }

    // Latency prediction based on trend
    if (service.health?.latency > 500) {
      const latencyTrend = await this.analyzeLatencyTrend(service.name);

      if (latencyTrend.slope > 0) {
        predictions.push({
          id: `pred-${service.name}-latency-${now}`,
          service_name: service.name,
          prediction_type: 'latency',
          confidence: latencyTrend.confidence,
          time_to_failure: null,
          details: JSON.stringify({
            current_latency: service.health.latency,
            predicted_latency: latencyTrend.predicted,
            slope: latencyTrend.slope,
            reasoning: 'Latency trending upward, performance degradation likely',
          }),
          expires_at: now + (6 * 3600 * 1000), // 6 hours
        });
      }
    }

    // Anomaly prediction
    const anomalies = await this.consciousness.detectAnomalies();
    const serviceAnomalies = anomalies.filter(a => a.service === service.name);

    if (serviceAnomalies.length > 0) {
      predictions.push({
        id: `pred-${service.name}-anomaly-${now}`,
        service_name: service.name,
        prediction_type: 'anomaly',
        confidence: 0.7,
        time_to_failure: null,
        details: JSON.stringify({
          anomaly_count: serviceAnomalies.length,
          anomalies: serviceAnomalies.map(a => a.type),
          reasoning: 'Multiple anomalies detected, potential incident',
        }),
        expires_at: now + (2 * 3600 * 1000), // 2 hours
      });
    }

    return predictions;
  }

  /**
   * Predict cascade failures across service dependencies
   */
  async predictCascadeFailures(services) {
    const predictions = [];
    const now = Date.now();

    // Get service dependency graph from D1
    const dependencies = await this.getServiceDependencies();

    // Build dependency map
    const depMap = new Map();
    for (const dep of dependencies.results) {
      if (!depMap.has(dep.service_name)) {
        depMap.set(dep.service_name, []);
      }
      depMap.get(dep.service_name).push({
        service: dep.depends_on,
        type: dep.dependency_type,
        weight: dep.weight,
      });
    }

    // Check each failing/degraded service for cascade potential
    for (const service of services) {
      if (service.health?.status === 'down' || service.health?.status === 'degraded') {
        // Find dependent services
        const affectedServices = this.findDependentServices(service.name, depMap);

        if (affectedServices.length > 0) {
          const cascadeConfidence = this.calculateCascadeConfidence(
            service,
            affectedServices,
            depMap
          );

          predictions.push({
            id: `pred-cascade-${service.name}-${now}`,
            service_name: service.name,
            prediction_type: 'cascade',
            confidence: cascadeConfidence,
            time_to_failure: 300, // 5 minutes for cascade propagation
            details: JSON.stringify({
              failing_service: service.name,
              affected_services: affectedServices,
              cascade_depth: this.calculateCascadeDepth(service.name, depMap),
              reasoning: `${service.name} failure may cascade to ${affectedServices.length} dependent services`,
            }),
            expires_at: now + (1 * 3600 * 1000), // 1 hour
          });
        }
      }
    }

    return predictions;
  }

  /**
   * Estimate time to failure based on trend analysis
   */
  estimateTimeToFailure(service) {
    const errorRate = service.health?.errorRate || 0;
    const latency = service.health?.latency || 0;

    // Simple heuristic: higher error rate = faster failure
    if (errorRate > 0.5) return 300; // 5 minutes
    if (errorRate > 0.3) return 900; // 15 minutes
    if (errorRate > 0.1) return 1800; // 30 minutes
    if (latency > 2000) return 1800; // 30 minutes for high latency

    return 3600; // 1 hour default
  }

  /**
   * Analyze latency trend for a service
   */
  async analyzeLatencyTrend(serviceName) {
    // Get recent monitoring snapshots from D1
    const snapshots = await this.db
      .prepare(
        `SELECT latency_ms, created_at
         FROM monitoring_snapshots
         WHERE service_name = ?
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .bind(serviceName)
      .all();

    if (!snapshots.results || snapshots.results.length < 5) {
      return { slope: 0, confidence: 0, predicted: 0 };
    }

    // Calculate linear regression
    const points = snapshots.results.map((s, i) => ({
      x: i,
      y: s.latency_ms,
    }));

    const { slope, confidence } = this.linearRegression(points);
    const predicted = points[points.length - 1].y + slope * 5; // Predict 5 steps ahead

    return { slope, confidence, predicted };
  } //

  /**
   * Linear regression for trend analysis
   */
  linearRegression(points) {
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R² (confidence)
    const yMean = sumY / n;
    const ssTotal = points.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
    const ssResidual = points.reduce((sum, p) => {
      const predicted = slope * p.x + intercept;
      return sum + Math.pow(p.y - predicted, 2);
    }, 0);

    let rSquared;
    if (ssTotal === 0) {
      // No variance in y values, so rSquared is undefined. Set to 0 for no confidence.
      rSquared = 0;
    } else {
      rSquared = 1 - ssResidual / ssTotal;
    }
    const confidence = Math.max(0, Math.min(1, rSquared));

    return { slope, intercept, confidence };
  }

  /**
   * Get service dependencies from D1
   */
  async getServiceDependencies() {
    return await this.db
      .prepare(
        `SELECT service_name, depends_on, dependency_type, weight
         FROM service_dependencies`
      )
      .all();
  }

  /**
   * Find all services that depend on the given service
   */
  findDependentServices(serviceName, depMap) {
    const dependent = [];

    for (const [service, deps] of depMap) {
      const hasDependency = deps.some(d => d.service === serviceName);
      if (hasDependency) {
        dependent.push(service);
      }
    }

    return dependent;
  }

  /**
   * Calculate cascade failure confidence
   */
  calculateCascadeConfidence(failingService, affectedServices, depMap) {
    let totalWeight = 0;
    let criticalCount = 0;

    if (affectedServices.length === 0) {
      // No affected services means no cascade confidence
      return 0;
    }

    for (const affectedService of affectedServices) {
      const deps = depMap.get(affectedService) || [];
      const dep = deps.find(d => d.service === failingService.name);

      if (dep) {
        totalWeight += dep.weight;
        if (dep.type === 'critical') criticalCount++;
      }
    }

    // Base confidence on number of critical dependencies
    const baseConfidence = criticalCount / affectedServices.length;
    // Boost by average weight
    const weightBoost = (totalWeight / affectedServices.length) * 0.3;

    return Math.min(0.95, baseConfidence + weightBoost);
  }

  /**
   * Calculate cascade depth (how many levels deep)
   */
  calculateCascadeDepth(serviceName, depMap, visited = new Set()) {
    if (visited.has(serviceName)) return 0;
    visited.add(serviceName);

    const dependent = this.findDependentServices(serviceName, depMap);
    if (dependent.length === 0) return 1;

    const depths = dependent.map(s =>
      this.calculateCascadeDepth(s, depMap, visited)
    );

    return 1 + Math.max(...depths);
  }

  /**
   * Store prediction in D1
   */
  async storePrediction(prediction, sessionId) {
    try {
      await this.db
        .prepare(
          `INSERT INTO predictions (id, service_name, prediction_type, confidence, time_to_failure, details, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          prediction.id,
          prediction.service_name,
          prediction.prediction_type,
          prediction.confidence,
          prediction.time_to_failure,
          prediction.details,
          Date.now(),
          prediction.expires_at
        )
        .run();

      console.log(`[PredictionEngine] Stored prediction ${prediction.id}`);
    } catch (error) {
      console.warn('[PredictionEngine] Failed to store prediction:', error.message);
    }
  }

  /**
   * Cache high-confidence predictions in KV
   */
  async cacheHighConfidencePredictions(predictions) {
    const highConfidence = predictions.filter(p => p.confidence > 0.7);

    for (const prediction of highConfidence) {
      const cacheKey = `prediction:${prediction.service_name}:${prediction.prediction_type}`;
      const ttl = Math.floor((prediction.expires_at - Date.now()) / 1000);

      await this.predictionCache.put(
        cacheKey,
        JSON.stringify(prediction),
        { expirationTtl: ttl }
      );
    }

    console.log(`[PredictionEngine] Cached ${highConfidence.length} high-confidence predictions`);
  }

  /**
   * Get cached prediction
   */
  async getCachedPrediction(serviceName, predictionType) {
    const cacheKey = `prediction:${serviceName}:${predictionType}`;
    const cached = await this.predictionCache.get(cacheKey);

    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Get active predictions from D1
   */
  async getActivePredictions(serviceName = null) {
    const now = Date.now();
    let query;

    if (serviceName) {
      query = this.db.prepare(
        `SELECT * FROM predictions
         WHERE service_name = ? AND resolved_at IS NULL AND expires_at > ?
         ORDER BY confidence DESC, created_at DESC`
      ).bind(serviceName, now);
    } else {
      query = this.db.prepare(
        `SELECT * FROM predictions
         WHERE resolved_at IS NULL AND expires_at > ?
         ORDER BY confidence DESC, created_at DESC
         LIMIT 50`
      ).bind(now);
    }

    const result = await query.all();
    return result.results || [];
  }

  /**
   * Acknowledge prediction
   */
  async acknowledgePrediction(predictionId) {
    await this.db
      .prepare(
        `UPDATE predictions
         SET acknowledged_at = ?
         WHERE id = ?`
      )
      .bind(Date.now(), predictionId)
      .run();
  }

  /**
   * Resolve prediction
   */
  async resolvePrediction(predictionId) {
    await this.db
      .prepare(
        `UPDATE predictions
         SET resolved_at = ?
         WHERE id = ?`
      )
      .bind(Date.now(), predictionId)
      .run();
  }

  /**
   * Get prediction statistics
   */
  async getStats() {
    const total = await this.db
      .prepare(`SELECT COUNT(*) as count FROM predictions`)
      .first();

    const active = await this.db
      .prepare(`SELECT COUNT(*) as count FROM predictions WHERE resolved_at IS NULL`)
      .first();

    const byType = await this.db
      .prepare(
        `SELECT prediction_type, COUNT(*) as count, AVG(confidence) as avg_confidence
         FROM predictions
         WHERE resolved_at IS NULL
         GROUP BY prediction_type`
      )
      .all();

    return {
      total: total.count,
      active: active.count,
      byType: byType.results || [],
    };
  }
}

export default PredictionEngine;
