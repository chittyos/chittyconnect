/**
 * Neon Auth user store — ChittyConnect-owned read/write surface for
 * `neon_auth.{user,account,session,verification,organization,member,invitation}`
 * on Neon project `restless-grass-40598426` (ChittyOS-Core).
 *
 * Ownership and split rationale: see `chittyauth/CHARTER.md:60-84` and the
 * canon proposal `chittycanon://proposal/neon-auth-ownership-split`.
 *
 * Every request:
 *   1. Verifies the inbound Authorization: Bearer JWT via ChittyAuth JWKS
 *      (`requireChittyAuthJWT`). The verified `sub` claim is a ChittyID DID
 *      (did:chitty:*), per chittyauth `src/services/token.service.ts:49`.
 *   2. Opens a Neon connection and threads the verified `sub` into Postgres
 *      via `SELECT set_config('request.jwt.claim.sub', $1, true)`. The RLS
 *      policies installed by migration 019 then enforce per-user isolation
 *      server-side — no row-level filtering happens in this module.
 *   3. Executes the query inside a transaction. The LOCAL setting is
 *      cleared by COMMIT/ROLLBACK before the connection is closed.
 *
 * This module never bypasses RLS. The owner role (neondb_owner) is exempt
 * from RLS by default in Postgres; if/when the production deploy uses a
 * non-owner role, the policies do the rest. Migration 019 deliberately
 * does NOT issue `FORCE ROW LEVEL SECURITY` so existing owner-role-backed
 * admin paths (migrations, support tooling) continue to work. Per-user
 * request paths in this file always run the `set_config` so RLS applies
 * regardless of role privilege.
 */

import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { requireChittyAuthJWT } from "./jwks-verify.js";

export const neonUserStoreRoutes = new Hono();

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

function getDatabaseUrl(env) {
  return (
    env.NEON_AUTH_DATABASE_URL ||
    env.NEON_DATABASE_URL ||
    env.DATABASE_URL ||
    null
  );
}

/**
 * Run `fn(client)` against a fresh Neon connection with `request.jwt.claim.sub`
 * set to the verified DID. Used by every user-bound query in this module.
 *
 * Uses `set_config(name, value, is_local := true)` because `SET LOCAL` does
 * not accept parameter placeholders in @neondatabase/serverless's
 * parameterized path. The is_local=true means the binding clears on
 * COMMIT/ROLLBACK.
 */
async function withRlsBinding(env, sub, fn) {
  const url = getDatabaseUrl(env);
  if (!url) {
    const err = new Error(
      "NEON_AUTH_DATABASE_URL / NEON_DATABASE_URL / DATABASE_URL not configured",
    );
    err.code = "no_database_url";
    throw err;
  }

  const client = new Client(url);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      sub,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    try {
      await client.end();
    } catch (_) {
      /* ignore */
    }
  }
}

function errorResponse(c, err) {
  console.error("[neon-user-store]", err?.code || "", err?.message || err);
  const code = err?.code;
  if (code === "no_database_url") {
    return c.json(
      { error: "service_unavailable", code, message: err.message },
      503,
    );
  }
  return c.json(
    { error: "internal_error", message: err?.message || String(err) },
    500,
  );
}

// ---------------------------------------------------------------------------
// Routes — all require ChittyAuth JWT
// ---------------------------------------------------------------------------

neonUserStoreRoutes.use("*", requireChittyAuthJWT);

/**
 * GET /me — return the user row for the verified sub (DID).
 */
neonUserStoreRoutes.get("/me", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const row = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        `SELECT "id","name","email","emailVerified","image","role",
                "chittyDid","createdAt","updatedAt"
         FROM neon_auth."user" WHERE "chittyDid" = $1`,
        [sub],
      );
      return r.rows[0] || null;
    });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ user: row });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * POST /me — upsert the user row. Body: { name, email, image?, role? }.
 * `chittyDid` is taken from the verified JWT, never from the request body.
 */
