/**
 * MCP Client Binding Service — Zero-Trust Identity Resolution
 *
 * Manages the lifecycle of MCP client → ChittyID bindings with:
 * - Neon as source of truth (durable)
 * - KV as fast-path cache (ephemeral)
 * - Revocation checks on every auth (zero-trust)
 * - ChittyChronicle audit logging
 *
 * Separation of concerns: oauth-provider.js handles OAuth orchestration,
 * this module handles identity binding and trust verification.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/services/client-binding
 * @canon chittycanon://gov/governance#core-types
 */

import { Client } from "@neondatabase/serverless";
import { ChittyIDClient } from "../lib/chittyid-client.js";

/**
 * Build a deterministic cache key from client context.
 *
 * @param {string} clientId - OAuth client_id
 * @param {Object} contextHints - Contextual signals (spaceId, userId, etc.)
 * @returns {string} Cache key for KV and Neon lookups
 */
export function buildCacheKey(clientId, contextHints = {}) {
  const parts = [clientId];
  if (contextHints.spaceId) parts.push(`s:${contextHints.spaceId}`);
  if (contextHints.userId) parts.push(`u:${contextHints.userId}`);
  return `mcp-client:${parts.join(":")}`;
}

/**
 * Resolve a ChittyID for an MCP client context.
 *
 * Zero-trust flow:
 *   1. KV cache → hit + active? done (fast path)
 *   2. KV miss → Neon lookup → found + active? write KV, done
 *   3. Neon miss → mint ChittyID → write Neon + KV + chronicle log
 *   4. Revoked/suspended in either layer → reject
 *
 * @param {string} clientId - OAuth client_id
 * @param {Object} env - Worker environment bindings
 * @param {Object} [contextHints] - Contextual signals from redirect params
 * @returns {Promise<{chittyId: string, binding: Object}>}
 * @throws {ClientBindingError} If binding is revoked or suspended
 */
