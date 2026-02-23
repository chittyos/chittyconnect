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
 * 34 tools across 13 categories:
 * - Identity (ChittyID) — 2 tools
 * - Cases (ChittyCases) — 2 tools
 * - Evidence (ChittyEvidence) — 2 tools
 * - Finance Core (ChittyFinance) — 2 tools
 * - Finance Gateway (agent.chitty.cc) — 8 tools
 * - Ledger (ChittyLedger) — 5 tools
 * - Intelligence (ContextConsciousness™) — 1 tool
 * - Memory (MemoryCloude™) — 3 tools
 * - Credentials (1Password) — 2 tools
 * - Services (Ecosystem) — 2 tools
 * - Chronicle (ChittyChronicle) — 1 tool
 * - Integrations (Third-party) — 3 tools
 * - Sync (ChittySync) — 1 tool
 */
const TOOLS = [
  // Identity Tools
  {
    name: "chitty_id_mint",
    description:
      "Mint a new ChittyID for any canonical entity type: Person (P), Location (L), Thing (T), Event (E), or Authority (A). Returns cryptographically secure DID with drand beacon randomness.",
    inputSchema: {
      type: "object",
      properties: {
        // @canon: chittycanon://gov/governance#core-types
        entity_type: {
          type: "string",
          enum: ["P", "L", "T", "E", "A"],
          description:
            "Canonical entity type code. P=Person, L=Location, T=Thing, E=Event, A=Authority. See chittycanon://gov/governance#core-types",
        },
        characterization: {
          type: "string",
          description:
            "Characterization within entity type (e.g., Natural/Synthetic/Legal for Person, Digital/Physical for Thing)",
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
          description:
            "ChittyID to validate (format: VV-G-LLL-SSSS-T-YM-C-X per chittycanon://docs/tech/spec/chittyid-format)",
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

  // Finance Gateway Tools (proxied via agent.chitty.cc)
  {
    name: "chitty_finance_entities",
    description:
      "List financial entities with their account mappings from Mercury and other connected banks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "chitty_finance_balances",
    description:
      "Get current balances for a financial entity across all connected accounts.",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Entity identifier (e.g., 'nicholas', 'chittycorp')",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "chitty_finance_transactions",
    description:
      "Query transactions for an entity within a date range. Supports filtering by account and amount.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity identifier" },
        start: {
          type: "string",
          format: "date",
          description: "Start date (YYYY-MM-DD)",
        },
        end: {
          type: "string",
          format: "date",
          description: "End date (YYYY-MM-DD)",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "chitty_finance_cash_flow",
    description:
      "Generate a cash flow summary for an entity over a date range, showing inflows, outflows, and net.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity identifier" },
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
      required: ["entity"],
    },
  },
  {
    name: "chitty_finance_inter_entity",
    description:
      "Show inter-entity transfers between accounts (e.g., personal to LLC transfers).",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity identifier" },
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
    },
  },
  {
    name: "chitty_finance_detect_transfers",
    description:
      "Auto-detect potential inter-entity transfers using amount matching and date proximity.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
        threshold_days: {
          type: "number",
          description: "Max days between matching transactions (default: 3)",
        },
      },
    },
  },
  {
    name: "chitty_finance_flow_of_funds",
    description:
      "Generate a source-and-use-of-funds report across all entities for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
    },
  },
  {
    name: "chitty_finance_sync",
    description:
      "Trigger a Mercury bank sync to pull latest transactions into the finance database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // Ledger Tools (ChittyLedger)
  {
    name: "chitty_ledger_record",
    description:
      "Record a new transaction entry in ChittyLedger with full chain-of-custody tracking.",
    inputSchema: {
      type: "object",
      properties: {
        // @canon: chittycanon://gov/governance#core-types — record_type is distinct from canonical entity types P/L/T/E/A
        record_type: {
          type: "string",
          enum: ["transaction", "evidence", "custody", "audit"],
          description:
            "Ledger record classification (distinct from canonical entity types P/L/T/E/A). Maps to ChittyLedger entityType.",
        },
        entity_id: { type: "string", description: "UUID of the entity" },
        action: {
          type: "string",
          description: "Action performed (create, update, transfer, verify)",
        },
        actor: { type: "string", description: "Who performed the action" },
        actor_type: {
          type: "string",
          enum: ["user", "service", "system"],
          description: "Type of actor (default: user)",
        },
        metadata: { type: "object", description: "Additional entry metadata" },
      },
      required: ["record_type", "action"],
    },
  },
  {
    name: "chitty_ledger_query",
    description:
      "Query ledger history for a specific entity. Returns chronological chain of entries.",
    inputSchema: {
      type: "object",
      properties: {
        record_type: {
          type: "string",
          enum: ["transaction", "evidence", "custody", "audit"],
          description:
            "Ledger record classification (maps to ChittyLedger entityType)",
        },
        entity_id: { type: "string", description: "Entity ID to filter by" },
        actor: { type: "string", description: "Filter by actor" },
        status: { type: "string", enum: ["pending", "confirmed", "rejected"], description: "Filter by status" },
        limit: { type: "number", description: "Max entries to return (default: 100)" },
      },
    },
  },
  {
    name: "chitty_ledger_verify",
    description:
      "Verify ledger integrity by checking hash chains and detecting tampering.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "chitty_ledger_statistics",
    description:
      "Get ledger statistics: total entries, unique entities, unique actors, latest sequence, and date range.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "chitty_ledger_chain_of_custody",
    description:
      "Retrieve the full chain of custody for a specific entity from the ledger.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "UUID of the entity to get custody chain for",
        },
      },
      required: ["entity_id"],
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
    name: "chitty_memory_persist",
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
    name: "chitty_memory_recall",
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
    name: "chitty_memory_session_summary",
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
        return c.json(
          {
            content: [
              {
                type: "text",
                text: "Authentication required: No service token available for ChittyID",
              },
            ],
            isError: true,
          },
          401,
        );
      }
      const response = await fetch(
        "https://id.chitty.cc/api/v2/chittyid/mint",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entity: args.entity_type,
            characterization: args.characterization,
            metadata: args.metadata,
          }),
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        return c.json(
          {
            content: [
              {
                type: "text",
                text: `ChittyID error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          },
          response.status,
        );
      }
      result = await response.json();
    } else if (name === "chitty_id_validate") {
      const serviceToken = await getServiceToken(c.env, "chittyid");
      if (!serviceToken) {
        return c.json(
          {
            content: [
              {
                type: "text",
                text: "Authentication required: No service token available for ChittyID",
              },
            ],
            isError: true,
          },
          401,
        );
      }
      const response = await fetch(
        `https://id.chitty.cc/api/v2/chittyid/validate/${args.chitty_id}`,
        {
          headers: { Authorization: `Bearer ${serviceToken}` },
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        return c.json(
          {
            content: [
              {
                type: "text",
                text: `ChittyID validation error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          },
          response.status,
        );
      }
      result = await response.json();
    }

    // Case tools - delegate to local routes
    else if (name.startsWith("chitty_case_")) {
      const action = name.replace("chitty_case_", "");
      const endpoint =
        action === "create"
          ? "/api/chittycases/create"
          : `/api/chittycases/${args.case_id}`;
      const method = action === "create" ? "POST" : "GET";

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method,
        headers: {
          Authorization: c.req.header("Authorization"),
          "Content-Type": "application/json",
        },
        body: action === "create" ? JSON.stringify(args) : undefined,
      });
      result = await response.json();
    }

    // Evidence tools
    else if (name.startsWith("chitty_evidence_")) {
      const action = name.replace("chitty_evidence_", "");
      const endpoint =
        action === "ingest"
          ? "/api/chittyevidence/ingest"
          : `/api/chittyevidence/${args.evidence_id}`;

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method: action === "ingest" ? "POST" : "GET",
        headers: {
          Authorization: c.req.header("Authorization"),
          "Content-Type": "application/json",
        },
        body: action === "ingest" ? JSON.stringify(args) : undefined,
      });
      result = await response.json();
    }

    // Finance core tools (connect_bank, analyze — delegate to local routes)
    else if (
      name === "chitty_finance_connect_bank" ||
      name === "chitty_finance_analyze"
    ) {
      const action = name.replace("chitty_finance_", "");
      const endpoint = `/api/chittyfinance/${action}`;

      const response = await fetch(`${c.req.url.split("/mcp")[0]}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: c.req.header("Authorization"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // Finance gateway tools (proxied via agent.chitty.cc)
    else if (name.startsWith("chitty_finance_")) {
      const AGENT_BASE = "https://agent.chitty.cc/api/finance";
      const serviceToken = await getServiceToken(c.env, "chittyfinance");
      const headers = {
        "Content-Type": "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      };

      const toolName = name.replace("chitty_finance_", "");
      let url;
      let method = "GET";

      switch (toolName) {
        case "entities":
          url = `${AGENT_BASE}/entities`;
          break;
        case "balances":
          url = `${AGENT_BASE}/balances?entity=${encodeURIComponent(args.entity || "")}`;
          break;
        case "transactions": {
          const params = new URLSearchParams();
          if (args.entity) params.set("entity", args.entity);
          if (args.start) params.set("start", args.start);
          if (args.end) params.set("end", args.end);
          url = `${AGENT_BASE}/transactions?${params}`;
          break;
        }
        case "cash_flow": {
          const params = new URLSearchParams();
          if (args.entity) params.set("entity", args.entity);
          if (args.start) params.set("start", args.start);
          if (args.end) params.set("end", args.end);
          url = `${AGENT_BASE}/cash-flow?${params}`;
          break;
        }
        case "inter_entity": {
          const params = new URLSearchParams();
          if (args.entity) params.set("entity", args.entity);
          if (args.start) params.set("start", args.start);
          if (args.end) params.set("end", args.end);
          url = `${AGENT_BASE}/inter-entity?${params}`;
          break;
        }
        case "detect_transfers":
          url = `${AGENT_BASE}/detect-transfers`;
          method = "POST";
          break;
        case "flow_of_funds": {
          const params = new URLSearchParams();
          if (args.start) params.set("start", args.start);
          if (args.end) params.set("end", args.end);
          url = `${AGENT_BASE}/flow-of-funds?${params}`;
          break;
        }
        case "sync":
          url = `${AGENT_BASE}/sync`;
          method = "POST";
          break;
        default:
          return c.json(
            {
              content: [
                { type: "text", text: `Unknown finance tool: ${name}` },
              ],
              isError: true,
            },
            400,
          );
      }

      const response = await fetch(url, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(args) : undefined,
      });
      if (!response.ok) {
        const errorText = await response.text();
        return c.json(
          {
            content: [
              {
                type: "text",
                text: `Finance API error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          },
          response.status,
        );
      }
      result = await response.json();
    }

    // Ledger tools (ChittyLedger)
    else if (name.startsWith("chitty_ledger_")) {
      const LEDGER_BASE = "https://ledger.chitty.cc";
      const serviceToken = await getServiceToken(c.env, "chittyledger");
      const headers = {
        "Content-Type": "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      };

      const toolName = name.replace("chitty_ledger_", "");
      let url;
      let method = "GET";
      let body;

      switch (toolName) {
        case "record":
          url = `${LEDGER_BASE}/entries`;
          method = "POST";
          // ChittyLedger uses camelCase: entityType, entityId, actorType
          body = JSON.stringify({
            entityType: args.record_type,
            entityId: args.entity_id || null,
            action: args.action,
            actor: args.actor || null,
            actorType: args.actor_type || "user",
            metadata: args.metadata || null,
          });
          break;
        case "query": {
          // ChittyLedger uses camelCase query params
          const params = new URLSearchParams();
          if (args.record_type) params.set("entityType", args.record_type);
          if (args.entity_id) params.set("entityId", args.entity_id);
          if (args.actor) params.set("actor", args.actor);
          if (args.status) params.set("status", args.status);
          if (args.limit) params.set("limit", String(args.limit));
          url = `${LEDGER_BASE}/entries?${params}`;
          break;
        }
        case "verify":
          url = `${LEDGER_BASE}/verify`;
          break;
        case "statistics":
          url = `${LEDGER_BASE}/statistics`;
          break;
        case "chain_of_custody":
          url = `${LEDGER_BASE}/custody/${encodeURIComponent(args.entity_id || "")}`;
          break;
        default:
          return c.json(
            {
              content: [
                { type: "text", text: `Unknown ledger tool: ${name}` },
              ],
              isError: true,
            },
            400,
          );
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
      });
      if (!response.ok) {
        const errorText = await response.text();
        return c.json(
          {
            content: [
              {
                type: "text",
                text: `Ledger API error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          },
          response.status,
        );
      }
      result = await response.json();
    }

    // Intelligence tools
    else if (name === "chitty_intelligence_analyze") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/intelligence/analyze`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    }

    // Memory tools (MemoryCloude™)
    else if (name.startsWith("chitty_memory_")) {
      // These would integrate with session Durable Objects
      // For now, return placeholder
      result = {
        success: true,
        message: `Memory operation ${name} executed`,
        data: { session_id: context?.sessionId || "unknown" },
      };
    }

    // Credential tools
    else if (name.startsWith("chitty_credential_")) {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/credentials/${name.replace("chitty_credential_", "")}`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    }

    // Service health tools
    else if (
      name.startsWith("chitty_services_") ||
      name === "chitty_ecosystem_awareness"
    ) {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/services/status`,
        {
          headers: { Authorization: c.req.header("Authorization") },
        },
      );
      result = await response.json();
    }

    // Chronicle tools
    else if (name === "chitty_chronicle_log") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/chittychronicle/log`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    }

    // Third-party integration tools
    else if (name === "chitty_notion_query") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/thirdparty/notion/query`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    } else if (name === "chitty_openai_chat") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/thirdparty/openai/chat`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    } else if (name === "chitty_neon_query") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/thirdparty/neon/query`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    }

    // Sync tools
    else if (name === "chitty_sync_data") {
      const response = await fetch(
        `${c.req.url.split("/mcp")[0]}/api/chittysync/sync`,
        {
          method: "POST",
          headers: {
            Authorization: c.req.header("Authorization"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    } else {
      return c.json(
        {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        },
        400,
      );
    }

    // Format response for MCP
    return c.json({
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (error) {
    console.error(`[MCP] Tool execution error for ${name}:`, error);
    return c.json(
      {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${error.message}`,
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
 * List available MCP resources
 */
mcpRoutes.get("/resources/list", async (c) => {
  // NOTE: These are MCP transport resource URIs, distinct from chittycanon:// canonical identifiers.
  // chitty:// is used here as the MCP resource scheme; chittycanon:// is for governed document identifiers.
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
