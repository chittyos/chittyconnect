-- 019_neon_auth_user_store.sql — ChittyConnect ownership of neon_auth user/account/org tables
--
-- Target: **Neon Postgres** (project restless-grass-40598426 = ChittyOS-Core), NOT D1.
-- Run with: psql "$NEON_DATABASE_URL" -f migrations/019_neon_auth_user_store.sql
--           (NOT `wrangler d1 execute` — this is the Postgres branch of migrations.)
--
-- Background:
--   The `neon_auth` schema and the seven Better-Auth-shape tables
--   (user, account, session, verification, organization, member, invitation)
--   were provisioned in a prior Better Auth integration but never wired up;
--   all seven tables have 0 rows as of 2026-06-04. This migration:
--     1. Declares ChittyConnect ownership (COMMENT ON).
--     2. Adds the columns ChittyConnect actually needs (`chittyDid` on user,
--        FK on session/account/member/invitation, ON DELETE CASCADE where appropriate).
--     3. Adds the indexes used by the read paths in src/auth/neon-user-store.js.
--     4. Enables Row-Level Security and binds policies to the
--        `request.jwt.claim.sub` setting populated from ChittyAuth-issued JWTs
--        (issuer https://auth.chitty.cc, JWKS https://auth.chitty.cc/.well-known/jwks.json).
--        ChittyAuth sets `sub` = identityDid (did:chitty:*); see chittyauth
--        src/services/token.service.ts:49.
--
--   Tables NOT touched here (owned by ChittyAuth per chittyauth CHARTER.md:60-84):
--     - neon_auth.jwks
--     - neon_auth.project_config
--
-- Idempotency: every statement uses IF NOT EXISTS / IF EXISTS / DO blocks so
-- the migration is safe to re-run.
--
-- Cross-refs:
--   - chittyauth CHARTER.md:60-84 "Neon Auth Ownership"
--   - chittycanon://proposal/neon-auth-ownership-split
--   - Parent task: 0df3b186-343c-47f9-8a38-25a785b54e0a
--   - Sub-task:    2aacb316-cff1-4241-aeaf-1dc965cc8302

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Schema sanity & ownership declarations
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS neon_auth;

COMMENT ON SCHEMA neon_auth IS
  'Shared auth schema. Ownership split per chittyauth CHARTER.md:60-84: '
  'jwks & project_config = ChittyAuth; user/account/session/verification/'
  'organization/member/invitation = ChittyConnect (migration 019).';

-- The seven tables are expected to already exist (Better Auth shape) on
-- restless-grass-40598426. Re-declare them for fresh databases. Pre-existing
-- columns are left untouched.

CREATE TABLE IF NOT EXISTS neon_auth."user" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          text NOT NULL,
  "email"         text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image"         text,
  "createdAt"     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "role"          text,
  "banned"        boolean,
  "banReason"     text,
  "banExpires"    timestamptz
);

