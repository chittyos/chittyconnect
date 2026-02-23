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
