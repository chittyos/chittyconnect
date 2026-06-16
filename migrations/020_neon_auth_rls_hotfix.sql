-- 020_neon_auth_rls_hotfix.sql — Hotfix: enable RLS + install policies on neon_auth tables
--
-- Target: Neon Postgres, project restless-grass-40598426 (ChittyOS-Core), main branch.
--
-- Context:
--   PR #241 (feat/neon-auth-user-store) was admin-merged through a failing governance
--   check on 2026-06-09. Migration 019 contained the correct RLS + policy DDL but was
--   never applied to the production (main) branch. As a result all 9 neon_auth tables
--   (7 ChittyConnect-owned + jwks + project_config) have rowsecurity = false in prod.
--
--   This migration applies ONLY the RLS enable + policy creation from 019 and extends
--   coverage to jwks and project_config (ChittyAuth-owned) as a belt-and-suspenders
--   measure — those two tables get RLS enabled with no restrictive policy, meaning
--   owner-role migrations continue to work but a future policy can be added by ChittyAuth
--   without a schema change.
--
--   The DDL additions from 019 (chittyDid column, indexes, FKs, defaults) are idempotent
--   via IF NOT EXISTS and are included here to ensure they are applied if 019 never ran.
--
-- Run with:
--   DATABASE_URL=$(op read "op://Infrastructure/Neon Database/credential") \
--     node scripts/run-neon-migrations.js
-- Or directly:
--   psql "$NEON_DATABASE_URL" -f migrations/020_neon_auth_rls_hotfix.sql
--
-- Idempotency: safe to re-run. DROP POLICY IF EXISTS before each CREATE POLICY.
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent (no-op if already enabled).
--
-- Validation post-run:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='neon_auth' ORDER BY tablename;
--   SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON p.polrelid=c.oid
--     JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='neon_auth';
--   -- Expected: 9 tables, rowsecurity=true; 9 policies

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Ensure chittyDid column exists (019 may not have run)
-- ---------------------------------------------------------------------------

ALTER TABLE neon_auth."user"
  ADD COLUMN IF NOT EXISTS "chittyDid" text;

CREATE UNIQUE INDEX IF NOT EXISTS "user_chittyDid_uniq"
  ON neon_auth."user" ("chittyDid")
  WHERE "chittyDid" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on all 9 neon_auth tables
-- ---------------------------------------------------------------------------

-- 7 ChittyConnect-owned tables
ALTER TABLE neon_auth."user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.member       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.invitation   ENABLE ROW LEVEL SECURITY;

-- 2 ChittyAuth-owned tables (RLS enable only — no restrictive policy; ChittyAuth owns policy DDL)
ALTER TABLE neon_auth.jwks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.project_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Install / replace the 9 ChittyConnect RLS policies
--    (matching exactly the policies specified in 019 — idempotent via DROP IF EXISTS)
-- ---------------------------------------------------------------------------

-- ---- user (2 policies) --------------------------------------------------
DROP POLICY IF EXISTS user_self_select ON neon_auth."user";
DROP POLICY IF EXISTS user_self_update ON neon_auth."user";

CREATE POLICY user_self_select ON neon_auth."user"
  FOR SELECT
  USING (
    "chittyDid" IS NOT NULL
    AND "chittyDid" = current_setting('request.jwt.claim.sub', true)
  );

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

-- ---- organization, member, invitation (4 policies total) ----------------
DROP POLICY IF EXISTS organization_member_select ON neon_auth.organization;
DROP POLICY IF EXISTS member_self_org_select     ON neon_auth.member;
DROP POLICY IF EXISTS invitation_org_select      ON neon_auth.invitation;
DROP POLICY IF EXISTS invitation_self_email      ON neon_auth.invitation;

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
-- Post-apply verification queries (read-only):
--
--   SELECT tablename, rowsecurity
--     FROM pg_tables
--    WHERE schemaname='neon_auth'
--    ORDER BY tablename;
--   -- Expect: 9 rows, all rowsecurity=true
--
--   SELECT count(*)::int AS policy_count
--     FROM pg_policy p
--     JOIN pg_class c ON p.polrelid=c.oid
--     JOIN pg_namespace n ON c.relnamespace=n.oid
--    WHERE n.nspname='neon_auth';
--   -- Expect: 9
--
-- Alice/Bob isolation test — run scripts/e2e/neon-auth-rls.mjs against a
-- branch clone of main before promoting the migration result to main.
-- ---------------------------------------------------------------------------
