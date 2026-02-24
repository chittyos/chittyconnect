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
    if (!env.CHITTY_PROOF_TOKEN) {
      throw new Error("[ChittyProofClient] CHITTY_PROOF_TOKEN secret is not configured");
    }
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
