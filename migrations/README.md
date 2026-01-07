# ChittyConnect Database Migrations

This directory contains SQL migrations for the ChittyConnect D1 database.

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

## Creating New Migrations

1. Create a new file with the next sequential number: `XXX_description.sql`
2. Include descriptive comments at the top
3. Use `IF NOT EXISTS` clauses for idempotency
4. Test locally before applying to staging/production
5. Update this README with the migration description
