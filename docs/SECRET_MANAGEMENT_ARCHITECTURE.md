---
uri: chittycanon://docs/ops/architecture/secret-management
namespace: chittycanon://docs/ops
type: architecture
version: 1.0.0
status: DRAFT
title: "ChittyOS Secret Management Architecture"
visibility: INTERNAL
---

# ChittyOS Secret Management Architecture

## Overview

Machine-orchestrated credential management for a 100% synthetic development team. Secrets flow through a three-layer storage model (Cold → Hot → Cache) with strict role separation between provisioning, brokering, and consumption.

No human intervention is required for routine secret access or rotation. The 1Password desktop app is not used — all access is headless via Service Account tokens over HTTPS.

## Principles

1. **Data Diode** — Admin SAs read from many vaults, write to exactly one. A compromised admin can only corrupt its own target vault.
2. **Least Privilege** — Runtime SAs are read-only everywhere. Workers cannot modify vault contents.
3. **No Secret Sprawl** — Secrets never appear in git history, shell logs, or general LLM prompt context. They are injected just-in-time via `op run`, environment bindings, or authenticated machine-to-machine credential responses.
4. **Kill Switch** — Any SA token can be revoked instantly in the 1Password web UI, cutting off access globally without redeployment.
5. **Separation of Concerns** — Provisioning, brokering, and orchestration are handled by different systems with different access levels.

---

## System Roles

### 1. Provisioning Bot (GitHub Actions)

**Purpose:** One-shot or on-demand transfer of secrets from 1Password into Cloudflare's encrypted edge.

**Identity:** `sa-chitty-admin-{env}` Service Account tokens, stored as GH Actions secrets.

**Workflow:** `.github/workflows/sync-secrets.yml`

**Mechanism:**
```bash
# Set admin SA token for target environment
export OP_SERVICE_ACCOUNT_TOKEN="<sa-chitty-admin-stage token>"

# Read from 1Password environment, write to Cloudflare Secrets
op run --environment chitty-app-stage -- sh -c \
  'echo "$NEON_DATABASE_URL" | npx wrangler secret put NEON_DATABASE_URL --name chittyconnect'
```

**When it runs:**
- Manual trigger (`workflow_dispatch`) for initial provisioning
- On new service deployment (seeds required secrets)
- After credential rotation that affects Cloudflare Secrets (not KV-cached tokens)

**Access scope:**
- Reads from 1Password environments (`chitty-app-{env}`)
- Writes to Cloudflare Secrets Store via `wrangler secret put`
- Does NOT write back to 1Password (one-way diode)

**Secret catalog** (defined in workflow):
```
NEON_DATABASE_URL          — Neon PostgreSQL connection string
GDRIVE_CLIENT_ID           — Google OAuth2 client ID
GDRIVE_CLIENT_SECRET       — Google OAuth2 client secret
GDRIVE_REFRESH_TOKEN       — Google OAuth2 refresh token (long-lived)
CHITTY_AUTH_SERVICE_TOKEN   — ChittyAuth bearer token
ONEPASSWORD_CONNECT_TOKEN  — 1Password Connect API token
ONEPASSWORD_CONNECT_URL    — 1Password Connect server URL
```

---

### 2. Credential Broker (ChittyConnect)

**Purpose:** Runtime secret access for all ChittyOS agents. Serves credentials from hot storage (Cloudflare Secrets / env vars) or cache (Workers KV). Falls back to 1Password Connect API for on-demand retrieval.

**Current delivery model:** ChittyConnect is a broker, but authenticated machine callers may still receive raw credential material on some `/api/credentials/*` routes. This is current implementation behavior, not an opaque-handle-only design.

**Identity:** `sa-chitty-{env}` runtime SA tokens (read-only).

**Service:** `chittyconnect` Cloudflare Worker at `connect.chitty.cc`

**Components:**

| Module | Path | Purpose |
|--------|------|---------|
| `EnhancedCredentialProvisioner` | `src/services/credential-provisioner-enhanced.js` | Context-aware credential provisioning with 1Password integration |
| `CredentialBroker` | `src/lib/credential-broker.js` | Unified abstraction over credential backends (1Password, ChittyServ) |
| `SecretRotationService` | `src/services/secret-rotation.js` | Cron-based rotation of cached tokens (OAuth, DB passwords) |
| `CREDENTIAL_CACHE` | KV namespace | Hot cache for rotated tokens |
| `credential-paths.js` | `src/lib/credential-paths.js` | Maps logical names to 1Password item paths |

