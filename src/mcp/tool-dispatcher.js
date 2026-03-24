/**
 * Shared MCP Tool Dispatcher
 *
 * Extracted tool dispatch logic shared by the REST /mcp/tools/call endpoint,
 * the ChatGPT MCP protocol server, and the standalone mcp-server.js (stdio).
 *
 * @module mcp/tool-dispatcher
 */

import { getCredential, getServiceToken } from "../lib/credential-helper.js";
import {
  getCloudflareApiCredentials,
  parseTimeframe,
} from "../lib/cloudflare-api-helper.js";
import { Client } from "@neondatabase/serverless";

const CHITTYOS_SERVICES = [
  { id: "chittyid", url: "https://id.chitty.cc" },
  { id: "chittyauth", url: "https://auth.chitty.cc" },
  { id: "chittygateway", url: "https://gateway.chitty.cc" },
  { id: "chittyrouter", url: "https://router.chitty.cc" },
  { id: "chittyregistry", url: "https://registry.chitty.cc" },
  { id: "chittycases", url: "https://cases.chitty.cc" },
  { id: "chittyfinance", url: "https://finance.chitty.cc" },
  { id: "chittyevidence", url: "https://evidence.chitty.cc" },
  { id: "chittysync", url: "https://sync.chitty.cc" },
  { id: "chittychronicle", url: "https://chronicle.chitty.cc" },
  { id: "chittycontextual", url: "https://contextual.chitty.cc" },
  { id: "chittyschema", url: "https://schema.chitty.cc" },
  { id: "chittytrust", url: "https://trust.chitty.cc" },
  { id: "chittyscore", url: "https://score.chitty.cc" },
  { id: "chittychain", url: "https://chain.chitty.cc" },
  { id: "chittyledger", url: "https://ledger.chitty.cc" },
  { id: "chittydisputes", url: "https://disputes.chitty.cc" },
  { id: "chittytrack", url: "https://track.chitty.cc" },
  { id: "chittytask", url: "https://tasks.chitty.cc" },
];

/**
 * Parse a fetch response, returning an MCP error result for non-OK responses.
 * Returns null on success (caller should parse the response body).
 */
async function checkFetchError(response, toolLabel) {
  if (response.ok) return null;
  const body = await response.text().catch(() => "No response body");
  return {
    content: [
      {
        type: "text",
        text: `${toolLabel} error (${response.status}): ${body.slice(0, 300)}`,
      },
    ],
    isError: true,
  };
}

/**
 * Read response body and parse as JSON. Returns an MCP error result on parse failure.
 * Caller checks `error` first; if null, uses `parsed`.
 */
