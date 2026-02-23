/**
 * ChatGPT Developer Mode MCP Server Factory
 *
 * Creates an McpServer instance with all 34 ChittyConnect tools registered.
 * Used with WebStandardStreamableHTTPServerTransport for ChatGPT integration.
 *
 * @module mcp/chatgpt-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dispatchToolCall } from "./tool-dispatcher.js";

/**
 * Tool definitions with Zod schemas and annotations.
 * readOnlyHint: true for read-only tools, false for write tools.
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

  // ── Fact Governance ─────────────────────────────────────────────
  {
    name: "chitty_fact_mint",
    description: "Mint a new atomic fact from evidence. Creates a fact record in ChittyLedger with 'draft' status. Facts follow a lifecycle: draft → verified → sealed. Include the evidence source, confidence score, and category.",
    schema: {
      evidence_id: z.string().describe("Evidence item ID the fact is extracted from"),
      case_id: z.string().optional().describe("Case ID the fact belongs to"),
      text: z.string().describe("The atomic fact statement (single verifiable claim)"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence score 0.0-1.0 (default: 0.5)"),
      source_reference: z.string().optional().describe("Page number, paragraph, or location within the evidence document"),
      category: z.enum(["financial", "temporal", "identity", "property", "legal", "communication", "other"]).optional().describe("Fact category for classification"),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_fact_validate",
    description: "Validate a draft fact against corroborating evidence. Moves the fact from 'draft' to 'verified' status if validation passes. Requires the fact ID and validation method (cross_reference, document_match, witness_corroboration, or expert_review).",
    schema: {
      fact_id: z.string().describe("Fact ID to validate"),
      validation_method: z.enum(["cross_reference", "document_match", "witness_corroboration", "expert_review"]).describe("Method used to validate the fact"),
      corroborating_evidence: z.array(z.string()).optional().describe("Array of evidence IDs that corroborate this fact"),
      notes: z.string().optional().describe("Validation notes or reasoning"),
    },
    annotations: { readOnlyHint: false },
  },

  // ── Fact Governance (Seal / Dispute / Export) ────────────────────
  {
    name: "chitty_fact_seal",
    description: "Seal a verified fact permanently, triggering async ChittyProof minting. Requires Authority entity type with INSTITUTIONAL trust level (4+). Sealed facts are immutable and receive a ChittyProof 11-pillar proof bundle.",
    schema: {
      fact_id: z.string().describe("Fact ID to seal"),
      actor_chitty_id: z.string().describe("ChittyID of the authority performing the seal"),
      seal_reason: z.string().optional().describe("Reason for sealing the fact"),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_fact_dispute",
    description: "Dispute a verified or sealed fact. Creates a dispute record linked to ChittyDisputes. Requires ENHANCED trust level (2+).",
    schema: {
      fact_id: z.string().describe("Fact ID to dispute"),
      reason: z.string().describe("Reason for the dispute"),
      actor_chitty_id: z.string().describe("ChittyID of the entity filing the dispute"),
      challenger_chitty_id: z.string().optional().describe("ChittyID of the challenger (defaults to actor)"),
      counter_evidence_ids: z.array(z.string()).optional().describe("Evidence IDs that contradict this fact"),
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "chitty_fact_export",
    description: "Export a fact with its full proof bundle. JSON format returns inline proof data. PDF format generates a court-ready document via ChittyProof PDX export stored in R2.",
    schema: {
      fact_id: z.string().describe("Fact ID to export"),
      format: z.enum(["json", "pdf"]).describe("Export format: json (inline) or pdf (R2 download URL)"),
      actor_chitty_id: z.string().describe("ChittyID of the requesting entity"),
    },
    annotations: { readOnlyHint: false },
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
      version: "2.1.0",
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