neonUserStoreRoutes.post("/me", async (c) => {
  const { sub } = c.get("chittyAuth");
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const image = typeof body?.image === "string" ? body.image : null;
  const role = typeof body?.role === "string" ? body.role : null;
  if (!name || !email) {
    return c.json(
      { error: "missing_fields", required: ["name", "email"] },
      400,
    );
  }

  try {
    const row = await withRlsBinding(c.env, sub, async (client) => {
      // The unique index on chittyDid is partial (WHERE "chittyDid" IS NOT
      // NULL); Postgres requires ON CONFLICT to match the index predicate.
      // We always pass a non-null sub here (verified by JWKS), so the
      // partial predicate is always satisfied.
      const r = await client.query(
        `INSERT INTO neon_auth."user" ("name","email","emailVerified","image","role","chittyDid")
         VALUES ($1,$2,false,$3,$4,$5)
         ON CONFLICT ("chittyDid") WHERE "chittyDid" IS NOT NULL
         DO UPDATE SET "name"=EXCLUDED."name", "email"=EXCLUDED."email",
                       "image"=EXCLUDED."image", "role"=EXCLUDED."role",
                       "updatedAt"=CURRENT_TIMESTAMP
         RETURNING "id","name","email","emailVerified","image","role",
                   "chittyDid","createdAt","updatedAt"`,
        [name, email, image, role, sub],
      );
      return r.rows[0];
    });
    return c.json({ user: row });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * GET /accounts — list the verified user's linked auth accounts.
 */
neonUserStoreRoutes.get("/accounts", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const rows = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        `SELECT a."id", a."providerId", a."accountId", a."scope",
                a."accessTokenExpiresAt", a."createdAt", a."updatedAt"
         FROM neon_auth.account a
         WHERE a."userId" IN (SELECT "id" FROM neon_auth."user" WHERE "chittyDid" = $1)
         ORDER BY a."createdAt" DESC`,
        [sub],
      );
      return r.rows;
    });
    return c.json({ accounts: rows });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * GET /sessions — list the verified user's sessions.
 */
neonUserStoreRoutes.get("/sessions", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const rows = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        `SELECT s."id", s."expiresAt", s."createdAt", s."updatedAt",
                s."ipAddress", s."userAgent", s."activeOrganizationId"
         FROM neon_auth.session s
         WHERE s."userId" IN (SELECT "id" FROM neon_auth."user" WHERE "chittyDid" = $1)
         ORDER BY s."createdAt" DESC`,
        [sub],
      );
      return r.rows;
    });
    return c.json({ sessions: rows });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * GET /organizations — list orgs the verified user is a member of (RLS-filtered).
 */
neonUserStoreRoutes.get("/organizations", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const rows = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        `SELECT o."id", o."name", o."slug", o."logo", o."createdAt", m."role"
         FROM neon_auth.organization o
         JOIN neon_auth.member m ON m."organizationId" = o."id"
         JOIN neon_auth."user"  u ON u."id" = m."userId"
         WHERE u."chittyDid" = $1
         ORDER BY o."createdAt" DESC`,
        [sub],
      );
      return r.rows;
    });
    return c.json({ organizations: rows });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * POST /organizations — create an org and make the verified user its first
 * member (role=owner). Body: { name, slug, logo?, metadata? }.
 */
neonUserStoreRoutes.post("/organizations", async (c) => {
  const { sub } = c.get("chittyAuth");
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const logo = typeof body?.logo === "string" ? body.logo : null;
  const metadata = typeof body?.metadata === "string" ? body.metadata : null;
  if (!name || !slug) {
    return c.json(
      { error: "missing_fields", required: ["name", "slug"] },
      400,
    );
  }

  try {
    const row = await withRlsBinding(c.env, sub, async (client) => {
      const u = await client.query(
        'SELECT "id" FROM neon_auth."user" WHERE "chittyDid" = $1',
        [sub],
      );
      if (!u.rows[0]) {
        const err = new Error("user not initialized; POST /me first");
        err.statusCode = 409;
        throw err;
      }
      const userId = u.rows[0].id;

      const org = await client.query(
        `INSERT INTO neon_auth.organization ("name","slug","logo","metadata","createdAt")
         VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
         RETURNING "id","name","slug","logo","metadata","createdAt"`,
        [name, slug, logo, metadata],
      );
      const orgRow = org.rows[0];

      await client.query(
        `INSERT INTO neon_auth.member ("organizationId","userId","role","createdAt")
         VALUES ($1,$2,'owner',CURRENT_TIMESTAMP)`,
        [orgRow.id, userId],
      );
      return { ...orgRow, role: "owner" };
    });
    return c.json({ organization: row }, 201);
  } catch (err) {
    if (err?.statusCode === 409) {
      return c.json(
        { error: "user_not_initialized", message: err.message },
        409,
      );
    }
    if (err?.code === "23505") {
      return c.json({ error: "slug_taken" }, 409);
    }
    return errorResponse(c, err);
  }
});

/**
 * GET /invitations — list invitations visible to the verified user
 * (RLS-filtered: org members + invitee-by-email).
 */
neonUserStoreRoutes.get("/invitations", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const rows = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        `SELECT i."id", i."organizationId", i."email", i."role", i."status",
                i."expiresAt", i."createdAt"
         FROM neon_auth.invitation i
         ORDER BY i."createdAt" DESC`,
      );
      return r.rows;
    });
    return c.json({ invitations: rows });
  } catch (err) {
    return errorResponse(c, err);
  }
});

/**
 * GET /healthz — readiness probe. Confirms JWKS reachability (the bearer
 * verified upstream) and that the Neon connection can be opened with RLS
 * binding applied. Returns { ok, sub } so callers know which DID the bearer
 * maps to.
 */
neonUserStoreRoutes.get("/healthz", async (c) => {
  const { sub } = c.get("chittyAuth");
  try {
    const ok = await withRlsBinding(c.env, sub, async (client) => {
      const r = await client.query(
        "SELECT current_setting('request.jwt.claim.sub', true) AS bound_sub",
      );
      return r.rows[0]?.bound_sub === sub;
    });
    return c.json({ ok, sub });
  } catch (err) {
    return errorResponse(c, err);
  }
});
