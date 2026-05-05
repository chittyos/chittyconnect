# Credential Provisioning — Portal Pattern

## Architecture

Secrets are synced from 1Password synthetic-shared vault to Cloudflare Secrets Store at deploy time. Workers read env.SECRET_NAME directly — zero network calls, zero latency.

Fallback: ChittyConnect credential broker can fetch from ChittyServ or 1Password Connect for legacy paths.

## Credential Broker Backends

- cloudflare-secrets (DEFAULT): env binding reads, 0ms latency, no config needed
- chittyserv: HTTP API, ~50ms, set CREDENTIAL_BROKER_TYPE=chittyserv
- 1password: HTTP API, ~200ms, CREDENTIAL_BROKER_TYPE=1password (DEPRECATED)
- auto: cascading cloudflare-secrets then chittyserv then 1password

## Secret Lifecycle

1. Create: Add to 1Password synthetic-shared vault
2. Sync: Run sync-secrets.sh (op CLI reads 1P, CF API pushes to workers)
3. Deploy: Workers pick up new values on next deploy
4. Rotate: Update in 1P, re-sync, redeploy
5. Revoke: Remove from 1P, re-sync, redeploy

## SA Token Architecture

- sa-chitty-admin-shared: Migration/sync admin (read+write on all 19 vaults)
- sa-chitty-admin-prod/stage/dev: Per-environment admin
- sa-chitty-prod/stage/dev: Runtime read-only per environment

## Key Files

- src/services/cloudflare-secrets-client.js: CF Secrets Store backend (NEW)
- src/lib/credential-broker.js: Backend selector (UPDATED — default changed to cloudflare-secrets)
- src/services/chittyserv-client.js: ChittyServ backend
- src/services/1password-connect-client.js: 1Password backend (DEPRECATED)
- src/api/routes/credentials.js: REST API credential provisioning routes
