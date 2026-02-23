/**
 * Shared MCP Tool Dispatcher
 *
 * Extracted tool dispatch logic that can be called from both the
 * REST /mcp/tools/call endpoint and the ChatGPT MCP protocol server.
 *
 * @module mcp/tool-dispatcher
 */

import { getServiceToken } from "../lib/credential-helper.js";

/**
 * Dispatch a tool call and return an MCP-formatted result.
 *
 * @param {string} name - Tool name (e.g. "chitty_id_mint")
 * @param {object} args - Tool arguments
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Base URL for local API calls (e.g. "https://connect.chitty.cc")
 * @param {string} [options.authToken] - Bearer token for authenticated local calls
 * @param {object} [options.context] - MCP session context (sessionId, etc.)
 * @returns {Promise<{content: Array<{type: string, text: string}>, isError?: boolean}>}
 */
export async function dispatchToolCall(name, args = {}, env, options = {}) {
  const { baseUrl = "https://connect.chitty.cc", authToken, context } = options;
  const authHeader = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  try {
    let result;

    // ── Identity tools ──────────────────────────────────────────────
    if (name === "chitty_id_mint") {
      const serviceToken = await getServiceToken(env, "chittyid");
      if (!serviceToken) {
        return {
          content: [{ type: "text", text: "Authentication required: No service token available for ChittyID" }],
          isError: true,
        };
      }
      const response = await fetch("https://id.chitty.cc/api/v2/chittyid/mint", {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entity: args.entity_type, metadata: args.metadata }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: "text", text: `ChittyID error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }
      result = await response.json();
    } else if (name === "chitty_id_validate") {
      const serviceToken = await getServiceToken(env, "chittyid");
      if (!serviceToken) {
        return {
          content: [{ type: "text", text: "Authentication required: No service token available for ChittyID" }],
          isError: true,
        };
      }
      const response = await fetch(
        `https://id.chitty.cc/api/v2/chittyid/validate/${args.chitty_id}`,
        { headers: { Authorization: `Bearer ${serviceToken}` } },
      );
      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: "text", text: `ChittyID validation error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }
      result = await response.json();
    }

    // ── Case tools ──────────────────────────────────────────────────
    else if (name.startsWith("chitty_case_")) {
      const action = name.replace("chitty_case_", "");
      const endpoint = action === "create" ? "/api/chittycases/create" : `/api/chittycases/${args.case_id}`;
      const method = action === "create" ? "POST" : "GET";
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: action === "create" ? JSON.stringify(args) : undefined,
      });
      result = await response.json();
    }

    // ── ChittyLedger tools ──────────────────────────────────────────
    else if (name === "chitty_ledger_stats") {
      const response = await fetch("https://ledger.chitty.cc/api/dashboard/stats");
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }
    } else if (name === "chitty_ledger_evidence") {
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/evidence?caseId=${args.case_id}`
        : "https://ledger.chitty.cc/api/evidence";
      const response = await fetch(url);
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }
    } else if (name === "chitty_ledger_facts") {
      const response = await fetch(`https://ledger.chitty.cc/api/evidence/${args.evidence_id}/facts`);
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }
    } else if (name === "chitty_ledger_contradictions") {
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/contradictions?caseId=${args.case_id}`
        : "https://ledger.chitty.cc/api/contradictions";
      const response = await fetch(url);
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }
    }

    // ── ChittyContextual tools ──────────────────────────────────────
    else if (name === "chitty_contextual_timeline") {
      const params = new URLSearchParams();
      if (args.party) params.set("party", args.party);
      if (args.start_date) params.set("start", args.start_date);
      if (args.end_date) params.set("end", args.end_date);
      if (args.source) params.set("source", args.source);
      const response = await fetch(`https://contextual.chitty.cc/api/messages?${params.toString()}`);
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Contextual returned (${response.status}): ${text.slice(0, 200)}` };
      }
    } else if (name === "chitty_contextual_topics") {
      const response = await fetch("https://contextual.chitty.cc/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query }),
      });
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Contextual returned (${response.status}): ${text.slice(0, 200)}` };
      }
    }

    // ── Evidence AI Search tools ────────────────────────────────────
    else if (name === "chitty_evidence_search") {
      const accountId = env.CF_ACCOUNT_ID || "0bc21e3a5a9de1a4cc843be9c3e98121";
      const aiSearchToken = env.AI_SEARCH_TOKEN;
      if (!aiSearchToken) {
        return {
          content: [{ type: "text", text: "AI Search not configured: AI_SEARCH_TOKEN secret not set." }],
          isError: true,
        };
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/chittyevidence-search/search`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${aiSearchToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: args.query }], max_num_results: 10 }),
        },
      );
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!data || !data.success) {
        return {
          content: [{ type: "text", text: `AI Search error (${response.status}): ${(text || "").slice(0, 300)}` }],
          isError: true,
        };
      }
      const chunks = data.result?.chunks || [];
      const formatted = chunks.slice(0, 5).map((d) => {
        const fname = d.item?.key || d.filename || "unknown";
        const score = (d.score || 0).toFixed(3);
        const snippet = (d.text || "").slice(0, 200).replace(/\n/g, " ");
        return `[${score}] ${fname}\n  ${snippet}`;
      }).join("\n\n");
      return {
        content: [{ type: "text", text: formatted || "No matching documents found." }],
      };
    } else if (name === "chitty_evidence_retrieve") {
      const accountId = env.CF_ACCOUNT_ID || "0bc21e3a5a9de1a4cc843be9c3e98121";
      const aiSearchToken = env.AI_SEARCH_TOKEN;
      if (!aiSearchToken) {
        return {
          content: [{ type: "text", text: "AI Search not configured: AI_SEARCH_TOKEN secret not set." }],
          isError: true,
        };
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/chittyevidence-search/search`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${aiSearchToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: args.query }], max_num_results: args.max_num_results || 10 }),
        },
      );
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        return {
          content: [{ type: "text", text: `AI Search retrieve error (${response.status}): ${(text || "").slice(0, 300)}` }],
          isError: true,
        };
      }
    }

    // ── Evidence CRUD tools (ingest/verify) ─────────────────────────
    else if (name.startsWith("chitty_evidence_")) {
      const action = name.replace("chitty_evidence_", "");
      const endpoint = action === "ingest"
        ? "/api/chittyevidence/ingest"
        : `/api/chittyevidence/${args.evidence_id}`;
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: action === "ingest" ? "POST" : "GET",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: action === "ingest" ? JSON.stringify(args) : undefined,
      });
      result = await response.json();
    }

    // ── Finance tools ───────────────────────────────────────────────
    else if (name.startsWith("chitty_finance_")) {
      const action = name.replace("chitty_finance_", "");
      const response = await fetch(`${baseUrl}/api/chittyfinance/${action}`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // ── Intelligence tools ──────────────────────────────────────────
    else if (name === "chitty_intelligence_analyze") {
      const response = await fetch(`${baseUrl}/api/intelligence/analyze`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // ── Memory tools (MemoryCloude) ─────────────────────────────────
    else if (name.startsWith("memory_")) {
      result = {
        success: true,
        message: `Memory operation ${name} executed`,
        data: { session_id: context?.sessionId || "unknown" },
      };
    }

    // ── Credential tools ────────────────────────────────────────────
    else if (name.startsWith("chitty_credential_")) {
      const response = await fetch(
        `${baseUrl}/api/credentials/${name.replace("chitty_credential_", "")}`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(args),
        },
      );
      result = await response.json();
    }

    // ── Service health tools ────────────────────────────────────────
    else if (name.startsWith("chitty_services_") || name === "chitty_ecosystem_awareness") {
      const response = await fetch(`${baseUrl}/api/services/status`, {
        headers: authHeader,
      });
      result = await response.json();
    }

    // ── Chronicle tools ─────────────────────────────────────────────
    else if (name === "chitty_chronicle_log") {
      const response = await fetch(`${baseUrl}/api/chittychronicle/log`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // ── Third-party integration tools ───────────────────────────────
    else if (name === "chitty_notion_query") {
      const response = await fetch(`${baseUrl}/api/thirdparty/notion/query`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    } else if (name === "chitty_openai_chat") {
      const response = await fetch(`${baseUrl}/api/thirdparty/openai/chat`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    } else if (name === "chitty_neon_query") {
      const response = await fetch(`${baseUrl}/api/thirdparty/neon/query`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // ── Sync tools ──────────────────────────────────────────────────
    else if (name === "chitty_sync_data") {
      const response = await fetch(`${baseUrl}/api/chittysync/sync`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      result = await response.json();
    }

    // ── Unknown tool ────────────────────────────────────────────────
    else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Format result for MCP
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    console.error(`[MCP] Tool execution error for ${name}:`, error);
    return {
      content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }],
      isError: true,
    };
  }
}
