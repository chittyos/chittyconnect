# Fact Governance Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 new MCP tools (`chitty_fact_seal`, `chitty_fact_dispute`, `chitty_fact_export`) with RBAC enforcement, async ChittyProof minting via Cloudflare Queue, and R2-based PDF export.

**Architecture:** ChittyConnect gateway validates RBAC (trust levels from ChittyTrust, cached in KV), then delegates to ChittyLedger for state changes. Seal triggers async proof minting via a Cloudflare Queue consumer that calls ChittyProof and patches the result back. PDF exports go through R2 with streaming download.

**Tech Stack:** Cloudflare Workers (Hono.js), Vitest, Zod, MCP SDK, Cloudflare Queues, R2, KV

---

### Task 1: Trust Resolver with KV Caching

**Files:**
- Create: `src/lib/trust-resolver.js`
- Test: `tests/lib/trust-resolver.test.js`

**Step 1: Write the failing test**

```js
// tests/lib/trust-resolver.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTrustLevel, TRUST_LEVELS } from "../../src/lib/trust-resolver.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CREDENTIAL_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
  },
  CHITTY_TRUST_TOKEN: "test-trust-token",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TRUST_LEVELS", () => {
  it("exports canonical trust level constants", () => {
    expect(TRUST_LEVELS.ANONYMOUS).toBe(0);
    expect(TRUST_LEVELS.BASIC).toBe(1);
    expect(TRUST_LEVELS.ENHANCED).toBe(2);
    expect(TRUST_LEVELS.PROFESSIONAL).toBe(3);
    expect(TRUST_LEVELS.INSTITUTIONAL).toBe(4);
    expect(TRUST_LEVELS.OFFICIAL).toBe(5);
  });
});

describe("resolveTrustLevel", () => {
  it("returns cached trust level when available", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(
      JSON.stringify({ trust_level: 3, entity_type: "P" })
    );

    const result = await resolveTrustLevel("01-P-USA-1234-P-2601-A-X", mockEnv);

    expect(result).toEqual({ trust_level: 3, entity_type: "P" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches from ChittyTrust when cache is empty", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ trust_level: 4, entity_type: "A" }),
    });

    const result = await resolveTrustLevel("01-A-USA-5678-A-2601-B-X", mockEnv);

    expect(result).toEqual({ trust_level: 4, entity_type: "A" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://trust.chitty.cc/api/v1/trust/01-A-USA-5678-A-2601-B-X",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-trust-token",
        }),
      })
    );
    expect(mockEnv.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "trust:01-A-USA-5678-A-2601-B-X",
      expect.any(String),
      { expirationTtl: 300 }
    );
  });

  it("returns BASIC trust level on fetch failure", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await resolveTrustLevel("bad-id", mockEnv);

    expect(result).toEqual({ trust_level: 1, entity_type: "P" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/trust-resolver.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```js
// src/lib/trust-resolver.js
/**
 * Trust Level Resolver
 *
 * Resolves ChittyTrust levels with KV caching (5-min TTL).
 * @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
 *
 * @module lib/trust-resolver
 */

/** Canonical trust level constants (0-5 scale) */
export const TRUST_LEVELS = {
  ANONYMOUS: 0,
  BASIC: 1,
  ENHANCED: 2,
  PROFESSIONAL: 3,
  INSTITUTIONAL: 4,
  OFFICIAL: 5,
};

const CACHE_TTL = 300; // 5 minutes

/**
 * Resolve trust level for a ChittyID entity.
 *
 * @param {string} chittyId - Entity ChittyID
 * @param {object} env - Worker environment (needs CREDENTIAL_CACHE KV, CHITTY_TRUST_TOKEN)
 * @returns {Promise<{trust_level: number, entity_type: string}>}
 */
