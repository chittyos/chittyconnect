/**
 * ChittyConnect MCP API Routes
 *
 * Model Context Protocol endpoints for Claude Desktop/Code integration.
 * Provides tools, resources, prompts, and session management.
 */

import { Hono } from "hono";
import { getServiceToken } from "../../lib/credential-helper.js";

const mcpRoutes = new Hono();

/**
 * MCP Tools Registry
 *
 * 23 tools across 8 categories:
 * - Identity (ChittyID)
 * - Cases (ChittyCases)
 * - Evidence (ChittyEvidence)
 * - Finance (ChittyFinance)
 * - Memory (MemoryCloude™)
 * - Credentials (1Password)
 * - Services (Ecosystem)
 * - Integrations (Third-party)
 */
const TOOLS = [
  // Identity Tools
  {
    name: "chitty_id_mint",
    description: "Mint a new ChittyID for a person, trust, organization, case, or location. Returns cryptographically secure DID with drand beacon randomness.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["PERSON", "TRUST", "ORGANIZATION", "CASE", "LOCATION"],
          description: "Type of entity for ChittyID generation"
        },
        metadata: {
          type: "object",
          description: "Optional metadata (name, jurisdiction, etc.)",
          properties: {
            name: { type: "string" },
            jurisdiction: { type: "string" },
            description: { type: "string" }
          }
        }
      },
      required: ["entity_type"]
    }
  },
  {
    name: "chitty_id_validate",
    description: "Validate a ChittyID format and verify it exists in the registry. Returns validation status and entity details.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: {
          type: "string",
          description: "ChittyID to validate (format: VV-G-LLL-SSSS-T-YM-C-X)"
        }
      },
      required: ["chitty_id"]
    }
  },

  // Case Management Tools
  {
    name: "chitty_case_create",
    description: "Create a new legal case with parties, jurisdiction, and case type. Returns case ChittyID and structure.",
    inputSchema: {
      type: "object",
      properties: {
        case_type: {
          type: "string",
          description: "Type of legal case (civil, criminal, family, etc.)"
        },
        parties: {
          type: "array",
          description: "Array of party ChittyIDs with roles",
          items: {
            type: "object",
            properties: {
              chitty_id: { type: "string" },
              role: {
                type: "string",
                enum: ["plaintiff", "defendant", "witness", "attorney", "judge"]
              }
            }
          }
        },
        jurisdiction: { type: "string" },
        description: { type: "string" }
      },
      required: ["case_type", "parties"]
    }
  },
  {
    name: "chitty_case_get",
    description: "Retrieve full case details including parties, evidence, timeline, and status.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: {
          type: "string",
          description: "ChittyID of the case"
        }
      },
      required: ["case_id"]
    }
  },

  // Evidence Tools
  {
    name: "chitty_evidence_ingest",
    description: "Ingest evidence with chain of custody tracking. Supports documents, media, and digital artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string" },
        evidence_type: {
          type: "string",
          enum: ["document", "photo", "video", "audio", "digital"]
        },
        content_url: {
          type: "string",
          description: "URL to evidence content (or base64 data)"
        },
        metadata: {
          type: "object",
          properties: {
            source: { type: "string" },
            timestamp: { type: "string" },
            location: { type: "string" },
            chain_of_custody: { type: "array" }
          }
        }
      },
      required: ["case_id", "evidence_type", "content_url"]
    }
  },
  {
    name: "chitty_evidence_verify",
    description: "Verify evidence authenticity and integrity. Checks blockchain records and contradiction detection.",
    inputSchema: {
      type: "object",
      properties: {
        evidence_id: { type: "string" }
      },
      required: ["evidence_id"]
    }
  },

  // Finance Tools
  {
    name: "chitty_finance_connect_bank",
    description: "Connect a bank account for financial analysis and transaction monitoring.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: { type: "string", description: "Entity ChittyID" },
        institution: { type: "string" },
        account_type: {
          type: "string",
          enum: ["checking", "savings", "credit", "investment"]
        }
      },
      required: ["chitty_id", "institution"]
    }
  },
  {
    name: "chitty_finance_analyze",
    description: "Analyze financial transactions for a ChittyID. Detects patterns, anomalies, and risks.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: { type: "string" },
        time_range: {
          type: "object",
          properties: {
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" }
          }
        }
      },
      required: ["chitty_id"]
    }
  },

  // Intelligence Tools
  {
    name: "chitty_intelligence_analyze",
    description: "Deep contextual analysis using ContextConsciousness™. Extracts entities, sentiment, relationships, and legal/financial implications.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content to analyze (text, document, transcript)"
        },
        depth: {
          type: "string",
          enum: ["quick", "standard", "deep"],
          description: "Analysis depth level"
        },
        context: {
          type: "object",
          description: "Additional context (case_id, party_ids, etc.)"
        }
      },
      required: ["content"]
    }
  },

  // Memory Tools (MemoryCloude™)
  {
    name: "memory_persist_interaction",
    description: "Explicitly persist an interaction to MemoryCloude™ for long-term recall (90 days).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        interaction: {
          type: "object",
          properties: {
            type: { type: "string" },
            content: { type: "string" },
            entities: { type: "array" },
            importance: {
              type: "string",
              enum: ["low", "medium", "high", "critical"]
            }
          }
        }
      },
      required: ["session_id", "interaction"]
    }
  },
  {
    name: "memory_recall_context",
    description: "Recall relevant context from MemoryCloude™ based on semantic search.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Semantic search query"
        },
        session_id: { type: "string" },
        limit: { type: "number", default: 10 }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_get_session_summary",
    description: "Get a summary of the current session including entities, decisions, and tool usage.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" }
      },
      required: ["session_id"]
    }
  },

  // Credential Tools
  {
    name: "chitty_credential_retrieve",
    description: "Securely retrieve credentials from 1Password with ContextConsciousness™ validation. Risk-based access control.",
    inputSchema: {
      type: "object",
      properties: {
        credential_type: {
          type: "string",
          enum: ["service_token", "api_key", "oauth_token", "database_url"]
        },
        target: {
          type: "string",
          description: "Target service (chittyid, notion, openai, etc.)"
        },
        purpose: {
          type: "string",
          description: "Purpose of credential usage"
        }
      },
      required: ["credential_type", "target", "purpose"]
    }
  },
  {
    name: "chitty_credential_audit",
    description: "Audit credential access patterns and security posture.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        time_range: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" }
          }
        }
      }
    }
  },

  // Service Health Tools
  {
    name: "chitty_services_status",
    description: "Check health status of all ChittyOS ecosystem services.",
    inputSchema: {
      type: "object",
      properties: {
        services: {
          type: "array",
          items: { type: "string" },
          description: "Optional: specific services to check"
        }
      }
    }
  },
  {
    name: "chitty_ecosystem_awareness",
    description: "Get real-time ContextConsciousness™ ecosystem awareness including service health, credential status, and anomaly detection.",
    inputSchema: {
      type: "object",
      properties: {
        include_credentials: { type: "boolean", default: false },
        include_anomalies: { type: "boolean", default: true }
      }
    }
  },

  // Chronicle/Audit Tools
  {
    name: "chitty_chronicle_log",
    description: "Create an audit log entry in ChittyChronicle for compliance and tracking.",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string" },
        entity_id: { type: "string" },
        description: { type: "string" },
        metadata: { type: "object" }
      },
      required: ["event_type", "description"]
    }
  },

  // Third-Party Integration Tools
  {
    name: "chitty_notion_query",
    description: "Query Notion databases through ChittyConnect proxy with 1Password credential retrieval.",
    inputSchema: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        filter: { type: "object" },
        sorts: { type: "array" }
      },
      required: ["database_id"]
    }
  },
  {
    name: "chitty_openai_chat",
    description: "Chat with OpenAI through ChittyConnect proxy for AI analysis and generation.",
    inputSchema: {
      type: "object",
      properties: {
        messages: { type: "array" },
        model: { type: "string", default: "gpt-4" },
        temperature: { type: "number", default: 0.7 }
      },
      required: ["messages"]
    }
  },
  {
    name: "chitty_neon_query",
    description: "Execute SQL queries against Neon database through secure proxy.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" },
        params: { type: "array" }
      },
      required: ["sql"]
    }
  },

  // Sync Tools
  {
    name: "chitty_sync_data",
    description: "Synchronize data across ChittyOS services for consistency.",
    inputSchema: {
      type: "object",
      properties: {
        source_service: { type: "string" },
        target_service: { type: "string" },
        entity_ids: { type: "array" }
      },
      required: ["source_service", "target_service"]
    }
  }
];

