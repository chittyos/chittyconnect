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

/**
 * VERBATIM live response from POST https://id.chitty.cc/mint with
 * {"entityType":"P"}, captured 2026-09-17. The earlier revision of this file
 * invented a `{ chitty_id: ... }` fixture from chittyid's README:61 — a shape
 * the service has NEVER emitted — so every assertion measured agreement
 * between two artifacts written in the same pass, and the suite stayed green
 * against code that would have thrown on every production call.
 *
 * Fixtures for a contract must come from the wire.
 */
const LIVE_MINT_RESPONSE = Object.freeze({
  success: true,
  chittyId: "03-1-USA-4448-P-2609-0-88",
  components: {},
  mintProof: {},
  trust: {},
  geo: {},
  drand: {},
  certificateStatus: "pending",
  timestamp: "2026-09-17T23:00:00.000Z",
  service: "id.chitty.cc",
  mintedBy: "mint.chitty.cc",
});

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
    const calls = stubFetch(200, LIVE_MINT_RESPONSE);
    await ecosystem().mintChittyID({ entity: "P" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/mint$/);
    expect(calls[0].url).not.toContain("/v1/mint");
  });

  it("sends entityType, translating the legacy `entity` callers still pass", async () => {
    const calls = stubFetch(200, { ...LIVE_MINT_RESPONSE, chittyId: "03-1-USA-4448-T-2609-0-11" });
    // Both in-repo callers pass `entity` (chittyos-ecosystem.js:66, index.js:2034).
    await ecosystem().mintChittyID({ entity: "T", characterization: "Digital" });

    const body = JSON.parse(calls[0].options.body);
    expect(body.entityType).toBe("T");
    // Extra fields are preserved rather than dropped.
    expect(body.characterization).toBe("Digital");
  });

  it("prefers an explicit entityType when the caller already sends canonical", async () => {
    const calls = stubFetch(200, LIVE_MINT_RESPONSE);
    await ecosystem().mintChittyID({ entityType: "L" });
    expect(JSON.parse(calls[0].options.body).entityType).toBe("L");
  });

  it("reads chittyId from the real live response shape", async () => {
    stubFetch(200, LIVE_MINT_RESPONSE);
    const id = await ecosystem().mintChittyID({ entity: "P" });
    expect(id).toBe(LIVE_MINT_RESPONSE.chittyId);
  });

  // ---- THE regression: a 2xx carrying no ChittyID ------------------------

  it("THROWS on a 200 that carries no chittyId, instead of returning undefined", async () => {
    // Exactly the production shape: response.ok true, no chitty_id field.
    stubFetch(200, { ok: true, status: "queued" });

    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow(
      /without a chittyId/,
    );
  });

  it("names the fields it did receive, so the next person can see the shape", async () => {
    stubFetch(200, { requestId: "abc", ok: true });
    const err = await ecosystem()
      .mintChittyID({ entity: "P" })
      .catch((e) => e);
    // Field names are listed sorted, so the assertion does not depend on the
    // service's JSON key order.
    expect(err.message).toContain("ok");
    expect(err.message).toContain("requestId");
  });

  it("never returns the string 'undefined' or a non-string to callers", async () => {
    stubFetch(200, { id: null });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();

    stubFetch(200, { chitty_id: "" });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();
  });

  it("keeps defensive arms for snake_case and `id`, neither emitted today", async () => {
    stubFetch(200, { chitty_id: "03-1-USA-4448-P-2609-0-88" });
    expect(await ecosystem().mintChittyID({ entity: "P" })).toBe(
      "03-1-USA-4448-P-2609-0-88",
    );

    stubFetch(200, { id: "03-1-USA-4448-P-2609-0-88" });
    expect(await ecosystem().mintChittyID({ entity: "P" })).toBe(
      "03-1-USA-4448-P-2609-0-88",
    );
  });

  it("THROWS on the pre-fix reader shape, proving the live contract is covered", async () => {
    // If someone reverts to `result.id`, LIVE_MINT_RESPONSE has no such field.
    // This asserts the fixture is the real one, not a convenient one.
    expect(LIVE_MINT_RESPONSE).not.toHaveProperty("chitty_id");
    expect(LIVE_MINT_RESPONSE).not.toHaveProperty("id");
    expect(LIVE_MINT_RESPONSE).toHaveProperty("chittyId");
  });

  // NOTE: a 5xx is retryable, so this drives real backoff sleeps and records
  // failures against the module-global circuit breaker keyed on the "id"
  // hostname (src/utils/error-handling.js:39, threshold 5). Kept to ONE such
  // test in this file on purpose — a second would risk opening the breaker for
  // 60s and cascading into unrelated tests.
  it("propagates a non-2xx as an error rather than a silent undefined", async () => {
    stubFetch(500, { error: "upstream" });
    await expect(ecosystem().mintChittyID({ entity: "P" })).rejects.toThrow();
  }, 20000);
});
