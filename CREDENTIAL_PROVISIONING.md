# Credential Provisioning — Portal Pattern

## Architecture

Secrets are synced from chittysecrets synthetic-shared vault to Cloudflare Secrets Store at deploy time. Workers read env.SECRET_NAME directly — zero network calls, zero latency.

Fallback: ChittyConnect credential broker can fetch from ChittyServ or chittysecrets Connect for legacy paths.

## Credential Broker Backends

- cloudflare-secrets (DEFAULT): env binding reads, 0ms latency, no config needed
- chittyserv: HTTP API, ~50ms, set CREDENTIAL_BROKER_TYPE=chittyserv
- chittysecrets: HTTP API, ~200ms, CREDENTIAL_BROKER_TYPE=chittysecrets (DEPRECATED)
- auto: cascading cloudflare-secrets then chittyserv then chittysecrets

## Secret Lifecycle

1. Create: Add to chittysecrets synthetic-shared vault
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
- src/services/chittysecrets-connect-client.js: chittysecrets backend (DEPRECATED)
- src/api/routes/credentials.js: REST API credential provisioning routes