async function parseJsonBody(response, label) {
  const text = await response.text();
  try {
    return { parsed: JSON.parse(text), error: null };
  } catch {
    return {
      parsed: null,
      error: {
        content: [
          {
            type: "text",
            text: `${label} returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Check for HTTP errors and parse JSON body in one step.
 * Returns `{ data, error }` — caller checks `error` first, then uses `data`.
 */
async function checkAndParseJson(response, label) {
  const fetchErr = await checkFetchError(response, label);
  if (fetchErr) return { data: null, error: fetchErr };
  const { parsed, error } = await parseJsonBody(response, label);
  return { data: parsed, error };
}

async function fetchServiceStatusSnapshot() {
  const statusChecks = CHITTYOS_SERVICES.map(async (service) => {
    try {
      const response = await fetch(`${service.url}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return {
        serviceId: service.id,
        name: service.id,
        url: service.url,
        status: response.ok ? "healthy" : "degraded",
        statusCode: response.status,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        serviceId: service.id,
        name: service.id,
        url: service.url,
        status: "down",
        error: error.message,
        lastChecked: new Date().toISOString(),
      };
    }
  });

  const results = await Promise.all(statusChecks);
  const services = {};
  results.forEach((entry) => {
    services[entry.serviceId] = entry;
  });
  return { services };
}

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
  // authHeader: only for calls to our own baseUrl (connect.chitty.cc internal routes)
  const authHeader = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  // requireServiceAuth: for cross-service calls to *.chitty.cc siblings — fails explicitly if no token
  const requireServiceAuth = async (serviceName, displayName) => {
    let token;
    try {
      token = await getServiceToken(env, serviceName);
    } catch (err) {
      console.error(
        `[MCP] Service token retrieval failed for ${displayName}:`,
        err,
      );
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Authentication failed: Unable to retrieve service token for ${displayName} (${err.message})`,
            },
          ],
          isError: true,
        },
        headers: {},
      };
    }
    if (!token) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Authentication required: No service token available for ${displayName}`,
            },
          ],
          isError: true,
        },
        headers: {},
      };
    }
    return { error: null, headers: { Authorization: `Bearer ${token}` } };
  };

  // requireCloudflareAuth: for Cloudflare API calls — fails explicitly if no token/accountId
  const requireCloudflareAuth = async () => {
    let apiToken, accountId;
    try {
      ({ apiToken, accountId } = await getCloudflareApiCredentials(env));
    } catch (err) {
      console.error("[MCP] Cloudflare credential retrieval failed:", err);
      return {
        error: {
          content: [
            {
              type: "text",
              text: `Cloudflare auth failed: ${err.message}`,
            },
          ],
          isError: true,
        },
      };
    }
    if (!apiToken) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: "Cloudflare API token not configured (set CLOUDFLARE_MAKE_API_KEY or 1Password path infrastructure/cloudflare/api_token)",
            },
          ],
          isError: true,
        },
      };
    }
    if (!accountId) {
      return {
        error: {
          content: [
            {
              type: "text",
              text: "Cloudflare account ID not configured (set CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID)",
            },
          ],
          isError: true,
        },
      };
    }
    return { error: null, apiToken, accountId };
  };

  try {
    let result;

    // ── Identity tools ──────────────────────────────────────────────
    if (name === "chitty_id_mint") {
      const serviceToken =
        env.CHITTYMINT_SECRET ||
        (await getServiceToken(env, "chittymint")) ||
        (await getServiceToken(env, "chittyid"));
      if (!serviceToken) {
        return {
          content: [
            {
              type: "text",
              text: "Authentication required: No service token available for ChittyMint",
            },
          ],
          isError: true,
        };
      }
      const response = await fetch("https://mint.chitty.cc/api/mint", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entity_type: args.entity_type,
          metadata: args.metadata,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `ChittyID error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }
      result = await response.json();
    } else if (name === "chitty_id_validate") {
      const serviceToken = await getServiceToken(env, "chittyid");
      if (!serviceToken) {
        return {
          content: [
            {
              type: "text",
              text: "Authentication required: No service token available for ChittyID",
            },
          ],
          isError: true,
        };
      }
      const response = await fetch(
        `https://id.chitty.cc/api/v2/chittyid/validate/${encodeURIComponent(args.chitty_id)}`,
        { headers: { Authorization: `Bearer ${serviceToken}` } },
      );
      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `ChittyID validation error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }
      result = await response.json();
    }

    // ── Case tools ──────────────────────────────────────────────────
    else if (name.startsWith("chitty_case_")) {
      const action = name.replace("chitty_case_", "");
      const endpoint =
        action === "create"
          ? "/api/chittycases/create"
          : `/api/chittycases/${encodeURIComponent(args.case_id)}`;
      const method = action === "create" ? "POST" : "GET";
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: action === "create" ? JSON.stringify(args) : undefined,
      });
      const fetchErr = await checkFetchError(response, "ChittyCases");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── ChittyLedger tools ──────────────────────────────────────────
    else if (name === "chitty_ledger_stats") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/dashboard/stats",
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_evidence") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/evidence?caseId=${encodeURIComponent(args.case_id)}`
        : "https://ledger.chitty.cc/api/evidence";
      const response = await fetch(url, { headers: ledgerAuth });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_facts") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        `https://ledger.chitty.cc/api/evidence/${encodeURIComponent(args.evidence_id)}/facts`,
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_mint") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      // Pre-flight: verify the cited evidence exists in ChittyLedger
      const evidenceCheck = await fetch(
        `https://ledger.chitty.cc/api/evidence/${encodeURIComponent(args.evidence_id)}`,
        { headers: ledgerAuth },
      );
      if (!evidenceCheck.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Fact minting blocked: evidence_id "${args.evidence_id}" not found in ChittyLedger (${evidenceCheck.status}). Evidence must be ingested through the pipeline before facts can be minted from it.`,
            },
          ],
          isError: true,
        };
      }
      let evidenceRecord;
      try {
        evidenceRecord = await evidenceCheck.json();
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Fact minting blocked: evidence "${args.evidence_id}" returned invalid JSON. Cannot anchor evidence hash for integrity verification.`,
            },
          ],
          isError: true,
        };
      }
      const evidenceHash =
        evidenceRecord?.file_hash || evidenceRecord?.thing?.file_hash || null;

      const response = await fetch("https://ledger.chitty.cc/api/facts", {
        method: "POST",
        headers: { ...ledgerAuth, "Content-Type": "application/json" },
        body: JSON.stringify({
          evidence_id: args.evidence_id,
          case_id: args.case_id,
          text: args.text,
          confidence: args.confidence,
          source_reference: args.source_reference,
          category: args.category,
          // Anchor fact to evidence integrity state at mint time
          evidence_hash_at_mint: evidenceHash,
        }),
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_validate") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      // Pre-flight: verify all corroborating evidence IDs exist (parallel)
      if (args.corroborating_evidence?.length) {
        const checks = await Promise.all(
          args.corroborating_evidence.map(async (evId) => {
            const resp = await fetch(
              `https://ledger.chitty.cc/api/evidence/${encodeURIComponent(evId)}`,
              { headers: ledgerAuth },
            );
            return { evId, ok: resp.ok, status: resp.status };
          }),
        );
        const failed = checks.find((c) => !c.ok);
        if (failed) {
          return {
            content: [
              {
                type: "text",
                text: `Validation blocked: corroborating evidence "${failed.evId}" not found in ChittyLedger (${failed.status}). All cited evidence must exist in the pipeline.`,
              },
            ],
            isError: true,
          };
        }
      }

      const response = await fetch(
        `https://ledger.chitty.cc/api/facts/${encodeURIComponent(args.fact_id)}/validate`,
        {
          method: "POST",
          headers: { ...ledgerAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            validation_method: args.validation_method,
            corroborating_evidence: args.corroborating_evidence,
            notes: args.notes,
          }),
        },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_seal") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      if (!args.actor_chitty_id) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameter: actor_chitty_id",
            },
          ],
          isError: true,
        };
      }
      // RBAC: Authority (A) with trust >= INSTITUTIONAL (4)
      const { checkFactPermission, FACT_ACTIONS } =
        await import("../lib/fact-rbac.js");
      const perm = await checkFactPermission(
        args.actor_chitty_id,
        FACT_ACTIONS.SEAL,
        env,
      );
      if (!perm.allowed) {
        return {
          content: [
            { type: "text", text: `Permission denied: ${perm.reason}` },
          ],
          isError: true,
        };
      }

      // Seal the fact in ChittyLedger
      const response = await fetch(
        `https://ledger.chitty.cc/api/facts/${encodeURIComponent(args.fact_id)}/seal`,
        {
          method: "POST",
          headers: { ...ledgerAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            sealed_by: args.actor_chitty_id,
            seal_reason: args.seal_reason,
          }),
        },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;

      if (env.PROOF_Q) {
        try {
          await env.PROOF_Q.send({
            fact_id: args.fact_id,
            fact_text: result.fact_text || result.text,
            evidence_chain: result.evidence_chain || [],
            signer_chitty_id: args.actor_chitty_id,
          });
        } catch (queueErr) {
          console.error(
            `[MCP] Proof queue send failed for fact ${args.fact_id} (seal succeeded):`,
            queueErr,
          );
          result.proof_queue_warning =
            "Seal succeeded but proof queue failed. Manual proof minting may be required.";
        }
      } else {
        console.warn(
          `[MCP] PROOF_Q not configured. Fact ${args.fact_id} sealed without proof minting.`,
        );
        result.proof_queue_warning =
          "PROOF_Q binding not configured. Proof will not be minted.";
      }
    } else if (name === "chitty_fact_dispute") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      if (!args.actor_chitty_id) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameter: actor_chitty_id",
            },
          ],
          isError: true,
        };
      }
      // RBAC: Person (P) or Authority (A) with trust >= ENHANCED (2)
      const { checkFactPermission: checkDisputePerm, FACT_ACTIONS: DA } =
        await import("../lib/fact-rbac.js");
      const perm = await checkDisputePerm(
        args.actor_chitty_id,
        DA.DISPUTE,
        env,
      );
      if (!perm.allowed) {
        return {
          content: [
            { type: "text", text: `Permission denied: ${perm.reason}` },
          ],
          isError: true,
        };
      }

      // Verify counter evidence exists (parallel)
      if (args.counter_evidence_ids?.length) {
        const checks = await Promise.all(
          args.counter_evidence_ids.map(async (evId) => {
            const resp = await fetch(
              `https://ledger.chitty.cc/api/evidence/${encodeURIComponent(evId)}`,
              { headers: ledgerAuth },
            );
            return { evId, ok: resp.ok, status: resp.status };
          }),
        );
        const failed = checks.find((c) => !c.ok);
        if (failed) {
          return {
            content: [
              {
                type: "text",
                text: `Dispute blocked: counter evidence "${failed.evId}" not found in ChittyLedger (${failed.status}).`,
              },
            ],
            isError: true,
          };
        }
      }

      const response = await fetch(
        `https://ledger.chitty.cc/api/facts/${encodeURIComponent(args.fact_id)}/dispute`,
        {
          method: "POST",
          headers: { ...ledgerAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: args.reason,
            challenger_chitty_id:
              args.challenger_chitty_id || args.actor_chitty_id,
            counter_evidence_ids: args.counter_evidence_ids,
          }),
        },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_export") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      if (!args.actor_chitty_id) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameter: actor_chitty_id",
            },
          ],
          isError: true,
        };
      }
      // RBAC: Any authenticated with trust >= BASIC (1)
      const { checkFactPermission: checkExportPerm, FACT_ACTIONS: EA } =
        await import("../lib/fact-rbac.js");
      const perm = await checkExportPerm(args.actor_chitty_id, EA.EXPORT, env);
      if (!perm.allowed) {
        return {
          content: [
            { type: "text", text: `Permission denied: ${perm.reason}` },
          ],
          isError: true,
        };
      }

      if (args.format === "pdf") {
        // Fetch fact with proof data
        const factResp = await fetch(
          `https://ledger.chitty.cc/api/facts/${encodeURIComponent(args.fact_id)}/export`,
          { headers: ledgerAuth },
        );
        if (!factResp.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Export failed: fact ${args.fact_id} not found (${factResp.status})`,
              },
            ],
            isError: true,
          };
        }
        const { parsed: factData, error: factParseErr } = await parseJsonBody(
          factResp,
          "Ledger",
        );
        if (factParseErr) return factParseErr;

        if (!factData.proof_id) {
          return {
            content: [
              {
                type: "text",
                text: `PDF export requires a sealed fact with a minted proof. Current proof_status: ${factData.proof_status || "NONE"}`,
              },
            ],
            isError: true,
          };
        }

        // Generate PDF via ChittyProof and store in R2
        const { ChittyProofClient } =
          await import("../lib/chittyproof-client.js");
        const proofClient = new ChittyProofClient(env);
        const pdfResult = await proofClient.exportPdf(factData.proof_id);

        if (pdfResult.error) {
          return {
            content: [
              {
                type: "text",
                text: `PDF generation failed: ${pdfResult.message}`,
              },
            ],
            isError: true,
          };
        }

        // Store in R2
        if (!env.FILES) {
          return {
            content: [
              {
                type: "text",
                text: "PDF export failed: R2 storage (FILES binding) is not configured.",
              },
            ],
            isError: true,
          };
        }
        const exportPath = `facts/${args.fact_id}/${Date.now()}.pdf`;
        const r2Key = `exports/${exportPath}`;
        try {
          await env.FILES.put(r2Key, pdfResult.body, {
            httpMetadata: { contentType: "application/pdf" },
          });
        } catch (r2Err) {
          console.error(`[MCP] R2 put failed for ${r2Key}:`, r2Err);
          return {
            content: [
              {
                type: "text",
                text: `PDF generated but storage failed: ${r2Err.message}`,
              },
            ],
            isError: true,
          };
        }

        result = {
          fact_id: args.fact_id,
          format: "pdf",
          download_url: `${baseUrl}/api/v1/exports/${exportPath}`,
          proof_id: factData.proof_id,
          verification_url: factData.verification_url,
        };
      } else {
        // JSON export — fetch full fact with proof bundle
        const response = await fetch(
          `https://ledger.chitty.cc/api/facts/${encodeURIComponent(args.fact_id)}/export`,
          { headers: ledgerAuth },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyLedger",
        );
        if (respErr) return respErr;
        result = data;
      }
    } else if (name === "chitty_ledger_contradictions") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/contradictions?caseId=${encodeURIComponent(args.case_id)}`
        : "https://ledger.chitty.cc/api/contradictions";
      const response = await fetch(url, { headers: ledgerAuth });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── ChittyLedger chain tools (record, query, verify, statistics, custody) ──
    else if (name === "chitty_ledger_record") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch("https://ledger.chitty.cc/api/ledger", {
        method: "POST",
        headers: { ...ledgerAuth, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_query") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const params = new URLSearchParams();
      if (args.record_type) params.set("type", args.record_type);
      if (args.entity_id) params.set("entity_id", args.entity_id);
      if (args.actor) params.set("actor", args.actor);
      if (args.status) params.set("status", args.status);
      if (args.limit) params.set("limit", String(args.limit));
      const response = await fetch(
        `https://ledger.chitty.cc/api/ledger?${params}`,
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_verify") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/ledger/verify",
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_statistics") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/ledger/statistics",
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_chain_of_custody") {
      const { error: ledgerErr, headers: ledgerAuth } =
        await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      if (!args.entity_id) {
        return {
          content: [
            { type: "text", text: "Missing required parameter: entity_id" },
          ],
          isError: true,
        };
      }
      const response = await fetch(
        `https://ledger.chitty.cc/api/ledger/${encodeURIComponent(args.entity_id)}/custody`,
        { headers: ledgerAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── ChittyContextual tools ──────────────────────────────────────
    else if (name === "chitty_contextual_timeline") {
      const { error: ctxErr, headers: ctxAuth } = await requireServiceAuth(
        "chittycontextual",
        "ChittyContextual",
      );
      if (ctxErr) return ctxErr;
      const params = new URLSearchParams();
      if (args.party) params.set("party", args.party);
      if (args.start_date) params.set("start", args.start_date);
      if (args.end_date) params.set("end", args.end_date);
      if (args.source) params.set("source", args.source);
      const response = await fetch(
        `https://contextual.chitty.cc/api/messages?${params.toString()}`,
        { headers: ctxAuth },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyContextual",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_contextual_topics") {
      const { error: ctxErr, headers: ctxAuth } = await requireServiceAuth(
        "chittycontextual",
        "ChittyContextual",
      );
      if (ctxErr) return ctxErr;
      const response = await fetch("https://contextual.chitty.cc/api/topics", {
        method: "POST",
        headers: { ...ctxAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query }),
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyContextual",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── Evidence AI Search tools ────────────────────────────────────
    else if (name === "chitty_evidence_search") {
      const accountId = env.CF_ACCOUNT_ID || env.CHITTYOS_ACCOUNT_ID;
      if (!accountId) {
        return {
          content: [
            {
              type: "text",
              text: "AI Search not configured: CF_ACCOUNT_ID or CHITTYOS_ACCOUNT_ID not set.",
            },
          ],
          isError: true,
        };
      }
      const aiSearchToken = env.AI_SEARCH_TOKEN;
      if (!aiSearchToken) {
        return {
          content: [
            {
              type: "text",
              text: "AI Search not configured: AI_SEARCH_TOKEN secret not set.",
            },
          ],
          isError: true,
        };
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/chittyevidence-search/search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aiSearchToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: args.query }],
            max_num_results: 10,
          }),
        },
      );
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!data || !data.success) {
        return {
          content: [
            {
              type: "text",
              text: `AI Search error (${response.status}): ${(text || "").slice(0, 300)}`,
            },
          ],
          isError: true,
        };
      }
      const chunks = data.result?.chunks || [];
      const formatted = chunks
        .slice(0, 5)
        .map((d) => {
          const fname = d.item?.key || d.filename || "unknown";
          const score = (d.score || 0).toFixed(3);
          const snippet = (d.text || "").slice(0, 200).replace(/\n/g, " ");
          return `[${score}] ${fname}\n  ${snippet}`;
        })
        .join("\n\n");
      return {
        content: [
          { type: "text", text: formatted || "No matching documents found." },
        ],
      };
    } else if (name === "chitty_evidence_retrieve") {
      const accountId = env.CF_ACCOUNT_ID || env.CHITTYOS_ACCOUNT_ID;
      if (!accountId) {
        return {
          content: [
            {
              type: "text",
              text: "AI Search not configured: CF_ACCOUNT_ID or CHITTYOS_ACCOUNT_ID not set.",
            },
          ],
          isError: true,
        };
      }
      const aiSearchToken = env.AI_SEARCH_TOKEN;
      if (!aiSearchToken) {
        return {
          content: [
            {
              type: "text",
              text: "AI Search not configured: AI_SEARCH_TOKEN secret not set.",
            },
          ],
          isError: true,
        };
      }
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-search/instances/chittyevidence-search/search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aiSearchToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: args.query }],
            max_num_results: args.max_num_results || 10,
          }),
        },
      );
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `AI Search retrieve error (${response.status}): ${(text || "").slice(0, 300)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // ── Evidence CRUD tools (ingest/verify) ─────────────────────────
    else if (name.startsWith("chitty_evidence_")) {
      const action = name.replace("chitty_evidence_", "");
      const endpoint =
        action === "ingest"
          ? "/api/chittyevidence/ingest"
          : `/api/chittyevidence/${encodeURIComponent(args.evidence_id)}`;
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: action === "ingest" ? "POST" : "GET",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: action === "ingest" ? JSON.stringify(args) : undefined,
      });
      const fetchErr = await checkFetchError(response, "ChittyEvidence");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Finance tools ───────────────────────────────────────────────
    else if (name === "chitty_finance_entities") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch("https://finance.chitty.cc/api/entities", {
        headers: financeAuth,
      });
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_balances") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch(
        `https://finance.chitty.cc/api/entities/${encodeURIComponent(args.entity)}/balances`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_transactions") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await fetch(
        `https://finance.chitty.cc/api/entities/${encodeURIComponent(args.entity)}/transactions?${params}`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_cash_flow") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await fetch(
        `https://finance.chitty.cc/api/entities/${encodeURIComponent(args.entity)}/cash-flow?${params}`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_inter_entity") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const params = new URLSearchParams();
      if (args.entity) params.set("entity", args.entity);
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await fetch(
        `https://finance.chitty.cc/api/transfers/inter-entity?${params}`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_detect_transfers") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch(
        "https://finance.chitty.cc/api/transfers/detect",
        {
          method: "POST",
          headers: { ...financeAuth, "Content-Type": "application/json" },
          body: JSON.stringify({
            entity: args.entity,
            start: args.start,
            end: args.end,
            threshold: args.threshold,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_flow_of_funds") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await fetch(
        `https://finance.chitty.cc/api/reports/flow-of-funds?${params}`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_sync") {
      const { error: financeErr, headers: financeAuth } =
        await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch(
        "https://finance.chitty.cc/api/sync/mercury",
        {
          method: "POST",
          headers: { ...financeAuth, "Content-Type": "application/json" },
        },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name.startsWith("chitty_finance_")) {
      // Generic fallback for connect_bank and analyze — these go to our own baseUrl
      const action = name.replace("chitty_finance_", "");
      const allowedKeys = [
        "institution",
        "account_type",
        "query",
        "entity",
        "start",
        "end",
      ];
      const safeArgs = Object.fromEntries(
        Object.entries(args).filter(([k]) => allowedKeys.includes(k)),
      );
      const response = await fetch(
        `${baseUrl}/api/chittyfinance/${encodeURIComponent(action)}`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(safeArgs),
        },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Intelligence tools ──────────────────────────────────────────
    else if (name === "chitty_intelligence_analyze") {
      const response = await fetch(`${baseUrl}/api/intelligence/analyze`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "Intelligence");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Context tools ─────────────────────────────────────────────────
    else if (name === "context_resolve") {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/resolve`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            project_path: args.project_path,
            platform: args.platform || "claude_code",
            support_type: args.support_type || "development",
            organization: args.organization,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "ContextResolve");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "context_restore") {
      const params = new URLSearchParams();
      if (args.project_slug) params.set("project", args.project_slug);
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/${encodeURIComponent(args.chitty_id)}/restore?${params}`,
        { headers: authHeader },
      );
      const fetchErr = await checkFetchError(response, "ContextRestore");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "context_commit") {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/commit`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: args.session_id,
            chitty_id: args.chitty_id,
            project_slug: args.project_slug,
            metrics: args.metrics,
            decisions: args.decisions,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "ContextCommit");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "context_check") {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/${encodeURIComponent(args.chitty_id)}/check`,
        { headers: authHeader },
      );
      const fetchErr = await checkFetchError(response, "ContextCheck");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "context_checkpoint") {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/checkpoint`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            chitty_id: args.chitty_id,
            project_slug: args.project_slug,
            name: args.name,
            state: args.state,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "ContextCheckpoint");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Memory tools (MemoryCloude) ──────────────────────────────────
    else if (
      name === "chitty_memory_persist" ||
      name === "memory_persist_interaction" ||
      name === "memory_persist"
    ) {
      const response = await fetch(
        `${baseUrl}/api/intelligence/memory/persist`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: args.session_id || "default",
            interaction: {
              type: args.type || "memory",
              content: args.content || args.interaction,
              entities: args.entities || [],
              importance: args.importance || "medium",
              tags: args.tags,
              chitty_id: args.chitty_id,
            },
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "MemoryPersist");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (
      name === "chitty_memory_recall" ||
      name === "memory_recall_context" ||
      name === "memory_recall"
    ) {
      const response = await fetch(
        `${baseUrl}/api/intelligence/memory/recall`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: args.session_id || "default",
            query: args.query,
            limit: args.limit ? Number(args.limit) : 5,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "MemoryRecall");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (
      name === "chitty_memory_session_summary" ||
      name === "memory_get_session_summary"
    ) {
      const response = await fetch(
        `${baseUrl}/api/intelligence/memory/session/${encodeURIComponent(args.session_id)}`,
        { headers: authHeader },
      );
      const fetchErr = await checkFetchError(response, "MemorySessionSummary");
      if (fetchErr) return fetchErr;
      result = await response.json();
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
      const fetchErr = await checkFetchError(response, "Credentials");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Service health tools ────────────────────────────────────────
    else if (
      name.startsWith("chitty_services_") ||
      name === "chitty_ecosystem_awareness"
    ) {
      result = await fetchServiceStatusSnapshot();
    }

    // ── Chronicle tools ─────────────────────────────────────────────
    else if (name === "chitty_chronicle_log") {
      const response = await fetch(`${baseUrl}/api/chittychronicle/log`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "ChittyChronicle");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Third-party integration tools ───────────────────────────────
    else if (name === "chitty_notion_query") {
      const response = await fetch(`${baseUrl}/api/thirdparty/notion/query`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "Notion");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_openai_chat") {
      // Route Ollama-hosted models to the Ollama proxy, everything else to OpenAI
      const ollamaModels = ["llama3.2:3b", "nomic-embed-text"];
      const isOllamaModel =
        args.model && ollamaModels.some((m) => args.model.startsWith(m));
      const endpoint = isOllamaModel
        ? `${baseUrl}/api/thirdparty/ollama/chat`
        : `${baseUrl}/api/thirdparty/openai/chat`;
      const providerLabel = isOllamaModel ? "Ollama" : "OpenAI";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, providerLabel);
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_inference_usage") {
      const days = Math.min(args.days || 7, 90);
      const response = await fetch(
        `${baseUrl}/api/thirdparty/ollama/usage?days=${days}`,
        { headers: { ...authHeader } },
      );
      const fetchErr = await checkFetchError(response, "Usage");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_neon_query") {
      const query = args.query || args.sql;
      if (!query) {
        return {
          content: [{ type: "text", text: "Missing required parameter: sql" }],
          isError: true,
        };
      }
      const neonDbUrl =
        env.NEON_DATABASE_URL ||
        (await getCredential(
          env,
          "database/neon/chittyos_core",
          "NEON_DATABASE_URL",
          "Neon",
        ));
      if (!neonDbUrl) {
        return {
          content: [
            {
              type: "text",
              text: "Neon error (503): Neon database URL not configured",
            },
          ],
          isError: true,
        };
      }
      if (neonDbUrl.startsWith("http://") || neonDbUrl.startsWith("https://")) {
        const response = await fetch(neonDbUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, params: args.params }),
        });
        const fetchErr = await checkFetchError(response, "Neon");
        if (fetchErr) return fetchErr;
        result = await response.json();
      } else {
        const client = new Client({ connectionString: neonDbUrl });
        try {
          await client.connect();
          result = await client.query(query, args.params || []);
        } finally {
          await client.end().catch(() => {});
        }
      }
    }

    // ── Sync tools ──────────────────────────────────────────────────
    else if (name === "chitty_sync_data") {
      const response = await fetch(`${baseUrl}/api/chittysync/sync`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "ChittySync");
      if (fetchErr) return fetchErr;
      result = await response.json();
    }

    // ── Infrastructure tools ────────────────────────────────────────
    else if (name === "chitty_infra_logs") {
      const cfAuth = await requireCloudflareAuth();
      if (cfAuth.error) return cfAuth.error;

      const { apiToken, accountId } = cfAuth;
      const service = args.service;
      const queryType = args.query_type;
      const timeframe = args.timeframe || "1h";
      const limit = Math.min(Math.max(args.limit || 25, 1), 100);

      let since, before;
      try {
        ({ since, before } = parseTimeframe(timeframe));
      } catch (err) {
        return {
          content: [{ type: "text", text: err.message }],
          isError: true,
        };
      }

      let queryBody;
      if (queryType === "events") {
        queryBody = {
          queryId: "chittyconnect-events",
          view: "events",
          limit,
          timeframe: { since, before },
          filters: [
            {
              key: "$metadata.scriptName",
              operation: "includes",
              value: service,
            },
          ],
        };
      } else if (queryType === "errors") {
        queryBody = {
          queryId: "chittyconnect-errors",
          view: "events",
          limit,
          timeframe: { since, before },
          filters: [
            {
              key: "$metadata.scriptName",
              operation: "includes",
              value: service,
            },
            {
              key: "$metadata.level",
              operation: "eq",
              value: "error",
            },
          ],
        };
      } else {
        // metrics
        queryBody = {
          queryId: "chittyconnect-metrics",
          view: "calculations",
          limit,
          timeframe: { since, before },
          filters: [
            {
              key: "$metadata.scriptName",
              operation: "includes",
              value: service,
            },
          ],
          calculations: [
            { operator: "count" },
            { operator: "avg", key: "$metadata.duration" },
          ],
          groupBys: ["$metadata.response.status"],
        };
      }

      if (args.filter) {
        queryBody.needle = args.filter;
      }

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
            "workers-observability-origin": "chittyconnect",
          },
          body: JSON.stringify(queryBody),
        },
      );
      const { data, error } = await checkAndParseJson(
        response,
        "Workers Observability",
      );
      if (error) return error;
      result = data;
    } else if (name === "chitty_infra_audit") {
      const cfAuth = await requireCloudflareAuth();
      if (cfAuth.error) return cfAuth.error;

      const { apiToken, accountId } = cfAuth;
      const params = new URLSearchParams();
      params.set("since", args.since);
      params.set("before", args.before);
      if (args.action_type) params.set("action.type", args.action_type);
      if (args.actor_email) params.set("actor.email", args.actor_email);
      if (args.resource_type) params.set("zone.name", args.resource_type);
      params.set(
        "per_page",
        String(Math.min(Math.max(args.limit || 25, 1), 100)),
      );

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/logs/audit?${params}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
            "portal-version": "2",
          },
        },
      );
      const { data, error } = await checkAndParseJson(response, "Audit Logs");
      if (error) return error;
      result = data;
    } else if (name === "chitty_infra_analytics") {
      const cfAuth = await requireCloudflareAuth();
      if (cfAuth.error) return cfAuth.error;

      const { apiToken, accountId } = cfAuth;
      const variables = args.variables || { accountTag: accountId };

      const response = await fetch(
        "https://api.cloudflare.com/client/v4/graphql",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: args.query, variables }),
        },
      );

      const fetchErr = await checkFetchError(response, "GraphQL Analytics");
      if (fetchErr) return fetchErr;

      const rawText = await response.text();
      const MAX_RESPONSE_SIZE = 800 * 1024; // 800KB
      if (rawText.length > MAX_RESPONSE_SIZE) {
        return {
          content: [
            {
              type: "text",
              text: `GraphQL Analytics response too large (${(rawText.length / 1024).toFixed(0)}KB > 800KB limit). Narrow your query with filters or a shorter time range.`,
            },
          ],
          isError: true,
        };
      }

      try {
        result = JSON.parse(rawText);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `GraphQL Analytics returned non-JSON: ${rawText.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // ── Task Management tools ────────────────────────────────────────
    // Proxies to tasks.chitty.cc — inter-agent task coordination
    // Auth: CHITTY_TASK_TOKEN (service token for chittytask)
    else if (name.startsWith("chitty_task_")) {
      const { error: taskErr, headers: taskAuth } = await requireServiceAuth(
        "chittytask",
        "ChittyTask",
      );
      if (taskErr) return taskErr;
      const taskHeaders = { ...taskAuth, "Content-Type": "application/json" };

      if (name === "chitty_task_create") {
        const body = {
          title: args.title,
          task_type: args.task_type,
          assigned_agent: args.assigned_agent,
        };
        if (args.description !== undefined) body.description = args.description;
        if (args.priority !== undefined) body.priority = args.priority;
        if (args.payload !== undefined) body.payload = args.payload;
        if (args.depends_on !== undefined) body.depends_on = args.depends_on;
        const response = await fetch("https://tasks.chitty.cc/api/v1/tasks", {
          method: "POST",
          headers: taskHeaders,
          body: JSON.stringify(body),
        });
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_list") {
        const params = new URLSearchParams();
        if (args.agent) params.set("agent", args.agent);
        if (args.status) params.set("status", args.status);
        if (args.task_type) params.set("task_type", args.task_type);
        if (args.limit !== undefined) params.set("limit", String(args.limit));
        if (args.offset !== undefined) params.set("offset", String(args.offset));
        const url = `https://tasks.chitty.cc/api/v1/tasks${params.toString() ? `?${params}` : ""}`;
        const response = await fetch(url, { headers: taskAuth });
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_get") {
        if (!args.task_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `https://tasks.chitty.cc/api/v1/tasks/${encodeURIComponent(args.task_id)}`,
          { headers: taskAuth },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_claim") {
        if (!args.task_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        }
        const claimHeaders = { ...taskAuth };
        if (args.agent) claimHeaders["X-ChittyOS-Caller"] = args.agent;
        const url = args.agent
          ? `https://tasks.chitty.cc/api/v1/tasks/${encodeURIComponent(args.task_id)}/claim?agent=${encodeURIComponent(args.agent)}`
          : `https://tasks.chitty.cc/api/v1/tasks/${encodeURIComponent(args.task_id)}/claim`;
        const response = await fetch(url, {
          method: "POST",
          headers: claimHeaders,
        });
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_complete") {
        if (!args.task_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        }
        const body = {};
        if (args.result !== undefined) body.result = args.result;
        const response = await fetch(
          `https://tasks.chitty.cc/api/v1/tasks/${encodeURIComponent(args.task_id)}/complete`,
          {
            method: "POST",
            headers: taskHeaders,
            body: JSON.stringify(body),
          },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_fail") {
        if (!args.task_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        }
        if (!args.error) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: error" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `https://tasks.chitty.cc/api/v1/tasks/${encodeURIComponent(args.task_id)}/fail`,
          {
            method: "POST",
            headers: taskHeaders,
            body: JSON.stringify({ error: args.error }),
          },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_task_my_tasks") {
        if (!args.agent) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: agent" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `https://tasks.chitty.cc/api/v1/tasks/agent/${encodeURIComponent(args.agent)}`,
          { headers: taskAuth },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyTask",
        );
        if (respErr) return respErr;
        result = data;
      } else {
        return {
          content: [{ type: "text", text: `Unknown task tool: ${name}` }],
          isError: true,
        };
      }
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
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (error) {
    console.error(`[MCP] Tool execution error for ${name}:`, error);
    return {
      content: [
        { type: "text", text: `Error executing ${name}: ${error.message}` },
      ],
      isError: true,
    };
  }
}
