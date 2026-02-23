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
