# ChittyConnect Secrets & Environment Model

**Authoritative reference** for all secrets, vars, and bindings in ChittyConnect.
Canonical source: `wrangler.jsonc` secrets manifest comments.

---

## Architecture

```
1Password (cold)  ──►  wrangler secret put --env <env>  ──►  Cloudflare Secrets (hot)
                                                               │
                                                               ▼
                                                         Worker env.<NAME>
```

| Layer | Purpose | Scope |
|-------|---------|-------|
| **1Password** | Source of truth. All secrets originate here. | Per-vault (infrastructure, services, integrations, emergency) |
| **Cloudflare Secrets** | Runtime delivery. Injected into Worker `env` at deploy. | Per-environment (dev / staging / production) |
| **KV** | Short-lived rotated values only. Never long-lived secrets. | Ephemeral cache with TTL |
| **`[vars]`** | Non-secret configuration only. | Per-environment in wrangler.jsonc |

## Ownership Matrix (Normative)

| Capability | Owner | Notes |
|------------|-------|-------|
| API key/token issuance + rotation | `chittyauth` | Canonical issuer for service credentials |
| Certificate issuance/revocation | `chittycert` | CA role |
| Trust decisioning + cert proxy | `chittytrust` | Policy + proxy, not token issuer |
| Identity issuance policy | `chittyid` | Pipeline and format governance |
| Evidence/ID mint operations | `chittymint` | Consumes auth credentials; not issuer |

Reference: [Credential Ownership Law](./CREDENTIAL_OWNERSHIP_LAW.md)

## Environments

| Environment | Deploy Command | Worker Name |
|-------------|---------------|-------------|
| **dev** | `wrangler dev` | local |
| **staging** | `wrangler deploy --env staging` | chittyconnect-staging |
| **production** | `wrangler deploy --env production` | chittyconnect |

All `wrangler secret put` commands **must** include `--env <environment>`. Bare `wrangler secret put` (no env flag) is never correct.

Dev secrets go in `.dev.vars` (gitignored), not via `wrangler secret put`.

## Secret Inventory

### GitHub Integration (3)

| Name | Description |
|------|-------------|
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_PK` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature verification |

### ChittyOS Service Tokens (21)

Pattern: `CHITTY_<SERVICE>_TOKEN`

| Name | Service |
|------|---------|
| `CHITTY_ID_TOKEN` | ChittyID |
| `CHITTY_AUTH_TOKEN` | ChittyAuth |
| `CHITTY_REGISTRY_TOKEN` | ChittyRegistry |
| `CHITTY_CHRONICLE_TOKEN` | ChittyChronicle |
| `CHITTY_DNA_TOKEN` | ChittyDNA |
| `CHITTY_VERIFY_TOKEN` | ChittyVerify |
| `CHITTY_CERTIFY_TOKEN` | ChittyCertify |
| `CHITTY_CASES_TOKEN` | ChittyCases |
| `CHITTY_FINANCE_TOKEN` | ChittyFinance |
| `CHITTY_EVIDENCE_TOKEN` | ChittyEvidence |
| `CHITTY_SYNC_TOKEN` | ChittySync |
| `CHITTY_PROOF_TOKEN` | ChittyProof |
| `CHITTY_TRUST_TOKEN` | ChittyTrust |
| `CHITTY_CONTEXTUAL_TOKEN` | ChittyContextual |
| `CHITTY_TASK_TOKEN` | ChittyTask |
| `CHITTY_SERV_TOKEN` | ChittyServ (homelab) |
| `CHITTY_TRACK_TOKEN` | ChittyTrack |
| `CHITTY_DISPUTES_TOKEN` | ChittyDisputes |
| `CHITTY_LEDGER_TOKEN` | ChittyLedger |
| `CHITTY_ID_SERVICE_TOKEN` | ChittyID generic service token |
| `CHITTYCONNECT_SERVICE_TOKEN` | ChittyConnect self-service token |
| `CHITTYMINT_SECRET` | ChittyMint webhook secret |
| `CHITTYAUTH_ISSUED_MINT_TOKEN` | Preferred auth-issued token for ChittyMint API calls |
| `MINT_API_KEY` | Transitional alias for ChittyMint API auth token |

Policy:
- Preferred global pattern: `CHITTYAUTH_ISSUED_<SERVICE>_TOKEN`
- `CHITTYAUTH_ISSUED_MINT_TOKEN` is preferred.
- `MINT_API_KEY` is allowed during migration.
- `CHITTYMINT_SECRET` is legacy and should not be primary API auth.

### Third-Party Integrations (10)

| Name | Description |
|------|-------------|
| `NOTION_TOKEN` | Notion API integration |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_ACCESS_TOKEN` | Google OAuth access token |
| `GDRIVE_CLIENT_ID` | Google Drive OAuth client ID |
| `GDRIVE_CLIENT_SECRET` | Google Drive OAuth client secret |
| `OLLAMA_CF_CLIENT_ID` | CF Access client ID (Ollama tunnel) |
| `OLLAMA_CF_CLIENT_SECRET` | CF Access client secret (Ollama) |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `AI_SEARCH_TOKEN` | AI search integration token |

### Neon Database (5)

