---
uri: chittycanon://docs/ops/runbook/secret-migration
namespace: chittycanon://docs/ops
type: runbook
version: 1.0.0
status: ACTIVE
title: "Secret Management Migration Runbook"
visibility: INTERNAL
implements: chittycanon://docs/ops/architecture/secret-management
architecture_source: chittyconnect/docs/SECRET_MANAGEMENT_ARCHITECTURE.md
---

# Secret Management Migration Runbook

Implements [chittycanon://docs/ops/architecture/secret-management](chittyconnect/docs/SECRET_MANAGEMENT_ARCHITECTURE.md).

If there is a disagreement between this runbook and the architecture spec, the architecture spec wins for target design. This runbook wins for current rollout status and migration sequencing.

---

## Current State Audit (2026-03-24)

### Scale

- **60 Workers** across 4 orgs (CHITTYOS, CHITTYFOUNDATION, CHICAGOAPPS, CHITTYAPPS)
- **~140 `env.*` references** in source code
- **47 Workers** need env blocks added, 13 already have them
- **Config formats:** CHITTYFOUNDATION → `.jsonc`, CHITTYOS → `.toml`

### Secret Classification

| Category | Count | Action |
|----------|-------|--------|
| Service-to-service URLs | ~30 | Move to `vars` (not secrets) |
| Notion database IDs | ~12 | Move to `vars` (not secrets) |
| 1Password-specific (`ONEPASSWORD_*`) | ~8 | **Delete** after migration |
| Service tokens | ~25 | → Cloudflare Secrets Store |
| Third-party credentials | ~20 | → Cloudflare Secrets Store |
| Signing/encryption keys | ~5 | → Secrets Store + rotation audit |
| **Actual secrets to migrate** | **~60-70** | |

### High-Density Workers

| Worker | env refs | Migration complexity |
|--------|----------|---------------------|
| chittyconnect | 70+ | Highest — has ONEPASSWORD_* refs, all service tokens, 1P Connect fallback |
| chittyrouter | 100+ | High — many bindings + secrets |
| chittyid | 40+ | High — signing keys, auth tokens |
| chittyregistry | 35+ | Medium — Notion integration heavy |
| chittygov | 25+ | Medium — Notion + OpenAI |
| chatgpt-mcp-gateway | 13 | Medium — all MCP service tokens |

### Stale Compatibility Dates

| Worker | compat_date | Target |
|--------|-------------|--------|
| chittymint | 2024-01-01 | 2026-03-16 |
| flow-analyzer | 2024-01-15 | 2026-03-16 |
| chittycases-pro | 2024-09-18 | 2026-03-16 |
| chittygov | 2024-09-23 | 2026-03-16 |
| chittymcp | 2024-10-01 | 2026-03-16 |
| chitty-chronicle-api | 2024-11-01 | 2026-03-16 |

---

## Prerequisites

### 1. Service Account Tokens

Create 7 SAs per the architecture spec's hierarchy. Set tokens on both machines:

```bash
# Local Mac (~/.zshrc)
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxxxx"

# VM (~/.bashrc)
ssh chittyserv-dev 'echo "export OP_SERVICE_ACCOUNT_TOKEN=\"ops_xxxxx\"" >> ~/.bashrc'
```

Verify: `op user get --me` and `op environment read <ENV_ID>`

### 2. 1Password Environments

Create 3 environments in 1Password web console (Developer → Environments):
- `chitty-app-dev`
- `chitty-app-stage`
- `chitty-app-prod`

Populate each with the secrets its Workers need.

### 3. Deployment Hook

`~/.claude/hooks/1password-validate-env.sh` gates `wrangler deploy` commands:
- Checks `OP_SERVICE_ACCOUNT_TOKEN` on VM for SSH commands
- Allows `--dry-run` without token
- Handles SSH with flags (`ssh -o ... chittyserv-dev`)

---

## Wrangler Multi-Environment Pattern

**Critical rule:** Env blocks do NOT inherit top-level `vars`, `routes`, or `tail_consumers`. Each block must be self-contained.

```jsonc
{
  "name": "chittyauth",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-16",
  "workers_dev": false,
  "observability": { "enabled": true },

  // Secrets: NEON_DATABASE_URL, JWT_SECRET, service tokens
  // Injected by: op run --environment <ID> -- npx wrangler deploy --env prod

  "env": {
    "dev": {
      "vars": { "SERVICE_NAME": "chittyauth", "ENVIRONMENT": "development" },
      "tail_consumers": [{ "service": "chittytrack" }]
    },
    "prod": {
      "routes": [{ "pattern": "auth.chitty.cc/*", "zone_name": "chitty.cc" }],
      "vars": { "SERVICE_NAME": "chittyauth", "ENVIRONMENT": "production" },
      "tail_consumers": [{ "service": "chittytrack" }]
    }
  }
}
```

Full template: `process-ops/state/wrangler-template.jsonc`

---

## Migration Phases

### Phase 1: Foundation ⬜
- [ ] Create 7 Service Accounts (4 admin + 3 runtime)
- [ ] Create 3 1P Environments
- [ ] Set `OP_SERVICE_ACCOUNT_TOKEN` on Mac and VM
- [ ] Verify: `op environment read <ID>` returns variables

### Phase 2: First Worker ✅ partial
- [x] Migrate chittyauth wrangler.jsonc (env blocks, dry-run validated)
- [ ] Sync chittyauth secrets to CF Secrets Store
- [ ] Deploy: `op run --env chitty-app-prod -- npx wrangler deploy --env prod`
- [ ] Verify: `curl https://auth.chitty.cc/health`

### Phase 3: Shared Secrets ⬜
- [ ] `NEON_DATABASE_URL` → chittyapi, chitty-ledger-api, chitty-id-api, chitty-verify-api, chitty-chronicle-api, chatgpt-mcp-gateway
- [ ] `NOTION_TOKEN` → chittymcp, chittyregistry, chittyagent-notion
- [ ] `OPENAI_API_KEY` → chitty-janitor, chittygov
- [ ] `ANTHROPIC_API_KEY` → chitty-janitor

### Phase 4: Tier-by-Tier Rollout ⬜

| Tier | Services | Status |
|------|----------|--------|
| 0 | chittyid, chittyschema | ⬜ |
| 1 | ~~chittyauth~~ ✅, chittycert, chittyregister | partial |
| 2 | chittyconnect (heaviest — do last), chittyrouter | ⬜ |
| 3 | chittymonitor, chittydispute, chittytrack | ⬜ |
| 4+ | chittyevidence, chittycommand, all agents | ⬜ |

### Phase 5: Cleanup ⬜
- [ ] Remove 8 `ONEPASSWORD_*` env refs from chittyconnect
- [ ] Remove `op run` from legacy deploy scripts
- [ ] Move ~30 service URLs to plain `vars`
- [ ] Move ~12 Notion DB IDs to plain `vars`
- [ ] Update 6 stale compatibility dates
- [ ] Port sync-secrets.sh to GitHub Actions
- [ ] Uninstall 1Password Desktop App

---

## Gaps to Reconcile

These require architecture-level decisions (resolve in chittyconnect spec, not here):

| Gap | Question | Impact |
|-----|----------|--------|
| Auth on `/api/v1/secrets/*` | Bearer token — is this a CF Secret or a service binding? | Determines how agents authenticate to the broker |
| Raw vs brokered secrets | Should broker return raw values or scoped/wrapped responses? | Affects consumer contract |
| `ONEPASSWORD_CONNECT_HOST` vs `_URL` | Both exist in chittyconnect source — which is canonical? | Cleanup target |
| Neon rotation: broker vs env | Should rotated Neon URI go to KV (broker-based) or CF Secrets (env-based)? | Affects whether consumers use broker or `env.NEON_DATABASE_URL` |

---

## Scripts

All scripts in `process-ops/scripts/`:

### sync-secrets.sh
```bash
# List variables in a 1P Environment
./scripts/sync-secrets.sh --list <ENV_ID>

# Bulk sync: 1P Environment → Worker
./scripts/sync-secrets.sh --env <ENV_ID> --worker <name> [--dry-run]

# Per-secret mapping mode
./scripts/sync-secrets.sh [--worker <name>] [--dry-run]
```

### gen-dev-vars.sh
```bash
# Generate .dev.vars templates (placeholders)
./scripts/gen-dev-vars.sh

# With live values (needs OP_SERVICE_ACCOUNT_TOKEN)
./scripts/gen-dev-vars.sh --worker chittyauth /output/dir/
```

### add-env-blocks.sh
```bash
# Audit which Workers need env blocks (run on VM)
ssh chittyserv-dev 'bash -s' < scripts/add-env-blocks.sh
```

### health-check.sh
```bash
# Check all *.chitty.cc/health endpoints
./scripts/health-check.sh
```

---

## Validation Checkpoints

After each phase, verify:

| Check | Command | Expected |
|-------|---------|----------|
| SA auth works | `op user get --me` | Returns SA details |
| Environment readable | `op environment read <ID>` | Returns JSON variables |
| Worker config valid | `npx wrangler deploy --dry-run --env prod` | No errors, correct vars listed |
| Secrets synced | `npx wrangler secret list --name <worker>` | Lists expected secret names |
| Service healthy | `curl https://<svc>.chitty.cc/health` | `{"status":"ok"}` |
| No 1P Desktop dependency | `pkill 1Password && op environment read <ID>` | Still works |

---

## Rollback

If a Worker breaks after migration:

```bash
# 1. Restore old wrangler config from backup
ssh chittyserv-dev "cp ~/projects/github.com/CHITTYFOUNDATION/chittyauth/wrangler.jsonc.bak \
  ~/projects/github.com/CHITTYFOUNDATION/chittyauth/wrangler.jsonc"

# 2. Redeploy without --env flag (uses top-level config)
ssh chittyserv-dev "cd ~/projects/github.com/CHITTYFOUNDATION/chittyauth && npx wrangler deploy"

# 3. Verify
curl -s https://auth.chitty.cc/health | jq .
```

---

## State Files

| File | Purpose |
|------|---------|
| `state/worker-secrets-map.json` | Per-Worker secrets/vars/bindings classification (15 Workers) |
| `state/secrets-audit.md` | Full env ref categorization |
| `state/wrangler-template.jsonc` | Canonical wrangler config template |
| `state/architecture-blueprint.md` | Hub & Spoke + environment strategy overview |
| `state/blockers.md` | Active operational blockers |
| `state/last-health.json` | Latest health check results |
