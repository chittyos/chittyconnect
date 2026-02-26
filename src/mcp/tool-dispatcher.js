/**
 * Shared MCP Tool Dispatcher
 *
 * Extracted tool dispatch logic shared by the REST /mcp/tools/call endpoint,
 * the ChatGPT MCP protocol server, and the standalone mcp-server.js (stdio).
 *
 * @module mcp/tool-dispatcher
 */

import { getServiceToken } from "../lib/credential-helper.js";

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
    const token = await getServiceToken(env, serviceName);
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
      const response = await fetch(
        "https://mint.chitty.cc/api/mint",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entity_type: args.entity_type,
            metadata: args.metadata,
          }),
        },
      );
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
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/dashboard/stats",
        { headers: ledgerAuth },
      );
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `ChittyLedger error (${response.status}): ${await response.text().catch(() => "")}`.slice(
                0,
                300,
              ),
            },
          ],
          isError: true,
        };
      }
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_evidence") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/evidence?caseId=${encodeURIComponent(args.case_id)}`
        : "https://ledger.chitty.cc/api/evidence";
      const response = await fetch(url, { headers: ledgerAuth });
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `ChittyLedger error (${response.status}): ${await response.text().catch(() => "")}`.slice(
                0,
                300,
              ),
            },
          ],
          isError: true,
        };
      }
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_facts") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        `https://ledger.chitty.cc/api/evidence/${encodeURIComponent(args.evidence_id)}/facts`,
        { headers: ledgerAuth },
      );
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `ChittyLedger error (${response.status}): ${await response.text().catch(() => "")}`.slice(
                0,
                300,
              ),
            },
          ],
          isError: true,
        };
      }
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_fact_mint") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const evidenceRecord = await evidenceCheck.json().catch(() => null);
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_fact_validate") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_fact_seal") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }

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
      } else if (!env.PROOF_Q) {
        console.warn(
          `[MCP] PROOF_Q not configured. Fact ${args.fact_id} sealed without proof minting.`,
        );
        result.proof_queue_warning =
          "PROOF_Q binding not configured. Proof will not be minted.";
      }
    } else if (name === "chitty_fact_dispute") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_fact_export") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
        const factData = await factResp.json();

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
        const fetchErr = await checkFetchError(response, "ChittyLedger");
        if (fetchErr) return fetchErr;
        const text = await response.text();
        try {
          result = JSON.parse(text);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
              },
            ],
            isError: true,
          };
        }
      }
    } else if (name === "chitty_ledger_contradictions") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const url = args.case_id
        ? `https://ledger.chitty.cc/api/contradictions?caseId=${encodeURIComponent(args.case_id)}`
        : "https://ledger.chitty.cc/api/contradictions";
      const response = await fetch(url, { headers: ledgerAuth });
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `ChittyLedger error (${response.status}): ${await response.text().catch(() => "")}`.slice(
                0,
                300,
              ),
            },
          ],
          isError: true,
        };
      }
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // ── ChittyLedger chain tools (record, query, verify, statistics, custody) ──
    else if (name === "chitty_ledger_record") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch("https://ledger.chitty.cc/api/ledger", {
        method: "POST",
        headers: { ...ledgerAuth, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_query") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_verify") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/ledger/verify",
        { headers: ledgerAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_statistics") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
      if (ledgerErr) return ledgerErr;
      const response = await fetch(
        "https://ledger.chitty.cc/api/ledger/statistics",
        { headers: ledgerAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_ledger_chain_of_custody") {
      const { error: ledgerErr, headers: ledgerAuth } = await requireServiceAuth("chittyledger", "ChittyLedger");
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
      const fetchErr = await checkFetchError(response, "ChittyLedger");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Ledger returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // ── ChittyContextual tools ──────────────────────────────────────
    else if (name === "chitty_contextual_timeline") {
      const { error: ctxErr, headers: ctxAuth } = await requireServiceAuth("chittycontextual", "ChittyContextual");
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
      const fetchErr = await checkFetchError(response, "ChittyContextual");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Contextual returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
    } else if (name === "chitty_contextual_topics") {
      const { error: ctxErr, headers: ctxAuth } = await requireServiceAuth("chittycontextual", "ChittyContextual");
      if (ctxErr) return ctxErr;
      const response = await fetch("https://contextual.chitty.cc/api/topics", {
        method: "POST",
        headers: { ...ctxAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query }),
      });
      const fetchErr = await checkFetchError(response, "ChittyContextual");
      if (fetchErr) return fetchErr;
      const text = await response.text();
      try {
        result = JSON.parse(text);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Contextual returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
            },
          ],
          isError: true,
        };
      }
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch("https://finance.chitty.cc/api/entities", {
        headers: financeAuth,
      });
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_balances") {
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
      if (financeErr) return financeErr;
      const response = await fetch(
        `https://finance.chitty.cc/api/entities/${encodeURIComponent(args.entity)}/balances`,
        { headers: financeAuth },
      );
      const fetchErr = await checkFetchError(response, "ChittyFinance");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_finance_transactions") {
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const { error: financeErr, headers: financeAuth } = await requireServiceAuth("chittyfinance", "ChittyFinance");
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
      const allowedKeys = ["institution", "account_type", "query", "entity", "start", "end"];
      const safeArgs = Object.fromEntries(
        Object.entries(args).filter(([k]) => allowedKeys.includes(k)),
      );
      const response = await fetch(`${baseUrl}/api/chittyfinance/${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(safeArgs),
      });
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
      const response = await fetch(`${baseUrl}/api/v1/memory/persist`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: args.content || args.interaction,
          chitty_id: args.chitty_id,
          session_id: args.session_id,
          tags: args.tags,
        }),
      });
      const fetchErr = await checkFetchError(response, "MemoryPersist");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (
      name === "chitty_memory_recall" ||
      name === "memory_recall_context" ||
      name === "memory_recall"
    ) {
      const params = new URLSearchParams();
      if (args.query) params.set("query", args.query);
      if (args.chitty_id) params.set("chitty_id", args.chitty_id);
      if (args.session_id) params.set("session_id", args.session_id);
      if (args.limit) params.set("limit", String(args.limit));
      const response = await fetch(
        `${baseUrl}/api/v1/memory/recall?${params}`,
        { headers: authHeader },
      );
      const fetchErr = await checkFetchError(response, "MemoryRecall");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (
      name === "chitty_memory_session_summary" ||
      name === "memory_get_session_summary"
    ) {
      const response = await fetch(
        `${baseUrl}/api/v1/memory/session/${encodeURIComponent(args.session_id)}/summary`,
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
      const response = await fetch(`${baseUrl}/api/services/status`, {
        headers: authHeader,
      });
      const fetchErr = await checkFetchError(response, "ServiceHealth");
      if (fetchErr) return fetchErr;
      result = await response.json();
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
      const response = await fetch(`${baseUrl}/api/thirdparty/openai/chat`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "OpenAI");
      if (fetchErr) return fetchErr;
      result = await response.json();
    } else if (name === "chitty_neon_query") {
      const response = await fetch(`${baseUrl}/api/thirdparty/neon/query`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const fetchErr = await checkFetchError(response, "Neon");
      if (fetchErr) return fetchErr;
      result = await response.json();
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
