/**
 * ChittyConnect MCP Server
 * Model Context Protocol server for Claude integration
 * Provides ContextConsciousness™ - AI-intelligent spine for ChittyOS
 */

import { Hono } from "hono";

const mcp = new Hono();

/**
 * MCP Protocol Version
 */
const MCP_VERSION = "2024-11-05";

/**
 * GET /mcp/manifest
 * MCP server manifest
 */
mcp.get("/manifest", (c) => {
  return c.json({
    schema_version: MCP_VERSION,
    name: "chittyconnect",
    version: "1.0.0",
    description:
      "ChittyConnect MCP Server - ContextConsciousness™ AI spine for ChittyOS ecosystem",
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
    },
    vendor: {
      name: "ChittyOS",
      url: "https://chitty.cc",
    },
  });
});

/**
 * GET /mcp/tools/list
 * List available MCP tools
 */
mcp.get("/tools/list", (c) => {
  return c.json({
    tools: [
      {
        name: "chittyid_mint",
        description: "Mint a new ChittyID with contextual awareness",
        inputSchema: {
          type: "object",
          properties: {
            entity: {
              type: "string",
              enum: [
                "PEO",
                "PLACE",
                "PROP",
                "EVNT",
                "AUTH",
                "INFO",
                "FACT",
                "CONTEXT",
                "ACTOR",
              ],
              description: "Entity type for ChittyID",
            },
            metadata: {
              type: "object",
              description: "Contextual metadata",
            },
          },
          required: ["entity"],
        },
      },
      {
        name: "chitty_contextual_analyze",
        description:
          "Analyze text with ContextConsciousness™ - deep understanding of legal, financial, and relational context",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Text to analyze",
            },
            context: {
              type: "object",
              description: "Additional context",
            },
            analysisType: {
              type: "string",
              enum: [
                "sentiment",
                "entities",
                "legal",
                "financial",
                "comprehensive",
              ],
              default: "comprehensive",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "chitty_case_create",
        description: "Create legal case with full contextual integration",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            caseType: {
              type: "string",
              enum: ["eviction", "litigation", "resolution", "general"],
            },
            metadata: {
              type: "object",
            },
          },
          required: ["title", "caseType"],
        },
      },
      {
        name: "chitty_chronicle_log",
        description: "Log event to ChittyChronicle with timeline awareness",
        inputSchema: {
          type: "object",
          properties: {
            eventType: {
              type: "string",
            },
            entityId: {
              type: "string",
            },
            data: {
              type: "object",
            },
          },
          required: ["eventType", "data"],
        },
      },
      {
        name: "chitty_evidence_ingest",
        description: "Ingest evidence with automated extraction and analysis",
        inputSchema: {
          type: "object",
          properties: {
            fileUrl: {
              type: "string",
              description: "URL to evidence file",
            },
            caseId: {
              type: "string",
            },
            evidenceType: {
              type: "string",
            },
          },
          required: ["fileUrl", "caseId"],
        },
      },
      {
        name: "chitty_sync_trigger",
        description: "Trigger data synchronization across ChittyOS services",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
            },
            target: {
              type: "string",
            },
            mode: {
              type: "string",
              enum: ["incremental", "full"],
              default: "incremental",
            },
          },
          required: ["source", "target"],
        },
      },
      {
        name: "chitty_services_status",
        description: "Get comprehensive status of all ChittyOS services",
        inputSchema: {
          type: "object",
          properties: {
            detailed: {
              type: "boolean",
              default: false,
            },
          },
        },
      },
      {
        name: "chitty_registry_discover",
        description:
          "Discover services in ChittyRegistry with intelligent routing",
        inputSchema: {
          type: "object",
          properties: {
            serviceType: {
              type: "string",
            },
            capabilities: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
        },
      },
      {
        name: "chitty_finance_connect_bank",
        description: "Connect banking account via secure integration",
        inputSchema: {
          type: "object",
          properties: {
            provider: {
              type: "string",
              enum: ["plaid", "stripe", "direct"],
            },
            publicToken: {
              type: "string",
            },
          },
          required: ["provider"],
        },
      },
      {
        name: "notion_query",
        description: "Query Notion databases through ChittyConnect",
        inputSchema: {
          type: "object",
          properties: {
            databaseId: {
              type: "string",
            },
            filter: {
              type: "object",
            },
          },
          required: ["databaseId"],
        },
      },
      {
        name: "openai_chat",
        description: "Access OpenAI models through ChittyConnect",
        inputSchema: {
          type: "object",
          properties: {
            messages: {
              type: "array",
              items: {
                type: "object",
              },
            },
            model: {
              type: "string",
              default: "gpt-4",
            },
          },
          required: ["messages"],
        },
      },
      // Intelligence Tools
      {
        name: "consciousness_get_awareness",
        description:
          "Get ContextConsciousness™ ecosystem awareness - current health, anomalies, and predictions for all ChittyOS services",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "consciousness_capture_snapshot",
        description:
          "Capture comprehensive ecosystem snapshot with detailed service health, anomaly detection, and failure predictions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "memory_persist_interaction",
        description:
          "Persist interaction to MemoryCloude™ for 90-day semantic memory with entity extraction and decision logging",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session identifier",
            },
            interaction: {
              type: "object",
              description:
                "Interaction data including content, entities, actions, decisions",
              properties: {
                userId: { type: "string" },
                type: { type: "string" },
                content: { type: "string" },
                entities: { type: "array" },
                actions: { type: "array" },
                decisions: { type: "array" },
              },
            },
          },
          required: ["sessionId", "interaction"],
        },
      },
      {
        name: "memory_recall_context",
        description:
          "Recall relevant context from MemoryCloude™ using semantic search with vector embeddings",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session identifier",
            },
            query: {
              type: "string",
              description: "Search query for context recall",
            },
            limit: {
              type: "number",
              description: "Maximum number of contexts to return",
              default: 5,
            },
          },
          required: ["sessionId", "query"],
        },
      },
      {
        name: "memory_get_session_summary",
        description:
          "Get AI-generated summary of a session from MemoryCloude™",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Session identifier",
            },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "coordination_execute_task",
        description:
          "Execute complex task with Cognitive-Coordination™ - intelligent decomposition, parallel execution, and synthesis",
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "object",
              description: "Task specification",
              properties: {
                description: { type: "string" },
                type: { type: "string" },
                metadata: { type: "object" },
              },
              required: ["description"],
            },
            sessionId: {
              type: "string",
              description: "Session identifier for learning",
            },
          },
          required: ["task"],
        },
      },
      {
        name: "coordination_analyze_task",
        description:
          "Analyze task complexity with Cognitive-Coordination™ without executing - shows subtasks, dependencies, and risks",
        inputSchema: {
          type: "object",
          properties: {
            task: {
              type: "object",
              description: "Task to analyze",
              properties: {
                description: { type: "string" },
                type: { type: "string" },
              },
              required: ["description"],
            },
          },
          required: ["task"],
        },
      },
    ],
  });
});

