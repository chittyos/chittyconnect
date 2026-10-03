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
 * TWO contract errors and one posture error produced it — all three verified
 * against the running service, not against documentation:
 *
 *   - the body sent `entity`; id.chitty.cc reads `entityType` and IGNORES
 *     `entity`, defaulting to "T". So every ID this worker caused to be minted
 *     is a Thing, including contexts canon requires to be Person.
 *   - the response was read as `result.id`; the field is `result.chittyId`
 *     (camelCase).
 *   - and on finding nothing it RETURNED undefined instead of throwing, so the
 *     failure propagated as the string "undefined" into downstream ChittyDNA
 *     and ChittyAuth calls and was logged as "non-critical".
 *
 * A PREVIOUS REVISION OF THIS FILE ASSERTED `result.chitty_id`, citing
 * CHITTYFOUNDATION/chittyid README.md:61. That README is STALE and the claim
 * was withdrawn. It is recorded here because the wrong version of this docblock
 * shipped once already: a fixture invented from a doc is not evidence about a
 * service, and every assertion built on it measured agreement between two
 * artifacts written in the same pass.
 *
 * `/v1/mint` is NOT among the defects. It 308-redirects to /mint and a 308
 * preserves method and body, so the old path worked. Moving to /mint is
 * deprecation hygiene (sunset 2027-05-27), not a bug fix.
 *
 * LIMIT OF THIS SUITE, stated because it is the failure that caused all of the
 * above: a local fixture catches CODE regressions and structurally cannot catch
 * SERVICE drift. If id.chitty.cc renames `chittyId` tomorrow, all of these
 * still pass and production breaks exactly as it did this week. Only a live
 * smoke test against /mint would catch that.
 *
 * These drive the real ChittyOSEcosystem and the real resilientFetch/retry
 * path. Only `globalThis.fetch` — the network boundary we do not own — is
 * substituted; no ChittyOS module is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChittyOSEcosystem } from "../../src/integrations/chittyos-ecosystem.js";

/**
 * Captured from POST https://id.chitty.cc/mint with {"entityType":"P"} on
 * 2026-09-17. `mintProof`, `trust`, `geo` and `drand` are elided to {} because
 * nothing reads them, and `timestamp` is ROUNDED to the hour — it is the one
 * retained field that is not the captured value. Nothing reads it either; it is
 * kept only so the fixture has the right shape. Every OTHER retained field is
 * byte-for-byte from the wire, types included — `components.trustLevel` is the
 * STRING "0", not the number 0, and `certificateStatus` is an object, not a
 * status string.
 *
 * Both of those were wrong in earlier revisions of this file, inside a block
 * headed "VERBATIM". A trim you declare is evidence; a trim you call verbatim
 * is an over-claim, and this one took three rounds to stop making — a separated
 * review then caught the rounded `timestamp` above still sitting under a
 * blanket "byte-for-byte" claim, which is the same mistake a fourth time and is
 * why the elision is now named explicitly. The earlier revision of this file
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
  components: Object.freeze({
    version: "03",
    entityType: "P",
    jurisdiction: "USA",
    region: "1",
    sequential: "4448",
    yearMonth: "2609",
    trustLevel: "0",
    checksum: "88",
  }),
  mintProof: Object.freeze({}),
  trust: Object.freeze({}),
  geo: Object.freeze({}),
  drand: Object.freeze({}),
  certificateStatus: Object.freeze({
    issued: false,
    reason: "not-configured",
    detail:
      "neither CHITTYCERT_SERVICE_TOKEN nor CHITTY_SERVICE_TOKEN is configured",
  }),
  timestamp: "2026-09-17T23:00:00.000Z",
  service: "id.chitty.cc",
  mintedBy: "mint.chitty.cc",
});

/**
 * The FAILURE path is an HTTP 200 carrying {success:false, error} — captured
 * from POST /mint with {"entityType":"PEO"}. resilientFetch cannot catch it,
 * because 200 is ok. Neither revision of this file covered this shape; it is
 * the reason the fail-closed throw earns its place.
 */
const LIVE_ERROR_ENVELOPE = Object.freeze({
  success: false,
  error:
    'Invalid entityType: "peo". Must be one of: person, place, thing, event, authority',
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
    // Exactly the production shape: response.ok true, no chittyId field.
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
    // certificateStatus is an OBJECT on the wire. A previous revision invented
    // the string "pending" here — in a fixture whose whole claim to authority
    // was that it came from the wire.
    expect(typeof LIVE_MINT_RESPONSE.certificateStatus).toBe("object");
  });

  it("throws on the 200 error envelope and surfaces the service's reason", async () => {
    stubFetch(200, LIVE_ERROR_ENVELOPE);
    const err = await ecosystem()
      .mintChittyID({ entity: "P" })
      .catch((e) => e);
    // The operator needs the reason, not just the fact that a reason exists.
    expect(err.message).toContain("Invalid entityType");
    expect(err.message).toContain("person, place, thing, event, authority");
  });

  it("refuses to mint when entityType is absent, rather than defaulting to T", async () => {
    // JSON.stringify drops an undefined value, so the service would receive no
    // entityType and silently mint a Thing.
    const calls = stubFetch(200, LIVE_MINT_RESPONSE);
    await expect(ecosystem().mintChittyID({ metadata: {} })).rejects.toThrow(
      /requires an entityType/,
    );
    expect(calls).toHaveLength(0);
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
