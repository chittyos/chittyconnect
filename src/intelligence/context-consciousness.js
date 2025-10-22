/**
 * ContextConsciousness™ - The Intelligent Spine
 *
 * Provides ecosystem awareness, anomaly detection, and predictive capabilities
 * for ChittyConnect. Monitors services, predicts failures, and self-heals.
 *
 * @module intelligence/context-consciousness
 */

export class ContextConsciousness {
  constructor(env) {
    this.env = env;
    this.services = new Map();
    this.healthHistory = [];
    this.alertThresholds = {
      latency: 1000, // ms
      errorRate: 0.05, // 5%
      availability: 0.99, // 99%
    };
  }

  /**
   * Initialize ContextConsciousness™ monitoring
   */
  async initialize() {
    console.log("[ContextConsciousness™] Initializing ecosystem awareness...");

    // Load service registry
    await this.loadServiceRegistry();

    // Start passive monitoring (no interval in Workers)
    console.log("[ContextConsciousness™] Ready for ecosystem monitoring");
  }

  /**
   * Load all services from ChittyRegistry
   */
  async loadServiceRegistry() {
    try {
      const registryUrl =
        this.env.REGISTRY_SERVICE_URL || "https://registry.chitty.cc";
      const response = await fetch(`${registryUrl}/api/services`, {
        headers: {
          "User-Agent": "ChittyConnect/1.0 (ContextConsciousness)",
        },
      });

      if (response.ok) {
        const services = await response.json();
        for (const service of services) {
          this.services.set(service.name, {
            ...service,
            health: { status: "unknown", lastCheck: null },
          });
        }
        console.log(
          `[ContextConsciousness™] Loaded ${this.services.size} services`,
        );
      }
    } catch (error) {
      console.warn(
        "[ContextConsciousness™] Registry load failed:",
        error.message,
      );
    }
  }