/**
 * POST /mcp/tools/call
 * Execute MCP tool
 */
mcp.post("/tools/call", async (c) => {
  try {
    const { name, arguments: args } = await c.req.json();

    if (!name) {
      return c.json({ error: "Tool name is required" }, 400);
    }

    let result;

    switch (name) {
      case "chittyid_mint":
        result = await mintChittyID(args, c.env);
        break;

      case "chitty_contextual_analyze":
        result = await analyzeContext(args, c.env);
        break;

      case "chitty_case_create":
        result = await createCase(args, c.env);
        break;

      case "chitty_chronicle_log":
        result = await logChronicle(args, c.env);
        break;

      case "chitty_evidence_ingest":
        result = await ingestEvidence(args, c.env);
        break;

      case "chitty_sync_trigger":
        result = await triggerSync(args, c.env);
        break;

      case "chitty_services_status":
        result = await getServicesStatus(args, c.env);
        break;

      case "chitty_registry_discover":
        result = await discoverServices(args, c.env);
        break;

      case "chitty_finance_connect_bank":
        result = await connectBank(args, c.env);
        break;

      case "notion_query":
        result = await queryNotion(args, c.env);
        break;

      case "openai_chat":
        result = await openaiChat(args, c.env);
        break;

      // Intelligence tools
      case "consciousness_get_awareness":
        result = await getConsciousnessAwareness(c);
        break;

      case "consciousness_capture_snapshot":
        result = await captureConsciousnessSnapshot(c);
        break;

      case "memory_persist_interaction":
        result = await persistMemoryInteraction(args, c);
        break;

      case "memory_recall_context":
        result = await recallMemoryContext(args, c);
        break;

      case "memory_get_session_summary":
        result = await getMemorySessionSummary(args, c);
        break;

      case "coordination_execute_task":
        result = await executeCoordinationTask(args, c);
        break;

      case "coordination_analyze_task":
        result = await analyzeCoordinationTask(args, c);
        break;

      default:
        return c.json({ error: `Unknown tool: ${name}` }, 404);
    }

    return c.json({
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (error) {
    return c.json(
      {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      },
      500,
    );
  }
});

/**
 * GET /mcp/resources/list
 * List available resources
 */
mcp.get("/resources/list", (c) => {
  return c.json({
    resources: [
      {
        uri: "chitty://services/status",
        name: "ChittyOS Services Status",
        description: "Real-time status of all ChittyOS services",
        mimeType: "application/json",
      },
      {
        uri: "chitty://registry/services",
        name: "Service Registry",
        description: "Complete service registry with capabilities",
        mimeType: "application/json",
      },
      {
        uri: "chitty://context/awareness",
        name: "ContextConsciousness™ State",
        description: "Current contextual awareness state across ecosystem",
        mimeType: "application/json",
      },
    ],
  });
});

/**
 * GET /mcp/resources/read
 * Read resource content
 */
mcp.get("/resources/read", async (c) => {
  try {
    const uri = c.req.query("uri");

    if (!uri) {
      return c.json({ error: "uri is required" }, 400);
    }

    let content;

    if (uri === "chitty://services/status") {
      content = await getServicesStatus({}, c.env);
    } else if (uri === "chitty://registry/services") {
      content = await discoverServices({}, c.env);
    } else if (uri === "chitty://context/awareness") {
      content = await getContextAwareness(c.env);
    } else {
      return c.json({ error: `Unknown resource: ${uri}` }, 404);
    }

    return c.json({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(content, null, 2),
        },
      ],
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Tool implementations
 */

async function mintChittyID(args, env) {
  const response = await fetch("https://id.chitty.cc/v1/mint", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CHITTY_ID_TOKEN}`,
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function analyzeContext(args, env) {
  const response = await fetch("https://contextual.chitty.cc/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CHITTY_CONTEXTUAL_TOKEN}`,
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function createCase(args, env) {
  const response = await fetch("https://cases.chitty.cc/api/cases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CHITTY_CASES_TOKEN}`,
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function logChronicle(args, env) {
  const response = await fetch("https://chronicle.chitty.cc/api/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CHITTY_CHRONICLE_TOKEN}`,
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function ingestEvidence(args, env) {
  // Download file and forward to evidence service
  const fileResponse = await fetch(args.fileUrl);
  const fileBlob = await fileResponse.blob();

  const formData = new FormData();
  formData.append("file", fileBlob);
  formData.append("caseId", args.caseId);
  if (args.evidenceType) formData.append("evidenceType", args.evidenceType);

  const response = await fetch("https://evidence.chitty.cc/api/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CHITTY_EVIDENCE_TOKEN}`,
    },
    body: formData,
  });
  return await response.json();
}

async function triggerSync(args, env) {
  const response = await fetch("https://sync.chitty.cc/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CHITTY_SYNC_TOKEN}`,
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function getServicesStatus(args, env) {
  const services = [
    "id.chitty.cc",
    "auth.chitty.cc",
    "gateway.chitty.cc",
    "router.chitty.cc",
    "registry.chitty.cc",
    "cases.chitty.cc",
    "finance.chitty.cc",
    "evidence.chitty.cc",
    "sync.chitty.cc",
    "chronicle.chitty.cc",
    "contextual.chitty.cc",
  ];

  const checks = services.map(async (url) => {
    try {
      const response = await fetch(`https://${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return { url, status: response.ok ? "healthy" : "degraded" };
    } catch {
      return { url, status: "down" };
    }
  });

  const results = await Promise.all(checks);
  return { services: results };
}

async function discoverServices(args, env) {
  const response = await fetch("https://registry.chitty.cc/api/services", {
    headers: {
      Authorization: `Bearer ${env.CHITTY_REGISTRY_TOKEN}`,
    },
  });
  return await response.json();
}

async function connectBank(args, env) {
  const response = await fetch(
    "https://finance.chitty.cc/api/banking/connect",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CHITTY_FINANCE_TOKEN}`,
      },
      body: JSON.stringify(args),
    },
  );
  return await response.json();
}

async function queryNotion(args, env) {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${args.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: args.filter }),
    },
  );
  return await response.json();
}

async function openaiChat(args, env) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return await response.json();
}

async function getContextAwareness(env) {
  // ContextConsciousness™ - aggregate contextual state
  const [servicesStatus, registryServices] = await Promise.all([
    getServicesStatus({}, env),
    discoverServices({}, env),
  ]);

  return {
    timestamp: new Date().toISOString(),
    contextConsciousness: {
      servicesOnline: servicesStatus.services.filter(
        (s) => s.status === "healthy",
      ).length,
      totalServices: servicesStatus.services.length,
      registeredServices: registryServices.services?.length || 0,
      ecosystemHealth: calculateEcosystemHealth(servicesStatus.services),
    },
    services: servicesStatus,
    registry: registryServices,
  };
}

function calculateEcosystemHealth(services) {
  const healthy = services.filter((s) => s.status === "healthy").length;
  const healthPercent = (healthy / services.length) * 100;

  if (healthPercent >= 90) return "excellent";
  if (healthPercent >= 70) return "good";
  if (healthPercent >= 50) return "degraded";
  return "critical";
}

/**
 * Intelligence Tool Implementations
 */

async function getConsciousnessAwareness(c) {
  const consciousness = c.get("consciousness");

  if (!consciousness) {
    throw new Error("ContextConsciousness™ not available");
  }

  return await consciousness.getAwareness();
}

async function captureConsciousnessSnapshot(c) {
  const consciousness = c.get("consciousness");

  if (!consciousness) {
    throw new Error("ContextConsciousness™ not available");
  }

  const snapshot = await consciousness.captureEcosystemSnapshot();
  const anomalies = await consciousness.detectAnomalies(snapshot);
  const predictions = await consciousness.predictFailures(snapshot);

  return {
    snapshot,
    anomalies,
    predictions,
  };
}

async function persistMemoryInteraction(args, c) {
  const memory = c.get("memory");

  if (!memory) {
    throw new Error("MemoryCloude™ not available");
  }

  const { sessionId, interaction } = args;

  if (!sessionId || !interaction) {
    throw new Error("sessionId and interaction are required");
  }

  await memory.persistInteraction(sessionId, interaction);

  return {
    success: true,
    message: `Interaction persisted to MemoryCloude™ for session ${sessionId}`,
  };
}

async function recallMemoryContext(args, c) {
  const memory = c.get("memory");

  if (!memory) {
    throw new Error("MemoryCloude™ not available");
  }

  const { sessionId, query, limit } = args;

  if (!sessionId || !query) {
    throw new Error("sessionId and query are required");
  }

  const contexts = await memory.recallContext(sessionId, query, {
    limit: limit || 5,
    semantic: true,
  });

  return {
    sessionId,
    query,
    contexts,
    count: contexts.length,
  };
}

async function getMemorySessionSummary(args, c) {
  const memory = c.get("memory");

  if (!memory) {
    throw new Error("MemoryCloude™ not available");
  }

  const { sessionId } = args;

  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const summary = await memory.getSessionSummary(sessionId);
  const stats = await memory.getStats(sessionId);

  return {
    sessionId,
    summary,
    stats,
  };
}

async function executeCoordinationTask(args, c) {
  const coordinator = c.get("coordinator");

  if (!coordinator) {
    throw new Error("Cognitive-Coordination™ not available");
  }

  const { task, sessionId } = args;

  if (!task) {
    throw new Error("task is required");
  }

  const result = await coordinator.executeComplex(
    task,
    sessionId || "mcp-session",
  );

  return result;
}

async function analyzeCoordinationTask(args, c) {
  const coordinator = c.get("coordinator");

  if (!coordinator) {
    throw new Error("Cognitive-Coordination™ not available");
  }

  const { task } = args;

  if (!task) {
    throw new Error("task is required");
  }

  const analysis = await coordinator.cognitiveAnalysis(task);

  return analysis;
}

export { mcp };
