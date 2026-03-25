# ChittyConnect Secrets & Environment Enforcement Audit

**Date**: 2026-03-25
**Auditor**: Claude Opus 4.6
**Scope**: All env vars, secrets, bindings, and credential patterns in chittyconnect
**Standard**: 3-env model (dev/stage/prod), 1Password cold → Cloudflare Secrets hot, KV only for short-lived rotated values

**NOTE**: `registry.chitty.cc` (ChittyRegistry — catalog/discovery) and `register.chitty.cc` (ChittyRegister — compliance/registration) are **two distinct live services**. ChittyConnect correctly uses `registry.chitty.cc` for service discovery.

---

## Executive Summary

ChittyConnect has **zero env-block separation** — everything is flat at the wrangler.jsonc top level with production IDs. There are no env.dev, env.staging, or env.production blocks. The architecture doc's 3-env model is completely unenforced.

---

## 1. Vars (wrangler.jsonc `vars` block)

| Name | Classification | Env-Specific? | Action |
|------|---------------|---------------|--------|
| `ENVIRONMENT` | var | YES — must differ per env | Split to env blocks |
| `CHITTYID_SERVICE_URL` | var | YES | Split to env blocks |
| `REGISTRY_SERVICE_URL` | var | YES — dev/staging may differ | Split to env blocks |
| `CHITTYOS_ACCOUNT_ID` | var | No | Keep at top level |
| `CHITTYOS_DOMAIN` | var | No | Keep at top level |
| `NEON_ORG_ID` | var | No | Keep at top level |
| `ONEPASSWORD_CONNECT_URL` | var | YES — dev might use local | Split |
| `ONEPASSWORD_VAULT_*` (4) | var | No — same vaults | Keep at top level |
| `CREDENTIAL_FAILOVER_ENABLED` | var | Possibly — disable in dev | Evaluate |
| `CREDENTIAL_BROKER_TYPE` | var | No | Keep |
| `CHITTYSERV_URL` | var | YES — **dev URL in prod config!** | Fix + split |

## 2. Secrets (deployed via `wrangler secret put`)

### Documented (22)

| Name | 1Password Source? | Per-Env? | Action |
|------|-------------------|----------|--------|
| `GITHUB_APP_ID` | Should be | YES | 1P cold → CF hot per env |
| `GITHUB_APP_PK` | Should be | YES | 1P cold → CF hot per env |
| `GITHUB_WEBHOOK_SECRET` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_ID_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_AUTH_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_CASES_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_FINANCE_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_EVIDENCE_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_SYNC_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_CHRONICLE_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_CONTEXTUAL_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_REGISTRY_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_PROOF_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_TRUST_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `CHITTY_TASK_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `NOTION_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `OPENAI_API_KEY` | Should be | YES | 1P cold → CF hot per env |
| `GOOGLE_ACCESS_TOKEN` | Should be | YES | 1P cold → CF hot per env |
| `NEON_DATABASE_URL` | Should be | YES — different DBs | 1P cold → CF hot per env |
| `NEON_API_KEY` | Should be | YES | 1P cold → CF hot per env |
| `ONEPASSWORD_CONNECT_TOKEN` | N/A (is the 1P JWT) | YES | CF hot per env |
| `ENCRYPTION_KEY` | Should be | YES | 1P cold → CF hot per env |

### Undocumented (14) — in source but NOT in wrangler.jsonc

| Name | Found In | Action |
|------|----------|--------|
| `CHITTY_VERIFY_TOKEN` | `chittyos-ecosystem.js:349` | Document + provision |
| `CHITTY_CERTIFY_TOKEN` | `chittyos-ecosystem.js:388` | Document + provision |
| `CHITTY_DNA_TOKEN` | `chittyos-ecosystem.js:223` | Document + provision |
| `CHITTYAUTH_SERVICE_URL` | `chittyid-auth.js:69` | Document as var |
| `CHITTYCHRONICLE_SERVICE_URL` | `chittyid-auth.js:259` | Document as var |
| `CHITTYCONNECT_URL` | `DocumentStorageService.js:163` | Document as var |
| `CHITTYCONNECT_SERVICE_TOKEN` | `tenant-data-migration.js:452` | Document + provision |
| `EVIDENCE_LEGACY_MODE` | `chittyevidence.js:151` | Move to var or delete |
| `OP_EVENTS_API_TOKEN` | `onepassword-events.js:253` | Document + provision |
| `TWILIO_ACCOUNT_SID` | `credentials.js:491` | Document + provision |
| `TWILIO_AUTH_TOKEN` | `credentials.js:492` | Document + provision |
| `TWILIO_PHONE_NUMBER` | `credentials.js:493` | Document as var |
| `ENABLE_DURABLE_OBJECTS` | QUICK_REFERENCE.md | Delete — feature flag, not secret |
| `ENABLE_R2_STORAGE` | QUICK_REFERENCE.md | Delete — feature flag, not secret |

## 3. Bindings (wrangler.jsonc)

