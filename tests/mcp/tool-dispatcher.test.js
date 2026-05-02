/**
 * Tool Dispatcher Tests
 *
 * Tests the shared MCP tool dispatch logic used by both
 * the REST /mcp/tools/call endpoint and the ChatGPT MCP server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const neonMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock("@neondatabase/serverless", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      connect: neonMocks.connect,
      query: neonMocks.query,
      end: neonMocks.end,
    };
  }),
}));

import { dispatchToolCall } from "../../src/mcp/tool-dispatcher.js";
import { Client } from "@neondatabase/serverless";

// Mock credential-helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn(),
  getServiceToken: vi.fn(),
  getMintAuthToken: vi.fn(),
}));

import {
  getCredential,
  getServiceToken,
  getMintAuthToken,
} from "../../src/lib/credential-helper.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const mockStorageFetch = vi.fn();

// Mock service-switch: serviceFetch delegates to global fetch so existing
// mockFetch expectations continue to work. Reconstructs realistic URLs
// from (serviceName, path) so URL-based assertions in tests still pass.
const SERVICE_URL_MAP = {
  mint: "https://mint.chitty.cc",
  id: "https://id.chitty.cc",
  ledger: "https://ledger.chitty.cc",
  evidence: "https://evidence.chitty.cc",
  finance: "https://finance.chitty.cc",
  cases: "https://cases.chitty.cc",
  chronicle: "https://chronicle.chitty.cc",
  contextual: "https://contextual.chitty.cc",
  dispute: "https://dispute.chitty.cc",
  score: "https://score.chitty.cc",
  tasks: "https://tasks.chitty.cc",
};
// Import getServiceToken so the mock can read its return value
const { getServiceToken: _gst } = await import(
  "../../src/lib/credential-helper.js"
);
vi.mock("../../src/lib/service-switch.js", () => ({
  serviceFetch: vi.fn(async (_env, svc, path, options = {}) => {
    const base = SERVICE_URL_MAP[svc] || `https://${svc}.chitty.cc`;
    // Simulate HTTP mode: resolve service token and add Authorization header
    let token;
    try {
      token = await _gst(_env, svc);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: `Authentication failed: ${err.message}`,
          service: svc,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!token) {
      // Simulate service switch returning 503 for missing auth
      return new Response(
        JSON.stringify({
          error: `Authentication required for ${svc}`,
          service: svc,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    const headers = { ...options.headers };
    headers.Authorization = `Bearer ${token}`;
    const fetchOpts = { headers };
    if (options.method) fetchOpts.method = options.method;
    if (options.body) fetchOpts.body = JSON.stringify(options.body);
    return fetch(`${base}${path}`, fetchOpts);
  }),
  getSwitch: vi.fn().mockResolvedValue({ enabled: true, mode: "http" }),
  invalidateSwitchCache: vi.fn(),
}));

const mockEnv = {
  CHITTYOS_ACCOUNT_ID: "test-account-id",
  AI_SEARCH_TOKEN: "test-ai-token",
  SVC_STORAGE: {
    fetch: mockStorageFetch,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getMintAuthToken.mockResolvedValue({ token: null, source: "none" });
  neonMocks.connect.mockReset();
  neonMocks.query.mockReset();
  neonMocks.end.mockReset();
  mockStorageFetch.mockReset();
});

describe("dispatchToolCall", () => {
  // ── Identity tools ──────────────────────────────────────────────

  describe("chitty_id_mint", () => {
    it("returns error when no service token available", async () => {
      getMintAuthToken.mockResolvedValue({ token: null, source: "none" });

      const result = await dispatchToolCall(
        "chitty_id_mint",
        { entity_type: "PERSON" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication required");
    });

    it("calls ChittyMint service and returns result", async () => {
      getMintAuthToken.mockResolvedValue({
        token: "svc-token-123",
        source: "auth-issued",
      });
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          chitty_id: "01-P-USA-1234-P-2601-A-X",
          success: true,
        }),
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
        "https://mint.chitty.cc/api/mint",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer svc-token-123",
          }),
        }),
      );
    });

    it("returns error on upstream failure", async () => {
      getMintAuthToken.mockResolvedValue({
        token: "svc-token-123",
        source: "auth-issued",
      });
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await dispatchToolCall(
        "chitty_id_mint",
        { entity_type: "PERSON" },
        mockEnv,
      );

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
        ok: true,
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
        ok: true,
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
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("fetches dashboard stats", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ total_cases: 5, total_evidence: 42 }),
      });

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total_cases).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/dashboard/stats",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });

    it("handles non-OK response with error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "<html>Bad Gateway</html>",
      });

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ChittyLedger error (502)");
    });
  });

  describe("chitty_ledger_evidence", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("fetches all evidence without filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ evidence: [] }),
      });

      await dispatchToolCall("chitty_ledger_evidence", {}, mockEnv);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });

    it("filters evidence by case_id", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });
  });

  describe("chitty_ledger_facts", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("fetches facts for an evidence item", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ facts: [{ text: "Amount was $500k" }] }),
      });

      await dispatchToolCall(
        "chitty_ledger_facts",
        { evidence_id: "ev-123" },
        mockEnv,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/ev-123/facts",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });
  });

  describe("chitty_ledger_contradictions", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("fetches contradictions with optional case filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ contradictions: [] }),
      });

      await dispatchToolCall(
        "chitty_ledger_contradictions",
        { case_id: "c-1" },
        mockEnv,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/contradictions?caseId=c-1",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });
  });

  // ── Fact Governance tools ────────────────────────────────────────

  describe("chitty_fact_mint", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

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
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
    });

    it("creates a fact after verifying evidence exists, anchors file_hash", async () => {
      // First call: evidence check (returns evidence with file_hash)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          evidence_id: "ev-123",
          file_hash: "abc123sha256",
        }),
      });
      // Second call: POST to facts endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            fact_id: "fact-001",
            status: "draft",
            text: "Purchase price was $450,000",
          }),
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
        { headers: { Authorization: "Bearer svc-token-123" } },
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
        ok: false,
        status: 422,
        text: async () => "Validation failed: text is required",
      });

      const result = await dispatchToolCall(
        "chitty_fact_mint",
        { evidence_id: "ev-123", text: "" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ChittyLedger error (422)");
    });
  });

  describe("chitty_fact_validate", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

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
        ok: true,
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
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/ev-456",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://ledger.chitty.cc/api/evidence/ev-789",
        { headers: { Authorization: "Bearer svc-token-123" } },
      );
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
        ok: true,
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
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ error: "Fact is already locked" }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_validate",
        { fact_id: "fact-locked", validation_method: "expert_review" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ChittyLedger error (409)");
    });
  });

  // ── ChittyContextual tools ─────────────────────────────────────

  describe("chitty_contextual_timeline", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("fetches timeline with query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
      // Verify auth header is passed
      expect(mockFetch.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          headers: { Authorization: "Bearer svc-token-123" },
        }),
      );
    });
  });

  describe("chitty_contextual_topics", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("sends topic query via POST", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
          headers: expect.objectContaining({
            Authorization: "Bearer svc-token-123",
          }),
          body: JSON.stringify({ query: "rent disputes" }),
        }),
      );
    });
  });

  // ── Evidence tools (delegated to ChittyStorage) ─────────────────

  describe("chitty_evidence_search", () => {
    it("returns error when SVC_STORAGE binding is not set", async () => {
      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "closing disclosure" },
        { CHITTYOS_ACCOUNT_ID: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SVC_STORAGE binding missing");
    });

    it("formats storage document results with tags and hashes", async () => {
      mockStorageFetch.mockResolvedValue({
        json: async () => ({
          docs: [
            {
              filename: "closing-disclosure.pdf",
              content_hash: "abc123",
              processing_tier: 2,
              created_at: "2026-03-30T14:00:00.000Z",
              tags: {
                primary_entity: "arias-v-bianchi",
                doc_type: "closing_disclosure",
              },
            },
            {
              filename: "settlement-stmt.pdf",
              content_hash: "def456",
              processing_tier: 1,
              created_at: "2026-03-29T10:30:00.000Z",
              tags: {},
            },
          ],
        }),
      });

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "closing", entity_slug: "arias-v-bianchi", max_num_results: 5 },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(
        "[arias-v-bianchi/closing_disclosure] closing-disclosure.pdf",
      );
      expect(result.content[0].text).toContain("hash: abc123");
      expect(result.content[0].text).toContain(
        "[unlinked/unclassified] settlement-stmt.pdf",
      );
      expect(mockStorageFetch).toHaveBeenCalledWith(
        "https://internal/api/docs?q=closing&limit=5&entity=arias-v-bianchi",
      );
    });

    it("returns no matching documents message when empty", async () => {
      mockStorageFetch.mockResolvedValue({
        json: async () => ({ docs: [] }),
      });

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "nonexistent" },
        mockEnv,
      );

      expect(result.content[0].text).toBe("No matching documents found.");
    });

    it("returns error on storage binding failure", async () => {
      mockStorageFetch.mockRejectedValue(new Error("storage unavailable"));

      const result = await dispatchToolCall(
        "chitty_evidence_search",
        { query: "test" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error executing chitty_evidence_search: storage unavailable",
      );
    });
  });

  describe("chitty_evidence_retrieve", () => {
    it("fetches a single document by content hash", async () => {
      mockStorageFetch.mockResolvedValue({
        json: async () => ({
          docs: [
            {
              chitty_id: "doc-123",
              content_hash: "a".repeat(64),
              filename: "wire-transfer.pdf",
              processing_tier: 3,
              tags: { primary_entity: "arias-v-bianchi" },
              entities: [{ slug: "arias-v-bianchi" }],
            },
          ],
        }),
      });

      const raw = await dispatchToolCall(
        "chitty_evidence_retrieve",
        { content_hash: "a".repeat(64) },
        mockEnv,
      );
      const result = JSON.parse(raw.content[0].text);

      expect(result.content_hash).toBe("a".repeat(64));
      expect(result.file_url).toBe(
        `https://storage.chitty.cc/api/files/${"a".repeat(64)}`,
      );
      expect(mockStorageFetch).toHaveBeenCalledWith(
        `https://internal/api/docs?q=${"a".repeat(64)}&limit=1`,
      );
    });

    it("returns an error when no lookup key is provided", async () => {
      const result = await dispatchToolCall(
        "chitty_evidence_retrieve",
        {},
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Provide content_hash, evidence_id, or query to retrieve.",
      );
    });
  });

  // ── Service health tools ───────────────────────────────────────

  describe("chitty_services_status", () => {
    it("fetches service status", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await dispatchToolCall("chitty_services_status", {}, mockEnv, {
        baseUrl: "https://test.chitty.cc",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://id.chitty.cc/health",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("chitty_neon_query", () => {
    it("returns error when sql is missing", async () => {
      const result = await dispatchToolCall("chitty_neon_query", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Missing required parameter: sql",
      );
    });

    it("returns error when Neon URL is not configured", async () => {
      getCredential.mockResolvedValue(undefined);

      const result = await dispatchToolCall(
        "chitty_neon_query",
        { sql: "SELECT 1" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Neon error (503)");
    });

    it("queries Neon directly using sql + params", async () => {
      getCredential.mockResolvedValue("https://neon.example/sql");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ rows: [{ ok: 1 }] }),
      });

      const result = await dispatchToolCall(
        "chitty_neon_query",
        { sql: "SELECT $1::int as ok", params: [1] },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://neon.example/sql",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ query: "SELECT $1::int as ok", params: [1] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.rows[0].ok).toBe(1);
    });

    it("uses Neon serverless client for postgresql DSN credentials", async () => {
      const dsn = "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db";
      getCredential.mockResolvedValue(dsn);
      neonMocks.connect.mockResolvedValue(undefined);
      neonMocks.query.mockResolvedValue({ rows: [{ ok: 1 }] });
      neonMocks.end.mockResolvedValue(undefined);

      const result = await dispatchToolCall(
        "chitty_neon_query",
        { sql: "SELECT 1 as ok" },
        mockEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(Client).toHaveBeenCalledWith({ connectionString: dsn });
      expect(neonMocks.connect).toHaveBeenCalled();
      expect(neonMocks.query).toHaveBeenCalledWith("SELECT 1 as ok", []);
      expect(neonMocks.end).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Unknown tool ───────────────────────────────────────────────

  describe("unknown tool", () => {
    it("returns error for unrecognized tool name", async () => {
      const result = await dispatchToolCall("nonexistent_tool", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Unknown tool: nonexistent_tool",
      );
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe("error handling", () => {
    it("catches fetch exceptions and returns MCP error", async () => {
      getMintAuthToken.mockResolvedValue({
        token: "token",
        source: "auth-issued",
      });
      getServiceToken.mockResolvedValue("token");
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await dispatchToolCall(
        "chitty_id_mint",
        { entity_type: "PERSON" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Network timeout");
    });
  });

  // ── Auth token forwarding ──────────────────────────────────────

  describe("auth token forwarding", () => {
    it("includes Authorization header when authToken provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
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
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("returns RBAC error when trust level insufficient", async () => {
      // Mock trust resolver: low trust
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.5, vy: 0.5, ry: 0.5 }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
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
        json: async () => ({ ty: 0.9, vy: 0.8, ry: 0.7 }),
      });
      // Mock ChittyLedger seal response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            fact_id: "fact-1",
            status: "sealed",
            proof_status: "PENDING",
          }),
      });

      const mockProofQ = { send: vi.fn() };
      const envWithQueue = {
        ...mockEnv,
        PROOF_Q: mockProofQ,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
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
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("creates dispute via ChittyLedger", async () => {
      // Mock trust resolver
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.5, vy: 0.5, ry: 0.5 }),
      });
      // Mock ledger dispute response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            fact_id: "fact-1",
            status: "disputed",
            dispute_id: "d-1",
          }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_dispute",
        {
          fact_id: "fact-1",
          reason: "Contradicted by evidence ev-2",
          actor_chitty_id: "01-P-USA-1234-P-2601-A-X",
        },
        envWithCache,
      );

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text).dispute_id).toBe("d-1");
    });
  });

  // ── Finance tools ─────────────────────────────────────────────

  describe("chitty_finance_entities", () => {
    it("uses service token (not caller auth) for finance.chitty.cc calls", async () => {
      getServiceToken.mockResolvedValue("finance-svc-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ entities: ["ARIAS LLC", "BIANCHI TRUST"] }),
      });

      await dispatchToolCall("chitty_finance_entities", {}, mockEnv, {
        authToken: "user-api-key-should-not-be-forwarded",
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer finance-svc-token");
      expect(headers.Authorization).not.toContain("user-api-key");
    });

    it("returns error when no service token is available", async () => {
      getServiceToken.mockResolvedValue(null);

      const result = await dispatchToolCall(
        "chitty_finance_entities",
        {},
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("503");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("chitty_finance_xfer_detect", () => {
    it("whitelists args — does not forward arbitrary fields", async () => {
      getServiceToken.mockResolvedValue("finance-svc-token");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ transfers: [] }),
      });

      await dispatchToolCall(
        "chitty_finance_xfer_detect",
        {
          entity: "arias-llc",
          start: "2025-01-01",
          end: "2025-12-31",
          threshold: 1000,
          __proto__: { polluted: true },
          malicious_field: "should not appear",
        },
        mockEnv,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.entity).toBe("arias-llc");
      expect(body.start).toBe("2025-01-01");
      expect(body.end).toBe("2025-12-31");
      expect(body.threshold).toBe(1000);
      expect(body.malicious_field).toBeUndefined();
      expect(Object.keys(body)).toEqual([
        "entity",
        "start",
        "end",
        "threshold",
      ]);
    });
  });

  describe("chitty_fact_export", () => {
    beforeEach(() => {
      getServiceToken.mockResolvedValue("svc-token-123");
    });

    it("returns JSON proof bundle", async () => {
      // Mock trust resolver
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.3, vy: 0.3, ry: 0.3 }),
      });
      // Mock ledger fact+proof response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            fact_id: "fact-1",
            proof_id: "proof-1",
            verification_url: "https://proof.chitty.cc/verify/proof-1",
          }),
      });

      const envWithCache = {
        ...mockEnv,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_export",
        {
          fact_id: "fact-1",
          format: "json",
          actor_chitty_id: "01-P-USA-1234-P-2601-A-X",
        },
        envWithCache,
      );

      expect(result.isError).toBeUndefined();
    });
  });

  // ── Auth failure isolation tests ─────────────────────────────────

  describe("auth failure isolation — skips fetch when no service token", () => {
    // Only tools that still use requireServiceAuth (not serviceFetch)
    // Ledger/fact/evidence tools now use serviceFetch which handles auth
    // internally via service bindings — they no longer pre-check tokens.
    const serviceAuthCases = [
      [
        "chitty_contextual_timeline",
        { party: "test@example.com" },
        "ChittyContextual",
      ],
      ["chitty_contextual_topics", { query: "rent" }, "ChittyContextual"],
    ];

    it.each(serviceAuthCases)(
      "%s returns auth error and never calls fetch",
      async (toolName, toolArgs, expectedService) => {
        getServiceToken.mockResolvedValue(null);

        const result = await dispatchToolCall(toolName, toolArgs, mockEnv);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Authentication required");
        expect(result.content[0].text).toContain(expectedService);
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );
  });

  // ── getServiceToken exception handling ────────────────────────────

  describe("requireServiceAuth handles getServiceToken throwing", () => {
    it("returns structured auth error when getServiceToken throws", async () => {
      getServiceToken.mockRejectedValue(
        new Error("1Password connection timeout"),
      );

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("1Password connection timeout");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Non-JSON response handling ─────────────────────────────────────

  describe("non-JSON response handling", () => {
    it("returns isError when ledger returns HTML instead of JSON", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          "<!DOCTYPE html><html><body>Bad Gateway</body></html>",
      });

      const result = await dispatchToolCall("chitty_ledger_stats", {}, mockEnv);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Ledger returned non-JSON");
    });
  });

  // ── fact_seal checkFetchError + PROOF_Q interaction ────────────────

  describe("chitty_fact_seal error and PROOF_Q interaction", () => {
    it("returns error and does NOT enqueue proof when seal POST returns 500", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      // Mock trust resolver: Authority with INSTITUTIONAL trust
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.9, vy: 0.8, ry: 0.7 }),
      });
      // Mock ChittyLedger seal — upstream failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const mockProofQ = { send: vi.fn() };
      const envWithQueue = {
        ...mockEnv,
        PROOF_Q: mockProofQ,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-A-USA-5678-A-2601-B-X" },
        envWithQueue,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ChittyLedger error (500)");
      expect(mockProofQ.send).not.toHaveBeenCalled();
    });

    it("seals successfully and warns when PROOF_Q not configured", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      // Mock trust resolver
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.9, vy: 0.8, ry: 0.7 }),
      });
      // Mock seal success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ fact_id: "fact-1", status: "sealed" }),
      });

      const envNoQueue = {
        ...mockEnv,
        // No PROOF_Q binding
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-A-USA-5678-A-2601-B-X" },
        envNoQueue,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.proof_queue_warning).toContain(
        "PROOF_Q binding not configured",
      );
    });

    it("seals successfully but warns when PROOF_Q.send throws", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ty: 0.9, vy: 0.8, ry: 0.7 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ fact_id: "fact-1", status: "sealed" }),
      });

      const mockProofQ = {
        send: vi.fn().mockRejectedValue(new Error("Queue unavailable")),
      };
      const envWithQueue = {
        ...mockEnv,
        PROOF_Q: mockProofQ,
        CREDENTIAL_CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn(),
        },
        CHITTY_TRUST_TOKEN: "tok",
      };

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-A-USA-5678-A-2601-B-X" },
        envWithQueue,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.proof_queue_warning).toContain("proof queue failed");
      expect(mockProofQ.send).toHaveBeenCalled();
    });
  });

  // ── Evidence JSON parse failure during fact mint ────────────────────

  describe("chitty_fact_mint evidence JSON parse", () => {
    it("returns error when evidence endpoint returns invalid JSON", async () => {
      getServiceToken.mockResolvedValue("svc-token-123");
      // Evidence check returns 200 but non-JSON body
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });

      const result = await dispatchToolCall(
        "chitty_fact_mint",
        { evidence_id: "ev-corrupt", text: "test claim" },
        mockEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("returned invalid JSON");
      expect(result.content[0].text).toContain("ev-corrupt");
      // Should NOT have proceeded to mint
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Infrastructure tools ──────────────────────────────────────────

  describe("chitty_infra_logs", () => {
    it("returns error when no Cloudflare API token", async () => {
      getCredential.mockResolvedValue(undefined);
      const env = { CHITTYOS_ACCOUNT_ID: "acct-123" };

      const result = await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyid", query_type: "events" },
        env,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("API token not configured");
    });

    it("returns error when no account ID", async () => {
      getCredential.mockImplementation(async (_env, path) => {
        if (path.includes("api_token")) return "cf-token";
        return undefined;
      });

      const result = await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyid", query_type: "events" },
        {},
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("account ID not configured");
    });

    it("sends events query with correct URL and body", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: { events: [] } }),
      });

      const result = await dispatchToolCall(
        "chitty_infra_logs",
        {
          service: "chittyid-production",
          query_type: "events",
          timeframe: "1h",
        },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/accounts/acct-123/workers/observability/telemetry/query",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer cf-token",
            "workers-observability-origin": "chittyconnect",
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.view).toBe("events");
      expect(body.filters[0].key).toBe("$metadata.scriptName");
      expect(body.filters[0].value).toBe("chittyid-production");
    });

    it("sends errors query with level filter", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: [] }),
      });

      await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "errors" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.view).toBe("events");
      expect(body.filters).toHaveLength(2);
      expect(body.filters[1].key).toBe("$metadata.level");
      expect(body.filters[1].value).toBe("error");
    });

    it("sends metrics query with calculations and groupBys", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: {} }),
      });

      await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "metrics" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.view).toBe("calculations");
      expect(body.calculations).toBeDefined();
      expect(body.groupBys).toContain("$metadata.response.status");
    });

    it("adds needle when filter is provided", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: [] }),
      });

      await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "events", filter: "timeout" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.needle).toBe("timeout");
    });

    it("clamps limit to max 100", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: [] }),
      });

      await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "events", limit: 999 },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.limit).toBe(100);
    });

    it("returns error for invalid timeframe", async () => {
      getCredential.mockResolvedValue("cf-token");

      const result = await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "events", timeframe: "bad" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid timeframe");
    });

    it("handles CF API error responses", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      const result = await dispatchToolCall(
        "chitty_infra_logs",
        { service: "chittyconnect", query_type: "events" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("403");
    });
  });

  describe("chitty_infra_audit", () => {
    it("returns error when no Cloudflare API token", async () => {
      getCredential.mockResolvedValue(undefined);

      const result = await dispatchToolCall(
        "chitty_infra_audit",
        { since: "2026-01-01", before: "2026-01-02" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("API token not configured");
    });

    it("returns error when no account ID", async () => {
      getCredential.mockImplementation(async (_env, path) => {
        if (path.includes("api_token")) return "cf-token";
        return undefined;
      });

      const result = await dispatchToolCall(
        "chitty_infra_audit",
        { since: "2026-01-01", before: "2026-01-02" },
        {},
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("account ID not configured");
    });

    it("calls audit endpoint with correct params", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: [] }),
      });

      const result = await dispatchToolCall(
        "chitty_infra_audit",
        {
          since: "2026-01-01",
          before: "2026-01-02",
          action_type: "delete",
          actor_email: "user@example.com",
        },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBeUndefined();
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("/accounts/acct-123/logs/audit");
      expect(url).toContain("since=2026-01-01");
      expect(url).toContain("before=2026-01-02");
      expect(url).toContain("action.type=delete");
      expect(url).toContain("actor.email=user%40example.com");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["portal-version"]).toBe("2");
    });

    it("omits optional params when not provided", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ result: [] }),
      });

      await dispatchToolCall(
        "chitty_infra_audit",
        { since: "2026-01-01", before: "2026-01-02" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const url = mockFetch.mock.calls[0][0];
      expect(url).not.toContain("action.type");
      expect(url).not.toContain("actor.email");
    });

    it("handles CF API error responses", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await dispatchToolCall(
        "chitty_infra_audit",
        { since: "2026-01-01", before: "2026-01-02" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("500");
    });
  });

  describe("chitty_infra_analytics", () => {
    it("returns error when no Cloudflare API token", async () => {
      getCredential.mockResolvedValue(undefined);

      const result = await dispatchToolCall(
        "chitty_infra_analytics",
        { query: "{ viewer { zones { firewallEventsAdaptive { action } } } }" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("API token not configured");
    });

    it("sends GraphQL query with default variables", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { viewer: {} } }),
      });

      const gql =
        "{ viewer { accounts(filter: {accountTag: $accountTag}) { httpRequests1dGroups { sum { requests } } } } }";
      const result = await dispatchToolCall(
        "chitty_infra_analytics",
        { query: gql },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/graphql",
        expect.objectContaining({ method: "POST" }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toBe(gql);
      expect(body.variables).toEqual({ accountTag: "acct-123" });
    });

    it("uses provided variables instead of defaults", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: {} }),
      });

      const customVars = { accountTag: "custom", zoneTag: "zone-1" };
      await dispatchToolCall(
        "chitty_infra_analytics",
        { query: "{ viewer { zones { } } }", variables: customVars },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables).toEqual(customVars);
    });

    it("rejects responses over 800KB", async () => {
      getCredential.mockResolvedValue("cf-token");
      const largePayload = "x".repeat(801 * 1024);
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => largePayload,
      });

      const result = await dispatchToolCall(
        "chitty_infra_analytics",
        { query: "{ viewer { } }" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("too large");
      expect(result.content[0].text).toContain("800KB");
    });

    it("handles non-JSON responses gracefully", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => "<html>error page</html>",
      });

      const result = await dispatchToolCall(
        "chitty_infra_analytics",
        { query: "{ viewer { } }" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("non-JSON");
    });

    it("handles CF API error responses", async () => {
      getCredential.mockResolvedValue("cf-token");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await dispatchToolCall(
        "chitty_infra_analytics",
        { query: "{ viewer { } }" },
        { CHITTYOS_ACCOUNT_ID: "acct-123" },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("401");
    });
  });

  // ── Tenant Management tools ─────────────────────────────────────────
  describe("chitty_tenant_* tools", () => {
    const tenantEnv = { CHITTYCONNECT_URL: "https://connect.chitty.cc" };

    it("chitty_tenant_provision calls POST /api/v1/tenants/provision", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            tenantId: "org-42",
            neonProjectId: "np-123",
            status: "active",
          }),
      });

      const result = await dispatchToolCall(
        "chitty_tenant_provision",
        { tenant_id: "org-42", region: "aws-us-east-2" },
        tenantEnv,
      );

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.tenantId).toBe("org-42");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/tenants/provision",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("chitty_tenant_provision passes auth header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ tenantId: "org-42" }),
      });

      await dispatchToolCall(
        "chitty_tenant_provision",
        { tenant_id: "org-42" },
        tenantEnv,
        { authToken: "test-bearer-token" },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-bearer-token",
          }),
        }),
      );
    });

    it("chitty_tenant_provision rejects missing tenant_id", async () => {
      const result = await dispatchToolCall(
        "chitty_tenant_provision",
        {},
        tenantEnv,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("tenant_id");
    });

    it("chitty_tenant_get fetches tenant details", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ tenantId: "org-42", status: "active" }),
      });

      const result = await dispatchToolCall(
        "chitty_tenant_get",
        { tenant_id: "org-42" },
        tenantEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/tenants/org-42",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("chitty_tenant_list passes query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tenants: [], total: 0 }),
      });

      await dispatchToolCall(
        "chitty_tenant_list",
        { status: "active", limit: 10 },
        tenantEnv,
      );

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("status=active");
      expect(calledUrl).toContain("limit=10");
    });

    it("chitty_tenant_deprovision calls DELETE", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ tenantId: "org-42", status: "deprovisioned" }),
      });

      const result = await dispatchToolCall(
        "chitty_tenant_deprovision",
        { tenant_id: "org-42" },
        tenantEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/tenants/org-42",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("chitty_tenant_export calls POST export", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            tenantId: "org-42",
            exportedAt: "2026-03-28T00:00:00Z",
          }),
      });

      const result = await dispatchToolCall(
        "chitty_tenant_export",
        { tenant_id: "org-42" },
        tenantEnv,
      );

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://connect.chitty.cc/api/v1/tenants/org-42/export",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("chitty_tenant_query blocks non-SELECT queries", async () => {
      const result = await dispatchToolCall(
        "chitty_tenant_query",
        { tenant_id: "org-42", query: "DELETE FROM evidence_documents" },
        tenantEnv,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SELECT");
    });

    it("chitty_tenant_query requires tenant_id and query", async () => {
      const result = await dispatchToolCall(
        "chitty_tenant_query",
        { tenant_id: "org-42" },
        tenantEnv,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("tenant_id and query");
    });

    it("chitty_tenant_query blocks semicolons (multi-statement injection)", async () => {
      const result = await dispatchToolCall(
        "chitty_tenant_query",
        {
          tenant_id: "org-42",
          query: "SELECT 1; DROP TABLE evidence_documents",
        },
        tenantEnv,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("semicolons");
    });

    it("chitty_tenant_query blocks data-modifying CTEs", async () => {
      const result = await dispatchToolCall(
        "chitty_tenant_query",
        {
          tenant_id: "org-42",
          query:
            "WITH deleted AS (DELETE FROM evidence_documents RETURNING *) SELECT * FROM deleted",
        },
        tenantEnv,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Data-modifying CTEs");
    });
  });
});
