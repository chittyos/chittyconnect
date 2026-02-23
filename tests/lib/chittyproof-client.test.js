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
