/**
 * Unified MCP Tool Registry
 *
 * Single source of truth for all tool definitions across every MCP surface:
 *  - REST MCP (src/api/routes/mcp.js)         → uses MCP_TOOLS (JSON Schema)
 *  - ChatGPT Streamable HTTP (chatgpt-server)  → uses MCP_TOOL_DEFS (Zod + annotations)
 *  - OAuth JSON-RPC (oauth-provider.js)         → proxies to REST, inherits via /mcp/tools/list
 *  - stdio server (mcp-server.js)               → uses MCP_TOOLS (JSON Schema)
 *
 * @module mcp/tool-registry
 * @canonical-uri chittycanon://core/services/chittyconnect/mcp/tool-registry
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// JSON Schema → Zod converter (lightweight, covers MCP tool schemas)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a JSON Schema property definition to a Zod schema.
 * Handles the subset used by MCP tool inputSchemas.
 */
function jsonSchemaToZod(prop, required = false) {
  if (!prop) return z.unknown();

  let schema;

  if (prop.enum) {
    schema = z.enum(prop.enum);
  } else if (prop.type === "string") {
    schema = z.string();
  } else if (prop.type === "number" || prop.type === "integer") {
    schema = z.number();
    if (prop.minimum !== undefined) schema = schema.min(prop.minimum);
    if (prop.maximum !== undefined) schema = schema.max(prop.maximum);
  } else if (prop.type === "boolean") {
    schema = z.boolean();
  } else if (prop.type === "array") {
    const items = prop.items ? jsonSchemaToZod(prop.items, true) : z.unknown();
    schema = z.array(items);
  } else if (prop.type === "object") {
    if (prop.properties) {
      const shape = {};
      const reqSet = new Set(prop.required || []);
      for (const [key, val] of Object.entries(prop.properties)) {
        shape[key] = jsonSchemaToZod(val, reqSet.has(key));
      }
      schema = z.object(shape);
    } else {
      schema = z.record(z.unknown());
    }
  } else {
    schema = z.unknown();
  }

  if (prop.default !== undefined) {
    schema = schema.default(prop.default);
  }

  if (!required) {
    schema = schema.optional();
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Convert a full JSON Schema inputSchema to a Zod shape object
 * suitable for McpServer.tool() registration.
 */
function inputSchemaToZodShape(inputSchema) {
  if (!inputSchema?.properties) return {};
  const reqSet = new Set(inputSchema.required || []);
  const shape = {};
  for (const [key, prop] of Object.entries(inputSchema.properties)) {
    shape[key] = jsonSchemaToZod(prop, reqSet.has(key));
  }
  return shape;
}

// ═══════════════════════════════════════════════════════════════════════════
// Authoritative tool definitions (JSON Schema) — 52 tools across 10 domains
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @type {Array<{name: string, description: string, inputSchema: object}>}
 */
const MCP_TOOLS = [
  // ── 1. Identity (2) ─────────────────────────────────────────
  {
    name: "chitty_id_mint",
    description:
      "Mint a new ChittyID for any canonical entity type: Person (P), Location (L), Thing (T), Event (E), or Authority (A). Returns cryptographically secure DID with drand beacon randomness.",
    inputSchema: {
      type: "object",
      properties: {
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

  // ── 2. Cases (2) ────────────────────────────────────────────
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
        case_id: { type: "string", description: "ChittyID of the case" },
      },
      required: ["case_id"],
    },
  },

  // ── 3. Evidence (4) ─────────────────────────────────────────
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
  {
    name: "chitty_evidence_search",
    description:
      "AI-powered semantic search over legal evidence documents. Searches the evidence R2 bucket using vector embeddings and returns ranked document chunks with relevance scores. Use for questions about case documents, financial records, correspondence, court filings.",
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

  // ── 4. Fact Governance (5) ──────────────────────────────────
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
          description: "The atomic fact statement (single verifiable claim)",
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
        fact_id: { type: "string", description: "Fact ID to validate" },
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
          description: "Array of evidence IDs that corroborate this fact",
        },
        notes: {
          type: "string",
          description: "Validation notes or reasoning",
        },
      },
      required: ["fact_id", "validation_method"],
    },
  },
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
        reason: { type: "string", description: "Reason for the dispute" },
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

  // ── 5. Ledger (9) ──────────────────────────────────────────
  {
    name: "chitty_ledger_stats",
    description:
      "Get dashboard statistics from ChittyLedger: total cases, evidence items, facts, contradictions, and verification rates.",
    inputSchema: { type: "object", properties: {} },
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
  {
    name: "chitty_ledger_record",
    description:
      "Record a new transaction entry in ChittyLedger with full chain-of-custody tracking.",
    inputSchema: {
      type: "object",
      properties: {
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
        status: {
          type: "string",
          enum: ["pending", "confirmed", "rejected"],
          description: "Filter by status",
        },
        limit: {
          type: "number",
          description: "Max entries to return (default: 100)",
        },
      },
    },
  },
  {
    name: "chitty_ledger_verify",
    description:
      "Verify ledger integrity by checking hash chains and detecting tampering.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chitty_ledger_statistics",
    description:
      "Get ledger statistics: total entries, unique entities, unique actors, latest sequence, and date range.",
    inputSchema: { type: "object", properties: {} },
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

  // ── 6. Finance (10) ─────────────────────────────────────────
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
  {
    name: "chitty_finance_entities",
    description:
      "List financial entities with their account mappings from Mercury and other connected banks.",
    inputSchema: { type: "object", properties: {} },
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
    inputSchema: { type: "object", properties: {} },
  },

  // ── 7. Intelligence & Context (8) ──────────────────────────
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
  {
    name: "context_resolve",
    description:
      "Resolve a session to its context entity. Matches project path, platform, and support type to an existing or new context.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the project directory",
        },
        platform: {
          type: "string",
          description: "Platform identifier (e.g., claude_code, chatgpt)",
        },
        support_type: {
          type: "string",
          description: "Support type (e.g., development, operations)",
        },
        organization: { type: "string", description: "Organization name" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "context_restore",
    description:
      "Restore a previous context session for a ChittyID. Returns accumulated DNA, decisions, and project state.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: {
          type: "string",
          description: "ChittyID of the context entity",
        },
        project_slug: {
          type: "string",
          description: "Project slug to filter by",
        },
      },
      required: ["chitty_id"],
    },
  },
  {
    name: "context_commit",
    description:
      "Commit session context (metrics, decisions) to the context ledger for a ChittyID.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Current session ID" },
        chitty_id: {
          type: "string",
          description: "ChittyID of the context entity",
        },
        project_slug: { type: "string", description: "Project slug" },
        metrics: { type: "object", description: "Session metrics to commit" },
        decisions: {
          type: "array",
          description: "Decisions made during session",
        },
      },
      required: ["session_id", "chitty_id"],
    },
  },
  {
    name: "context_check",
    description:
      "Check the current state and health of a context entity by ChittyID.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: {
          type: "string",
          description: "ChittyID of the context entity",
        },
      },
      required: ["chitty_id"],
    },
  },
  {
    name: "context_checkpoint",
    description:
      "Create a named checkpoint for a context entity's state. Allows restoring to this point later.",
    inputSchema: {
      type: "object",
      properties: {
        chitty_id: {
          type: "string",
          description: "ChittyID of the context entity",
        },
        project_slug: { type: "string", description: "Project slug" },
        name: { type: "string", description: "Checkpoint name" },
        state: { type: "object", description: "State snapshot to save" },
      },
      required: ["chitty_id", "name"],
    },
  },
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

  // ── 8. Memory / MemoryCloude™ (3) ──────────────────────────
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
        query: { type: "string", description: "Semantic search query" },
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

  // ── 9. Platform (6) ─────────────────────────────────────────
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

  // ── 10. Integrations (3) ────────────────────────────────────
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
];

