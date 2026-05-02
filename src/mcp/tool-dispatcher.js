/**
 * Shared MCP Tool Dispatcher
 *
 * Extracted tool dispatch logic shared by the REST /mcp/tools/call endpoint,
 * the ChatGPT MCP protocol server, and the standalone mcp-server.js (stdio).
 *
 * @module mcp/tool-dispatcher
 */

import { getCredential, getServiceToken, getMintAuthToken } from "../lib/credential-helper.js";
import { serviceFetch } from "../lib/service-switch.js";
import {
  getCloudflareApiCredentials,
  parseTimeframe,
} from "../lib/cloudflare-api-helper.js";
import { getServiceCatalog } from "../lib/service-catalog.js";
import { Client } from "@neondatabase/serverless";

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

async function fetchServiceStatusSnapshot(env) {
  const statusChecks = getServiceCatalog(env).map(async (service) => {
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
              text: "Cloudflare account ID not configured (set CHITTYOS_ACCOUNT_ID)",
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
      const { token: serviceToken, source: mintTokenSource } =
        await getMintAuthToken(env);
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
      if (mintTokenSource === "legacy-webhook-secret") {
        console.warn(
          "[policy] chitty_id_mint using deprecated CHITTYMINT_SECRET; migrate to CHITTYAUTH_ISSUED_MINT_TOKEN/MINT_API_KEY",
        );
      }
      const response = await serviceFetch(env, "mint", "/api/mint", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          "Content-Type": "application/json",
        },
        body: {
          entity_type: args.entity_type,
          metadata: args.metadata,
        },
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
      const response = await serviceFetch(
        env,
        "id",
        `/api/v2/chittyid/validate/${encodeURIComponent(args.chitty_id)}`,
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
      const response = await serviceFetch(env, "ledger", "/api/dashboard/stats");
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_evidence") {
      const url = args.case_id
        ? `/api/evidence?caseId=${encodeURIComponent(args.case_id)}`
        : "/api/evidence";
      const response = await serviceFetch(env, "ledger", url);
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_facts") {
      const response = await serviceFetch(
        env,
        "ledger",
        `/api/evidence/${encodeURIComponent(args.evidence_id)}/facts`,
        {},
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_mint") {
      // Pre-flight: verify the cited evidence exists in ChittyLedger
      const evidenceCheck = await serviceFetch(
        env,
        "ledger",
        `/api/evidence/${encodeURIComponent(args.evidence_id)}`,
        {},
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

      const response = await serviceFetch(env, "ledger", "/api/facts", {
        method: "POST",

        body: {
          evidence_id: args.evidence_id,
          case_id: args.case_id,
          text: args.text,
          confidence: args.confidence,
          source_reference: args.source_reference,
          category: args.category,
          // Anchor fact to evidence integrity state at mint time
          evidence_hash_at_mint: evidenceHash,
        },
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_validate") {
      // Pre-flight: verify all corroborating evidence IDs exist (parallel)
      if (args.corroborating_evidence?.length) {
        const checks = await Promise.all(
          args.corroborating_evidence.map(async (evId) => {
            const resp = await serviceFetch(
              env,
              "ledger",
              `/api/evidence/${encodeURIComponent(evId)}`,
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

      const response = await serviceFetch(
        env,
        "ledger",
        `/api/facts/${encodeURIComponent(args.fact_id)}/validate`,
        {
          method: "POST",

          body: {
            validation_method: args.validation_method,
            corroborating_evidence: args.corroborating_evidence,
            notes: args.notes,
          },
        },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_seal") {
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
      const response = await serviceFetch(
        env,
        "ledger",
        `/api/facts/${encodeURIComponent(args.fact_id)}/seal`,
        {
          method: "POST",

          body: {
            sealed_by: args.actor_chitty_id,
            seal_reason: args.seal_reason,
          },
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
            const resp = await serviceFetch(
              env,
              "ledger",
              `/api/evidence/${encodeURIComponent(evId)}`,
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

      const response = await serviceFetch(
        env,
        "ledger",
        `/api/facts/${encodeURIComponent(args.fact_id)}/dispute`,
        {
          method: "POST",

          body: {
            reason: args.reason,
            challenger_chitty_id:
              args.challenger_chitty_id || args.actor_chitty_id,
            counter_evidence_ids: args.counter_evidence_ids,
          },
        },
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_fact_export") {
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
        const factResp = await serviceFetch(
          env,
          "ledger",
          `/api/facts/${encodeURIComponent(args.fact_id)}/export`,
          {},
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
        const response = await serviceFetch(
          env,
          "ledger",
          `/api/facts/${encodeURIComponent(args.fact_id)}/export`,
          {},
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "ChittyLedger",
        );
        if (respErr) return respErr;
        result = data;
      }
    } else if (name === "chitty_ledger_contradictions") {
      const url = args.case_id
        ? `/api/contradictions?caseId=${encodeURIComponent(args.case_id)}`
        : "/api/contradictions";
      const response = await serviceFetch(env, "ledger", url);
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── ChittyLedger chain tools (record, query, verify, statistics, custody) ──
    else if (name === "chitty_ledger_record") {
      const response = await serviceFetch(env, "ledger", "/api/ledger", {
        method: "POST",

        body: JSON.stringify(args),
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_query") {
      const params = new URLSearchParams();
      if (args.record_type) params.set("type", args.record_type);
      if (args.entity_id) params.set("entity_id", args.entity_id);
      if (args.actor) params.set("actor", args.actor);
      if (args.status) params.set("status", args.status);
      if (args.limit) params.set("limit", String(args.limit));
      const response = await serviceFetch(
        env,
        "ledger",
        `/api/ledger?${params}`,
        {},
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_verify") {
      const response = await serviceFetch(env, "ledger", "/api/ledger/verify");
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_statistics") {
      const response = await serviceFetch(
        env,
        "ledger",
        "/api/ledger/statistics",
      );
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyLedger",
      );
      if (respErr) return respErr;
      result = data;
    } else if (name === "chitty_ledger_custody") {
      if (!args.entity_id) {
        return {
          content: [
            { type: "text", text: "Missing required parameter: entity_id" },
          ],
          isError: true,
        };
      }
      const response = await serviceFetch(
        env,
        "ledger",
        `/api/ledger/${encodeURIComponent(args.entity_id)}/custody`,
        {},
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
      const response = await serviceFetch(
        env,
        "contextual",
        `/api/messages?${params.toString()}`,
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
      const response = await serviceFetch(env, "contextual", "/api/topics", {
        method: "POST",
        headers: { ...ctxAuth, "Content-Type": "application/json" },
        body: { query: args.query },
      });
      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyContextual",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── Evidence AI Search tools ────────────────────────────────────
    // ── Evidence tools — delegated to ChittyStorage (search/retrieve/ingest) ──
    else if (name === "chitty_evidence_search") {
      if (!env.SVC_STORAGE) {
        return { content: [{ type: "text", text: "ChittyStorage not configured (SVC_STORAGE binding missing)" }], isError: true };
      }
      const params = new URLSearchParams({ q: args.query || "", limit: String(args.max_num_results || 10) });
      if (args.entity_slug) params.set("entity", args.entity_slug);
      const response = await env.SVC_STORAGE.fetch(`https://internal/api/docs?${params}`);
      const data = await response.json();
      if (!data.docs || !data.docs.length) {
        return { content: [{ type: "text", text: "No matching documents found." }] };
      }
      const formatted = data.docs.slice(0, 10).map((d) => {
        const tags = d.tags || {};
        const entity = tags.primary_entity || "unlinked";
        const docType = tags.doc_type || "unclassified";
        return `[${entity}/${docType}] ${d.filename}\n  hash: ${d.content_hash}\n  tier: ${d.processing_tier} | created: ${d.created_at}`;
      }).join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    } else if (name === "chitty_evidence_retrieve") {
      if (!env.SVC_STORAGE) {
        return { content: [{ type: "text", text: "ChittyStorage not configured (SVC_STORAGE binding missing)" }], isError: true };
      }
      const hash = args.content_hash || args.evidence_id || args.query;
      if (!hash) {
        return { content: [{ type: "text", text: "Provide content_hash, evidence_id, or query to retrieve." }], isError: true };
      }
      const response = await env.SVC_STORAGE.fetch(`https://internal/api/docs?q=${encodeURIComponent(hash)}&limit=1`);
      const data = await response.json();
      if (!data.docs?.length) {
        return { content: [{ type: "text", text: `Document not found: ${hash}` }], isError: true };
      }
      const doc = data.docs[0];
      result = {
        chitty_id: doc.chitty_id,
        content_hash: doc.content_hash,
        filename: doc.filename,
        processing_tier: doc.processing_tier,
        tags: doc.tags || {},
        entities: doc.entities || [],
        file_url: `https://storage.chitty.cc/api/files/${doc.content_hash}`,
      };
    }

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
      const response = await serviceFetch(env, "finance", "/api/entities", {});
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_balances") {
      const response = await serviceFetch(
        env,
        "finance",
        `/api/entities/${encodeURIComponent(args.entity)}/balances`,
        {},
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_transactions") {
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await serviceFetch(
        env,
        "finance",
        `/api/entities/${encodeURIComponent(args.entity)}/transactions?${params}`,
        {},
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_cash_flow") {
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await serviceFetch(
        env,
        "finance",
        `/api/entities/${encodeURIComponent(args.entity)}/cash-flow?${params}`,
        {},
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_inter_entity") {
      const params = new URLSearchParams();
      if (args.entity) params.set("entity", args.entity);
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await serviceFetch(
        env,
        "finance",
        `/api/transfers/inter-entity?${params}`,
        {},
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_xfer_detect") {
      const response = await serviceFetch(
        env,
        "finance",
        "/api/transfers/detect",
        {
          method: "POST",

          body: {
            entity: args.entity,
            start: args.start,
            end: args.end,
            threshold: args.threshold,
          },
        },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_flow_of_funds") {
      const params = new URLSearchParams();
      if (args.start) params.set("start", args.start);
      if (args.end) params.set("end", args.end);
      const response = await serviceFetch(
        env,
        "finance",
        `/api/reports/flow-of-funds?${params}`,
        {},
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_sync") {
      const response = await serviceFetch(env, "finance", "/api/sync/mercury", {
        method: "POST",
      });
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
    } else if (name === "experience_migrate") {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/experience/migrate`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            manifest: args.manifest,
            metrics_transferred: args.metrics_transferred,
          }),
        },
      );
      const fetchErr = await checkFetchError(response, "ExperienceMigrate");
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
      result = await fetchServiceStatusSnapshot(env);
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
    // Tasks — via service binding (no Bearer token needed)
    else if (name.startsWith("chitty_task_")) {
      let response;

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
        response = await serviceFetch(env, "tasks", "/api/v1/tasks", {
          method: "POST",
          body,
        });
      } else if (name === "chitty_task_list") {
        const params = new URLSearchParams();
        if (args.agent) params.set("agent", args.agent);
        if (args.status) params.set("status", args.status);
        if (args.task_type) params.set("task_type", args.task_type);
        if (args.limit !== undefined) params.set("limit", String(args.limit));
        if (args.offset !== undefined)
          params.set("offset", String(args.offset));
        const qs = params.toString() ? `?${params}` : "";
        response = await serviceFetch(env, "tasks", `/api/v1/tasks${qs}`);
      } else if (name === "chitty_task_get") {
        if (!args.task_id)
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        response = await serviceFetch(
          env,
          "tasks",
          `/api/v1/tasks/${encodeURIComponent(args.task_id)}`,
        );
      } else if (name === "chitty_task_claim") {
        if (!args.task_id)
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        const qs = args.agent ? `?agent=${encodeURIComponent(args.agent)}` : "";
        response = await serviceFetch(
          env,
          "tasks",
          `/api/v1/tasks/${encodeURIComponent(args.task_id)}/claim${qs}`,
          {
            method: "POST",
            headers: args.agent ? { "X-ChittyOS-Caller": args.agent } : {},
          },
        );
      } else if (name === "chitty_task_complete") {
        if (!args.task_id)
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        response = await serviceFetch(
          env,
          "tasks",
          `/api/v1/tasks/${encodeURIComponent(args.task_id)}/complete`,
          {
            method: "POST",
            body: args.result ? { result: args.result } : {},
          },
        );
      } else if (name === "chitty_task_fail") {
        if (!args.task_id)
          return {
            content: [
              { type: "text", text: "Missing required parameter: task_id" },
            ],
            isError: true,
          };
        if (!args.error)
          return {
            content: [
              { type: "text", text: "Missing required parameter: error" },
            ],
            isError: true,
          };
        response = await serviceFetch(
          env,
          "tasks",
          `/api/v1/tasks/${encodeURIComponent(args.task_id)}/fail`,
          {
            method: "POST",
            body: { error: args.error },
          },
        );
      } else if (name === "chitty_task_my_tasks") {
        if (!args.agent)
          return {
            content: [
              { type: "text", text: "Missing required parameter: agent" },
            ],
            isError: true,
          };
        response = await serviceFetch(
          env,
          "tasks",
          `/api/v1/tasks/agent/${encodeURIComponent(args.agent)}`,
        );
      } else {
        return {
          content: [{ type: "text", text: `Unknown task tool: ${name}` }],
          isError: true,
        };
      }

      const { data, error: respErr } = await checkAndParseJson(
        response,
        "ChittyTask",
      );
      if (respErr) return respErr;
      result = data;
    }

    // ── Tenant Management tools ─────────────────────────────────────
    // Project-per-tenant Neon isolation — provision, query, export
    // Routes to local /api/v1/tenants endpoints via authHeader (same worker)
    else if (name.startsWith("chitty_tenant_")) {
      if (name === "chitty_tenant_provision") {
        if (!args.tenant_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: tenant_id" },
            ],
            isError: true,
          };
        }
        const response = await fetch(`${baseUrl}/api/v1/tenants/provision`, {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: args.tenant_id,
            region: args.region,
            pgVersion: args.pg_version,
          }),
        });
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "TenantProvision",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_tenant_get") {
        if (!args.tenant_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: tenant_id" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `${baseUrl}/api/v1/tenants/${encodeURIComponent(args.tenant_id)}`,
          { headers: authHeader },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "TenantGet",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_tenant_list") {
        const params = new URLSearchParams();
        if (args.status) params.set("status", args.status);
        if (args.limit !== undefined) params.set("limit", String(args.limit));
        if (args.offset !== undefined)
          params.set("offset", String(args.offset));
        const qs = params.toString() ? `?${params}` : "";
        const response = await fetch(`${baseUrl}/api/v1/tenants${qs}`, {
          headers: authHeader,
        });
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "TenantList",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_tenant_deprovision") {
        if (!args.tenant_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: tenant_id" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `${baseUrl}/api/v1/tenants/${encodeURIComponent(args.tenant_id)}`,
          { method: "DELETE", headers: authHeader },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "TenantDeprovision",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_tenant_export") {
        if (!args.tenant_id) {
          return {
            content: [
              { type: "text", text: "Missing required parameter: tenant_id" },
            ],
            isError: true,
          };
        }
        const response = await fetch(
          `${baseUrl}/api/v1/tenants/${encodeURIComponent(args.tenant_id)}/export`,
          { method: "POST", headers: authHeader },
        );
        const { data, error: respErr } = await checkAndParseJson(
          response,
          "TenantExport",
        );
        if (respErr) return respErr;
        result = data;
      } else if (name === "chitty_tenant_query") {
        if (!args.tenant_id || !args.query) {
          return {
            content: [
              {
                type: "text",
                text: "Missing required parameters: tenant_id and query",
              },
            ],
            isError: true,
          };
        }
        // Safety: block mutations via MCP — check prefix, semicolons, and DML in CTEs
        const trimmed = args.query.trim();
        const normalized = trimmed.toUpperCase();
        if (
          !normalized.startsWith("SELECT") &&
          !normalized.startsWith("WITH")
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Only SELECT/WITH queries are allowed via MCP tenant_query. Use the REST API for mutations.",
              },
            ],
            isError: true,
          };
        }
        // Block multi-statement injection (SELECT 1; DROP TABLE ...)
        if (trimmed.includes(";")) {
          return {
            content: [
              {
                type: "text",
                text: "Multi-statement queries (semicolons) are not allowed via MCP tenant_query.",
              },
            ],
            isError: true,
          };
        }
        // Block data-modifying CTEs (WITH deleted AS (DELETE FROM ...))
        const dmlPattern =
          /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i;
        if (normalized.startsWith("WITH") && dmlPattern.test(trimmed)) {
          return {
            content: [
              {
                type: "text",
                text: "Data-modifying CTEs are not allowed via MCP tenant_query. Use the REST API for mutations.",
              },
            ],
            isError: true,
          };
        }

        const { queryTenantDb } =
          await import("../lib/tenant-connection-router.js");
        const queryResult = await queryTenantDb(
          env,
          args.tenant_id,
          args.query,
          args.params || [],
        );
        result = { rows: queryResult.rows, layer: queryResult.layer };
      } else {
        return {
          content: [{ type: "text", text: `Unknown tenant tool: ${name}` }],
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
