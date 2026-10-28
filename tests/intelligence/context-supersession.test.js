import { describe, expect, it } from "vitest";
import {
  ContextSupersessionError,
  migrateCanonicalSupersession,
  verifyCanonicalSupersession,
} from "../../src/intelligence/context-supersession.js";

const predecessor = "03-1-USA-2629-T-2601-0-21";
const successor = "03-1-USA-3708-P-2601-0-51";
const auditId = "audit-continuity-001";
const originalHash = "784d15c5b0c1a7d2173cc6d87924f1af55c531f4c30145c55d6107c4de9656b7";

const currentSchema = `
CREATE TABLE context_entities (
  id TEXT PRIMARY KEY,
  chitty_id TEXT NOT NULL UNIQUE,
  context_hash TEXT NOT NULL UNIQUE,
  project_path TEXT,
  workspace TEXT,
  support_type TEXT DEFAULT 'development',
  organization TEXT,
  signature TEXT,
  issuer TEXT,
  trust_score REAL DEFAULT 50.0,
  trust_level INTEGER DEFAULT 3,
  current_sessions TEXT DEFAULT '[]',
  total_sessions INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','dormant','archived','revoked')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`;

const futureSchema = `
CREATE TABLE context_entities (
  id TEXT PRIMARY KEY,
  chitty_id TEXT NOT NULL UNIQUE,
  context_hash TEXT,
  anchor_hash TEXT,
  project_path TEXT,
  workspace TEXT,
  support_type TEXT DEFAULT 'development',
  organization TEXT,
  signature TEXT,
  issuer TEXT,
  trust_score REAL DEFAULT 0,
  trust_level INTEGER DEFAULT 0,
  current_sessions TEXT DEFAULT '[]',
  total_sessions INTEGER DEFAULT 0,
  status TEXT DEFAULT 'fresh' CHECK (status IN ('fresh','active','dormant','stale','retired','dissolved')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity INTEGER,
  anomaly_count INTEGER DEFAULT 0
)`;

function relation() {
  return {
    auditId,
    supersedes: predecessor,
    successor,
    issuedAt: "2026-10-28T04:00:00.000Z",
    recordedAt: "2026-10-28T04:00:01.000Z",
    authority: "id.chitty.cc",
    mintAuthority: "mint.chitty.cc",
  };
}

function authorityFetcher(overrides = {}) {
  return async (_env, serviceName, path, options) => {
    expect(serviceName).toBe("id");
    expect(path).toBe("/api/supersession/verify");
    expect(options.body).toBeTruthy();
    const rel = { ...relation(), ...overrides.relation };
    return Response.json(
      {
        success: true,
        valid: overrides.valid ?? true,
        canonical: overrides.canonical ?? true,
        mintVerified: overrides.mintVerified ?? true,
        reason: overrides.reason ?? null,
        relation: rel,
      },
      { status: overrides.status ?? 200 },
    );
  };
}