CREATE TABLE IF NOT EXISTS neon_auth.account (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                uuid NOT NULL,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS neon_auth.session (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "expiresAt"            timestamptz NOT NULL,
  "token"                text NOT NULL,
  "createdAt"            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"            text,
  "userAgent"            text,
  "userId"               uuid NOT NULL,
  "impersonatedBy"       text,
  "activeOrganizationId" text
);

CREATE TABLE IF NOT EXISTS neon_auth.verification (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS neon_auth.organization (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      text NOT NULL,
  "slug"      text NOT NULL,
  "logo"      text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"  text
);

CREATE TABLE IF NOT EXISTS neon_auth.member (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "userId"         uuid NOT NULL,
  "role"           text NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS neon_auth.invitation (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "email"          text NOT NULL,
  "role"           text,
  "status"         text NOT NULL,
  "expiresAt"      timestamptz NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inviterId"      uuid NOT NULL
);

-- ---------------------------------------------------------------------------
-- 1. ChittyConnect-required additions
-- ---------------------------------------------------------------------------

-- Several pre-existing Better Auth tables were provisioned with NOT NULL
-- timestamps but no default. Add safe defaults on the columns ChittyConnect
-- writes through. (ALTER COLUMN SET DEFAULT is idempotent.)
ALTER TABLE neon_auth.account      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE neon_auth.session      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE neon_auth.verification ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE neon_auth.organization ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE neon_auth.member       ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- The JWT 'sub' claim issued by ChittyAuth is a ChittyID DID
-- (did:chitty:*), NOT the user UUID. Persist it on user so RLS can compare
-- it directly against current_setting('request.jwt.claim.sub').
ALTER TABLE neon_auth."user"
  ADD COLUMN IF NOT EXISTS "chittyDid" text;

COMMENT ON COLUMN neon_auth."user"."chittyDid" IS
  'ChittyAuth identity DID (did:chitty:*). Mirrors the JWT sub claim emitted '
  'by auth.chitty.cc. Bound to RLS policies on this and related tables. '
  'See chittyauth src/services/token.service.ts:49.';

CREATE UNIQUE INDEX IF NOT EXISTS "user_chittyDid_uniq"
  ON neon_auth."user" ("chittyDid")
  WHERE "chittyDid" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_uniq"
  ON neon_auth."user" (lower("email"));

CREATE INDEX IF NOT EXISTS "account_userId_idx"
  ON neon_auth.account ("userId");

CREATE INDEX IF NOT EXISTS "account_provider_account_idx"
  ON neon_auth.account ("providerId", "accountId");

CREATE INDEX IF NOT EXISTS "session_userId_idx"
  ON neon_auth.session ("userId");

CREATE INDEX IF NOT EXISTS "session_token_idx"
  ON neon_auth.session ("token");

CREATE INDEX IF NOT EXISTS "session_expiresAt_idx"
  ON neon_auth.session ("expiresAt");

CREATE INDEX IF NOT EXISTS "verification_identifier_idx"
  ON neon_auth.verification ("identifier");

CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_uniq"
  ON neon_auth.organization ("slug");

CREATE INDEX IF NOT EXISTS "member_userId_idx"
  ON neon_auth.member ("userId");

CREATE INDEX IF NOT EXISTS "member_organizationId_idx"
  ON neon_auth.member ("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_uniq"
  ON neon_auth.member ("organizationId", "userId");

CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx"
  ON neon_auth.invitation ("organizationId");

CREATE INDEX IF NOT EXISTS "invitation_email_idx"
  ON neon_auth.invitation (lower("email"));

-- ---------------------------------------------------------------------------
-- 2. Foreign keys (idempotent via pg_constraint check)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_userId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.account
      ADD CONSTRAINT "account_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES neon_auth."user"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_userId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.session
      ADD CONSTRAINT "session_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES neon_auth."user"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_organizationId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.member
      ADD CONSTRAINT "member_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_userId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.member
      ADD CONSTRAINT "member_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES neon_auth."user"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitation_organizationId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.invitation
      ADD CONSTRAINT "invitation_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitation_inviterId_fkey' AND connamespace = 'neon_auth'::regnamespace
  ) THEN
    ALTER TABLE neon_auth.invitation
      ADD CONSTRAINT "invitation_inviterId_fkey"
      FOREIGN KEY ("inviterId") REFERENCES neon_auth."user"("id");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Ownership comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE neon_auth."user" IS
  'Owner: ChittyConnect (chittycanon://core/services/chittyconnect). '
  'User profile store. JWT sub claim mirrored in "chittyDid".';
COMMENT ON TABLE neon_auth.account IS
  'Owner: ChittyConnect. OAuth/credential linkage per user.';
COMMENT ON TABLE neon_auth.session IS
  'Owner: ChittyConnect. User session records (ChittyAuth is stateless).';
COMMENT ON TABLE neon_auth.verification IS
  'Owner: ChittyConnect. Email/factor verification challenges.';
COMMENT ON TABLE neon_auth.organization IS
  'Owner: ChittyConnect. Multi-tenant organization roots.';
COMMENT ON TABLE neon_auth.member IS
  'Owner: ChittyConnect. Org membership; (organizationId, userId) unique.';
COMMENT ON TABLE neon_auth.invitation IS
  'Owner: ChittyConnect. Pending org invitations.';

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
--
-- Policies use current_setting('request.jwt.claim.sub', true) which is set
-- either by Neon Auth (when configured against neon_auth.project_config) or
-- by src/auth/neon-user-store.js after JWKS-validating the inbound Bearer
-- token. The 'true' arg makes the setting fall through to NULL when unset
-- (so policies fail closed instead of erroring).
--
-- A connection that has not set the claim sees zero rows on protected
-- tables (except for the table owner role, which is exempt from RLS by
-- default — we intentionally do NOT FORCE RLS so existing
-- owner-role-backed admin/migration paths continue to function).

ALTER TABLE neon_auth."user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.member       ENABLE ROW LEVEL SECURITY;
ALTER TABLE neon_auth.invitation   ENABLE ROW LEVEL SECURITY;

-- ---- user --------------------------------------------------------------
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

-- ---- account, session, verification -----------------------------------
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

-- ---- organization, member, invitation ----------------------------------
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
-- Verification queries (read-only; do NOT mutate state):
--
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='neon_auth'
--      AND tablename IN ('user','account','session','verification',
--                        'organization','member','invitation')
--    ORDER BY tablename;
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='neon_auth' AND table_name='user'
--      AND column_name='chittyDid';
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE connamespace='neon_auth'::regnamespace AND contype='f'
--    ORDER BY conname;
-- ---------------------------------------------------------------------------
