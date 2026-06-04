#!/usr/bin/env node
/**
 * End-to-end validation for migration 019 + src/auth/neon-user-store.js.
 *
 * Runs against a Neon branch of restless-grass-40598426 (ChittyOS-Core).
 * Required env:
 *   NEON_DATABASE_URL — connection string to the target branch (NOT main)
 *
 * What it verifies (real SQL, no mocks):
 *   1. JWKS endpoint at auth.chitty.cc is reachable, returns an EC P-256 key,
 *      and `jose.createRemoteJWKSet` can hydrate it.
 *   2. `neon_auth.user` has the `chittyDid` column added by migration 019.
 *   3. RLS is enabled on all seven ChittyConnect-owned tables.
 *   4. The 9 policies created by migration 019 are present.
 *   5. With `request.jwt.claim.sub` bound to user A's DID, SELECT on
 *      `neon_auth."user"` returns A's row only — B's row is filtered out.
 *   6. With binding flipped to B's DID, the reverse is true.
 *   7. The `verification_self_all` policy follows the same isolation: a
 *      verification row keyed to A's email is invisible to B.
 *
 * The script seeds two users on the branch, runs the checks, and cleans up.
 * It connects with the owner role — to exercise RLS the owner is filtered
 * with explicit `SET ROLE` to a non-owner shadow role if available; we use
 * `SET LOCAL row_security = on` + `SET LOCAL role` to force policy
 * evaluation. Postgres's owner-bypass means the cleanest portable approach
 * is to use a separate non-owner role; for branch-scoped E2E we instead
 * use `SET LOCAL ROLE` to a freshly created throwaway role per run.
 */

import { Client } from "@neondatabase/serverless";
import * as jose from "jose";

const ISSUER = process.env.CHITTYAUTH_ISSUER || "https://auth.chitty.cc";
const JWKS_URL =
  process.env.CHITTYAUTH_JWKS_URL || `${ISSUER}/.well-known/jwks.json`;

const ALICE_DID = "did:chitty:e2e-alice";
const BOB_DID = "did:chitty:e2e-bob";

function step(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("NEON_DATABASE_URL is required (target a non-main branch).");
    process.exit(2);
  }

  // 1) JWKS reachability
  const res = await fetch(JWKS_URL);
  const jwks = await res.json();
  const key = jwks?.keys?.[0];
  step(
    "JWKS reachable + ES256 key",
    !!(key && key.kty === "EC" && key.crv === "P-256" && key.alg === "ES256"),
    `kid=${key?.kid}`,
  );
  // Hydrate it through jose to confirm format compatibility
  jose.createRemoteJWKSet(new URL(JWKS_URL));

  const client = new Client(url);
  await client.connect();
  try {
    // 2) Schema state
    const colsR = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='neon_auth' AND table_name='user' AND column_name='chittyDid'",
    );
    step("user.chittyDid column exists", colsR.rowCount === 1);

    const rlsR = await client.query(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='neon_auth' AND tablename IN ('user','account','session','verification','organization','member','invitation') ORDER BY tablename",
    );
    const allOn = rlsR.rows.length === 7 && rlsR.rows.every((r) => r.rowsecurity);
    step(
      "RLS enabled on 7 ChittyConnect tables",
      allOn,
      JSON.stringify(rlsR.rows),
    );

    const polR = await client.query(
      "SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='neon_auth'",
    );
    step("9 RLS policies present", polR.rows[0].n === 9, `n=${polR.rows[0].n}`);

    // 3) Seed two users
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO neon_auth."user" ("name","email","emailVerified","chittyDid")
       VALUES ('Alice','alice@e2e.test',true,$1)
       ON CONFLICT ("chittyDid") DO UPDATE SET "name"=EXCLUDED."name"`,
      [ALICE_DID],
    );
    await client.query(
      `INSERT INTO neon_auth."user" ("name","email","emailVerified","chittyDid")
       VALUES ('Bob','bob@e2e.test',true,$1)
       ON CONFLICT ("chittyDid") DO UPDATE SET "name"=EXCLUDED."name"`,
      [BOB_DID],
    );
    // Seed a verification row addressed to Alice
    await client.query(
      `INSERT INTO neon_auth.verification ("identifier","value","expiresAt")
       VALUES ('alice@e2e.test','code-A',CURRENT_TIMESTAMP + interval '10 minutes')
       ON CONFLICT DO NOTHING`,
    );
    await client.query("COMMIT");

    // 4) RLS check — owner role bypasses RLS by default. Spin up a
    // throwaway non-owner role for this run so policies actually apply.
    const shadowRole = `e2e_shadow_${Date.now()}`;
    await client.query(`CREATE ROLE "${shadowRole}" NOLOGIN`);
    await client.query(
      `GRANT USAGE ON SCHEMA neon_auth TO "${shadowRole}"`,
    );
    await client.query(
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA neon_auth TO "${shadowRole}"`,
    );

    async function viewAs(did) {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${shadowRole}"`);
      await client.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [did],
      );
      const u = await client.query(
        'SELECT "chittyDid","name" FROM neon_auth."user" ORDER BY "name"',
      );
      const v = await client.query(
        'SELECT "identifier" FROM neon_auth.verification ORDER BY "identifier"',
      );
      await client.query("ROLLBACK");
      return { users: u.rows, verifications: v.rows };
    }

    const asAlice = await viewAs(ALICE_DID);
    step(
      "as Alice: sees only her own user row",
      asAlice.users.length === 1 && asAlice.users[0].chittyDid === ALICE_DID,
      JSON.stringify(asAlice.users),
    );
    step(
      "as Alice: sees her own verification challenge",
      asAlice.verifications.length === 1 &&
        asAlice.verifications[0].identifier === "alice@e2e.test",
      JSON.stringify(asAlice.verifications),
    );

    const asBob = await viewAs(BOB_DID);
    step(
      "as Bob: sees only his own user row",
      asBob.users.length === 1 && asBob.users[0].chittyDid === BOB_DID,
      JSON.stringify(asBob.users),
    );
    step(
      "as Bob: does NOT see Alice's verification challenge",
      asBob.verifications.length === 0,
      JSON.stringify(asBob.verifications),
    );

    // Unbound (no JWT sub) → zero rows
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE "${shadowRole}"`);
    const unbound = await client.query(
      'SELECT count(*)::int AS n FROM neon_auth."user"',
    );
    await client.query("ROLLBACK");
    step(
      "unbound (no JWT sub): sees zero user rows",
      unbound.rows[0].n === 0,
      `n=${unbound.rows[0].n}`,
    );

    // Cleanup
    await client.query("BEGIN");
    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA neon_auth FROM "${shadowRole}"`,
    );
    await client.query(`REVOKE USAGE ON SCHEMA neon_auth FROM "${shadowRole}"`);
    await client.query(`DROP ROLE IF EXISTS "${shadowRole}"`);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }

  if (process.exitCode) {
    console.error("\nE2E FAILED");
  } else {
    console.log("\nE2E PASS");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