// ═══════════════════════════════════════════════════════════════════════════
// Derived exports
// ═══════════════════════════════════════════════════════════════════════════

/** Set of all valid tool names for fast validation */
const MCP_TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));

/** Read-only hint: tools that only read data (no side effects) */
const READ_ONLY_TOOLS = new Set([
  "chitty_id_validate",
  "chitty_case_get",
  "chitty_evidence_search",
  "chitty_evidence_retrieve",
  "chitty_ledger_stats",
  "chitty_ledger_evidence",
  "chitty_ledger_facts",
  "chitty_ledger_contradictions",
  "chitty_ledger_query",
  "chitty_ledger_verify",
  "chitty_ledger_statistics",
  "chitty_ledger_chain_of_custody",
  "chitty_finance_entities",
  "chitty_finance_balances",
  "chitty_finance_transactions",
  "chitty_finance_cash_flow",
  "chitty_finance_inter_entity",
  "chitty_finance_flow_of_funds",
  "context_restore",
  "context_check",
  "chitty_contextual_timeline",
  "chitty_contextual_topics",
  "chitty_memory_recall",
  "chitty_memory_session_summary",
  "chitty_credential_audit",
  "chitty_services_status",
  "chitty_ecosystem_awareness",
]);

/**
 * Zod-based tool definitions for McpServer.tool() registration.
 * Generated from MCP_TOOLS — no manual maintenance needed.
 *
 * @type {Array<{name: string, description: string, schema: object, annotations: {readOnlyHint: boolean}}>}
 */
const MCP_TOOL_DEFS = MCP_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  schema: inputSchemaToZodShape(tool.inputSchema),
  annotations: { readOnlyHint: READ_ONLY_TOOLS.has(tool.name) },
}));

export { MCP_TOOLS, MCP_TOOL_DEFS, MCP_TOOL_NAMES };