  /**
   * Capture current ecosystem snapshot
   */
  async captureEcosystemSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      services: [],
      overall: {
        healthy: 0,
        degraded: 0,
        down: 0,
      },
    };

    // Check health of all services
    for (const [name, service] of this.services.entries()) {
      const health = await this.checkServiceHealth(name, service);
      snapshot.services.push({ name, ...health });

      if (health.status === "healthy") snapshot.overall.healthy++;
      else if (health.status === "degraded") snapshot.overall.degraded++;
      else snapshot.overall.down++;
    }

    // Store in history
    this.healthHistory.push(snapshot);

    // Keep last 100 snapshots
    if (this.healthHistory.length > 100) {
      this.healthHistory.shift();
    }

    return snapshot;
  }

  /**
   * Check health of a specific service
   */
  async checkServiceHealth(name, service) {
    const start = Date.now();
    let status = "healthy";
    let latency = 0;

    try {
      const healthUrl = service.healthEndpoint || `${service.url}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      latency = Date.now() - start;

      if (!response.ok) {
        status = response.status >= 500 ? "down" : "degraded";
      } else if (latency > this.alertThresholds.latency) {
        status = "degraded";
      }

      return {
        status,
        latency,
        lastCheck: Date.now(),
        details: await response.json().catch(() => ({})),
      };
    } catch (error) {
      return {
        status: "down",
        latency: Date.now() - start,
        lastCheck: Date.now(),
        error: error.message,
      };
    }
  }

  /**
   * Detect anomalies in the ecosystem using AI
   */
  async detectAnomalies(snapshot) {
    const anomalies = [];

    // Check each service against thresholds
    for (const service of snapshot.services) {
      // High latency
      if (service.latency > this.alertThresholds.latency) {
        anomalies.push({
          type: "high_latency",
          service: service.name,
          value: service.latency,
          threshold: this.alertThresholds.latency,
          severity: "medium",
        });
      }

      // Service down
      if (service.status === "down") {
        anomalies.push({
          type: "service_down",
          service: service.name,
          severity: "high",
        });
      }
    }

    // Use AI for pattern-based anomaly detection if available
    if (anomalies.length === 0 && this.healthHistory.length >= 10) {
      const aiAnomalies = await this.aiDetectAnomalies(snapshot);
      anomalies.push(...aiAnomalies);
    }

    return anomalies;
  }

  /**
   * AI-powered anomaly detection
   */
  async aiDetectAnomalies(snapshot) {
    try {
      const recentHistory = this.healthHistory.slice(-10);

      const prompt = `Analyze this service health data and identify any anomalies or concerning patterns:

Current: ${JSON.stringify(snapshot)}
Recent history: ${JSON.stringify(recentHistory)}

Look for:
1. Unusual latency patterns
2. Service degradation trends
3. Cascading failures
4. Capacity issues

Respond in JSON format: {"anomalies": [{"type": "...", "description": "...", "severity": "low|medium|high"}]}`;

      const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "You are an anomaly detection expert for distributed systems.",
          },
          { role: "user", content: prompt },
        ],
      });

      const result = JSON.parse(response.response);
      return result.anomalies || [];
    } catch (error) {
      console.warn(
        "[ContextConsciousness™] AI anomaly detection failed:",
        error.message,
      );
      return [];
    }
  }

  /**
   * Predict potential failures 5-15 minutes in advance
   */
  async predictFailures(snapshot) {
    const predictions = [];

    // Need at least 10 data points for trend analysis
    if (this.healthHistory.length < 10) {
      return predictions;
    }

    // Analyze trends for each service
    for (const service of snapshot.services) {
      const serviceHistory = this.healthHistory
        .map((s) => s.services.find((svc) => svc.name === service.name))
        .filter(Boolean);

      // Check latency trend
      const latencyTrend = this.calculateTrend(
        serviceHistory.map((s) => s.latency),
      );

      if (latencyTrend.slope > 50 && latencyTrend.confidence > 0.7) {
        // Latency increasing rapidly
        const timeToFailure = this.estimateTimeToThreshold(
          service.latency,
          latencyTrend.slope,
          this.alertThresholds.latency * 2, // 2x threshold = failure
        );

        if (timeToFailure > 0 && timeToFailure < 900000) {
          // Within 15 minutes
          predictions.push({
            type: "latency_failure",
            service: service.name,
            timeToFailure: Math.round(timeToFailure / 1000), // seconds
            confidence: latencyTrend.confidence,
            currentValue: service.latency,
            threshold: this.alertThresholds.latency * 2,
          });
        }
      }
    }

    return predictions;
  }

  /**
   * Calculate linear trend from data points
   */
  calculateTrend(values) {
    if (values.length < 2) return { slope: 0, confidence: 0 };

    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);

    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * values[i], 0);
    const sumXX = indices.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Calculate R² for confidence
    const meanY = sumY / n;
    const ssTotal = values.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const ssResidual = values.reduce((sum, y, i) => {
      const predicted = slope * i + (sumY - slope * sumX) / n;
      return sum + Math.pow(y - predicted, 2);
    }, 0);
    const rSquared = 1 - ssResidual / ssTotal;

    return {
      slope,
      confidence: Math.max(0, Math.min(1, rSquared)), // Clamp to [0,1]
    };
  }

  /**
   * Estimate time until a threshold is reached
   */
  estimateTimeToThreshold(currentValue, slope, threshold) {
    if (slope <= 0) return -1; // Not increasing
    return ((threshold - currentValue) / slope) * 10000; // Assuming 10s interval
  }

  /**
   * Trigger self-healing actions for detected anomalies
   */
  async triggerSelfHealing(anomalies) {
    console.log(
      `[ContextConsciousness™] Self-healing triggered for ${anomalies.length} anomalies`,
    );

    for (const anomaly of anomalies) {
      switch (anomaly.type) {
        case "high_latency":
          await this.healHighLatency(anomaly);
          break;
        case "service_down":
          await this.healServiceDown(anomaly);
          break;
        default:
          console.log(
            `[ContextConsciousness™] No healing action for ${anomaly.type}`,
          );
      }
    }
  }

  /**
   * Heal high latency issues
   */
  async healHighLatency(anomaly) {
    // Enable caching for this service
    console.log(
      `[ContextConsciousness™] Enabling aggressive caching for ${anomaly.service}`,
    );

    // Store in KV for routing optimization
    await this.env.RATE_LIMIT.put(
      `cache:${anomaly.service}:aggressive`,
      "true",
      { expirationTtl: 300 }, // 5 minutes
    );
  }

  /**
   * Heal service down issues
   */
  async healServiceDown(anomaly) {
    // Activate failover routing
    console.log(
      `[ContextConsciousness™] Activating failover for ${anomaly.service}`,
    );

    // Find alternative service
    const alternatives = this.findAlternativeServices(anomaly.service);

    if (alternatives.length > 0) {
      await this.env.RATE_LIMIT.put(
        `failover:${anomaly.service}`,
        JSON.stringify(alternatives),
        { expirationTtl: 600 }, // 10 minutes
      );
    }
  }

  /**
   * Find alternative services that can handle requests
   */
  findAlternativeServices(serviceName) {
    const alternatives = [];

    for (const [name, service] of this.services.entries()) {
      if (
        name !== serviceName &&
        service.health?.status === "healthy" &&
        this.hasCompatibleCapabilities(serviceName, name)
      ) {
        alternatives.push(name);
      }
    }

    return alternatives;
  }

  /**
   * Check if services have compatible capabilities
   */
  hasCompatibleCapabilities(service1, service2) {
    const svc1 = this.services.get(service1);
    const svc2 = this.services.get(service2);

    if (!svc1 || !svc2) return false;

    // Simple capability matching (can be enhanced)
    return svc1.type === svc2.type;
  }

  /**
   * Optimize routing based on current ecosystem state
   */
  async optimizeRouting(snapshot) {
    // Build routing preference map based on health
    const routingMap = {};

    for (const service of snapshot.services) {
      if (service.status === "healthy") {
        routingMap[service.name] = {
          priority: 1,
          latency: service.latency,
        };
      } else if (service.status === "degraded") {
        routingMap[service.name] = {
          priority: 2,
          latency: service.latency,
        };
      }
    }

    // Store routing optimization
    await this.env.RATE_LIMIT.put(
      "routing:optimization",
      JSON.stringify(routingMap),
      { expirationTtl: 60 }, // 1 minute
    );

    return routingMap;
  }

  /**
   * Get ecosystem awareness summary
   */
  async getAwareness() {
    const snapshot = await this.captureEcosystemSnapshot();
    const anomalies = await this.detectAnomalies(snapshot);
    const predictions = await this.predictFailures(snapshot);

    return {
      timestamp: Date.now(),
      ecosystem: {
        totalServices: this.services.size,
        healthy: snapshot.overall.healthy,
        degraded: snapshot.overall.degraded,
        down: snapshot.overall.down,
      },
      anomalies: {
        count: anomalies.length,
        details: anomalies,
      },
      predictions: {
        count: predictions.length,
        details: predictions,
      },
      routing: await this.getRoutingOptimization(),
    };
  }

  /**
   * Get current routing optimization
   */
  async getRoutingOptimization() {
    try {
      const stored = await this.env.RATE_LIMIT.get("routing:optimization");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }
}

export default ContextConsciousness;
