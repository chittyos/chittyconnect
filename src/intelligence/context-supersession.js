import { serviceFetch } from "../lib/service-switch.js";
import { ChittyIDClient } from "../lib/chittyid-client.js";

export class ContextSupersessionError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "ContextSupersessionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function entityType(chittyId) {
  return ChittyIDClient.parse(chittyId)?.entityType || null;
}

function authorityHint(manifest = {}) {
  return {
    auditId: manifest.auditId || manifest.mint_audit_id || null,
    supersedes: manifest.supersedes || manifest.from_chitty_id || null,
    successor: manifest.successor || manifest.to_chitty_id || null,
  };
}

function parseIssuedAtSeconds(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

async function hashContent(content) {
  const encoded = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function directContextByChittyId(db, chittyId) {
  return db
    .prepare(
      `SELECT *
       FROM context_entities
       WHERE chitty_id = ?
       LIMIT 1`,
    )
    .bind(chittyId)
    .first();
}

async function contextSchema(db) {
  const row = await db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table' AND name = 'context_entities'
       LIMIT 1`,
    )
    .first();

  const sql = row?.sql || "";
  return {
    sql,
    retiredStatus: /['"]retired['"]/.test(sql) ? "retired" : "archived",
    contextHashUnique: /context_hash\s+TEXT(?:\s+NOT\s+NULL)?\s+UNIQUE/i.test(sql),
  };
}

async function activeSessionCount(db, contextId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM context_session_bindings
       WHERE context_id = ? AND unbound_at IS NULL`,
    )
    .bind(contextId)
    .first();
  return Number(row?.count || 0);
}

async function contextDnaCount(db, contextId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM context_dna
       WHERE context_id = ?`,
    )
    .bind(contextId)
    .first();
  return Number(row?.count || 0);
}

function isRetiredStatus(status) {
  return status === "archived" || status === "retired";
}

async function idempotentState(db, source, relation, auditId) {
  const target = await directContextByChittyId(db, relation.successor);
  if (!target || !isRetiredStatus(source.status)) return null;

  const sourceReleased =
    source.context_hash === target.context_hash ||
    source.context_hash?.startsWith(`superseded:${auditId}:`);

  if (
    target.signature !== `supersession:${auditId}` ||
    !sourceReleased
  ) {
    return null;
  }

  return {
    migrated: true,
    idempotent: true,
    from: relation.supersedes,
    to: relation.successor,
    auditId,
    sourceContextId: source.id,
    targetContextId: target.id,
    contextHash: target.context_hash,
  };
}

export async function verifyCanonicalSupersession(
  env,
  manifest,
  fetchService = serviceFetch,
) {
  if (!manifest || typeof manifest !== "object") {
    throw new ContextSupersessionError(
      "MISSING_MANIFEST",
      "ChittyID supersession manifest/reference is required",
      400,
    );
  }

  const hints = authorityHint(manifest);
  if (!hints.auditId && !hints.supersedes) {
    throw new ContextSupersessionError(
      "MANIFEST_INCOMPLETE",
      "manifest must include auditId/mint_audit_id or supersedes/from_chitty_id",
      400,
    );
  }

  const response = await fetchService(
    env,
    "id",
    "/api/supersession/verify",
    {
      method: "POST",
      body: hints.auditId
        ? { auditId: hints.auditId }
        : { supersedes: hints.supersedes },
    },
  );

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ContextSupersessionError(
      "IDENTITY_AUTHORITY_INVALID_RESPONSE",
      "ChittyID returned an unreadable supersession verification response",
      502,
    );
  }

  if (
    !response.ok ||
    payload?.valid !== true ||
    payload?.canonical !== true ||
    payload?.mintVerified !== true ||
    !payload?.relation
  ) {
    throw new ContextSupersessionError(
      "IDENTITY_AUTHORITY_REJECTED",
      "ChittyID did not verify a current canonical supersession relation",
      response.status === 503 ? 503 : 409,
      {
        status: response.status,
        reason: payload?.reason || payload?.error || "authority_rejected",
      },
    );
  }

  const relation = payload.relation;
  if (
    entityType(relation.supersedes) !== "T" ||
    entityType(relation.successor) !== "P"
  ) {
    throw new ContextSupersessionError(
      "INVALID_SUPERSESSION_TYPES",
      "Canonical relation must be legacy Thing (T) to Synthetic Person (P)",
      409,
    );
  }

  if (
    (hints.auditId && relation.auditId !== hints.auditId) ||
    (hints.supersedes && relation.supersedes !== hints.supersedes) ||
    (hints.successor && relation.successor !== hints.successor)
  ) {
    throw new ContextSupersessionError(
      "MANIFEST_RELATION_MISMATCH",
      "Caller-supplied supersession fields do not match ChittyID authority",
      409,
    );
  }

  return relation;
}

export async function migrateCanonicalSupersession(
  env,
  manifest,
  options = {},
) {
  const db = env?.DB;
  if (!db) {
    throw new ContextSupersessionError(
      "CONTEXT_DB_UNAVAILABLE",
      "ChittyConnect context database is unavailable",
      503,
    );
  }

  const relation = await verifyCanonicalSupersession(
    env,
    manifest,
    options.fetchService || serviceFetch,
  );
  const auditId = relation.auditId;
  const source = await directContextByChittyId(db, relation.supersedes);

  if (!source) {
    throw new ContextSupersessionError(
      "SOURCE_NOT_FOUND",
      `Source context ${relation.supersedes} is not present in ChittyConnect`,
      404,
    );
  }
  if (entityType(source.chitty_id) !== "T") {
    throw new ContextSupersessionError(
      "SOURCE_NOT_LEGACY_THING",
      "Source context is not a legacy Thing identity",
      409,
    );
  }

  const alreadyMigrated = await idempotentState(
    db,
    source,
    relation,
    auditId,
  );
  if (alreadyMigrated) return alreadyMigrated;

  const existingTarget = await directContextByChittyId(db, relation.successor);
  if (existingTarget) {
    throw new ContextSupersessionError(
      "TARGET_CONFLICT",
      "Successor context already exists but the source is not in the matching retired state",
      409,
      { targetContextId: existingTarget.id, sourceStatus: source.status },
    );
  }

  const activeSessions = await activeSessionCount(db, source.id);
  if (activeSessions > 0) {
    throw new ContextSupersessionError(
      "ACTIVE_SESSIONS_PRESENT",
      "Legacy context has active session bindings; drain/re-authenticate them before identity handoff",
      409,
      { activeSessions },
    );
  }

  if (!source.context_hash) {
    throw new ContextSupersessionError(
      "SOURCE_ANCHOR_MISSING",
      "Legacy context has no canonical context_hash to hand off",
      409,
    );
  }

  const [schema, dnaRowsMoved] = await Promise.all([
    contextSchema(db),
    contextDnaCount(db, source.id),
  ]);
  const targetId = crypto.randomUUID();
  const timestampMs = Date.now();
  const timestampSec = Math.floor(timestampMs / 1000);
  const targetCreatedAt = parseIssuedAtSeconds(relation.issuedAt);
  // Active bindings were explicitly drained above, so the successor is
  // reconstitutable but not currently active. The next authenticated bind
  // promotes it back to active through the normal ContextResolver path.
  const targetStatus = "dormant";
  const originalContextHash = source.context_hash;
  const releasedSourceHash = schema.contextHashUnique
    ? `superseded:${auditId}:${originalContextHash}`
    : originalContextHash;

  const targetEntryId = crypto.randomUUID();
  const targetPayload = {
    type: "identity_supersession_received",
    auditId,
    predecessor: relation.supersedes,
    successor: relation.successor,
    authority: relation.authority || "id.chitty.cc",
    mintAuthority: relation.mintAuthority || "mint.chitty.cc",
    sourceContextId: source.id,
    targetContextId: targetId,
    originalContextHash,
    dnaMoved: dnaRowsMoved > 0,
    dnaRowsMoved,
    reason: "legacy_context_identity_correction",
    migratedAt: timestampMs,
  };
  const targetEntryData = {
    entryId: targetEntryId,
    contextId: targetId,
    sessionId: "identity_supersession",
    eventType: "transaction",
    payload: targetPayload,
    timestamp: timestampMs,
  };
  const targetEntryHash = await hashContent(targetEntryData);

  const sourceEntryId = crypto.randomUUID();
  const sourcePayload = {
    type: "identity_superseded",
    auditId,
    predecessor: relation.supersedes,
    successor: relation.successor,
    authority: relation.authority || "id.chitty.cc",
    mintAuthority: relation.mintAuthority || "mint.chitty.cc",
    sourceContextId: source.id,
    targetContextId: targetId,
    originalContextHash,
    releasedSourceHash,
    linkedTargetEntryId: targetEntryId,
    linkedTargetHash: targetEntryHash,
    reason: "legacy_context_identity_correction",
    migratedAt: timestampMs,
  };
  const sourceEntryData = {
    entryId: sourceEntryId,
    contextId: source.id,
    sessionId: "identity_supersession",
    eventType: "transaction",
    payload: sourcePayload,
    timestamp: timestampMs,
  };
  const sourceEntryHash = await hashContent(sourceEntryData);

  const statements = [
    db
      .prepare(
        `UPDATE context_entities
         SET context_hash = ?,
             status = ?,
             current_sessions = '[]',
             last_activity = ?
         WHERE id = ? AND chitty_id = ?`,
      )
      .bind(
        releasedSourceHash,
        schema.retiredStatus,
        timestampSec,
        source.id,
        source.chitty_id,
      ),
    db
      .prepare(
        `INSERT INTO context_entities (
           id, chitty_id, context_hash, project_path, workspace, support_type,
           organization, signature, issuer, trust_score, trust_level,
           current_sessions, total_sessions, status, created_at, last_activity
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      )
      .bind(
        targetId,
        relation.successor,
        originalContextHash,
        source.project_path || null,
        source.workspace || null,
        source.support_type || "development",
        source.organization || null,
        `supersession:${auditId}`,
        relation.authority || "id.chitty.cc",
        source.trust_score ?? 0,
        source.trust_level ?? 0,
        source.total_sessions ?? 0,
        targetStatus,
        targetCreatedAt,
        source.last_activity || timestampSec,
      ),
    db
      .prepare(
        `UPDATE context_dna
         SET context_id = ?, context_chitty_id = ?
         WHERE context_id = ?`,
      )
      .bind(targetId, relation.successor, source.id),
    db
      .prepare(
        `INSERT INTO context_ledger (
           id, context_id, context_chitty_id, session_id,
           event_type, payload, hash, previous_hash
         ) VALUES (?, ?, ?, ?, 'transaction', ?, ?, 'genesis')`,
      )
      .bind(
        targetEntryId,
        targetId,
        relation.successor,
        "identity_supersession",
        JSON.stringify(targetPayload),
        targetEntryHash,
      ),
    db
      .prepare(
        `INSERT INTO context_ledger (
           id, context_id, context_chitty_id, session_id,
           event_type, payload, hash, previous_hash
         )
         SELECT ?, ?, ?, ?, 'transaction', ?, ?,
                COALESCE(
                  (
                    SELECT hash
                    FROM context_ledger
                    WHERE context_id = ?
                    ORDER BY timestamp DESC
                    LIMIT 1
                  ),
                  'genesis'
                )`,
      )
      .bind(
        sourceEntryId,
        source.id,
        source.chitty_id,
        "identity_supersession",
        JSON.stringify(sourcePayload),
        sourceEntryHash,
        source.id,
      ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    // Concurrent retries may race on successor UNIQUE(chitty_id). If another
    // transaction completed first, return the canonical completed state.
    const refreshedSource = await directContextByChittyId(
      db,
      relation.supersedes,
    );
    if (refreshedSource) {
      const concurrentResult = await idempotentState(
        db,
        refreshedSource,
        relation,
        auditId,
      );
      if (concurrentResult) return concurrentResult;
    }
    throw error;
  }

  return {
    migrated: true,
    idempotent: false,
    from: relation.supersedes,
    to: relation.successor,
    auditId,
    sourceContextId: source.id,
    targetContextId: targetId,
    contextHash: originalContextHash,
    sourceLedger: { entryId: sourceEntryId, hash: sourceEntryHash },
    targetLedger: { entryId: targetEntryId, hash: targetEntryHash },
    nextSteps: {
      chronicle:
        "Ch1tty saga should append the identity_supersession event to ChittyChronicle",
      trust:
        "Ch1tty saga should call ChittyTrust.reckon(successor) after handoff",
    },
  };
}