| Binding | Type | Has Dev/Stage IDs? | KV Justified? | Action |
|---------|------|--------------------|---------------|--------|
| `FILES` | R2 | No | N/A | Create dev/stage buckets |
| `IDEMP_KV` | KV | No | YES — ephemeral dedup | Create dev/stage |
| `TOKEN_KV` | KV | No | YES — short-lived tokens | Create dev/stage |
| `API_KEYS` | KV | No | Evaluate — could be D1 | Create dev/stage |
| `OAUTH_KV` | KV | No | YES — OAuth tokens | Create dev/stage |
| `CREDENTIAL_CACHE` | KV | No | YES — cached creds | Create dev/stage |
| `RATE_LIMIT` | KV | No | YES — ephemeral counters | Create dev/stage |
| `TENANT_CONNECTIONS` | KV | No | Evaluate — could be D1 | Create dev/stage |
| `DB` | D1 | No | N/A | Create dev/stage databases |
| `MCP_AGENT` | DO | Same class | N/A | OK |
| `EVENT_Q` | Queue | No | N/A | Create dev/stage queues |
| `PROOF_Q` | Queue | No | N/A | Create dev/stage queues |
| `AI` | Workers AI | auto | N/A | OK |
| `MEMORY_VECTORIZE` | Vectorize | No | N/A | Create dev/stage indexes |
| `CONTEXT_VECTORIZE` | Vectorize | No | N/A | Create dev/stage indexes |

### Ghost bindings (referenced in code, NOT in wrangler.jsonc)

| Binding | Found In | Action |
|---------|----------|--------|
| `COMMAND_KV` | `connect.js:31,40,43,56` | Add to wrangler or delete code |
| `DOCUMENT_STORAGE` | `DocumentStorageService.js:17` | Alias of `FILES`? Reconcile |
| `SESSION_STATE` | `SessionStateService.js:19-20` | DO binding — add or delete |
| `CONVERSATIONS` | `composite.js:351` | KV? Add or delete |
| `CONTEXT_CONSCIOUSNESS` | `documents.js:64-65` | DO/service? Add or delete |

## 4. Hardcoded Values (legacy/ad-hoc)

| Value | Location | Action |
|-------|----------|--------|
| `0bc21e3a5a9de1a4cc843be9c3e98121` | `credential-provisioner.js:113,237` | Use `CHITTYOS_ACCOUNT_ID` var |
| `https://chronicle.chitty.cc` | `chittyid-auth.js` | Use env var `CHITTYCHRONICLE_SERVICE_URL` |
| Service URL arrays | `services.js:14`, `tool-dispatcher.js:22` | Move to env vars or D1 |
| `CHITTYSERV_URL` = `http://chittyserv-dev:8080` | `wrangler.jsonc:104` | Dev URL in prod — fix |

## 5. Remediation Runbook

### Phase 1: Fix Immediate Bugs — DONE (PR #99)
- [x] `CHITTYSERV_URL` dev URL in prod config → split to env blocks
- [x] Feature-flag "secrets" → demote to vars or delete

### Phase 2: Wrangler Env Blocks — DONE (PR #99)
- [x] Restructure wrangler.jsonc with env.dev / env.staging / env.production blocks
- [x] Move env-specific vars into their respective blocks
- [x] Keep shared bindings at top level
- [x] Comprehensive secrets manifest in comments

### Phase 3: Secret Provisioning — OPS TASK (no code changes)
- [ ] Document all secrets in 1Password with canonical item names
- [ ] Run `wrangler secret put <NAME> --env production` for each (not bare)
- [ ] Run `wrangler secret put <NAME> --env staging` for each
- [ ] Dev secrets via `.dev.vars` file (gitignored)

### Phase 4: Ghost Binding Resolution — DEFERRED (guarded with optional chaining)
- [x] Documented in wrangler.jsonc as "Phantom Bindings" section
- [ ] Provision as KV namespaces when features are promoted to production

### Phase 5: Source Code Hardcoding Cleanup — IN PROGRESS
- [x] Remove hardcoded account ID `0bc21e3a...` from 4 source files → use `CHITTYOS_ACCOUNT_ID`
- [x] Remove hardcoded `https://chronicle.chitty.cc` from 5 fetch calls → use `CHITTYCHRONICLE_SERVICE_URL`
- [x] `CHITTYSERV_URL` fallback to dev URL removed — explicit guard added
- [x] `CLOUDFLARE_ACCOUNT_ID` default in github-actions.js → falls back to `CHITTYOS_ACCOUNT_ID` env
- [ ] Static service arrays in `services.js` and `tool-dispatcher.js` — needs architectural decision (query ChittyRegistry?)
- [ ] Remaining `env.VAR || "https://..."` fallback patterns (11 locations) — evaluate per-instance

### Phase 6: Documentation Alignment
- [ ] Replace SECRETS_MODEL.md with authoritative version reflecting 3-env model
- [ ] Update all setup/reference docs with `--env` flags on `wrangler secret put`
