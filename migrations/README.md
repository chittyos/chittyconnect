# ChittyConnect D1 Database Migrations

This directory contains SQL migrations for the ChittyConnect D1 database.

## Database Schema Overview

### Tables

1. **contexts** - Core context records with ChittyID tracking
2. **installations** - GitHub App installations
3. **actors** - Actor registry (humans, AI agents, services)
4. **connections** - Active connections between contexts and services

### Relationships

```
actors (chitty_id)
  └─> contexts (owner_chitty_id)
       └─> connections (source_chitty_id)

installations (installation_id)
  └─> contexts (via GitHub integration)
```

## Creating the Database

### Production

```bash
# Create database
npx wrangler d1 create chittyconnect

# Copy the database_id from output and update wrangler.toml

# Run migrations
npx wrangler d1 execute chittyconnect --file=migrations/0001_create_contexts_table.sql
npx wrangler d1 execute chittyconnect --file=migrations/0002_create_installations_table.sql
npx wrangler d1 execute chittyconnect --file=migrations/0003_create_actors_table.sql
npx wrangler d1 execute chittyconnect --file=migrations/0004_create_connections_table.sql
```

### Staging

```bash
# Create staging database
npx wrangler d1 create chittyconnect-staging

# Copy the database_id and update wrangler.toml [env.staging]

# Run migrations on staging
npx wrangler d1 execute chittyconnect-staging --file=migrations/0001_create_contexts_table.sql --env=staging
npx wrangler d1 execute chittyconnect-staging --file=migrations/0002_create_installations_table.sql --env=staging
npx wrangler d1 execute chittyconnect-staging --file=migrations/0003_create_actors_table.sql --env=staging
npx wrangler d1 execute chittyconnect-staging --file=migrations/0004_create_connections_table.sql --env=staging
```

### Local Development

```bash
# Create local database
npx wrangler d1 create chittyconnect --local

# Run migrations locally
npx wrangler d1 execute chittyconnect --local --file=migrations/0001_create_contexts_table.sql
npx wrangler d1 execute chittyconnect --local --file=migrations/0002_create_installations_table.sql
npx wrangler d1 execute chittyconnect --local --file=migrations/0003_create_actors_table.sql
npx wrangler d1 execute chittyconnect --local --file=migrations/0004_create_connections_table.sql
```

## Running All Migrations at Once

```bash
# Production
cat migrations/*.sql | npx wrangler d1 execute chittyconnect --command=-

# Staging
cat migrations/*.sql | npx wrangler d1 execute chittyconnect-staging --env=staging --command=-

# Local
cat migrations/*.sql | npx wrangler d1 execute chittyconnect --local --command=-
```

## Automatic Initialization

The ChittyConnect worker includes automatic database initialization middleware that runs migrations on first request. See `src/middleware/ecosystem-init.js` for implementation.

This ensures zero-configuration deployment - just deploy the worker and the database schema is created automatically.

## Schema Versioning

Migrations are numbered sequentially:

- `0001_` - Contexts table
- `0002_` - Installations table (GitHub App)
- `0003_` - Actors table
- `0004_` - Connections table

Future migrations should continue the sequence (0005_, 0006_, etc.).

## Querying the Database

### Using wrangler CLI

```bash
# Production
npx wrangler d1 execute chittyconnect --command="SELECT * FROM contexts LIMIT 10"

# Staging
npx wrangler d1 execute chittyconnect-staging --env=staging --command="SELECT * FROM contexts LIMIT 10"

# Local
npx wrangler d1 execute chittyconnect --local --command="SELECT * FROM contexts LIMIT 10"
```

### Using SQL file

```bash
npx wrangler d1 execute chittyconnect --file=query.sql
```

## Backing Up the Database

```bash
# Export production data
npx wrangler d1 execute chittyconnect --command=".dump" > backup-$(date +%Y%m%d).sql

# Restore from backup
npx wrangler d1 execute chittyconnect --file=backup-20251021.sql
```

## Schema Documentation

### contexts table

Stores context records with full ChittyOS integration.

**Key fields:**
- `chitty_id` (PK) - ChittyID from id.chitty.cc
- `name` (unique) - Human-readable context name
- `owner_chitty_id` (FK to actors) - Context owner
- `data`, `systems`, `tools` - JSON arrays
- `chitty_dna_id` - DNA tracking reference
- `status` - active, inactive, deleted

### installations table

Tracks GitHub App installations.

**Key fields:**
- `installation_id` (PK) - GitHub's installation ID
- `chitty_id` (unique) - ChittyID for this installation
- `account_id`, `account_login` - GitHub account info
- `repository_selection` - 'all' or 'selected'
- `permissions`, `events` - JSON configuration
- `uninstalled_at` - NULL if active

### actors table

Registry of all actors (humans, AI, services).

**Key fields:**
- `chitty_id` (PK) - ChittyID from ChittyAuth
- `actor_type` - human, ai, service, system
- `capabilities` - JSON array of permissions
- `status` - active, suspended, deleted

### connections table

Active connections between contexts and services.

**Key fields:**
- `connection_id` (PK) - UUID
- `source_chitty_id` (FK) - Context or actor
- `target_service` - Service name
- `credentials_kv_key` - Reference to API_KEYS
- `status` - active, inactive, failed, disconnected

## Performance Considerations

### Indexes

All tables have appropriate indexes for common queries:

- Primary key indexes (automatic)
- Foreign key indexes (owner lookups)
- Status indexes (active records)
- Timestamp indexes (pagination)
- Unique constraints (name, chitty_id)

### Query Optimization

1. Always use indexed columns in WHERE clauses
2. Limit result sets with LIMIT
3. Use prepared statements (automatic with D1)
4. Avoid SELECT * in production code

## Security

### Data Protection

- No plaintext credentials in database
- Sensitive data references KV storage (encrypted)
- Soft delete pattern preserves audit trail
- ChittyID compliance for identity management

### Access Control

- All database access through worker only
- No direct database exposure
- Zero-trust validation on every request
- Actor-based authorization

## Troubleshooting

### Migration Fails

```bash
# Check if table already exists
npx wrangler d1 execute chittyconnect --command=".schema"

# Drop and recreate (⚠️ DESTRUCTIVE)
npx wrangler d1 execute chittyconnect --command="DROP TABLE contexts"
npx wrangler d1 execute chittyconnect --file=migrations/0001_create_contexts_table.sql
```

### Check Table Structure

```bash
npx wrangler d1 execute chittyconnect --command="PRAGMA table_info(contexts)"
```

### View Indexes

```bash
npx wrangler d1 execute chittyconnect --command="PRAGMA index_list(contexts)"
```

---

**Last Updated:** 2025-10-21
**Schema Version:** 0004
