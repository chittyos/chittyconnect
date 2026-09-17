/**
 * Regression tests for a defect observed LIVE in production via `wrangler tail`
 * on 2026-09-17, firing roughly once a second on GitHub App webhooks and the
 * five-minute cron:
 *
 *     [ChittyID] Minting new P ChittyID...
 *     [ChittyID] Minted: undefined
 *     [ChittyDNA] Initializing DNA record for undefined...
 *     [Retry] Non-retryable error (not_found): HTTP 404: Not Found
 *     [ChittyConnect] Background initialization error (non-critical): HTTP 404
 *
 * Three contract errors and one posture error produced that:
 *   - the body sent `entity`, but the canonical field is `entityType`
 *   - the path used `/v1/mint`, a 308 alias (sunset 2027-05-27)
 *   - the response was read as `result.id`, but the field is `result.chitty_id`
 *   - and on finding nothing it RETURNED undefined instead of throwing, so the
 *     failure propagated as the literal string "undefined" into downstream
 *     ChittyDNA/ChittyAuth calls and was logged as "non-critical"
 *
 * Canonical contract: CHITTYFOUNDATION/chittyid README "Request a ChittyID" —
 * POST https://id.chitty.cc/mint, body { entityType: 'P' }, response
 * result.chitty_id. @canon: chittycanon://gov/governance#core-types
 *
 * These drive the real ChittyOSEcosystem and the real resilientFetch/retry
 * path. Only `globalThis.fetch` — the network boundary we do not own — is
 * substituted; no ChittyOS module is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChittyOSEcosystem } from "../../src/integrations/chittyos-ecosystem.js";

const realFetch = globalThis.fetch;

/** Captures calls and replies with a caller-supplied body. */
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

function ecosystem() {
  return new ChittyOSEcosystem({ CHITTY_ID_TOKEN: "test-token-not-a-real-credential" });
}

describe("ChittyID mint contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("posts to the canonical /mint path, not the deprecated /v1/mint alias", async () => {
    const calls = stubFetch(200, { chitty_id: "CP-A-001-1234-P-2509-I-82" });
    await ecosystem().mintChittyID({ entity: "P" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/mint$/);
    expect(calls[0].url).not.toContain("/v1/mint");
  });

  it("sends entityType, translating the legacy `entity` callers still pass", async () => {
    const calls = stubFetch(200, { chitty_id: "CT-A-001-1234-T-2509-I-11" });
    // Both in-repo callers pass `entity` (chittyos-ecosystem.js:66, index.js:2034).
    await ecosystem().mintChittyID({ entity: "T", characterization: "Digital" });

    const body = JSON.parse(calls[0].options.body);
    expect(body.entityType).toBe("T");
    // Extra fields are preserved rather than dropped.
    expect(body.characterization).toBe("Digital");
  });

  it("prefers an explicit entityType when the caller already sends canonical", async () => {
    const calls = stubFetch(200, { chitty_id: "CP-A-001-1234-P-2509-I-82" });
    await ecosystem().mintChittyID({ entityType: "L" });
    expect(JSON.parse(calls[0].options.body).entityType).toBe("L");
  });

  it("reads chitty_id from the response", async () => {
    stubFetch(200, { chitty_id: "CP-A-001-1234-P-2509-I-82" });
    const id = await ecosystem().mintChittyID({ entity: "P" });
    expect(id).toBe("CP-A-001-1234-P-2509-I-82");
  });

  // ---- THE regression: a 2xx carrying no ChittyID ------------------------

  it("THROWS on a 200 that carries no chitty_id, instead of returning undefined", async () => {
    // Exactly the production shape: response.ok true, no chitty_id field.
    stubFetch(200, { ok: true, status: "queued" });

    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow(
      /without a chitty_id/,
    );
  });

  it("names the fields it did receive, so the next person can see the shape", async () => {
    stubFetch(200, { ok: true, requestId: "abc" });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow(
      /ok, requestId/,
    );
  });

  it("never returns the string 'undefined' or a non-string to callers", async () => {
    stubFetch(200, { id: null });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();

    stubFetch(200, { chitty_id: "" });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();
  });

  it("still accepts a response that uses `id`, matching context-resolver's reader", async () => {
    stubFetch(200, { id: "CP-A-001-1234-P-2509-I-82" });
    const id = await ecosystem().mintChittyID({ entity: "P" });
    expect(id).toBe("CP-A-001-1234-P-2509-I-82");
  });

  it("propagates a non-2xx as an error rather than a silent undefined", async () => {
    stubFetch(500, { error: "upstream" });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();
  });
});