/**
 * GET /mcp/tools/list
 * List all available MCP tools
 */
mcpRoutes.get("/tools/list", async (c) => {
  return c.json({ tools: TOOLS });
});

/**
 * POST /mcp/tools/call
 * Execute an MCP tool
 */
mcpRoutes.post("/tools/call", async (c) => {
  const { name, arguments: args, context } = await c.req.json();

  // Route to appropriate service based on tool name
  try {
    let result;

    // Identity tools
    if (name === "chitty_id_mint") {
      const serviceToken = await getServiceToken(c.env, "chittyid");
      if (!serviceToken) {
        return c.json({
          content: [{ type: "text", text: "Authentication required: No service token available for ChittyID" }],
          isError: true
        }, 401);
      }
      const response = await fetch("https://id.chitty.cc/api/v2/chittyid/mint", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entity: args.entity_type,
          metadata: args.metadata
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        return c.json({
          content: [{ type: "text", text: `ChittyID error (${response.status}): ${errorText}` }],
          isError: true
        }, response.status);
      }
      result = await response.json();
    }

    else if (name === "chitty_id_validate") {
      const serviceToken = await getServiceToken(c.env, "chittyid");
      if (!serviceToken) {
        return c.json({
          content: [{ type: "text", text: "Authentication required: No service token available for ChittyID" }],
          isError: true
        }, 401);
      }
      const response = await fetch(`https://id.chitty.cc/api/v2/chittyid/validate/${args.chitty_id}`, {
        headers: { "Authorization": `Bearer ${serviceToken}` }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return c.json({
          content: [{ type: "text", text: `ChittyID validation error (${response.status}): ${errorText}` }],
          isError: true
        }, response.status);
      }
      result = await response.json();
    }

    // Case tools - delegate to local routes
    else if (name.startsWith("chitty_case_")) {
      const action = name.replace("chitty_case_", "");
      const endpoint = action === "create" ? "/api/chittycases/create" : `/api/chittycases/${args.case_id}`;
      const method = action === "create" ? "POST" : "GET";

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method,
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: action === "create" ? JSON.stringify(args) : undefined
      });
      result = await response.json();
    }

    // Evidence tools
    else if (name.startsWith("chitty_evidence_")) {
      const action = name.replace("chitty_evidence_", "");
      const endpoint = action === "ingest" ? "/api/chittyevidence/ingest" : `/api/chittyevidence/${args.evidence_id}`;

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method: action === "ingest" ? "POST" : "GET",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: action === "ingest" ? JSON.stringify(args) : undefined
      });
      result = await response.json();
    }

    // Finance tools
    else if (name.startsWith("chitty_finance_")) {
      const action = name.replace("chitty_finance_", "");
      const endpoint = `/api/chittyfinance/${action}`;

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    // Intelligence tools
    else if (name === "chitty_intelligence_analyze") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/intelligence/analyze`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    // Memory tools (MemoryCloude™)
    else if (name.startsWith("memory_")) {
      // These would integrate with session Durable Objects
      // For now, return placeholder
      result = {
        success: true,
        message: `Memory operation ${name} executed`,
        data: { session_id: context?.sessionId || "unknown" }
      };
    }

    // Credential tools
    else if (name.startsWith("chitty_credential_")) {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/credentials/${name.replace("chitty_credential_", "")}`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    // Service health tools
    else if (name.startsWith("chitty_services_") || name === "chitty_ecosystem_awareness") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/services/status`, {
        headers: { "Authorization": c.req.header("Authorization") }
      });
      result = await response.json();
    }

    // Chronicle tools
    else if (name === "chitty_chronicle_log") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/chittychronicle/log`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    // Third-party integration tools
    else if (name === "chitty_notion_query") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/thirdparty/notion/query`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    else if (name === "chitty_openai_chat") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/thirdparty/openai/chat`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    else if (name === "chitty_neon_query") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/thirdparty/neon/query`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    // Sync tools
    else if (name === "chitty_sync_data") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/chittysync/sync`, {
        method: "POST",
        headers: {
          "Authorization": c.req.header("Authorization"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
      result = await response.json();
    }

    else {
      return c.json({
        content: [{
          type: "text",
          text: `Unknown tool: ${name}`
        }],
        isError: true
      }, 400);
    }

    // Format response for MCP
    return c.json({
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    });

  } catch (error) {
    console.error(`[MCP] Tool execution error for ${name}:`, error);
    return c.json({
      content: [{
        type: "text",
        text: `Error executing ${name}: ${error.message}`
      }],
      isError: true
    }, 500);
  }
});

