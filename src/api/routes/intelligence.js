/**
 * Intelligence API Routes
 *
 * Provides REST API endpoints for:
 * - ContextConsciousness™
 * - MemoryCloude™
 * - Cognitive-Coordination™
 */

import { Hono } from "hono";

const intelligence = new Hono();

/**
 * ContextConsciousness™ Endpoints
 */

// GET /intelligence/consciousness/awareness
// Get current ecosystem awareness
intelligence.get("/consciousness/awareness", async (c) => {
  try {
    const consciousness = c.get("consciousness");

    if (!consciousness) {
      return c.json({ error: "ContextConsciousness™ not initialized" }, 503);
    }

    const awareness = await consciousness.getAwareness();

    return c.json({
      success: true,
      ...awareness,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// POST /intelligence/consciousness/snapshot
// Capture ecosystem snapshot
intelligence.post("/consciousness/snapshot", async (c) => {
  try {
    const consciousness = c.get("consciousness");

    if (!consciousness) {
      return c.json({ error: "ContextConsciousness™ not initialized" }, 503);
    }

    const snapshot = await consciousness.captureEcosystemSnapshot();
    const anomalies = await consciousness.detectAnomalies(snapshot);
    const predictions = await consciousness.predictFailures(snapshot);

    return c.json({
      success: true,
      snapshot,
      anomalies,
      predictions,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// POST /intelligence/consciousness/heal
// Trigger self-healing for a service
intelligence.post("/consciousness/heal", async (c) => {
  try {
    const consciousness = c.get("consciousness");

    if (!consciousness) {
      return c.json({ error: "ContextConsciousness™ not initialized" }, 503);
    }

    const { service, anomalyType } = await c.req.json();

    if (!service || !anomalyType) {
      return c.json({ error: "service and anomalyType required" }, 400);
    }

    const anomaly = {
      type: anomalyType,
      service,
    };

    await consciousness.triggerSelfHealing([anomaly]);

    return c.json({
      success: true,
      message: `Self-healing triggered for ${service}`,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

/**
 * MemoryCloude™ Endpoints
 */

// POST /intelligence/memory/persist
// Persist an interaction to memory
intelligence.post("/memory/persist", async (c) => {
  try {
    const memory = c.get("memory");

    if (!memory) {
      return c.json({ error: "MemoryCloude™ not initialized" }, 503);
    }

    const body = await c.req.json();
    const { sessionId, interaction } = body;

    if (!sessionId || !interaction) {
      return c.json({ error: "sessionId and interaction required" }, 400);
    }

    await memory.persistInteraction(sessionId, interaction);

    return c.json({
      success: true,
      message: "Interaction persisted to MemoryCloude™",
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// POST /intelligence/memory/recall
// Recall context from memory
intelligence.post("/memory/recall", async (c) => {
  try {
    const memory = c.get("memory");

    if (!memory) {
      return c.json({ error: "MemoryCloude™ not initialized" }, 503);
    }

    const body = await c.req.json();
    const { sessionId, query, limit, semantic } = body;

    if (!sessionId || !query) {
      return c.json({ error: "sessionId and query required" }, 400);
    }

    const contexts = await memory.recallContext(sessionId, query, {
      limit: limit || 5,
      semantic: semantic !== false,
    });

    return c.json({
      success: true,
      sessionId,
      query,
      contexts,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// GET /intelligence/memory/session/:sessionId
// Get session summary
intelligence.get("/memory/session/:sessionId", async (c) => {
  try {
    const memory = c.get("memory");

    if (!memory) {
      return c.json({ error: "MemoryCloude™ not initialized" }, 503);
    }

    const sessionId = c.req.param("sessionId");
    const summary = await memory.getSessionSummary(sessionId);
    const stats = await memory.getStats(sessionId);

    return c.json({
      success: true,
      sessionId,
      summary,
      stats,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// POST /intelligence/memory/summarize
// Summarize a session
intelligence.post("/memory/summarize", async (c) => {
  try {
    const memory = c.get("memory");

    if (!memory) {
      return c.json({ error: "MemoryCloude™ not initialized" }, 503);
    }

    const { sessionId } = await c.req.json();

    if (!sessionId) {
      return c.json({ error: "sessionId required" }, 400);
    }

    const summary = await memory.summarizeSession(sessionId);

    return c.json({
      success: true,
      sessionId,
      summary,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

/**
 * Cognitive-Coordination™ Endpoints
 */

// POST /intelligence/coordination/execute
// Execute a complex task with cognitive coordination
intelligence.post("/coordination/execute", async (c) => {
  try {
    const coordinator = c.get("coordinator");

    if (!coordinator) {
      return c.json({ error: "Cognitive-Coordination™ not initialized" }, 503);
    }

    const body = await c.req.json();
    const { task, sessionId } = body;

    if (!task) {
      return c.json({ error: "task required" }, 400);
    }

    const result = await coordinator.executeComplex(
      task,
      sessionId || "default",
    );

    return c.json({
      success: true,
      result,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// POST /intelligence/coordination/analyze
// Analyze task complexity
intelligence.post("/coordination/analyze", async (c) => {
  try {
    const coordinator = c.get("coordinator");

    if (!coordinator) {
      return c.json({ error: "Cognitive-Coordination™ not initialized" }, 503);
    }

    const { task } = await c.req.json();

    if (!task) {
      return c.json({ error: "task required" }, 400);
    }

    const analysis = await coordinator.cognitiveAnalysis(task);

    return c.json({
      success: true,
      analysis,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

// GET /intelligence/coordination/stats
// Get coordination statistics
intelligence.get("/coordination/stats", async (c) => {
  try {
    const coordinator = c.get("coordinator");

    if (!coordinator) {
      return c.json({ error: "Cognitive-Coordination™ not initialized" }, 503);
    }

    const stats = await coordinator.getStats();

    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

/**
 * Combined Intelligence Endpoint
 */

// GET /intelligence/status
// Get status of all intelligence modules
intelligence.get("/status", async (c) => {
  const consciousness = c.get("consciousness");
  const memory = c.get("memory");
  const coordinator = c.get("coordinator");

  return c.json({
    success: true,
    modules: {
      contextConsciousness: {
        available: !!consciousness,
        description: "Ecosystem awareness, anomaly detection, and self-healing",
      },
      memoryCloude: {
        available: !!memory,
        description: "90-day semantic memory with cross-session learning",
      },
      cognitiveCoordination: {
        available: !!coordinator,
        description: "Intelligent task decomposition and orchestration",
      },
    },
  });
});

export { intelligence };
