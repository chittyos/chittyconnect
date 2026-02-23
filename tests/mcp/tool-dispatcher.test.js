/**
 * Tool Dispatcher Tests
 *
 * Tests the shared MCP tool dispatch logic used by both
 * the REST /mcp/tools/call endpoint and the ChatGPT MCP server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchToolCall } from "../../src/mcp/tool-dispatcher.js";

// Mock credential-helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getServiceToken: vi.fn(),
}));

import { getServiceToken } from "../../src/lib/credential-helper.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CF_ACCOUNT_ID: "test-account-id",
  AI_SEARCH_TOKEN: "test-ai-token",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchToolCall", () => {
  // ── Identity tools ──────────────────────────────────────────────

  describe("chitty_id_mint", () => {
    it("returns error when no service token available", async () => {
      getServiceToken.mockResolvedValue(null);

      const result = await dispatchToolCall("chitty_id_mint", { entity_type: "PERSON" }, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication required");
    });

    it("calls ChittyID service and returns result", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ chitty_id: "01-P-USA-1234-P-2601-A-X", success: true }),
      });

      const result = await dispatchToolCall(
        "chitty_id_mint",
        { entity_type: "PERSON", metadata: { name: "Test" } },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.chitty_id).toBe("01-P-USA-1234-P-2601-A-X");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://id.chitty.cc/api/v2/chittyid/mint",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer svc-token-123" }),
        }),
      );
    });

    it("returns error on upstream failure", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await dispatchToolCall("chitty_id_mint", { entity_type: "PERSON" }, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ChittyID error (500)");
    });
  });

  describe("chitty_id_validate", () => {
    it("returns error when no service token available", async () => {
      getServiceToken.mockResolvedValue(null);

      const result = await dispatchToolCall(
        "chitty_id_validate",
        { chitty_id: "01-P-USA-1234-P-2601-A-X" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication required");
    });

    it("validates a ChittyID successfully", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true, entity_type: "PERSON" }),
      });

      const result = await dispatchToolCall(
        "chitty_id_validate",
        { chitty_id: "01-P-USA-1234-P-2601-A-X" },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.valid).toBe(true);
    });
  });

  // ── Case tools ──────────────────────────────────────────────────

  describe("chitty_case_create", () => {
    it("creates a case via baseUrl proxy", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ case_id: "case-123", status: "created" }),
      });

      const result = await dispatchToolCall(
        "chitty_case_create",
        { case_type: "civil", parties: [] },
        mockEnv,
        { baseUrl: "https://test.chitty.cc" },
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.case_id).toBe("case-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.chitty.cc/api/chittycases/create",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("chitty_case_get", () => {
    it("retrieves a case by ID", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ case_id: "case-123", case_type: "civil" }),
      });

      const result = await dispatchToolCall(
        "chitty_case_get",
        { case_id: "case-123" },
        mockEnv,
        { baseUrl: "https://test.chitty.cc" },
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.case_id).toBe("case-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.chitty.cc/api/chittycases/case-123",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ── ChittyLedger tools ─────────────────────────────────────────

  describe("chitty_ledger_stats", () => {
    it("fetches dashboard stats", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ total_cases: 5, total_evidence: 42 }),
      });

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total_cases).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith("https://ledger.chitty.cc/api/dashboard/stats");
    });

    it("handles non-JSON response gracefully", async () => {
      mockFetch.mockResolvedValue({
        status: 502,
        text: async () => "<html>Bad Gateway</html>",
      });

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Ledger returned (502)");
    });
  });

  describe("chitty_ledger_evidence", () => {
    it("fetches all evidence without filter", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ evidence: [] }),
      });

      await dispatchToolCall("chitty_ledger_evidence", {}, mockEnv);

      expect(mockFetch).toHaveBeenCalledWith("https://ledger.chitty.cc/api/evidence");
    });

    it("filters evidence by case_id", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ evidence: [{ id: "e1" }] }),
      });

      await dispatchToolCall(
        "chitty_ledger_evidence",
        { case_id: "case-abc" },
        mockEnv,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence?caseId=case-abc",
      );
    });
  });

  describe("chitty_ledger_facts", () => {
    it("fetches facts for an evidence item", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ facts: [{ text: "Amount was $500k" }] }),
      });

      await dispatchToolCall(
        "chitty_ledger_facts",
        { evidence_id: "ev-123" },
        mockEnv,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/ev-123/facts",
      );
    });
  });

  describe("chitty_ledger_contradictions", () => {
    it("fetches contradictions with optional case filter", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ contradictions: [] }),
      });

      await dispatchToolCall("chitty_ledger_contradictions", { case_id: "c-1" }, mockEnv);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/contradictions?caseId=c-1",
      );
    });
  });

  // ── Fact Governance tools ────────────────────────────────────────

  describe("chitty_fact_mint", () => {
    it("blocks minting when evidence_id not found in ledger", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await dispatchToolCall(
        "chitty_fact_mint",
        { evidence_id: "nonexistent-ev", text: "Some claim" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Fact minting blocked");
      expect(result.content[0].text).toContain("not found in ChittyLedger");
      // Should NOT have called the facts endpoint
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/nonexistent-ev",
      );
    });

    it("creates a fact after verifying evidence exists, anchors file_hash", async () => {
      // First call: evidence check (returns evidence with file_hash)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ evidence_id: "ev-123", file_hash: "abc123sha256" }),
      });
      // Second call: POST to facts endpoint
      mockFetch.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({ fact_id: "fact-001", status: "draft", text: "Purchase price was $450,000" }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_mint",
        {
          evidence_id: "ev-123",
          case_id: "case-abc",
          text: "Purchase price was $450,000",
          confidence: 0.95,
          source_reference: "Page 3, paragraph 2",
          category: "financial",
        },
        mockEnv,
      );

      // Verify evidence check happened first
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/ev-123",
      );
      // Verify fact creation
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/facts",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.evidence_id).toBe("ev-123");
      expect(body.text).toBe("Purchase price was $450,000");
      expect(body.confidence).toBe(0.95);
      expect(body.evidence_hash_at_mint).toBe("abc123sha256");

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.fact_id).toBe("fact-001");
      expect(parsed.status).toBe("draft");
    });

    it("handles ledger error on mint after evidence check passes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ evidence_id: "ev-123" }),
      });
      mockFetch.mockResolvedValueOnce({
        status: 422,
        text: async () => "Validation failed: text is required",
      });

      const result = await dispatchToolCall(
        "chitty_fact_mint",
        { evidence_id: "ev-123", text: "" },
        mockEnv,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Ledger returned (422)");
    });
  });

  describe("chitty_fact_validate", () => {
    it("blocks validation when corroborating evidence not found", async () => {
      // First corroborating evidence check passes
      mockFetch.mockResolvedValueOnce({ ok: true });
      // Second corroborating evidence check fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await dispatchToolCall(
        "chitty_fact_validate",
        {
          fact_id: "fact-001",
          validation_method: "cross_reference",
          corroborating_evidence: ["ev-456", "ev-missing"],
        },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation blocked");
      expect(result.content[0].text).toContain("ev-missing");
    });

    it("validates a fact after verifying all corroborating evidence exists", async () => {
      // Two corroborating evidence checks pass
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockFetch.mockResolvedValueOnce({ ok: true });
      // Validate endpoint
      mockFetch.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            fact_id: "fact-001",
            previous_status: "draft",
            new_status: "verified",
            validation_method: "cross_reference",
          }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_validate",
        {
          fact_id: "fact-001",
          validation_method: "cross_reference",
          corroborating_evidence: ["ev-456", "ev-789"],
          notes: "Confirmed by closing disclosure and settlement statement",
        },
        mockEnv,
      );

      // Verify evidence checks happened
      expect(mockFetch).toHaveBeenCalledWith("https://ledger.chitty.cc/api/evidence/ev-456");
      expect(mockFetch).toHaveBeenCalledWith("https://ledger.chitty.cc/api/evidence/ev-789");
      // Verify validate call
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/facts/fact-001/validate",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body.validation_method).toBe("cross_reference");
      expect(body.corroborating_evidence).toEqual(["ev-456", "ev-789"]);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.new_status).toBe("verified");
    });

    it("validates without corroborating evidence (skips pre-flight)", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({ fact_id: "fact-001", new_status: "verified" }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_validate",
        { fact_id: "fact-001", validation_method: "expert_review" },
        mockEnv,
      );

      // Only one fetch call — no evidence pre-flight needed
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.new_status).toBe("verified");
    });

    it("handles validation failure from ledger", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 409,
        text: async () => JSON.stringify({ error: "Fact is already locked" }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_validate",
        { fact_id: "fact-locked", validation_method: "expert_review" },
        mockEnv,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("Fact is already locked");
    });
  });

  // ── ChittyContextual tools ─────────────────────────────────────

  describe("chitty_contextual_timeline", () => {
    it("fetches timeline with query params", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ messages: [] }),
      });

      await dispatchToolCall(
        "chitty_contextual_timeline",
        { party: "john@example.com", source: "email" },
        mockEnv,
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("contextual.chitty.cc/api/messages");
      expect(calledUrl).toContain("party=john%40example.com");
      expect(calledUrl).toContain("source=email");
    });
  });

  describe("chitty_contextual_topics", () => {
    it("sends topic query via POST", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ topics: ["rent", "deposit"] }),
      });

      await dispatchToolCall(
        "chitty_contextual_topics",
        { query: "rent disputes" },
        mockEnv,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://contextual.chitty.cc/api/topics",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "rent disputes" }),
        }),
      );
    });
  });

  // ── Evidence AI Search tools ───────────────────────────────────

  describe("chitty_evidence_search", () => {
    it("returns error when AI_SEARCH_TOKEN not set", async () => {
      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "closing disclosure" },
        { CF_ACCOUNT_ID: "test" }, // no AI_SEARCH_TOKEN
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("AI Search not configured");
    });

    it("formats search results with scores and filenames", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            result: {
              chunks: [
                { item: { key: "closing-disclosure.pdf" }, score: 0.92, text: "Purchase price was $450,000" },
                { item: { key: "settlement-stmt.pdf" }, score: 0.78, text: "Wire transfer of $112,500" },
              ],
            },
          }),
      });

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "purchase price" },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("[0.920] closing-disclosure.pdf");
      expect(result.content[0].text).toContain("Purchase price was $450,000");
    });

    it("returns no matching documents message when empty", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ success: true, result: { chunks: [] } }),
      });

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "nonexistent" },
        mockEnv,
      );

      expect(result.content[0].text).toBe("No matching documents found.");
    });

    it("returns error on API failure", async () => {
      mockFetch.mockResolvedValue({
        status: 403,
        text: async () => JSON.stringify({ success: false, errors: [{ message: "forbidden" }] }),
      });

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "test" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("AI Search error (403)");
    });
  });

  describe("chitty_evidence_retrieve", () => {
    it("passes max_num_results to API", async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ success: true, result: { chunks: [] } }),
      });

      await dispatchToolCall(
        "chitty_evidence_retrieve",
        { query: "wire transfer", max_num_results: 5 },
        mockEnv,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_num_results).toBe(5);
    });
  });

  // ── Service health tools ───────────────────────────────────────

  describe("chitty_services_status", () => {
    it("fetches service status", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ services: { chittyid: "healthy" } }),
      });

      await dispatchToolCall("chitty_services_status", {}, mockEnv, {
        baseUrl: "https://test.chitty.cc",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test.chitty.cc/api/services/status",
        expect.any(Object),
      );
    });
  });

  // ── Unknown tool ───────────────────────────────────────────────

  describe("unknown tool", () => {
    it("returns error for unrecognized tool name", async () => {
      const result = await dispatchToolCall("nonexistent_tool", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool: nonexistent_tool");
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe("error handling", () => {
    it("catches fetch exceptions and returns MCP error", async () => {
      getServiceToken.mockResolvedValue("token");
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await dispatchToolCall("chitty_id_mint", { entity_type: "PERSON" }, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Network timeout");
    });
  });

  // ── Auth token forwarding ──────────────────────────────────────

  describe("auth token forwarding", () => {
    it("includes Authorization header when authToken provided", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ success: true }),
      });

      await dispatchToolCall(
        "chitty_case_create",
        { case_type: "civil", parties: [] },
        mockEnv,
        { baseUrl: "https://test.chitty.cc", authToken: "user-jwt-abc" },
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer user-jwt-abc");
    });
  });

  // ── Fact Governance (seal, dispute, export) ──────────────────────

  describe("chitty_fact_seal", () => {
    it("returns RBAC error when trust level insufficient", async () => {
      // Mock trust resolver: low trust
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trust_level: 2, entity_type: "P" }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-P-USA-1234-P-2601-A-X" },
        envWithCache,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Permission denied");
    });

    it("seals fact and enqueues proof job on success", async () => {
      // Mock trust resolver: Authority with INSTITUTIONAL trust
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trust_level: 4, entity_type: "A" }),
      });
      // Mock ChittyLedger seal response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ fact_id: "fact-1", status: "sealed", proof_status: "PENDING" }),
      });

      const mockProofQ = { send: vi.fn() };
      const envWithQueue = {
        ...mockEnv,
        PROOF_Q: mockProofQ,
        CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-A-USA-5678-A-2601-B-X" },
        envWithQueue,
      );

      expect(result.isError).toBeUndefined();
      expect(mockProofQ.send).toHaveBeenCalled();
    });
  });

  describe("chitty_fact_dispute", () => {
    it("creates dispute via ChittyLedger", async () => {
      // Mock trust resolver
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trust_level: 2, entity_type: "P" }),
      });
      // Mock ledger dispute response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ fact_id: "fact-1", status: "disputed", dispute_id: "d-1" }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_dispute",
        { fact_id: "fact-1", reason: "Contradicted by evidence ev-2", actor_chitty_id: "01-P-USA-1234-P-2601-A-X" },
        envWithCache,
      );

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text).dispute_id).toBe("d-1");
    });
  });

  describe("chitty_fact_export", () => {
    it("returns JSON proof bundle", async () => {
      // Mock trust resolver
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trust_level: 1, entity_type: "P" }),
      });
      // Mock ledger fact+proof response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ fact_id: "fact-1", proof_id: "proof-1", verification_url: "https://proof.chitty.cc/verify/proof-1" }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_export",
        { fact_id: "fact-1", format: "json", actor_chitty_id: "01-P-USA-1234-P-2601-A-X" },
        envWithCache,
      );

      expect(result.isError).toBeUndefined();
    });
  });
});