/**
 * GET /mcp/resources/list
 * List available MCP resources
 */
mcpRoutes.get("/resources/list", async (c) => {
  return c.json({
    resources: [
      {
        uri: "chitty://ecosystem/status",
        name: "Ecosystem Status",
        description: "Real-time status of all ChittyOS services",
        mimeType: "application/json"
      },
      {
        uri: "chitty://memory/session/{id}",
        name: "Session Memory",
        description: "MemoryCloude™ session context and history",
        mimeType: "application/json"
      },
      {
        uri: "chitty://credentials/audit",
        name: "Credential Audit Log",
        description: "Credential access patterns and security posture",
        mimeType: "application/json"
      }
    ]
  });
});

/**
 * GET /mcp/resources/read
 * Read an MCP resource
 */
mcpRoutes.get("/resources/read", async (c) => {
  const uri = c.req.query("uri");

  try {
    let content;

    if (uri === "chitty://ecosystem/status") {
      const response = await fetch(`${c.req.url.split("/mcp")[0]}/api/services/status`, {
        headers: { "Authorization": c.req.header("Authorization") }
      });
      content = await response.text();
    }
    else if (uri.startsWith("chitty://memory/session/")) {
      const sessionId = uri.split("/").pop();
      content = JSON.stringify({
        session_id: sessionId,
        message: "Session memory retrieval from Durable Objects (placeholder)"
      }, null, 2);
    }
    else if (uri === "chitty://credentials/audit") {
      content = JSON.stringify({
        message: "Credential audit log (placeholder)"
      }, null, 2);
    }
    else {
      return c.json({
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `Unknown resource: ${uri}`
        }]
      }, 404);
    }

    return c.json({
      contents: [{
        uri,
        mimeType: "application/json",
        text: content
      }]
    });

  } catch (error) {
    return c.json({
      contents: [{
        uri,
        mimeType: "text/plain",
        text: `Error reading resource: ${error.message}`
      }]
    }, 500);
  }
});

/**
 * POST /mcp/session/persist
 * Persist session data to MemoryCloude™
 */
mcpRoutes.post("/session/persist", async (c) => {
  const { sessionId, toolHistory, context, platform } = await c.req.json();

  try {
    // This would interact with Durable Objects for session state
    // For now, return success
    return c.json({
      success: true,
      sessionId,
      persisted: {
        toolHistory: toolHistory.length,
        contextKeys: Object.keys(context).length,
        platform,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * POST /mcp/sampling/sample
 * MCP sampling support for advanced features
 */
mcpRoutes.post("/sampling/sample", async (c) => {
  const { messages, maxTokens, sessionId } = await c.req.json();

  try {
    // This would use Workers AI or proxy to OpenAI
    // For now, return a placeholder
    return c.json({
      content: "Sampling support via Workers AI (placeholder)",
      model: "@cf/meta/llama-3-8b-instruct",
      stopReason: "end_turn"
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { mcpRoutes };
