import { Router } from "itty-router";
import { ChittyCertClient } from "@chittycorp/chittycanon-sdk";

export const ledgerRouter = Router({ base: "/api/v1/ledger" });

/**
 * POST /api/v1/ledger/append
 * Appends a new cryptographic event to the context.ledger.
 * Requires STRICT_SOVEREIGNTY validation of the incoming cert.
 */
ledgerRouter.post("/append", async (req, env, ctx) => {
  const certHeader = req.headers.get("x-sovereignty-cert") || req.headers.get("authorization");
  if (!certHeader) {
    return new Response(JSON.stringify({ error: "Missing SOVEREIGNTY.cert" }), { status: 401 });
  }

  const payload = await req.json();
  const { context_id, context_chitty_id, session_id, event_type, data, signature, signer_id } = payload;

  if (!context_id || !signature || !signer_id) {
    return new Response(JSON.stringify({ error: "Missing required ledger payload fields" }), { status: 400 });
  }

  // 1. Verify the Sovereignty Cert
  const client = new ChittyCertClient({
    serviceUrl: env.CHITTYCERT_SERVICE_URL,
    token: env.CHITTY_CERT_TOKEN,
  });

  const valResult = await client.validateCert(certHeader, signer_id, "chitty_ledger_record");
  if (!valResult.valid) {
    return new Response(JSON.stringify({ error: "Invalid SOVEREIGNTY.cert", details: valResult.error }), { status: 403 });
  }

  // 2. Fetch previous hash
  const db = env.DB; // D1 binding
  const lastEntry = await db.prepare(
    `SELECT hash FROM context_ledger WHERE context_id = ? ORDER BY timestamp DESC LIMIT 1`
  ).bind(context_id).first();
  const previous_hash = lastEntry ? lastEntry.hash : "GENESIS";

  // 3. Generate current hash (simple SHA-256 placeholder via Web Crypto)
  const encoder = new TextEncoder();
  const dataString = JSON.stringify(data);
  const hashMaterial = `${previous_hash}:${context_id}:${event_type}:${dataString}:${signature}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(hashMaterial));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const id = crypto.randomUUID();

  // 4. Insert (relying on trigger to prevent updates/deletes)
  try {
    await db.prepare(`
      INSERT INTO context_ledger (
        id, context_id, context_chitty_id, session_id, event_type,
        payload, hash, previous_hash, signer_id, signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, context_id, context_chitty_id, session_id, event_type,
      dataString, hashHex, previous_hash, signer_id, signature
    ).run();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Ledger append failed", details: err.message }), { status: 500 });
  }

  return new Response(JSON.stringify({
    success: true,
    id,
    hash: hashHex,
    previous_hash
  }), { status: 201 });
});

export default ledgerRouter;