| Name | Description |
|------|-------------|
| `NEON_DATABASE_URL` | Neon connection string |
| `NEON_API_KEY` | Neon API key (secret rotation) |
| `NEON_PROJECT_ID` | Neon project ID |
| `NEON_BRANCH_ID` | Neon branch ID |
| `NEON_HOST` | Neon host |

### Credential Provisioning & 1Password (7)

| Name | Description |
|------|-------------|
| `ONEPASSWORD_CONNECT_TOKEN` | 1Password Connect JWT |
| `OP_EVENTS_API_TOKEN` | 1Password Events API token |
| `CLOUDFLARE_MAKE_API_KEY` | CF API fallback (if 1Password down) |
| `CLOUDFLARE_ACCOUNT_ID` | CF account fallback |
| `EMERGENCY_REVOKE_TOKEN` | Emergency credential revocation |
| `ENCRYPTION_KEY` | 32-byte key for KV cache encryption |
| `INTERNAL_WEBHOOK_SECRET` | Internal webhook verification |

### Code Aliases (not separate secrets)

| In Code | Resolves To |
|---------|-------------|
| `CF_ACCOUNT_ID` | `CHITTYOS_ACCOUNT_ID` (var) |
| `CHITTY_SERVICE_TOKEN` | `CHITTY_ID_SERVICE_TOKEN` (secret) |
| `CHITTY_API_KEY` | `API_KEYS` KV lookup (binding) |

## Vars (non-secret, per-environment)

Set in `wrangler.jsonc` env blocks. Key env-specific vars:

| Name | Dev | Staging | Production |
|------|-----|---------|------------|
| `ENVIRONMENT` | `development` | `staging` | `production` |
| `CHITTYCONNECT_URL` | `http://localhost:8787` | `*.workers.dev` | `https://connect.chitty.cc` |
| `CHITTYSERV_URL` | `http://chittyserv-dev:8080` | *(absent)* | *(absent)* |

Shared across all envs: `CHITTYOS_ACCOUNT_ID`, `CHITTYOS_DOMAIN`, `NEON_ORG_ID`, `ONEPASSWORD_VAULT_*`, `CREDENTIAL_BROKER_TYPE`, `NEON_ROLE_NAME`, `NEON_DATABASE`.

## Bindings

| Binding | Type | Purpose | KV Justified? |
|---------|------|---------|---------------|
| `FILES` | R2 | Document storage | N/A |
| `IDEMP_KV` | KV | Ephemeral dedup | Yes |
| `TOKEN_KV` | KV | Short-lived tokens | Yes |
| `API_KEYS` | KV | API key lookup | Yes |
| `OAUTH_KV` | KV | OAuth tokens | Yes |
| `CREDENTIAL_CACHE` | KV | Cached credentials | Yes |
| `RATE_LIMIT` | KV | Ephemeral counters | Yes |
| `TENANT_CONNECTIONS` | KV | Tenant connection state | Yes |
| `DB` | D1 | Primary database | N/A |
| `MCP_AGENT` | DO | Durable Object agent | N/A |
| `EVENT_Q` | Queue | GitHub events | N/A |
| `PROOF_Q` | Queue | DocuMint proofs | N/A |
| `AI` | Workers AI | AI inference | N/A |
| `MEMORY_VECTORIZE` | Vectorize | MemoryCloude index | N/A |
| `CONTEXT_VECTORIZE` | Vectorize | Context embeddings | N/A |

### Phantom Bindings (code references, not yet provisioned)

| Binding | Type | Guard Pattern |
|---------|------|---------------|
| `COMMAND_KV` | KV | `if (c.env.COMMAND_KV)` |
| `CONVERSATIONS` | KV | `if (c.env.CONVERSATIONS)` + warn |
| `CONTEXT_CONSCIOUSNESS` | DO | `if (c.env.CONTEXT_CONSCIOUSNESS)` |
| `CHRONICLE_KV` | KV | `if (env.CHRONICLE_KV)` |
| `MEMORY_KV` | KV | Falls back to `TOKEN_KV` |
| `SESSION_STATE` | DO | Throws if missing |

Provision when features are promoted to production.

## Rotation Policy

| Category | Interval | Method |
|----------|----------|--------|
| Service tokens | 90 days | 1Password rotate + `wrangler secret put --env` |
| OAuth tokens | Per-provider expiry | SecretRotationService (cron every 50 min) |
| Neon passwords | 7 days | SecretRotationService |
| Emergency | Immediate on incident | `EMERGENCY_REVOKE_TOKEN` + audit all provisions |

## Provisioning Workflow

```bash
# 1. Create/update in 1Password (source of truth)
op item edit "ChittyConnect - <SECRET_NAME>" --vault ChittyOS-Core

# 2. Deploy to Cloudflare (runtime delivery)
wrangler secret put <SECRET_NAME> --env production
wrangler secret put <SECRET_NAME> --env staging

# 3. Dev uses .dev.vars (gitignored)
echo "SECRET_NAME=value" >> .dev.vars
```

## Audit & Revocation

| Endpoint | Purpose |
|----------|---------|
| `POST /api/credentials/audit` | Recent provisions log |
| `POST /api/credentials/revoke` | Revoke compromised token |
| `GET /api/v1/credentials/status` | Credential broker health |
