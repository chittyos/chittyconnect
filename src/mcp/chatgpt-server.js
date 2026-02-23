/**
 * ChatGPT Developer Mode MCP Server Factory
 *
 * Creates an McpServer instance with all 31 ChittyConnect tools registered.
 * Used with WebStandardStreamableHTTPServerTransport for ChatGPT integration.
 *
 * @module mcp/chatgpt-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dispatchToolCall } from "./tool-dispatcher.js";

/**
 * Tool definitions with Zod schemas and annotations.
 * readOnlyHint: true for read-only tools, false (default) for write tools.
 */
const TOOL_DEFS = [
  // ── Identity ──────────────────────────────────────────────────────
  {
    name: "chitty_id_mint",
    description: "Mint a new ChittyID for a person, trust, organization, case, or location. Returns cryptographically secure DID with drand beacon randomness.",
    schema: {
      entity_type: z.enum(["PERSON", "TRUST", "ORGANIZATION", "CASE", "LOCATION"]).describe("Type of entity for ChittyID generation"),
      metadata: z.object({
        name: z.string().optional(),
        jurisdiction: z.string().optional(),
        description: z.string().optional(),
      }).optional().describe("Optional metadata (name, jurisdiction, etc.)"),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_id_validate",
    description: "Validate a ChittyID format and verify it exists in the registry. Returns validation status and entity details.",
    schema: {
      chitty_id: z.string().describe("ChittyID to validate (format: VV-G-LLL-SSSS-T-YM-C-X)"),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Cases ─────────────────────────────────────────────────────────
  {
    name: "chitty_case_create",
    description: "Create a new legal case with parties, jurisdiction, and case type. Returns case ChittyID and structure.",
    schema: {
      case_type: z.string().describe("Type of legal case (civil, criminal, family, etc.)"),
      parties: z.array(z.object({
        chitty_id: z.string().optional(),
        role: z.enum(["plaintiff", "defendant", "witness", "attorney", "judge"]).optional(),
      })).describe("Array of party ChittyIDs with roles"),
      jurisdiction: z.string().optional(),
      description: z.string().optional(),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_case_get",
    description: "Retrieve full case details including parties, evidence, timeline, and status.",
    schema: {
      case_id: z.string().describe("ChittyID of the case"),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Evidence ──────────────────────────────────────────────────────
  {
    name: "chitty_evidence_ingest",
    description: "Ingest evidence with chain of custody tracking. Supports documents, media, and digital artifacts.",
    schema: {
      case_id: z.string(),
      evidence_type: z.enum(["document", "photo", "video", "audio", "digital"]),
      content_url: z.string().describe("URL to evidence content (or base64 data)"),
      metadata: z.object({
        source: z.string().optional(),
        timestamp: z.string().optional(),
        location: z.string().optional(),
        chain_of_custody: z.array(z.unknown()).optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_evidence_verify",
    description: "Verify evidence authenticity and integrity. Checks blockchain records and contradiction detection.",
    schema: {
      evidence_id: z.string(),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Finance ───────────────────────────────────────────────────────
  {
    name: "chitty_finance_connect_bank",
    description: "Connect a bank account for financial analysis and transaction monitoring.",
    schema: {
      chitty_id: z.string().describe("Entity ChittyID"),
      institution: z.string(),
      account_type: z.enum(["checking", "savings", "credit", "investment"]).optional(),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_finance_analyze",
    description: "Analyze financial transactions for a ChittyID. Detects patterns, anomalies, and risks.",
    schema: {
      chitty_id: z.string(),
      time_range: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Intelligence ──────────────────────────────────────────────────
  {
    name: "chitty_intelligence_analyze",
    description: "Deep contextual analysis using ContextConsciousness. Extracts entities, sentiment, relationships, and legal/financial implications.",
    schema: {
      content: z.string().describe("Content to analyze (text, document, transcript)"),
      depth: z.enum(["quick", "standard", "deep"]).optional().describe("Analysis depth level"),
      context: z.record(z.unknown()).optional().describe("Additional context (case_id, party_ids, etc.)"),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Memory (MemoryCloude) ─────────────────────────────────────────
  {
    name: "memory_persist_interaction",
    description: "Explicitly persist an interaction to MemoryCloude for long-term recall (90 days).",
    schema: {
      session_id: z.string(),
      interaction: z.object({
        type: z.string().optional(),
        content: z.string().optional(),
        entities: z.array(z.unknown()).optional(),
        importance: z.enum(["low", "medium", "high", "critical"]).optional(),
      }),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "memory_recall_context",
    description: "Recall relevant context from MemoryCloude based on semantic search.",
    schema: {
      query: z.string().describe("Semantic search query"),
      session_id: z.string().optional(),
      limit: z.number().optional().default(10),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "memory_get_session_summary",
    description: "Get a summary of the current session including entities, decisions, and tool usage.",
    schema: {
      session_id: z.string(),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Credentials ───────────────────────────────────────────────────
  {
    name: "chitty_credential_retrieve",
    description: "Securely retrieve credentials from 1Password with ContextConsciousness validation. Risk-based access control.",
    schema: {
      credential_type: z.enum(["service_token", "api_key", "oauth_token", "database_url"]),
      target: z.string().describe("Target service (chittyid, notion, openai, etc.)"),
      purpose: z.string().describe("Purpose of credential usage"),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_credential_audit",
    description: "Audit credential access patterns and security posture.",
    schema: {
      target: z.string().optional(),
      time_range: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Service Health ────────────────────────────────────────────────
  {
    name: "chitty_services_status",
    description: "Check health status of all ChittyOS ecosystem services.",
    schema: {
      services: z.array(z.string()).optional().describe("Optional: specific services to check"),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_ecosystem_awareness",
    description: "Get real-time ContextConsciousness ecosystem awareness including service health, credential status, and anomaly detection.",
    schema: {
      include_credentials: z.boolean().optional().default(false),
      include_anomalies: z.boolean().optional().default(true),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Chronicle ─────────────────────────────────────────────────────
  {
    name: "chitty_chronicle_log",
    description: "Create an audit log entry in ChittyChronicle for compliance and tracking.",
    schema: {
      event_type: z.string(),
      entity_id: z.string().optional(),
      description: z.string(),
      metadata: z.record(z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Third-Party Integrations ──────────────────────────────────────
  {
    name: "chitty_notion_query",
    description: "Query Notion databases through ChittyConnect proxy with 1Password credential retrieval.",
    schema: {
      database_id: z.string(),
      filter: z.record(z.unknown()).optional(),
      sorts: z.array(z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_openai_chat",
    description: "Chat with OpenAI through ChittyConnect proxy for AI analysis and generation.",
    schema: {
      messages: z.array(z.unknown()),
      model: z.string().optional().default("gpt-4"),
      temperature: z.number().optional().default(0.7),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_neon_query",
    description: "Execute SQL queries against Neon database through secure proxy.",
    schema: {
      sql: z.string(),
      params: z.array(z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Sync ──────────────────────────────────────────────────────────
  {
    name: "chitty_sync_data",
    description: "Synchronize data across ChittyOS services for consistency.",
    schema: {
      source_service: z.string(),
      target_service: z.string(),
      entity_ids: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false },
  },

  // ── ChittyLedger ──────────────────────────────────────────────────
  {
    name: "chitty_ledger_stats",
    description: "Get dashboard statistics from ChittyLedger: total cases, evidence items, facts, contradictions, and verification rates.",
    schema: {},
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_ledger_evidence",
    description: "Query evidence items from ChittyLedger. Filter by case ID. Returns evidence with blockchain status, trust tier, and chain of custody.",
    schema: {
      case_id: z.string().optional().describe("Optional case ID to filter evidence"),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_ledger_facts",
    description: "Get atomic facts extracted from a specific evidence item. Includes confidence scores and source references.",
    schema: {
      evidence_id: z.string().describe("Evidence item ID to get facts for"),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_ledger_contradictions",
    description: "Get detected contradictions across evidence items. Shows conflicting facts, severity, and resolution status.",
    schema: {
      case_id: z.string().optional().describe("Optional case ID to filter contradictions"),
    },
    annotations: { readOnlyHint: true },
  },

  // ── ChittyContextual ──────────────────────────────────────────────
  {
    name: "chitty_contextual_timeline",
    description: "Get unified communication timeline from ChittyContextual. Aggregates iMessage, WhatsApp, Email, DocuSign, and OpenPhone into a chronological view.",
    schema: {
      party: z.string().optional().describe("Filter by party name, email, or phone number"),
      start_date: z.string().optional().describe("Start date (ISO 8601)"),
      end_date: z.string().optional().describe("End date (ISO 8601)"),
      source: z.enum(["imessage", "whatsapp", "email", "docusign", "openphone"]).optional().describe("Filter by communication source"),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_contextual_topics",
    description: "Get topic analysis from ChittyContextual. Returns AI-modeled topic clusters across all communication sources with entity relationships.",
    schema: {
      query: z.string().optional().describe("Topic or keyword to search for"),
    },
    annotations: { readOnlyHint: true },
  },

  // ── Evidence AI Search ────────────────────────────────────────────
  {
    name: "chitty_evidence_search",
    description: "AI-powered semantic search over legal evidence documents (RAG). Searches the evidence R2 bucket using vector embeddings and generates an AI answer with source citations. Use for questions about case documents, financial records, correspondence, court filings.",
    schema: {
      query: z.string().describe("Natural language search query (e.g. 'purchase price of 541 W Addison', 'closing disclosure SoFi', 'court order October 2024')"),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "chitty_evidence_retrieve",
    description: "Retrieve matching evidence documents by semantic similarity (no AI generation). Returns ranked document chunks with scores. Use when you need raw document matches without an AI-generated summary.",
    schema: {
      query: z.string().describe("Natural language search query"),
      max_num_results: z.number().optional().default(10).describe("Maximum number of results (default: 10)"),
    },
    annotations: { readOnlyHint: true },
  },
];

/**
 * Create a configured McpServer with all ChittyConnect tools.
 *
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] - Base URL for local API calls
 * @returns {McpServer}
 */
export function createChatGPTMcpServer(env, opts = {}) {
  const server = new McpServer(
    {
      name: "ChittyConnect",
      version: "2.0.2",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  const baseUrl = opts.baseUrl || "https://connect.chitty.cc";

  for (const def of TOOL_DEFS) {
    server.tool(
      def.name,
      def.description,
      def.schema,
      def.annotations,
      async (args) => {
        return await dispatchToolCall(def.name, args, env, { baseUrl });
      },
    );
  }

  return server;
}