**How agents access secrets:**
```
Agent (e.g., chittyagent-finance)
  → Service Binding to ChittyConnect
    → CredentialBroker.get("integrations/neon/database_url")
      → Check KV cache (CREDENTIAL_CACHE)
        → Hit: return cached value
        → Miss: fetch from 1Password Connect API, cache, return
```

**REST API:**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/secrets/status` | GET | API key or Bearer | Freshness report for all managed secrets |
| `/api/v1/secrets/rotate/:name` | POST | API key or Bearer | Force-rotate a specific secret |

**Cron triggers:**

| Schedule | Handler | Purpose |
|----------|---------|---------|
| `*/50 * * * *` | `SecretRotationService.forceRotate('gdrive_access_token')` | Refresh GDrive OAuth access token before 60-min expiry |
| `0 * * * *` | `SecretRotationService.runDueRotations()` | Check all secrets, rotate any that are due |
| `*/5 * * * *` | `runAllHealthChecks()` | Connection health checks (existing) |

**Protected by middleware:** `/api/v1/secrets/*` is protected by the same `authenticate` middleware used for the rest of the API surface.

---

### 3. Orchestrator (chittyagent-orchestrator)

**Purpose:** Decides which agent handles which task. Does NOT manage secrets.

**Relationship to secrets:** The orchestrator delegates tasks to agents. Those agents call ChittyConnect for credentials. The orchestrator never sees or handles secret values.

```
User request
  → chittyagent-orchestrator (decides: "finance agent handles this")
    → chittyagent-finance (needs Neon credentials)
      → ChittyConnect credential broker (serves credentials)
        → KV cache or 1Password
```

---

## Storage Layers

### Layer 1: Cold Storage (1Password)

**What:** Long-term source of truth for all credentials.

**Access:** Human (Nick Bianchi, Full Access) + Service Accounts.

**Vaults:**

| Vault | Purpose | Items | Write Access |
|-------|---------|-------|-------------|
| `synthetic-dev` | Dev environment secrets | 1 | `sa-chitty-admin-dev` |
| `synthetic-stage` | Stage environment secrets | 1 | `sa-chitty-admin-stage` |
| `synthetic-prod` | Prod environment secrets | 1 | `sa-chitty-admin-prod` |
| `synthetic-shared` | Cross-environment secrets | 0 | `sa-chitty-admin-shared` |

**Environments:**

| Environment | Created | Purpose |
|-------------|---------|---------|
| `chitty-app-dev` | 2026-03-24 | Dev secret injection context |
| `chitty-app-stage` | 2026-03-24 | Stage secret injection context |
| `chitty-app-prod` | 2026-03-24 | Prod secret injection context |

### Layer 2: Hot Storage (Cloudflare Secrets)

**What:** Encrypted environment variables injected into Workers at deploy time.

**Access:** Worker `env` object only. Hidden from Cloudflare dashboard UI after creation.

**How secrets arrive:** Pushed from 1Password via `sync-secrets.yml` workflow using `wrangler secret put`.

**Lifecycle:** Static until explicitly re-synced. Used for long-lived credentials that don't rotate frequently (API keys, client IDs, refresh tokens).

**Example:**
```javascript
// Inside a Cloudflare Worker
const neonUrl = env.NEON_DATABASE_URL; // Injected at deploy time
```

### Layer 3: Cache Storage (Workers KV)

**What:** Short-lived, high-read tokens that change more often than you want to redeploy.

**Binding:** `CREDENTIAL_CACHE` KV namespace on ChittyConnect.

**Access:** Programmatic only, via `SecretRotationService` or `getCachedGDriveToken()` / `getCachedNeonUri()` helper functions.

**Keys:**

| KV Key | TTL | Content | Rotated By |
|--------|-----|---------|-----------|
| `secret:gdrive:access_token` | ~58 min | OAuth2 access token | 50-min cron |
| `secret:gdrive:refresh_token` | None | OAuth2 refresh token (seeded by provisioning bot) | Manual |
| `secret:gdrive:meta` | None | Rotation metadata (lastRotatedAt, lastResult) | Automatic |
| `secret:neon:connection_uri` | 8 days | Rotated connection string | Weekly cron |
| `secret:neon:password_rotated_at` | None | Timestamp of last rotation | Weekly cron |
| `secret:neon:meta` | None | Rotation metadata | Automatic |

---

## Service Account Hierarchy

### 7 Service Accounts

```
┌─────────────────────────────────────────────────────────┐
│                    1Password                             │
│                                                         │
│  Runtime SAs (READ-ONLY)        Admin SAs (READ many,   │
│  ┌──────────────────┐           WRITE to one vault)     │
│  │ sa-chitty-dev    │──read──→ synthetic-dev             │
│  │ sa-chitty-stage  │──read──→ synthetic-stage           │
│  │ sa-chitty-prod   │──read──→ synthetic-prod            │
│  │ (all three)      │──read──→ synthetic-shared          │
│  └──────────────────┘                                   │
│                                                         │
│  ┌──────────────────────┐                               │
│  │ sa-chitty-admin-dev  │──WRITE→ synthetic-dev          │
│  │                      │──read──→ (15 other vaults)     │
│  │ sa-chitty-admin-stage│──WRITE→ synthetic-stage         │
│  │                      │──read──→ (19 other vaults)     │
│  │ sa-chitty-admin-prod │──WRITE→ synthetic-prod          │
│  │                      │──read──→ (16 other vaults)     │
│  │ sa-chitty-admin-shared──WRITE→ synthetic-shared        │
│  │                      │──read──→ (18 other vaults)     │
│  └──────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
```

### Access Matrix

| SA | synthetic-dev | synthetic-stage | synthetic-prod | synthetic-shared |
|----|:---:|:---:|:---:|:---:|
| `sa-chitty-dev` | read | — | — | read |
| `sa-chitty-stage` | — | read | — | read |
| `sa-chitty-prod` | — | — | read | read |
| `sa-chitty-admin-dev` | **WRITE** | read | read | read |
| `sa-chitty-admin-stage` | read | **WRITE** | read | read |
| `sa-chitty-admin-prod` | read | read | **WRITE** | read |
| `sa-chitty-admin-shared` | read | read | read | **WRITE** |

### Security Properties

| Property | Value |
|----------|-------|
| Vault creation | Not allowed (all SAs) |
| Token expiry | Currently: doesn't expire. **Recommended: 90 days for admin SAs** |
| Token format | Service Account tokens (headless, HTTPS-only) |
| Desktop dependency | None. `op` CLI uses SA tokens directly |
| Memory footprint | <20MB (`op` CLI) vs ~500MB (1Password Desktop) |

---

## Secret Rotation

### Rotation Registry

The `SecretRotationService` uses a registry-driven design. Each entry defines:

```javascript
{
  description: 'Human-readable name',
  kvKey: 'secret:namespace:key',      // KV key for the cached value
  metaKey: 'secret:namespace:meta',   // KV key for rotation metadata
  refreshIntervalMs: 50 * 60 * 1000,  // How often to rotate
  rotator: 'methodName',              // Method on SecretRotationService
}
```

### GDrive OAuth2 Rotation

**Interval:** Every 50 minutes (tokens expire at 60 minutes).

**Flow:**
```
1. Read refresh_token from KV (seeded by provisioning bot)
2. POST https://oauth2.googleapis.com/token
   - grant_type=refresh_token
   - refresh_token, client_id, client_secret
3. Receive new access_token + expires_in
4. KV.put('secret:gdrive:access_token', token, { expirationTtl: expires_in - 120 })
5. Update rotation metadata
```

**Required env vars:**
- `GDRIVE_CLIENT_ID` — OAuth2 client ID (Cloudflare Secret)
- `GDRIVE_CLIENT_SECRET` — OAuth2 client secret (Cloudflare Secret)

**Required KV seed:**
- `secret:gdrive:refresh_token` — Long-lived refresh token (seeded by provisioning bot)

### Neon Password Rotation

**Interval:** Weekly (every 7 days).

**Flow:**
```
1. Read `NEON_API_KEY` from Worker env
2. POST https://console.neon.tech/api/v2/projects/{id}/branches/{branch}/roles/{role}/reset_password
   - Authorization: Bearer {NEON_API_KEY}
3. Receive new password in response
4. Build new connection URI: postgresql://{role}:{password}@{host}/{db}?sslmode=require
5. KV.put('secret:neon:connection_uri', uri, { expirationTtl: 8 days })
6. Update rotation metadata
```

**Required env vars:**
- `NEON_API_KEY` — Neon API key (Cloudflare Secret)
- `NEON_PROJECT_ID` — Neon project ID
- `NEON_BRANCH_ID` — Target branch (optional, defaults to main)
- `NEON_ROLE_NAME` — Database role (defaults to `chittyos_app`)
- `NEON_HOST` — Neon host for connection string construction
- `NEON_DATABASE` — Database name (defaults to `neondb`)

**Implementation note:** the current rotator reads `NEON_API_KEY` directly from Worker env rather than through the credential broker.

### Adding New Rotators

1. Add entry to `ROTATION_REGISTRY` in `src/services/secret-rotation.js`
2. Implement `async rotateMethodName()` on `SecretRotationService`
3. Return `{ ok: true, ...metadata }` on success or `{ ok: false, error: '...' }` on failure
4. The cron handler will automatically pick it up on the next hourly check

---

## Data Flow Diagrams

### Provisioning Flow (one-shot)

```
┌─────────────┐    op run     ┌─────────────┐   wrangler    ┌─────────────┐
│  1Password  │──────────────→│  GH Actions  │──secret put──→│  Cloudflare  │
│  Vault      │  (admin SA)   │  Workflow     │              │  Secrets     │
└─────────────┘               └─────────────┘               └─────────────┘
     cold                      provisioning                      hot
```

### Runtime Credential Flow

```
┌──────────┐  service   ┌──────────────┐  KV.get   ┌──────────┐
│  Agent   │──binding──→│ ChittyConnect │─────────→│ KV Cache  │ ← cache
│ (worker) │            │  (broker)     │          └──────────┘
└──────────┘            │               │  env.VAR  ┌──────────┐
                        │               │─────────→│ CF Secret │ ← hot
                        │               │          └──────────┘
                        │               │  1P API   ┌──────────┐
                        │               │─────────→│ 1Password │ ← cold
                        └──────────────┘           └──────────┘
```

### Rotation Flow (cron)

```
┌──────────────┐  cron    ┌─────────────────────┐
│  Cloudflare  │────────→│ SecretRotationService │
│  Scheduler   │         │                       │
└──────────────┘         │  1. Check if due      │
                         │  2. Call external API  │──→ Google OAuth2 / Neon API
                         │  3. Cache new token   │──→ KV (CREDENTIAL_CACHE)
                         │  4. Update metadata   │
                         └─────────────────────┘
```

---

## Operational Procedures

### First-Time Secret Sync (Stage)

```bash
# 1. Add admin SA token to GH Actions secrets
#    Secret name: OP_ADMIN_SA_TOKEN
#    Value: <sa-chitty-admin-stage token from 1Password web UI>

# 2. Add Cloudflare API token to GH Actions secrets
#    Secret name: CLOUDFLARE_API_TOKEN

# 3. Run sync workflow (dry run first)
gh workflow run sync-secrets.yml \
  -f environment=stage \
  -f secrets_to_sync=all \
  -f dry_run=true

# 4. Review output, then run for real
gh workflow run sync-secrets.yml \
  -f environment=stage \
  -f secrets_to_sync=all \
  -f dry_run=false

# 5. Seed GDrive refresh token into KV
#    (This is a one-time manual step — the refresh token is long-lived)
wrangler kv:key put --binding CREDENTIAL_CACHE \
  "secret:gdrive:refresh_token" "<refresh_token_value>"

# 6. Verify
curl -s https://connect.chitty.cc/api/v1/secrets/status | jq .
```

### Emergency: Revoke a Compromised SA

1. Go to 1Password web UI → Developer → Service Accounts
2. Find the compromised SA (e.g., `sa-chitty-admin-stage`)
3. Click "Revoke Token" → instant global revocation
4. Generate new token
5. Update GH Actions secret `OP_ADMIN_SA_TOKEN`
6. Re-run `sync-secrets.yml` to re-provision

### Monitoring

| Check | How | Frequency |
|-------|-----|-----------|
| Secret freshness | `GET /api/v1/secrets/status` | On demand |
| Rotation failures | Cloudflare Worker logs (`wrangler tail chittyconnect`) | Real-time |
| 1Password access patterns | 1Password audit logs in web console | Weekly |
| Secret catalog drift | `onepassword-rotation-audit.yml` workflow | Weekly (Monday 6am) |

---

## Files

| File | Repo | Purpose |
|------|------|---------|
| `src/services/secret-rotation.js` | chittyconnect | Rotation engine + registry |
| `src/services/credential-provisioner-enhanced.js` | chittyconnect | Runtime credential broker |
| `src/lib/credential-broker.js` | chittyconnect | Backend abstraction (1Password / ChittyServ) |
| `src/lib/credential-paths.js` | chittyconnect | Logical → 1Password path mapping |
| `.github/workflows/sync-secrets.yml` | chittyconnect | Provisioning workflow (1P → CF) |
| `.github/workflows/onepassword-rotation-audit.yml` | chittyconnect | Weekly catalog freshness check |
| `wrangler.jsonc` (triggers section) | chittyconnect | Cron schedule definitions |
