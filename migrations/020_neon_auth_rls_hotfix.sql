-- 020_neon_auth_rls_hotfix.sql — Hotfix: enable + FORCE RLS + full policy set on neon_auth tables
--
-- Target: Neon Postgres, project restless-grass-40598426 (ChittyOS-Core), main branch.
--
-- Background (regression from PR #241 / split from PR #245):
--   PR #241 (feat/neon-auth-user-store) was admin-merged on 2026-06-09 through a failing
--   governance check. Migration 019 was never applied to production. All 9 neon_auth tables
--   have rowsecurity=false in prod. This migration is the production-safe hotfix.
--
-- Why FORCE ROW LEVEL SECURITY (the critical addition over PR #245's version):
--   NEON_DATABASE_URL connects as neondb_owner, which OWNS the neon_auth tables. Postgres
--   exempts table owners from RLS unless FORCE ROW LEVEL SECURITY is set. Without FORCE,
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY is inert for the owner role — all 9 policies
--   in migration 019 (never applied) and in PR #245 (as reviewed) are bypassed at runtime.
--   See: https://www.postgresql.org/docs/current/sql-altertable.html#SQL-ALTERTABLE-FORCE-RLS
--   Confirmed: the e2e test (scripts/e2e/neon-auth-rls.mjs:112-124) explicitly creates a
--   shadow non-owner role to work around owner-bypass when testing — the test authors knew.
--
-- INSERT policies (missing from PR #245 + migration 019):
--   neon_auth."user" only had SELECT + UPDATE policies. POST /me in neon-user-store.js
--   does an INSERT ... ON CONFLICT upsert. Under FORCE, an INSERT with no permissive INSERT
--   policy is denied for the owner too. We add INSERT policies where the code writes.
--
-- neon_auth.jwks / neon_auth.project_config — NOT touched:
--   PR #245 enabled RLS on these two ChittyAuth-owned tables with no policy (deny-all for
--   non-owner). Under FORCE that becomes deny-all for the runtime role too. However:
--   - jwks-verify.js reads JWKS from the remote HTTP endpoint (auth.chitty.cc/.well-known/jwks.json)
--     via jose.createRemoteJWKSet — it does NOT read from neon_auth.jwks at runtime.
--   - project_config is not read by any ChittyConnect code path in this codebase.
--   - These tables are ChittyAuth-owned; this hotfix does NOT enable RLS on them
--     (chittyauth owns policy DDL for its tables per the ownership split).
--   If ChittyAuth later enables RLS on these tables it must add its own policies.
--
-- Schema additions (idempotent — in case 019 never ran):
--   chittyDid column + partial unique index on neon_auth."user".
--
-- Run with:
--   DATABASE_URL=$(op read "op://Infrastructure/Neon Database/credential") \
--     node scripts/run-neon-migrations.js
-- Or directly:
--   psql "$NEON_DATABASE_URL" -f migrations/020_neon_auth_rls_hotfix.sql
--
-- Idempotency: safe to re-run.
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op if already enabled.
--   ALTER TABLE ... FORCE ROW LEVEL SECURITY is a no-op if already forced.
--   DROP POLICY IF EXISTS before each CREATE POLICY.
--   IF NOT EXISTS guards all column/index additions.
--
-- Post-apply validation:
--   SELECT tablename, rowsecurity, relforcerowsecurity
--     FROM pg_tables t
--     JOIN pg_class c ON c.relname=t.tablename
--     JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='neon_auth'
--    WHERE t.schemaname='neon_auth'
--    ORDER BY tablename;
--   -- Expect: 7 rows (user,account,session,verification,organization,member,invitation)
--   --         all with rowsecurity=true AND relforcerowsecurity=true
--
--   SELECT count(*)::int AS policy_count
--     FROM pg_policy p
--     JOIN pg_class c ON p.polrelid=c.oid
--     JOIN pg_namespace n ON c.relnamespace=n.oid
--    WHERE n.nspname='neon_auth';
--   -- Expect: 12 (9 from 019 + 3 new INSERT/write policies for user, organization, member)

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Ensure chittyDid column + index exist (019 may not have run)
-- ---------------------------------------------------------------------------

ALTER TABLE neon_auth."user"
  ADD COLUMN IF NOT EXISTS "chittyDid" text;

CREATE UNIQUE INDEX IF NOT EXISTS "user_chittyDid_uniq"
  ON neon_auth."user" ("chittyDid")
  WHERE "chittyDid" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Enable + FORCE RLS on the 7 ChittyConnect-owned neon_auth tables
--
--    FORCE ROW LEVEL SECURITY is required because the runtime connection
--    role (neondb_owner) owns these tables and would otherwise bypass all
--    policies. Do NOT enable RLS on jwks or project_config here — those are
--    ChittyAuth-owned tables and must receive policies before RLS is enabled.
-- ---------------------------------------------------------------------------

ALTER TABLE neon_auth."user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.member       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.invitation   ENABLE ROW LEVEL SECURITY;

ALTER TABLE neon_auth."user"       FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.account      FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.session      FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.verification FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.organization FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.member       FORCE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.invitation   FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Install / replace all RLS policies
--    (idempotent via DROP IF EXISTS before each CREATE)
--
--    Policy map:
--      user          — SELECT, UPDATE, INSERT (3 policies)
--      account       — ALL (1)
--      session       — ALL (1)
--      verification  — ALL (1)
--      organization  — SELECT, INSERT (2 policies)
--      member        — SELECT, INSERT (2 policies)
--      invitation    — SELECT x2 (2 policies)
--                                            TOTAL: 12 policies
-- ---------------------------------------------------------------------------

-- ---- user (3 policies: select, update, insert) ---------------------------
DROP POLICY IF EXISTS user_self_select ON neon_auth."user";
DROP POLICY IF EXISTS user_self_update ON neon_auth."user";
DROP POLICY IF EXISTS user_self_insert ON neon_auth."user";

-- SELECT: user can see their own row
CREATE POLICY user_self_select ON neon_auth."user"
  FOR SELECT
  USING (
    "chittyDid" IS NOT NULL
    AND "chittyDid" = current_setting('request.jwt.claim.sub', true)
  );

-- UPDATE: user can update their own row
CREATE POLICY user_self_update ON neon_auth."user"
  FOR UPDATE
  USING (
    "chittyDid" IS NOT NULL
    AND "chittyDid" = current_setting('request.jwt.claim.sub', true)
  )
  WITH CHECK (
    "chittyDid" IS NOT NULL
    AND "chittyDid" = current_setting('request.jwt.claim.sub', true)
  );

-- INSERT: user can insert their own row (POST /me upsert path in neon-user-store.js:165-176)
-- WITH CHECK only (INSERT has no USING). The upsert always sets chittyDid = verified JWT sub.
CREATE POLICY user_self_insert ON neon_auth."user"
  FOR INSERT
  WITH CHECK (
    "chittyDid" IS NOT NULL
    AND "chittyDid" = current_setting('request.jwt.claim.sub', true)
  );

-- ---- account, session, verification (1 policy each = 3 policies) --------
DROP POLICY IF EXISTS account_self_all      ON neon_auth.account;
DROP POLICY IF EXISTS session_self_all      ON neon_auth.session;
DROP POLICY IF EXISTS verification_self_all ON neon_auth.verification;

CREATE POLICY account_self_all ON neon_auth.account
  FOR ALL
  USING (
    "userId" IN (
      SELECT "id" FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  )
  WITH CHECK (
    "userId" IN (
      SELECT "id" FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

CREATE POLICY session_self_all ON neon_auth.session
  FOR ALL
  USING (
    "userId" IN (
      SELECT "id" FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  )
  WITH CHECK (
    "userId" IN (
      SELECT "id" FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

CREATE POLICY verification_self_all ON neon_auth.verification
  FOR ALL
  USING (
    lower("identifier") IN (
      SELECT lower("email") FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
      UNION ALL
      SELECT lower("chittyDid") FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  )
  WITH CHECK (
    lower("identifier") IN (
      SELECT lower("email") FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
      UNION ALL
      SELECT lower("chittyDid") FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

-- ---- organization (2 policies: select + insert) --------------------------
-- INSERT needed: POST /organizations in neon-user-store.js:290-296 inserts org rows.
-- Member membership establishes the read scope so the insert policy is
-- permissive (any authenticated user may create an org; membership is created
-- in the same transaction to gate subsequent SELECTs).
DROP POLICY IF EXISTS organization_member_select ON neon_auth.organization;
DROP POLICY IF EXISTS organization_self_insert   ON neon_auth.organization;

CREATE POLICY organization_member_select ON neon_auth.organization
  FOR SELECT
  USING (
    "id" IN (
      SELECT m."organizationId"
      FROM neon_auth.member m
      JOIN neon_auth."user" u ON u."id" = m."userId"
      WHERE u."chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

-- Any authenticated user (non-empty sub) may create an org.
-- The caller is immediately added as a member in the same txn, so the
-- SELECT policy gates all future reads.
CREATE POLICY organization_self_insert ON neon_auth.organization
  FOR INSERT
  WITH CHECK (
    current_setting('request.jwt.claim.sub', true) IS NOT NULL
    AND current_setting('request.jwt.claim.sub', true) <> ''
  );

-- ---- member (2 policies: select + insert) --------------------------------
-- INSERT needed: the org creator is added as a member in POST /organizations.
DROP POLICY IF EXISTS member_self_org_select ON neon_auth.member;
DROP POLICY IF EXISTS member_self_insert     ON neon_auth.member;

CREATE POLICY member_self_org_select ON neon_auth.member
  FOR SELECT
  USING (
    "organizationId" IN (
      SELECT m."organizationId"
      FROM neon_auth.member m
      JOIN neon_auth."user" u ON u."id" = m."userId"
      WHERE u."chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

-- Allow the authenticated user to insert a member row where userId matches
-- their own user record. This is needed for the org-create transaction where
-- the org creator adds themselves as the first member.
CREATE POLICY member_self_insert ON neon_auth.member
  FOR INSERT
  WITH CHECK (
    "userId" IN (
      SELECT "id" FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

-- ---- invitation (2 SELECT policies) -------------------------------------
DROP POLICY IF EXISTS invitation_org_select   ON neon_auth.invitation;
DROP POLICY IF EXISTS invitation_self_email   ON neon_auth.invitation;

CREATE POLICY invitation_org_select ON neon_auth.invitation
  FOR SELECT
  USING (
    "organizationId" IN (
      SELECT m."organizationId"
      FROM neon_auth.member m
      JOIN neon_auth."user" u ON u."id" = m."userId"
      WHERE u."chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

CREATE POLICY invitation_self_email ON neon_auth.invitation
  FOR SELECT
  USING (
    lower("email") IN (
      SELECT lower("email") FROM neon_auth."user"
      WHERE "chittyDid" = current_setting('request.jwt.claim.sub', true)
    )
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-apply verification queries (read-only, run as neondb_owner):
--
--   SELECT t.tablename, t.rowsecurity, c.relforcerowsecurity
--     FROM pg_tables t
--     JOIN pg_class c ON c.relname = t.tablename
--     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'neon_auth'
--    WHERE t.schemaname = 'neon_auth'
--    ORDER BY t.tablename;
--   -- Expect: 7 rows (ChittyConnect-owned only), all rowsecurity=true + relforcerowsecurity=true
--   -- jwks and project_config should NOT appear (RLS not enabled on those here)
--
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'neon_auth'
--    ORDER BY tablename, policyname;
--   -- Expect: 12 policies across 7 tables
--
-- Alice/Bob isolation test:
--   NEON_DATABASE_URL="<branch-clone-url>" node scripts/e2e/neon-auth-rls.mjs
--   -- The shadow-role path in the e2e test uses SET LOCAL ROLE to a non-owner,
--   -- which still exercises FORCE RLS enforcement correctly.
-- ---------------------------------------------------------------------------
