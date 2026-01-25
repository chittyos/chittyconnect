/**
 * CacheWarmer - Prediction-Driven Intelligent Cache Warming
 *
 * Pre-warms caches based on prediction engine forecasts and access patterns
 * from MemoryCloude to optimize performance before issues occur.
 *
 * @module lib/cache-warmer
 */

export class CacheWarmer {
  constructor(env, predictionEngine, memory) {
    this.env = env;
    this.predictionEngine = predictionEngine;
    this.memory = memory;
    this.cache = env.CREDENTIAL_CACHE;
  }

  /**
   * Analyze predictions and pre-warm relevant caches
   */
  async warmCaches(predictions) {
    const warmed = {
      credentials: 0,
      serviceData: 0,
      predictions: 0,
    };

    for (const prediction of predictions) {
      if (prediction.confidence < 0.6) continue; // Only warm high-confidence

      switch (prediction.prediction_type) {
        case "failure":
          await this.warmFailoverCaches(prediction);
          warmed.serviceData++;
          break;

        case "latency":
          await this.warmPerformanceCaches(prediction);
          warmed.serviceData++;
          break;

        case "cascade":
          await this.warmCascadeCaches(prediction);
          warmed.serviceData++;
          break;
      }
    }

    console.log(`[CacheWarmer] Warmed ${JSON.stringify(warmed)} cache entries`);
    return warmed;
  }

  /**
   * Warm failover-related caches
   */
  async warmFailoverCaches(prediction) {
    const serviceName = prediction.service_name;

    // Pre-cache fallback service information
    const fallbackKey = `failover:${serviceName}:fallback`;
    await this.cache.put(
      fallbackKey,
      JSON.stringify({
        primaryService: serviceName,
        fallbackStrategy: "degraded-mode",
        cacheHit: true,
        warmedAt: Date.now(),
      }),
      { expirationTtl: 3600 }, // 1 hour
    );

    // Pre-cache health check results
    const healthKey = `health:${serviceName}:status`;
    await this.cache.put(
      healthKey,
      JSON.stringify({
        status: "predicted-failure",
        predictionId: prediction.id,
        warmedAt: Date.now(),
      }),
      { expirationTtl: 1800 }, // 30 minutes
    );
  }

  /**
   * Warm performance-related caches
   */
  async warmPerformanceCaches(prediction) {
    const serviceName = prediction.service_name;

    // Pre-cache aggressive caching strategy
    const strategyKey = `strategy:${serviceName}:caching`;
    await this.cache.put(
      strategyKey,
      JSON.stringify({
        mode: "aggressive",
        ttl: 300, // 5 minutes
        reason: "latency-prediction",
        predictionId: prediction.id,
        warmedAt: Date.now(),
      }),
      { expirationTtl: 3600 }, // 1 hour
    );

    // Pre-cache service response templates
    const templateKey = `template:${serviceName}:response`;
    await this.cache.put(
      templateKey,
      JSON.stringify({
        cached: true,
        serviceUnavailable: false,
        warmedAt: Date.now(),
      }),
      { expirationTtl: 900 }, // 15 minutes
    );
  }

  /**
   * Warm cascade-related caches
   */
  async warmCascadeCaches(prediction) {
    const details = JSON.parse(prediction.details);
    const affectedServices = details.affected_services || [];

    // Pre-cache dependency information for all affected services
    for (const service of affectedServices) {
      const depKey = `dependencies:${service}`;
      await this.cache.put(
        depKey,
        JSON.stringify({
          hasCascadeRisk: true,
          sourceFailure: prediction.service_name,
          predictionId: prediction.id,
          warmedAt: Date.now(),
        }),
        { expirationTtl: 1800 }, // 30 minutes
      );
    }

    // Pre-cache circuit breaker states
    const circuitKey = `circuit:${prediction.service_name}`;
    await this.cache.put(
      circuitKey,
      JSON.stringify({
        state: "half-open",
        reason: "cascade-prediction",
        warmedAt: Date.now(),
      }),
      { expirationTtl: 1800 }, // 30 minutes
    );
  }

  /**
   * Analyze access patterns and pre-warm frequently accessed data
   */
  async warmFromAccessPatterns(sessionId) {
    if (!this.memory) return { warmed: 0 };

    // Get recent interactions from MemoryCloude
    const interactions = await this.memory.getSessionInteractions(
      sessionId,
      50,
    );

    const accessCounts = new Map();

    // Count entity accesses
    for (const interaction of interactions) {
      if (interaction.entities) {
        for (const entity of interaction.entities) {
          const key = `${entity.type}:${entity.id}`;
          accessCounts.set(key, (accessCounts.get(key) || 0) + 1);
        }
      }
    }

    // Warm top accessed entities
    let warmed = 0;
    const sorted = Array.from(accessCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    for (const [entityKey, count] of sorted.slice(0, 10)) {
      const cacheKey = `entity:${entityKey}:data`;
      const entityData = await this.memory.kv.get(
        `entity:${entityKey}`,
        "json",
      );

      if (entityData) {
        await this.cache.put(
          cacheKey,
          JSON.stringify({
            ...entityData,
            accessCount: count,
            warmedAt: Date.now(),
          }),
          { expirationTtl: 3600 }, // 1 hour
        );
        warmed++;
      }
    }

    console.log(`[CacheWarmer] Warmed ${warmed} entities from access patterns`);
    return { warmed };
  }

  /**
   * Smart TTL calculation based on prediction confidence
   */
  calculateOptimalTTL(prediction) {
    const baseTTL = 3600; // 1 hour base

    // Higher confidence = longer TTL
    const confidenceMultiplier = prediction.confidence;

    // Shorter time to failure = longer TTL (need cache ready)
    const urgencyMultiplier = prediction.time_to_failure
      ? Math.max(0.5, 1 - prediction.time_to_failure / 3600)
      : 1;

    const optimalTTL = baseTTL * confidenceMultiplier * urgencyMultiplier;

    return Math.floor(Math.max(300, Math.min(7200, optimalTTL))); // 5min - 2hours
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    // This would require tracking warmed entries
    // For now, return basic info
    return {
      engine: "prediction-driven",
      status: "active",
      strategies: ["failover", "performance", "cascade", "access-pattern"],
    };
  }
}

export default CacheWarmer;