export async function resolveTrustLevel(chittyId, env) {
  const cacheKey = `trust:${chittyId}`;

  // Check cache
  const cached = await env.CREDENTIAL_CACHE.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupted cache entry — fall through to fetch
    }
  }

  // Fetch from ChittyTrust
  try {
    const token = env.CHITTY_TRUST_TOKEN;
    const resp = await fetch(
      `https://trust.chitty.cc/api/v1/trust/${chittyId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Source-Service": "chittyconnect",
        },
      },
    );

    if (!resp.ok) {
      return { trust_level: TRUST_LEVELS.BASIC, entity_type: "P" };
    }

    const data = await resp.json();
    const result = {
      trust_level: data.trust_level ?? TRUST_LEVELS.BASIC,
      entity_type: data.entity_type ?? "P",
    };

    // Cache with TTL
    await env.CREDENTIAL_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL,
    });

    return result;
  } catch {
    return { trust_level: TRUST_LEVELS.BASIC, entity_type: "P" };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/trust-resolver.test.js`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/lib/trust-resolver.js tests/lib/trust-resolver.test.js
git commit -m "feat: add trust-resolver with KV caching for RBAC"
```

---

### Task 2: Fact RBAC Module

**Files:**
- Create: `src/lib/fact-rbac.js`
- Test: `tests/lib/fact-rbac.test.js`

**Step 1: Write the failing test**

```js
// tests/lib/fact-rbac.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkFactPermission, FACT_ACTIONS } from "../../src/lib/fact-rbac.js";

vi.mock("../../src/lib/trust-resolver.js", () => ({
  resolveTrustLevel: vi.fn(),
  TRUST_LEVELS: { ANONYMOUS: 0, BASIC: 1, ENHANCED: 2, PROFESSIONAL: 3, INSTITUTIONAL: 4, OFFICIAL: 5 },
}));

import { resolveTrustLevel } from "../../src/lib/trust-resolver.js";

const mockEnv = {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FACT_ACTIONS", () => {
  it("defines all governance actions", () => {
    expect(FACT_ACTIONS.SEAL).toBeDefined();
    expect(FACT_ACTIONS.DISPUTE).toBeDefined();
    expect(FACT_ACTIONS.EXPORT).toBeDefined();
  });
});

describe("checkFactPermission", () => {
  it("allows seal when entity is Authority with INSTITUTIONAL trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 4, entity_type: "A" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("denies seal when entity is Person (wrong entity type)", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 5, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("entity type");
  });

  it("denies seal when trust level too low", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 3, entity_type: "A" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("trust level");
  });

  it("allows dispute for Person with ENHANCED trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 2, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.DISPUTE, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("allows export for any authenticated entity with BASIC trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 1, entity_type: "T" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.EXPORT, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("returns full context on denial", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 0, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.DISPUTE, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.trust_level).toBe(0);
    expect(result.required_level).toBe(2);
    expect(result.action).toBe("dispute");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/fact-rbac.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```js
// src/lib/fact-rbac.js
/**
 * Fact Governance RBAC
 *
 * Access control for fact lifecycle operations using ChittyID
 * entity types and ChittyTrust levels.
 *
 * @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
 * @canon: chittycanon://gov/governance#core-types
 *
 * @module lib/fact-rbac
 */

import { resolveTrustLevel, TRUST_LEVELS } from "./trust-resolver.js";

/**
 * Fact governance action definitions.
 * Each action specifies required entity types and minimum trust level.
 */
export const FACT_ACTIONS = {
  SEAL: {
    name: "seal",
    entity_types: ["A"],       // Authority only
    min_trust: TRUST_LEVELS.INSTITUTIONAL,
  },
  DISPUTE: {
    name: "dispute",
    entity_types: ["P", "A"],  // Person or Authority
    min_trust: TRUST_LEVELS.ENHANCED,
  },
  EXPORT: {
    name: "export",
    entity_types: null,        // Any authenticated entity
    min_trust: TRUST_LEVELS.BASIC,
  },
};

/**
 * Check if an entity has permission for a fact governance action.
 *
 * @param {string} chittyId - Actor ChittyID
 * @param {object} action - FACT_ACTIONS member
 * @param {object} env - Worker environment
 * @returns {Promise<{allowed: boolean, trust_level: number, entity_type: string, required_level: number, action: string, reason?: string}>}
 */
export async function checkFactPermission(chittyId, action, env) {
  const { trust_level, entity_type } = await resolveTrustLevel(chittyId, env);

  const base = {
    trust_level,
    entity_type,
    required_level: action.min_trust,
    action: action.name,
  };

  // Check entity type constraint
  if (action.entity_types && !action.entity_types.includes(entity_type)) {
    return {
      ...base,
      allowed: false,
      reason: `Action "${action.name}" requires entity type ${action.entity_types.join(" or ")}, got "${entity_type}"`,
    };
  }

  // Check trust level
  if (trust_level < action.min_trust) {
    return {
      ...base,
      allowed: false,
      reason: `Action "${action.name}" requires trust level ${action.min_trust}, got ${trust_level}`,
    };
  }

  return { ...base, allowed: true };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/fact-rbac.test.js`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/lib/fact-rbac.js tests/lib/fact-rbac.test.js
git commit -m "feat: add fact-rbac module with entity type + trust checks"
```

---

### Task 3: ChittyProof Client

**Files:**
- Create: `src/lib/chittyproof-client.js`
- Test: `tests/lib/chittyproof-client.test.js`

**Step 1: Write the failing test**

```js
// tests/lib/chittyproof-client.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChittyProofClient } from "../../src/lib/chittyproof-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CHITTY_PROOF_TOKEN: "test-proof-token",
};

let client;

beforeEach(() => {
  vi.clearAllMocks();
  client = new ChittyProofClient(mockEnv);
});

describe("ChittyProofClient", () => {
  describe("mintProof", () => {
    it("calls ChittyProof API with correct payload", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          proof_id: "proof-123",
          score: 9.5,
          chain_anchor_id: "anchor-456",
          verification_url: "https://proof.chitty.cc/verify/proof-123",
        }),
      });

      const result = await client.mintProof({
        fact_id: "fact-1",
        fact_text: "The purchase price was $500,000",
        evidence_chain: ["ev-1", "ev-2"],
        signer_chitty_id: "01-A-USA-1234-A-2601-A-X",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://proof.chitty.cc/api/v1/proofs/mint",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-proof-token",
          }),
        })
      );
      expect(result.proof_id).toBe("proof-123");
    });

    it("returns error on API failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "Service unavailable",
      });

      const result = await client.mintProof({ fact_id: "fact-1" });

      expect(result.error).toBe(true);
      expect(result.status).toBe(503);
    });
  });

  describe("exportPdf", () => {
    it("returns PDF bytes from ChittyProof", async () => {
      const pdfBuffer = new ArrayBuffer(10);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfBuffer,
        headers: new Headers({ "Content-Type": "application/pdf" }),
      });

      const result = await client.exportPdf("proof-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://proof.chitty.cc/api/v1/proofs/proof-123/export",
        expect.objectContaining({ method: "POST" })
      );
      expect(result.body).toBe(pdfBuffer);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/chittyproof-client.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```js
// src/lib/chittyproof-client.js
/**
 * ChittyProof Client
 *
 * Thin client for the ChittyProof service (proof.chitty.cc).
 * Handles proof minting, PDF export, and verification.
 *
 * @module lib/chittyproof-client
 */

const DEFAULT_BASE_URL = "https://proof.chitty.cc";

export class ChittyProofClient {
  #token;
  #baseUrl;

  /**
   * @param {object} env - Worker environment (needs CHITTY_PROOF_TOKEN)
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]
   */
  constructor(env, opts = {}) {
    this.#token = env.CHITTY_PROOF_TOKEN;
    this.#baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  }

  #headers() {
    return {
      Authorization: `Bearer ${this.#token}`,
      "Content-Type": "application/json",
      "X-Source-Service": "chittyconnect",
    };
  }

  /**
   * Mint a ChittyProof for a sealed fact.
   *
   * @param {object} params
   * @param {string} params.fact_id
   * @param {string} [params.fact_text]
   * @param {string[]} [params.evidence_chain]
   * @param {string} [params.signer_chitty_id]
   * @returns {Promise<{proof_id: string, score: number, chain_anchor_id: string, verification_url: string} | {error: boolean, status: number, message: string}>}
   */
  async mintProof(params) {
    try {
      const resp = await fetch(`${this.#baseUrl}/api/v1/proofs/mint`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({
          type: "fact",
          content: {
            fact_id: params.fact_id,
            fact_text: params.fact_text,
            evidence_chain: params.evidence_chain,
          },
          signer: params.signer_chitty_id,
          chain: true,
        }),
      });

      if (!resp.ok) {
        const message = await resp.text().catch(() => "Unknown error");
        return { error: true, status: resp.status, message };
      }

      return await resp.json();
    } catch (err) {
      return { error: true, status: 0, message: err.message };
    }
  }

  /**
   * Export a proof as PDF (PDX format).
   *
   * @param {string} proofId
   * @returns {Promise<{body: ArrayBuffer, contentType: string} | {error: boolean, status: number, message: string}>}
   */
  async exportPdf(proofId) {
    try {
      const resp = await fetch(`${this.#baseUrl}/api/v1/proofs/${proofId}/export`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ format: "pdx" }),
      });

      if (!resp.ok) {
        const message = await resp.text().catch(() => "Unknown error");
        return { error: true, status: resp.status, message };
      }

      const body = await resp.arrayBuffer();
      return {
        body,
        contentType: resp.headers.get("Content-Type") || "application/pdf",
      };
    } catch (err) {
      return { error: true, status: 0, message: err.message };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/chittyproof-client.test.js`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/lib/chittyproof-client.js tests/lib/chittyproof-client.test.js
git commit -m "feat: add chittyproof-client for proof minting and PDF export"
```

---

### Task 4: Proof Queue Consumer

**Files:**
- Create: `src/handlers/proof-queue.js`
- Test: `tests/handlers/proof-queue.test.js`
- Modify: `src/index.js:618-619` (extend `queue()` handler)

**Step 1: Write the failing test**

```js
// tests/handlers/proof-queue.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proofQueueConsumer } from "../../src/handlers/proof-queue.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CHITTY_PROOF_TOKEN: "test-proof-token",
};

beforeEach(() => {
  vi.clearAllMocks();
});

function makeMessage(body) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("proofQueueConsumer", () => {
  it("mints proof and patches ledger on success", async () => {
    // Mock ChittyProof mint response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        proof_id: "proof-abc",
        score: 8.5,
        chain_anchor_id: "anchor-def",
        verification_url: "https://proof.chitty.cc/verify/proof-abc",
      }),
    });
    // Mock ChittyLedger PATCH response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updated: true }),
    });

    const batch = {
      queue: "documint-proofs",
      messages: [
        makeMessage({
          fact_id: "fact-1",
          fact_text: "Test fact",
          evidence_chain: ["ev-1"],
          signer_chitty_id: "01-A-USA-1234-A-2601-A-X",
        }),
      ],
    };

    await proofQueueConsumer(batch, mockEnv);

    // First call: ChittyProof mint
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://proof.chitty.cc/api/v1/proofs/mint");
    // Second call: Ledger PATCH
    expect(mockFetch.mock.calls[1][0]).toBe("https://ledger.chitty.cc/api/facts/fact-1/proof");
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });

  it("retries message on ChittyProof failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    });

    const batch = {
      queue: "documint-proofs",
      messages: [makeMessage({ fact_id: "fact-2" })],
    };

    await proofQueueConsumer(batch, mockEnv);

    expect(batch.messages[0].retry).toHaveBeenCalled();
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/handlers/proof-queue.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```js
// src/handlers/proof-queue.js
/**
 * Proof Queue Consumer
 *
 * Processes async proof minting jobs from the PROOF_Q queue.
 * On success: mints ChittyProof, patches result back to ChittyLedger.
 * On failure: retries the message (Cloudflare Queues handles backoff).
 *
 * @module handlers/proof-queue
 */

import { ChittyProofClient } from "../lib/chittyproof-client.js";

/**
 * Process a batch of proof minting jobs.
 *
 * @param {MessageBatch} batch
 * @param {object} env - Worker environment
 */
export async function proofQueueConsumer(batch, env) {
  const client = new ChittyProofClient(env);

  for (const msg of batch.messages) {
    try {
      const { fact_id, fact_text, evidence_chain, signer_chitty_id } = msg.body;

      // 1. Mint proof via ChittyProof
      const proofResult = await client.mintProof({
        fact_id,
        fact_text,
        evidence_chain,
        signer_chitty_id,
      });

      if (proofResult.error) {
        console.error(`[ProofQueue] Mint failed for ${fact_id}:`, proofResult.message);
        msg.retry();
        continue;
      }

      // 2. Patch proof data back to ChittyLedger
      const patchResp = await fetch(
        `https://ledger.chitty.cc/api/facts/${fact_id}/proof`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proof_id: proofResult.proof_id,
            blockchain_record_id: proofResult.chain_anchor_id,
            verification_url: proofResult.verification_url,
            proof_score: proofResult.score,
            proof_status: "MINTED",
          }),
        },
      );

      if (!patchResp.ok) {
        console.error(`[ProofQueue] Ledger patch failed for ${fact_id}: ${patchResp.status}`);
        msg.retry();
        continue;
      }

      msg.ack();
      console.log(`[ProofQueue] Proof minted for ${fact_id}: ${proofResult.proof_id}`);
    } catch (err) {
      console.error(`[ProofQueue] Error processing ${msg.body?.fact_id}:`, err.message);
      msg.retry();
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/handlers/proof-queue.test.js`
Expected: PASS (2 tests)

**Step 5: Wire into `src/index.js`**

Modify `src/index.js:618-619` — change the `queue()` handler to route by queue name:

```js
// BEFORE (line 618-619):
  async queue(batch, env) {
    await queueConsumer(batch, env);
  },

// AFTER:
  async queue(batch, env) {
    if (batch.queue === "documint-proofs") {
      const { proofQueueConsumer } = await import("./handlers/proof-queue.js");
      await proofQueueConsumer(batch, env);
    } else {
      await queueConsumer(batch, env);
    }
  },
```

**Step 6: Commit**

```bash
git add src/handlers/proof-queue.js tests/handlers/proof-queue.test.js src/index.js
git commit -m "feat: add proof queue consumer for async ChittyProof minting"
```

---

### Task 5: Add 3 New MCP Tool Dispatchers

**Files:**
- Modify: `src/mcp/tool-dispatcher.js:174-184` (insert before `chitty_ledger_contradictions`)

**Step 1: Write the failing tests**

Add to `tests/mcp/tool-dispatcher.test.js` (append before the closing `});`):

```js
  // ── Fact Governance (seal, dispute, export) ──────────────────────

  describe("chitty_fact_seal", () => {
    it("returns RBAC error when trust level insufficient", async () => {
      // Mock trust resolver: low trust
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trust_level: 2, entity_type: "P" }),
      });

      const result = await dispatchToolCall(
        "chitty_fact_seal",
        { fact_id: "fact-1", actor_chitty_id: "01-P-USA-1234-P-2601-A-X" },
        mockEnv,
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
      const envWithQueue = { ...mockEnv, PROOF_Q: mockProofQ, CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, CHITTY_TRUST_TOKEN: "tok" };

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

      const envWithCache = { ...mockEnv, CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, CHITTY_TRUST_TOKEN: "tok" };

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

      const envWithCache = { ...mockEnv, CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, CHITTY_TRUST_TOKEN: "tok" };

      const result = await dispatchToolCall(
        "chitty_fact_export",
        { fact_id: "fact-1", format: "json", actor_chitty_id: "01-P-USA-1234-P-2601-A-X" },
        envWithCache,
      );

      expect(result.isError).toBeUndefined();
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tool-dispatcher.test.js`
Expected: FAIL — "Unknown tool: chitty_fact_seal"

**Step 3: Implement the dispatchers**

Add to `src/mcp/tool-dispatcher.js` after the `chitty_fact_validate` block (after line 174) and before `chitty_ledger_contradictions`:

```js
    } else if (name === "chitty_fact_seal") {
      // RBAC: Authority (A) with trust >= INSTITUTIONAL (4)
      const { checkFactPermission, FACT_ACTIONS } = await import("../lib/fact-rbac.js");
      const perm = await checkFactPermission(args.actor_chitty_id, FACT_ACTIONS.SEAL, env);
      if (!perm.allowed) {
        return {
          content: [{ type: "text", text: `Permission denied: ${perm.reason}` }],
          isError: true,
        };
      }

      // Seal the fact in ChittyLedger
      const response = await fetch(`https://ledger.chitty.cc/api/facts/${args.fact_id}/seal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sealed_by: args.actor_chitty_id,
          seal_reason: args.seal_reason,
        }),
      });
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }

      // Enqueue async proof minting if seal succeeded
      if (response.ok && env.PROOF_Q) {
        await env.PROOF_Q.send({
          fact_id: args.fact_id,
          fact_text: result.fact_text || result.text,
          evidence_chain: result.evidence_chain || [],
          signer_chitty_id: args.actor_chitty_id,
        });
      }

    } else if (name === "chitty_fact_dispute") {
      // RBAC: Person (P) or Authority (A) with trust >= ENHANCED (2)
      const { checkFactPermission, FACT_ACTIONS } = await import("../lib/fact-rbac.js");
      const perm = await checkFactPermission(args.actor_chitty_id, FACT_ACTIONS.DISPUTE, env);
      if (!perm.allowed) {
        return {
          content: [{ type: "text", text: `Permission denied: ${perm.reason}` }],
          isError: true,
        };
      }

      // Verify counter evidence exists (if provided)
      if (args.counter_evidence_ids?.length) {
        for (const evId of args.counter_evidence_ids) {
          const check = await fetch(`https://ledger.chitty.cc/api/evidence/${evId}`);
          if (!check.ok) {
            return {
              content: [{
                type: "text",
                text: `Dispute blocked: counter evidence "${evId}" not found in ChittyLedger (${check.status}).`,
              }],
              isError: true,
            };
          }
        }
      }

      const response = await fetch(`https://ledger.chitty.cc/api/facts/${args.fact_id}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: args.reason,
          challenger_chitty_id: args.challenger_chitty_id || args.actor_chitty_id,
          counter_evidence_ids: args.counter_evidence_ids,
        }),
      });
      const text = await response.text();
      try { result = JSON.parse(text); } catch {
        result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
      }

    } else if (name === "chitty_fact_export") {
      // RBAC: Any authenticated with trust >= BASIC (1)
      const { checkFactPermission, FACT_ACTIONS } = await import("../lib/fact-rbac.js");
      const perm = await checkFactPermission(args.actor_chitty_id, FACT_ACTIONS.EXPORT, env);
      if (!perm.allowed) {
        return {
          content: [{ type: "text", text: `Permission denied: ${perm.reason}` }],
          isError: true,
        };
      }

      if (args.format === "pdf") {
        // Fetch fact with proof data
        const factResp = await fetch(`https://ledger.chitty.cc/api/facts/${args.fact_id}/export`);
        if (!factResp.ok) {
          return {
            content: [{ type: "text", text: `Export failed: fact ${args.fact_id} not found (${factResp.status})` }],
            isError: true,
          };
        }
        const factData = await factResp.json();

        if (!factData.proof_id) {
          return {
            content: [{ type: "text", text: `PDF export requires a sealed fact with a minted proof. Current proof_status: ${factData.proof_status || "NONE"}` }],
            isError: true,
          };
        }

        // Generate PDF via ChittyProof and store in R2
        const { ChittyProofClient } = await import("../lib/chittyproof-client.js");
        const proofClient = new ChittyProofClient(env);
        const pdfResult = await proofClient.exportPdf(factData.proof_id);

        if (pdfResult.error) {
          return {
            content: [{ type: "text", text: `PDF generation failed: ${pdfResult.message}` }],
            isError: true,
          };
        }

        // Store in R2
        const r2Key = `exports/facts/${args.fact_id}/${Date.now()}.pdf`;
        if (env.FILES) {
          await env.FILES.put(r2Key, pdfResult.body, {
            httpMetadata: { contentType: "application/pdf" },
          });
        }

        result = {
          fact_id: args.fact_id,
          format: "pdf",
          download_url: `https://connect.chitty.cc/api/v1/exports/${r2Key}`,
          proof_id: factData.proof_id,
          verification_url: factData.verification_url,
        };
      } else {
        // JSON export — fetch full fact with proof bundle
        const response = await fetch(`https://ledger.chitty.cc/api/facts/${args.fact_id}/export`);
        const text = await response.text();
        try { result = JSON.parse(text); } catch {
          result = { error: `Ledger returned (${response.status}): ${text.slice(0, 200)}` };
        }
      }

    } else if (name === "chitty_ledger_contradictions") {
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tool-dispatcher.test.js`
Expected: PASS (all existing + 4 new tests)

**Step 5: Commit**

```bash
git add src/mcp/tool-dispatcher.js tests/mcp/tool-dispatcher.test.js
git commit -m "feat: add seal, dispute, export tool dispatchers with RBAC"
```

---

### Task 6: Add Zod Schemas for ChatGPT MCP Server

**Files:**
- Modify: `src/mcp/chatgpt-server.js:317-318` (insert after `chitty_fact_validate` block, before ChittyContextual)

**Step 1: Write the failing test**

Add to `tests/mcp/chatgpt-server.test.js` — update the `expectedTools` array:

```js
    const expectedTools = [
      // ... existing 31 tools ...
      "chitty_fact_seal",
      "chitty_fact_dispute",
      "chitty_fact_export",
    ];

    it("includes all expected tool names", () => {
      expect(expectedTools.length).toBe(34);
    });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/chatgpt-server.test.js`
Expected: FAIL — expected 34, got 31

**Step 3: Add the Zod schemas**

Insert after line 317 in `src/mcp/chatgpt-server.js` (after `chitty_fact_validate` closing brace):

```js
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
```

Also update the server version from `"2.0.2"` to `"2.1.0"` (line 372) to reflect new tool additions.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/chatgpt-server.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp/chatgpt-server.js tests/mcp/chatgpt-server.test.js
git commit -m "feat: add Zod schemas for seal, dispute, export in ChatGPT MCP"
```

---

### Task 7: Add JSON Schema Definitions for REST MCP

**Files:**
- Modify: `src/api/routes/mcp.js:538-560` (insert after `chitty_fact_validate` block)

**Step 1: Add the definitions**

Insert after the `chitty_fact_validate` tool definition (around line 560) in the `TOOL_DEFINITIONS` array:

```js
    {
      name: "chitty_fact_seal",
      description: "Seal a verified fact permanently, triggering async ChittyProof minting. Requires Authority entity type with INSTITUTIONAL trust level (4+).",
      inputSchema: {
        type: "object",
        properties: {
          fact_id: { type: "string", description: "Fact ID to seal" },
          actor_chitty_id: { type: "string", description: "ChittyID of the authority performing the seal" },
          seal_reason: { type: "string", description: "Reason for sealing the fact" },
        },
        required: ["fact_id", "actor_chitty_id"],
      },
    },
    {
      name: "chitty_fact_dispute",
      description: "Dispute a verified or sealed fact. Creates a dispute record. Requires ENHANCED trust level (2+).",
      inputSchema: {
        type: "object",
        properties: {
          fact_id: { type: "string", description: "Fact ID to dispute" },
          reason: { type: "string", description: "Reason for the dispute" },
          actor_chitty_id: { type: "string", description: "ChittyID of the entity filing the dispute" },
          challenger_chitty_id: { type: "string", description: "ChittyID of the challenger (defaults to actor)" },
          counter_evidence_ids: { type: "array", items: { type: "string" }, description: "Evidence IDs that contradict this fact" },
        },
        required: ["fact_id", "reason", "actor_chitty_id"],
      },
    },
    {
      name: "chitty_fact_export",
      description: "Export a fact with its full proof bundle. JSON or PDF format.",
      inputSchema: {
        type: "object",
        properties: {
          fact_id: { type: "string", description: "Fact ID to export" },
          format: { type: "string", enum: ["json", "pdf"], description: "Export format" },
          actor_chitty_id: { type: "string", description: "ChittyID of the requesting entity" },
        },
        required: ["fact_id", "format", "actor_chitty_id"],
      },
    },
```

Update the tool count comment at the top of the TOOL_DEFINITIONS array to reflect 36 tools.

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/api/routes/mcp.js
git commit -m "feat: add JSON Schema definitions for seal, dispute, export REST MCP"
```

---

### Task 8: Add Queue Binding to wrangler.toml

**Files:**
- Modify: `wrangler.toml:67-69` (add after EVENT_Q producer), also staging and production sections

**Step 1: Add bindings**

After the `EVENT_Q` producer (line 69), add:

```toml
[[queues.producers]]
binding = "PROOF_Q"
queue = "documint-proofs"

[[queues.consumers]]
queue = "documint-proofs"
max_batch_size = 10
max_retries = 5
dead_letter_queue = "documint-proofs-dlq"
```

Add staging equivalent after line 113 (`env.staging.queues.producers` for EVENT_Q):

```toml
[[env.staging.queues.producers]]
binding = "PROOF_Q"
queue = "documint-proofs"
```

Add production equivalent after line 193 (`env.production.queues.producers` for EVENT_Q):

```toml
[[env.production.queues.producers]]
binding = "PROOF_Q"
queue = "documint-proofs"
```

Add new secrets to the secrets comment block (after line 231):

```toml
# - CHITTY_PROOF_TOKEN (service token for proof.chitty.cc)
# - CHITTY_TRUST_TOKEN (service token for trust.chitty.cc)
```

**Step 2: Run all tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "feat: add PROOF_Q queue binding for async proof minting"
```

---

### Task 9: R2 Export Download Route

**Files:**
- Create: `src/api/routes/exports.js`
- Modify: `src/api/router.js` (mount the new route)

**Step 1: Write the route**

```js
// src/api/routes/exports.js
/**
 * R2 Export Download Route
 *
 * Streams exported files (PDFs, proof bundles) from R2 without buffering.
 *
 * @module api/routes/exports
 */

import { Hono } from "hono";

export const exportRoutes = new Hono();

exportRoutes.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");

  if (!c.env.FILES) {
    return c.json({ error: "Storage not configured" }, 503);
  }

  const obj = await c.env.FILES.get(`exports/${key}`);
  if (!obj) {
    return c.json({ error: "Export not found" }, 404);
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
      "Content-Length": obj.size,
    },
  });
});
```

**Step 2: Mount in router**

Add to `src/api/router.js`:

```js
import { exportRoutes } from "./routes/exports.js";
api.route("/api/v1/exports", exportRoutes);
```

**Step 3: Commit**

```bash
git add src/api/routes/exports.js src/api/router.js
git commit -m "feat: add R2 streaming export download route"
```

---

### Task 10: Run Full Test Suite and Final Commit

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: Check lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Verify git status is clean**

Run: `git status`
Expected: Clean working tree, branch ahead of origin

**Step 4: Final summary commit if any stragglers**

If any uncommitted changes remain:

```bash
git add -A
git commit -m "chore: cleanup and finalize fact governance hardening"
```

---

## Post-Implementation Checklist

- [ ] All tests pass (`npx vitest run`)
- [ ] Lint clean (`npm run lint`)
- [ ] 36 MCP tools registered (was 33)
- [ ] Trust resolver caches in CREDENTIAL_CACHE KV
- [ ] Proof queue consumer wired in `src/index.js`
- [ ] R2 export route mounted at `/api/v1/exports/*`
- [ ] wrangler.toml has `PROOF_Q` binding in dev, staging, production
- [ ] Secrets documented: `CHITTY_PROOF_TOKEN`, `CHITTY_TRUST_TOKEN`
