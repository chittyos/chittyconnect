/**
 * ChittyConnect MCP API Routes
 *
 * Model Context Protocol endpoints for Claude Desktop/Code integration.
 * Provides tools, resources, prompts, and session management.
 */

import { Hono } from "hono";
import { dispatchToolCall } from "../../mcp/tool-dispatcher.js";

const mcpRoutes = new Hono();

/**
 * MCP Tools Registry
 *
 * 34 tools across 15 categories:
 * - Identity (ChittyID)
 * - Cases (ChittyCases)
 * - Evidence (ChittyEvidence)
 * - Finance (ChittyFinance)
 * - Memory (MemoryCloude™)
 * - Credentials (1Password)
 * - Services (Ecosystem)
 * - Integrations (Third-party)
 * - AI Search (ChittyEvidence)
 * - Ledger (ChittyLedger)
 * - Fact Governance (ChittyLedger)
 * - Contextual (ChittyContextual)
 */
const TOOLS = [
  // Identity Tools
  {
    name: "chitty_id_mint",
    description:
      "Mint a new ChittyID for a person, trust, organization, case, or location. Returns cryptographically secure DID with drand beacon randomness.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["PERSON", "TRUST", "ORGANIZATION", "CASE", "LOCATION"],
          description: "Type of entity for ChittyID generation",
        },
        metadata: {
          type: "object",
          description: "Optional metadata (name, jurisdiction, etc.)",
          properties: {
            name: { type: "string" },
            jurisdiction: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      required: ["entity_type"],
    },
  },
  {
    name: "chitty_id_validate",
    description:
      "Validate a ChittyID format and verify it exists in the registry. Returns validation status and entity details.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: {
          type: "string",
          description: "ChittyID to validate (format: VV-G-LLL-SSSS-T-YM-C-X)",
        },
      },
      required: ["chitty_id"],
    },
  },

  // Case Management Tools
  {
    name: "chitty_case_create",
    description:
      "Create a new legal case with parties, jurisdiction, and case type. Returns case ChittyID and structure.",
    inputSchema: {
      type: "object",
      properties: {
        case_type: {
          type: "string",
          description: "Type of legal case (civil, criminal, family, etc.)",
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
                enum: [
                  "plaintiff",
                  "defendant",
                  "witness",
                  "attorney",
                  "judge",
                ],
              },
            },
          },
        },
        jurisdiction: { type: "string" },
        description: { type: "string" },
      },
      required: ["case_type", "parties"],
    },
  },
  {
    name: "chitty_case_get",
    description:
      "Retrieve full case details including parties, evidence, timeline, and status.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: {
          type: "string",
          description: "ChittyID of the case",
        },
      },
      required: ["case_id"],
    },
  },

  // Evidence Tools
  {
    name: "chitty_evidence_ingest",
    description:
      "Ingest evidence with chain of custody tracking. Supports documents, media, and digital artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string" },
        evidence_type: {
          type: "string",
          enum: ["document", "photo", "video", "audio", "digital"],
        },
        content_url: {
          type: "string",
          description: "URL to evidence content (or base64 data)",
        },
        metadata: {
          type: "object",
          properties: {
            source: { type: "string" },
            timestamp: { type: "string" },
            location: { type: "string" },
            chain_of_custody: { type: "array" },
          },
        },
      },
      required: ["case_id", "evidence_type", "content_url"],
    },
  },
  {
    name: "chitty_evidence_verify",
    description:
      "Verify evidence authenticity and integrity. Checks blockchain records and contradiction detection.",
    inputSchema: {
      type: "object",
      properties: {
        evidence_id: { type: "string" },
      },
      required: ["evidence_id"],
    },
  },

  // Finance Tools
  {
    name: "chitty_finance_connect_bank",
    description:
      "Connect a bank account for financial analysis and transaction monitoring.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: { type: "string", description: "Entity ChittyID" },
        institution: { type: "string" },
        account_type: {
          type: "string",
          enum: ["checking", "savings", "credit", "investment"],
        },
      },
      required: ["chitty_id", "institution"],
    },
  },
  {
    name: "chitty_finance_analyze",
    description:
      "Analyze financial transactions for a ChittyID. Detects patterns, anomalies, and risks.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: { type: "string" },
        time_range: {
          type: "object",
          properties: {
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
          },
        },
      },
      required: ["chitty_id"],
    },
  },

  // Intelligence Tools
  {
    name: "chitty_intelligence_analyze",
    description:
      "Deep contextual analysis using ContextConsciousness™. Extracts entities, sentiment, relationships, and legal/financial implications.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content to analyze (text, document, transcript)",
        },
        depth: {
          type: "string",
          enum: ["quick", "standard", "deep"],
          description: "Analysis depth level",
        },
        context: {
          type: "object",
          description: "Additional context (case_id, party_ids, etc.)",
        },
      },
      required: ["content"],
    },
  },

  // Memory Tools (MemoryCloude™)
  {
    name: "memory_persist_interaction",
    description:
      "Explicitly persist an interaction to MemoryCloude™ for long-term recall (90 days).",
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
              enum: ["low", "medium", "high", "critical"],
            },
          },
        },
      },
      required: ["session_id", "interaction"],
    },
  },
  {
    name: "memory_recall_context",
    description:
      "Recall relevant context from MemoryCloude™ based on semantic search.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Semantic search query",
        },
        session_id: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get_session_summary",
    description:
      "Get a summary of the current session including entities, decisions, and tool usage.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },

  // Credential Tools
  {
    name: "chitty_credential_retrieve",
    description:
      "Securely retrieve credentials from 1Password with ContextConsciousness™ validation. Risk-based access control.",
    inputSchema: {
      type: "object",
      properties: {
        credential_type: {
          type: "string",
          enum: ["service_token", "api_key", "oauth_token", "database_url"],
        },
        target: {
          type: "string",
          description: "Target service (chittyid, notion, openai, etc.)",
        },
        purpose: {
          type: "string",
          description: "Purpose of credential usage",
        },
      },
      required: ["credential_type", "target", "purpose"],
    },
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
            end: { type: "string" },
          },
        },
      },
    },
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
          description: "Optional: specific services to check",
        },
      },
    },
  },
  {
    name: "chitty_ecosystem_awareness",
    description:
      "Get real-time ContextConsciousness™ ecosystem awareness including service health, credential status, and anomaly detection.",
    inputSchema: {
      type: "object",
      properties: {
        include_credentials: { type: "boolean", default: false },
        include_anomalies: { type: "boolean", default: true },
      },
    },
  },

  // Chronicle/Audit Tools
  {
    name: "chitty_chronicle_log",
    description:
      "Create an audit log entry in ChittyChronicle for compliance and tracking.",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string" },
        entity_id: { type: "string" },
        description: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["event_type", "description"],
    },
  },

  // Third-Party Integration Tools
  {
    name: "chitty_notion_query",
    description:
      "Query Notion databases through ChittyConnect proxy with 1Password credential retrieval.",
    inputSchema: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        filter: { type: "object" },
        sorts: { type: "array" },
      },
      required: ["database_id"],
    },
  },
  {
    name: "chitty_openai_chat",
    description:
      "Chat with OpenAI through ChittyConnect proxy for AI analysis and generation.",
    inputSchema: {
      type: "object",
      properties: {
        messages: { type: "array" },
        model: { type: "string", default: "gpt-4" },
        temperature: { type: "number", default: 0.7 },
      },
      required: ["messages"],
    },
  },
  {
    name: "chitty_neon_query",
    description:
      "Execute SQL queries against Neon database through secure proxy.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" },
        params: { type: "array" },
      },
      required: ["sql"],
    },
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
        entity_ids: { type: "array" },
      },
      required: ["source_service", "target_service"],
    },
  },

  // ChittyLedger Tools
  {
    name: "chitty_ledger_stats",
    description:
      "Get dashboard statistics from ChittyLedger: total cases, evidence items, facts, contradictions, and verification rates.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "chitty_ledger_evidence",
    description:
      "Query evidence items from ChittyLedger. Filter by case ID. Returns evidence with blockchain status, trust tier, and chain of custody.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: {
          type: "string",
          description: "Optional case ID to filter evidence",
        },
      },
    },
  },
  {
    name: "chitty_ledger_facts",
    description:
      "Get atomic facts extracted from a specific evidence item. Includes confidence scores and source references.",
    inputSchema: {
      type: "object",
      properties: {
        evidence_id: {
          type: "string",
          description: "Evidence item ID to get facts for",
        },
      },
      required: ["evidence_id"],
    },
  },
  {
    name: "chitty_ledger_contradictions",
    description:
      "Get detected contradictions across evidence items. Shows conflicting facts, severity, and resolution status.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: {
          type: "string",
          description: "Optional case ID to filter contradictions",
        },
      },
    },
  },

  // Fact Governance Tools
  {
    name: "chitty_fact_mint",
    description:
      "Mint a new atomic fact from evidence. Creates a fact record in ChittyLedger with 'draft' status. Facts follow a lifecycle: draft → verified → sealed. Include the evidence source, confidence score, and category.",
    inputSchema: {
      type: "object",
      properties: {
        evidence_id: {
          type: "string",
          description: "Evidence item ID the fact is extracted from",
        },
        case_id: {
          type: "string",
          description: "Case ID the fact belongs to",
        },
        text: {
          type: "string",
          description:
            "The atomic fact statement (single verifiable claim)",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence score 0.0-1.0 (default: 0.5)",
        },
        source_reference: {
          type: "string",
          description:
            "Page number, paragraph, or location within the evidence document",
        },
        category: {
          type: "string",
          enum: [
            "financial",
            "temporal",
            "identity",
            "property",
            "legal",
            "communication",
            "other",
          ],
          description: "Fact category for classification",
        },
      },
      required: ["evidence_id", "text"],
    },
  },
  {
    name: "chitty_fact_validate",
    description:
      "Validate a draft fact against corroborating evidence. Moves the fact from 'draft' to 'verified' status if validation passes. Requires the fact ID and validation method.",
    inputSchema: {
      type: "object",
      properties: {
        fact_id: {
          type: "string",
          description: "Fact ID to validate",
        },
        validation_method: {
          type: "string",
          enum: [
            "cross_reference",
            "document_match",
            "witness_corroboration",
            "expert_review",
          ],
          description: "Method used to validate the fact",
        },
        corroborating_evidence: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of evidence IDs that corroborate this fact",
        },
        notes: {
          type: "string",
          description: "Validation notes or reasoning",
        },
      },
      required: ["fact_id", "validation_method"],
    },
  },

  // Fact Governance Hardening Tools (seal, dispute, export)
  {
    name: "chitty_fact_seal",
    description:
      "Seal a verified fact permanently, triggering async ChittyProof minting. Requires Authority entity type with INSTITUTIONAL trust level (4+).",
    inputSchema: {
      type: "object",
      properties: {
        fact_id: { type: "string", description: "Fact ID to seal" },
        actor_chitty_id: {
          type: "string",
          description: "ChittyID of the authority performing the seal",
        },
        seal_reason: {
          type: "string",
          description: "Reason for sealing the fact",
        },
      },
      required: ["fact_id", "actor_chitty_id"],
    },
  },
  {
    name: "chitty_fact_dispute",
    description:
      "Dispute a verified or sealed fact. Creates a dispute record. Requires ENHANCED trust level (2+).",
    inputSchema: {
      type: "object",
      properties: {
        fact_id: { type: "string", description: "Fact ID to dispute" },
        reason: {
          type: "string",
          description: "Reason for the dispute",
        },
        actor_chitty_id: {
          type: "string",
          description: "ChittyID of the entity filing the dispute",
        },
        challenger_chitty_id: {
          type: "string",
          description: "ChittyID of the challenger (defaults to actor)",
        },
        counter_evidence_ids: {
          type: "array",
          items: { type: "string" },
          description: "Evidence IDs that contradict this fact",
        },
      },
      required: ["fact_id", "reason", "actor_chitty_id"],
    },
  },
  {
    name: "chitty_fact_export",
    description:
      "Export a fact with its full proof bundle. JSON or PDF format.",
    inputSchema: {
      type: "object",
      properties: {
        fact_id: { type: "string", description: "Fact ID to export" },
        format: {
          type: "string",
          enum: ["json", "pdf"],
          description: "Export format",
        },
        actor_chitty_id: {
          type: "string",
          description: "ChittyID of the requesting entity",
        },
      },
      required: ["fact_id", "format", "actor_chitty_id"],
    },
  },

  // ChittyContextual Tools
  {
    name: "chitty_contextual_timeline",
    description:
      "Get unified communication timeline from ChittyContextual. Aggregates iMessage, WhatsApp, Email, DocuSign, and OpenPhone into a chronological view.",
    inputSchema: {
      type: "object",
      properties: {
        party: {
          type: "string",
          description: "Filter by party name, email, or phone number",
        },
        start_date: { type: "string", description: "Start date (ISO 8601)" },
        end_date: { type: "string", description: "End date (ISO 8601)" },
        source: {
          type: "string",
          enum: ["imessage", "whatsapp", "email", "docusign", "openphone"],
          description: "Filter by communication source",
        },
      },
    },
  },
  {
    name: "chitty_contextual_topics",
    description:
      "Get topic analysis from ChittyContextual. Returns AI-modeled topic clusters across all communication sources with entity relationships.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic or keyword to search for",
        },
      },
    },
  },

  // Evidence AI Search Tools
  {
    name: "chitty_evidence_search",
    description:
      "AI-powered semantic search over legal evidence documents (RAG). Searches the evidence R2 bucket using vector embeddings and generates an AI answer with source citations. Use for questions about case documents, financial records, correspondence, court filings.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language search query (e.g. 'purchase price of 541 W Addison', 'closing disclosure SoFi', 'court order October 2024')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "chitty_evidence_retrieve",
    description:
      "Retrieve matching evidence documents by semantic similarity (no AI generation). Returns ranked document chunks with scores. Use when you need raw document matches without an AI-generated summary.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        max_num_results: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
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
  const baseUrl = c.req.url.split("/mcp")[0];
  const authToken = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");

  const result = await dispatchToolCall(name, args, c.env, {
    baseUrl,
    authToken,
    context,
  });

  if (result.isError) {
    return c.json(result, result.content?.[0]?.text?.includes("Unknown tool") ? 400 : 500);
  }
  return c.json(result);
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
        mimeType: "application/json",
      },
      {
        uri: "chitty://memory/session/{id}",
        name: "Session Memory",
        description: "MemoryCloude™ session context and history",
        mimeType: "application/json",
      },
      {
        uri: "chitty://credentials/audit",
        name: "Credential Audit Log",
        description: "Credential access patterns and security posture",
        mimeType: "application/json",
      },
    ],
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
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/services/status`,
        {
          headers: { Authorization: c.req.header("Authorization") },
        },
      );
      content = await response.text();
    } else if (uri.startsWith("chitty://memory/session/")) {
      const sessionId = uri.split("/").pop();
      content = JSON.stringify(
        {
          session_id: sessionId,
          message:
            "Session memory retrieval from Durable Objects (placeholder)",
        },
        null,
        2,
      );
    } else if (uri === "chitty://credentials/audit") {
      content = JSON.stringify(
        {
          message: "Credential audit log (placeholder)",
        },
        null,
        2,
      );
    } else {
      return c.json(
        {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Unknown resource: ${uri}`,
            },
          ],
        },
        404,
      );
    }

    return c.json({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content,
        },
      ],
    });
  } catch (error) {
    return c.json(
      {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `Error reading resource: ${error.message}`,
          },
        ],
      },
      500,
    );
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
        timestamp: new Date().toISOString(),
      },
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
 * POST /mcp/sampling/sample
 * MCP sampling support for advanced features
 */
mcpRoutes.post("/sampling/sample", async (c) => {
  // Extract request body (unused for now but kept for future implementation)
  await c.req.json();

  try {
    // This would use Workers AI or proxy to OpenAI
    // For now, return a placeholder
    return c.json({
      content: "Sampling support via Workers AI (placeholder)",
      model: "@cf/meta/llama-3-8b-instruct",
      stopReason: "end_turn",
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { mcpRoutes };