function cloneState(state) {
  return structuredClone(state);
}

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = args;
  }

  bind(...args) {
    return new FakeStatement(this.db, this.sql, args);
  }

  async first() {
    const state = this.db.state;
    if (this.sql.startsWith("SELECT * FROM context_entities WHERE chitty_id = ?")) {
      return state.contexts.find((row) => row.chitty_id === this.args[0]) || null;
    }
    if (this.sql.startsWith("SELECT sql FROM sqlite_master")) {
      return { sql: state.schemaSql };
    }
    if (this.sql.startsWith("SELECT COUNT(*) AS count FROM context_session_bindings")) {
      const count = state.sessions.filter(
        (row) => row.context_id === this.args[0] && row.unbound_at == null,
      ).length;
      return { count };
    }
    if (this.sql.startsWith("SELECT COUNT(*) AS count FROM context_dna")) {
      return {
        count: state.dna.filter((row) => row.context_id === this.args[0]).length,
      };
    }
    throw new Error(`Unsupported first(): ${this.sql}`);
  }

  _execute(state) {
    const uniqueHash = /context_hash\s+TEXT(?:\s+NOT\s+NULL)?\s+UNIQUE/i.test(
      state.schemaSql,
    );

    if (this.sql.startsWith("UPDATE context_entities SET context_hash = ?")) {
      const [contextHash, status, lastActivity, id, chittyId] = this.args;
      const row = state.contexts.find(
        (item) => item.id === id && item.chitty_id === chittyId,
      );
      if (!row) return { meta: { changes: 0 } };
      if (
        uniqueHash &&
        state.contexts.some(
          (item) => item.id !== id && item.context_hash === contextHash,
        )
      ) {
        throw new Error("UNIQUE constraint failed: context_entities.context_hash");
      }
      row.context_hash = contextHash;
      row.status = status;
      row.current_sessions = "[]";
      row.last_activity = lastActivity;
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO context_entities")) {
      const [
        id,
        chittyId,
        contextHash,
        projectPath,
        workspace,
        supportType,
        organization,
        signature,
        issuer,
        trustScore,
        trustLevel,
        totalSessions,
        status,
        createdAt,
        lastActivity,
      ] = this.args;
      if (state.contexts.some((row) => row.chitty_id === chittyId)) {
        throw new Error("UNIQUE constraint failed: context_entities.chitty_id");
      }
      if (uniqueHash && state.contexts.some((row) => row.context_hash === contextHash)) {
        throw new Error("UNIQUE constraint failed: context_entities.context_hash");
      }
      state.contexts.push({
        id,
        chitty_id: chittyId,
        context_hash: contextHash,
        project_path: projectPath,
        workspace,
        support_type: supportType,
        organization,
        signature,
        issuer,
        trust_score: trustScore,
        trust_level: trustLevel,
        current_sessions: "[]",
        total_sessions: totalSessions,
        status,
        created_at: createdAt,
        last_activity: lastActivity,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE context_dna SET context_id = ?")) {
      const [targetId, targetChittyId, sourceId] = this.args;
      let changes = 0;
      for (const row of state.dna) {
        if (row.context_id === sourceId) {
          row.context_id = targetId;
          row.context_chitty_id = targetChittyId;
          changes += 1;
        }
      }
      return { meta: { changes } };
    }

    if (this.sql.startsWith("INSERT INTO context_ledger") && this.sql.includes("SELECT ?, ?, ?, ?")) {
      const [id, contextId, chittyId, sessionId, payload, hash, previousContextId] =
        this.args;
      const prior = state.ledger
        .filter((row) => row.context_id === previousContextId)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      state.ledger.push({
        id,
        context_id: contextId,
        context_chitty_id: chittyId,
        session_id: sessionId,
        event_type: "transaction",
        payload,
        hash,
        previous_hash: prior?.hash || "genesis",
        timestamp: state.ledger.length + 1,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO context_ledger") && this.sql.includes("'genesis'")) {
      const [id, contextId, chittyId, sessionId, payload, hash] = this.args;
      state.ledger.push({
        id,
        context_id: contextId,
        context_chitty_id: chittyId,
        session_id: sessionId,
        event_type: "transaction",
        payload,
        hash,
        previous_hash: "genesis",
        timestamp: state.ledger.length + 1,
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported statement: ${this.sql}`);
  }
}

class FakeD1 {
  constructor({ schemaSql = currentSchema, activeSession = false } = {}) {
    this.state = {
      schemaSql,
      contexts: [
        {
          id: "legacy-context-id",
          chitty_id: predecessor,
          context_hash: originalHash,
          project_path: "/Volumes/chitty/github.com/chittyconnect",
          workspace: "chittyconnect",
          support_type: "development",
          organization: "CHITTYOS",
          signature: "seed-signature",
          issuer: "chittyid",
          trust_score: 75,
          trust_level: 4,
          current_sessions: activeSession ? '["session-live"]' : "[]",
          total_sessions: 1,
          status: "active",
          created_at: 1760000000,
          last_activity: 1761000000,
        },
      ],
      dna: [
        {
          id: "dna-1",
          context_id: "legacy-context-id",
          context_chitty_id: predecessor,
          total_interactions: 142,
          total_decisions: 89,
        },
      ],
      sessions: [
        {
          id: "session-historical",
          context_id: "legacy-context-id",
          context_chitty_id: predecessor,
          unbound_at: 1760500000,
        },
        ...(activeSession
          ? [
              {
                id: "session-live",
                context_id: "legacy-context-id",
                context_chitty_id: predecessor,
                unbound_at: null,
              },
            ]
          : []),
      ],
      ledger: [
        {
          id: "old-ledger",
          context_id: "legacy-context-id",
          context_chitty_id: predecessor,
          hash: "old-hash",
          previous_hash: "genesis",
          timestamp: 1,
        },
      ],
    };
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const next = cloneState(this.state);
    const results = statements.map((statement) => statement._execute(next));
    this.state = next;
    return results;
  }
}

function env(options) {
  return { DB: new FakeD1(options) };
}

describe("canonical context supersession handoff", () => {
  it("rejects caller fields that disagree with ChittyID authority", async () => {
    await expect(
      verifyCanonicalSupersession(
        {},
        {
          auditId,
          from_chitty_id: predecessor,
          to_chitty_id: "03-1-USA-9999-P-2610-0-99",
        },
        authorityFetcher(),
      ),
    ).rejects.toMatchObject({
      code: "MANIFEST_RELATION_MISMATCH",
      status: 409,
    });
  });

  it("blocks handoff while a legacy viewport is still actively bound", async () => {
    const e = env({ activeSession: true });
    await expect(
      migrateCanonicalSupersession(
        e,
        { auditId },
        { fetchService: authorityFetcher() },
      ),
    ).rejects.toMatchObject({
      code: "ACTIVE_SESSIONS_PRESENT",
      status: 409,
    });

    expect(e.DB.state.contexts).toHaveLength(1);
    expect(e.DB.state.contexts[0].status).toBe("active");
  });

  it("atomically archives the live legacy T and transfers anchor + DNA to P", async () => {
    const e = env();
    const result = await migrateCanonicalSupersession(
      e,
      { auditId, from_chitty_id: predecessor, to_chitty_id: successor },
      { fetchService: authorityFetcher() },
    );

    expect(result).toMatchObject({
      migrated: true,
      idempotent: false,
      from: predecessor,
      to: successor,
      auditId,
      contextHash: originalHash,
    });

    const source = e.DB.state.contexts.find((row) => row.chitty_id === predecessor);
    const target = e.DB.state.contexts.find((row) => row.chitty_id === successor);

    expect(source.status).toBe("archived");
    expect(source.context_hash).toBe(`superseded:${auditId}:${originalHash}`);
    expect(source.current_sessions).toBe("[]");

    expect(target.status).toBe("dormant");
    expect(target.context_hash).toBe(originalHash);
    expect(target.signature).toBe(`supersession:${auditId}`);
    expect(target.trust_level).toBe(4);
    expect(target.total_sessions).toBe(1);

    expect(e.DB.state.dna).toEqual([
      expect.objectContaining({
        context_id: target.id,
        context_chitty_id: successor,
        total_interactions: 142,
        total_decisions: 89,
      }),
    ]);

    // Historical session provenance remains attached to the predecessor.
    expect(e.DB.state.sessions[0].context_id).toBe("legacy-context-id");
    expect(e.DB.state.sessions[0].context_chitty_id).toBe(predecessor);

    const sourceReceipt = e.DB.state.ledger.find(
      (row) =>
        row.context_id === "legacy-context-id" &&
        JSON.parse(row.payload || "{}").type === "identity_superseded",
    );
    const targetReceipt = e.DB.state.ledger.find(
      (row) =>
        row.context_id === target.id &&
        JSON.parse(row.payload || "{}").type === "identity_supersession_received",
    );
    expect(sourceReceipt.previous_hash).toBe("old-hash");
    expect(targetReceipt.previous_hash).toBe("genesis");
  });

  it("is idempotent after the canonical handoff completes", async () => {
    const e = env();
    const options = { fetchService: authorityFetcher() };

    const first = await migrateCanonicalSupersession(e, { auditId }, options);
    const ledgerCount = e.DB.state.ledger.length;
    const second = await migrateCanonicalSupersession(e, { auditId }, options);

    expect(second).toMatchObject({
      migrated: true,
      idempotent: true,
      targetContextId: first.targetContextId,
      contextHash: originalHash,
    });
    expect(e.DB.state.ledger).toHaveLength(ledgerCount);
  });

  it("uses retired and keeps the shared hash when the future schema removes hash uniqueness", async () => {
    const e = env({ schemaSql: futureSchema });
    await migrateCanonicalSupersession(
      e,
      { auditId },
      { fetchService: authorityFetcher() },
    );

    const source = e.DB.state.contexts.find((row) => row.chitty_id === predecessor);
    const target = e.DB.state.contexts.find((row) => row.chitty_id === successor);

    expect(source.status).toBe("retired");
    expect(source.context_hash).toBe(originalHash);
    expect(target.context_hash).toBe(originalHash);
  });

  it("does not mutate D1 when the identity authority rejects the relation", async () => {
    const e = env();
    await expect(
      migrateCanonicalSupersession(
        e,
        { auditId },
        {
          fetchService: authorityFetcher({
            valid: false,
            canonical: false,
            mintVerified: false,
            status: 409,
            reason: "manifest_not_current_authority_mapping",
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ContextSupersessionError);

    expect(e.DB.state.contexts).toHaveLength(1);
    expect(e.DB.state.contexts[0].context_hash).toBe(originalHash);
    expect(e.DB.state.dna[0].context_id).toBe("legacy-context-id");
  });
});
