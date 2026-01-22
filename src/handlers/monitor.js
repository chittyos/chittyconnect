/**
 * Monitor Queue Handler
 *
 * Processes monitoring queue messages to trigger proactive monitoring cycles.
 * This handler is invoked by Cloudflare Queues when monitoring events are queued.
 *
 * @module handlers/monitor
 */

import { ProactiveMonitor } from "../intelligence/proactive-monitor.js";
import { ContextConsciousness } from "../intelligence/context-consciousness.js";
import { PredictionEngine } from "../intelligence/prediction-engine.js";
import { CacheWarmer } from "../lib/cache-warmer.js";
import { StreamingManager } from "../intelligence/streaming-manager.js";
import { MemoryCloude } from "../intelligence/memory-cloude.js";

/**
 * Handle monitoring queue messages
 */
export async function handleMonitoringQueue(batch, env) {
  console.log(
    `[MonitorHandler] Processing batch of ${batch.messages.length} messages`,
  );

  // Initialize intelligence modules
  const consciousness = new ContextConsciousness(env);
  await consciousness.initialize();

  const memory = new MemoryCloude(env);
  await memory.initialize();

  const predictionEngine = new PredictionEngine(env, consciousness);
  const cacheWarmer = new CacheWarmer(env, predictionEngine, memory);
  const streamingManager = new StreamingManager(env);
  const monitor = new ProactiveMonitor(
    env,
    consciousness,
    predictionEngine,
    cacheWarmer,
    streamingManager,
  );

  const results = [];

  for (const message of batch.messages) {
    try {
      const { type, sessionId } = message.body;

      if (type === "monitoring:trigger") {
        const result = await monitor.runMonitoringCycle(sessionId);
        results.push(result);

        // Acknowledge message
        message.ack();
      } else {
        console.warn(`[MonitorHandler] Unknown message type: ${type}`);
        message.ack(); // Ack to prevent reprocessing
      }
    } catch (error) {
      console.error("[MonitorHandler] Error processing message:", error);
      // Retry by not acking (message will be retried)
      message.retry();
    }
  }

  console.log(`[MonitorHandler] Processed ${results.length} monitoring cycles`);
  return results;
}

export default handleMonitoringQueue;
