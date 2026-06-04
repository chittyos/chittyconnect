# ChittyConnect Database Migrations

This directory contains SQL migrations for ChittyConnect.

**Two backends live here.** Most files target Cloudflare D1 (SQLite) and are
applied via `wrangler d1 execute`. Files explicitly noted as **Neon Postgres**
in their header MUST be applied via `psql` against the appropriate Neon
project — do NOT run them through `wrangler d1 execute` (the dialects diverge:
no `gen_random_uuid()`, no `timestamptz`, no `DO $$ ... $$` blocks on D1).

Neon Postgres migrations in this directory (apply with `psql`):
- `019_neon_auth_user_store.sql` — `neon_auth.{user,account,session,verification,organization,member,invitation}` on Neon project `restless-grass-40598426` (ChittyOS-Core).

## Applying Migrations

### Local Development

Apply migrations to the local D1 database:

```bash
# Apply a specific migration
wrangler d1 execute chittyconnect --local --file=migrations/001_credential_provisions.sql

# Apply all migrations (in order)
for file in migrations/*.sql; do
  wrangler d1 execute chittyconnect --local --file="$file"
done
```

### Staging Environment

```bash
# Apply to staging
wrangler d1 execute chittyconnect --env=staging --file=migrations/001_credential_provisions.sql
```

### Production Environment

```bash
# Apply to production (requires confirmation)
wrangler d1 execute chittyconnect-production --env=production --file=migrations/001_credential_provisions.sql
```

## Migration History

- **001_credential_provisions.sql** - Initial credential provisioning audit table
  - Tracks all credential provision operations
  - Supports revocation tracking
  - Indexes for common query patterns
- **018_git_tenant_allowlists.sql** - Per-tenant policy for the Git Tool Surface
  - `git_remote_allowlist` — which remote URL patterns a tenant may push to
  - `git_repo_allowlist` — which absolute repo path prefixes are readable/writable
  - `git_author_allowlist` — which commit identities a tenant may use
  - `git_gateway_tags` — CF gateway membership tags for the `chittyagent-git` upstream
  - Seeds `chittyos-default` tenant with the CHARTER.md default allowlists
- **019_neon_auth_user_store.sql** — **Neon Postgres** (NOT D1). ChittyConnect
  ownership of `neon_auth.{user,account,session,verification,organization,
  member,invitation}` on project `restless-grass-40598426`. Adds `chittyDid`
  on `user`, foreign keys, indexes, and JWT-bound Row-Level Security
  (predicate: `chittyDid = current_setting('request.jwt.claim.sub', true)`).
  `neon_auth.jwks` and `neon_auth.project_config` remain ChittyAuth-owned.
  Apply via `psql "$NEON_DATABASE_URL" -f migrations/019_neon_auth_user_store.sql`.
  E2E validation: `node scripts/e2e/neon-auth-rls.mjs` against a Neon branch.

## Creating New Migrations

1. Create a new file with the next sequential number: `XXX_description.sql`
2. Include descriptive comments at the top
3. Use `IF NOT EXISTS` clauses for idempotency
4. Test locally before applying to staging/production
5. Update this README with the migration description