export async function resolveBinding(clientId, env, contextHints = {}) {
  const cacheKey = buildCacheKey(clientId, contextHints);

  // 1. KV fast path
  const cached = await env.TOKEN_KV.get(cacheKey, { type: "json" });
  if (cached?.chittyId) {
    if (cached.status === "revoked" || cached.status === "suspended") {
      throw new ClientBindingError(
        "BINDING_REVOKED",
        `Client binding ${cacheKey} is ${cached.status}`,
      );
    }
    // Update last_seen in background (don't block auth)
    touchBinding(cacheKey, env).catch(() => {});
    return { chittyId: cached.chittyId, binding: cached, source: "kv" };
  }

  // 2. Neon lookup
  const dbBinding = await queryBinding(cacheKey, env);
  if (dbBinding) {
    if (dbBinding.status === "revoked" || dbBinding.status === "suspended") {
      // Cache the revocation in KV so future checks are fast
      await writeKvCache(cacheKey, dbBinding, env);
      throw new ClientBindingError(
        "BINDING_REVOKED",
        `Client binding ${cacheKey} is ${dbBinding.status}`,
      );
    }
    // Rehydrate KV cache
    await writeKvCache(cacheKey, dbBinding, env);
    touchBinding(cacheKey, env).catch(() => {});
    return { chittyId: dbBinding.chitty_id, binding: dbBinding, source: "neon" };
  }

  // 3. Mint new ChittyID
  const chittyId = await mintClientChittyId(clientId, env);
  const binding = {
    chittyId,
    clientId,
    cacheKey,
    ...contextHints,
    status: "active",
    trustLevel: 2,
    authCount: 1,
    mintedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  // Write to Neon (source of truth)
  await insertBinding(binding, env);

  // Write to KV (cache)
  await writeKvCache(cacheKey, binding, env);

  // Audit log
  await logChronicle(env, "mcp_client_binding_created", chittyId, {
    clientId,
    cacheKey,
    contextHints,
  });

  return { chittyId, binding, source: "minted" };
}

/**
 * Revoke a client binding (zero-trust: immediate effect).
 *
 * @param {string} cacheKey - The binding cache key
 * @param {string} revokedBy - ChittyID of the revoker
 * @param {string} reason - Revocation reason
 * @param {Object} env - Worker environment bindings
 */
export async function revokeBinding(cacheKey, revokedBy, reason, env) {
  const db = new Client({ connectionString: env.NEON_DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      `UPDATE mcp_client_bindings
       SET status = 'revoked', revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
       WHERE cache_key = $3 AND status = 'active'`,
      [revokedBy, reason, cacheKey],
    );
  } finally {
    await db.end().catch(() => {});
  }

  // Poison the KV cache immediately
  const existing = await env.TOKEN_KV.get(cacheKey, { type: "json" });
  if (existing) {
    existing.status = "revoked";
    existing.revokedAt = new Date().toISOString();
    await env.TOKEN_KV.put(cacheKey, JSON.stringify(existing));
  }

  await logChronicle(env, "mcp_client_binding_revoked", revokedBy, {
    cacheKey,
    reason,
  });
}

/**
 * List all active bindings for a client_id (admin use).
 */
export async function listBindings(clientId, env) {
  const db = new Client({ connectionString: env.NEON_DATABASE_URL });
  try {
    await db.connect();
    const result = await db.query(
      `SELECT * FROM mcp_client_bindings WHERE client_id = $1 ORDER BY last_seen_at DESC`,
      [clientId],
    );
    return result.rows;
  } finally {
    await db.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function queryBinding(cacheKey, env) {
  const db = new Client({ connectionString: env.NEON_DATABASE_URL });
  try {
    await db.connect();
    const result = await db.query(
      `SELECT * FROM mcp_client_bindings WHERE cache_key = $1 LIMIT 1`,
      [cacheKey],
    );
    return result.rows[0] || null;
  } finally {
    await db.end().catch(() => {});
  }
}

async function insertBinding(binding, env) {
  const db = new Client({ connectionString: env.NEON_DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      `INSERT INTO mcp_client_bindings
         (cache_key, client_id, space_id, user_id, chitty_id, status, trust_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (cache_key) DO NOTHING`,
      [
        binding.cacheKey,
        binding.clientId,
        binding.spaceId || null,
        binding.userId || null,
        binding.chittyId,
        binding.status,
        binding.trustLevel,
      ],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function touchBinding(cacheKey, env) {
  const db = new Client({ connectionString: env.NEON_DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      `UPDATE mcp_client_bindings
       SET last_seen_at = NOW(), auth_count = auth_count + 1
       WHERE cache_key = $1 AND status = 'active'`,
      [cacheKey],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function writeKvCache(cacheKey, binding, env) {
  const kvData = {
    chittyId: binding.chittyId || binding.chitty_id,
    clientId: binding.clientId || binding.client_id,
    spaceId: binding.spaceId || binding.space_id || null,
    userId: binding.userId || binding.user_id || null,
    status: binding.status,
    trustLevel: binding.trustLevel || binding.trust_level,
    mintedAt: binding.mintedAt || binding.minted_at,
    type: "mcp-client",
  };
  // Cache for 1 hour — zero-trust: re-verify against Neon periodically
  await env.TOKEN_KV.put(cacheKey, JSON.stringify(kvData), {
    expirationTtl: 3600,
  });
}

async function mintClientChittyId(clientId, env) {
  try {
    const client = new ChittyIDClient({
      env,
      token: env.CHITTY_ID_SERVICE_TOKEN,
    });
    const result = await client.mint("person", { trust: 2 });
    const chittyId = result.chittyId || result.id;
    if (chittyId) {
      console.log(`[ClientBinding] Minted ChittyID ${chittyId} for ${clientId}`);
      return chittyId;
    }
  } catch (err) {
    console.error(
      `[ClientBinding] Mint failed for ${clientId}: ${err.message}`,
    );
  }
  // Fallback: deterministic synthetic ID so we never block auth
  return `mcp-client:${clientId}`;
}

async function logChronicle(env, action, chittyId, metadata) {
  try {
    const chronicleUrl =
      env.CHITTY_CHRONICLE_URL || "https://connect.chitty.cc";
    await fetch(`${chronicleUrl}/api/v1/chronicle/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CHITTY_CHRONICLE_TOKEN || ""}`,
      },
      body: JSON.stringify({
        service: "chittyconnect",
        action,
        userId: chittyId,
        metadata,
        status: "success",
      }),
    });
  } catch {
    // Chronicle logging is best-effort — never block auth
  }
}

export class ClientBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClientBindingError";
    this.code = code;
  }
}
