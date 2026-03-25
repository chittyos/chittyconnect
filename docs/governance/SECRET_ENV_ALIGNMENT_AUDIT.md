# ChittyConnect Secret & Environment Alignment Audit

**Date**: 2026-03-25
**Scope**: Enforcement audit — every secret, var, and binding classified and mapped to dev/stage/prod
**Canonical model**: 1Password (cold/source-of-truth) → Cloudflare Secrets (hot/runtime) → KV only for short-lived rotated values

---

## Audit Summary

| Category | Count | Compliant | Non-Compliant | Action Required |
|----------|-------|-----------|---------------|-----------------|
| **Secrets** | 33 | 7 | 26 | Add to sync-secrets catalog + 1Password environments |
| **Vars** | 14 | 10 | 4 | Add to wrangler env blocks |
| **Bindings** | 18 | 9 | 9 | Add missing bindings to dev/stage env blocks |
| **Delete** | 5 | — | 5 | Remove dead references |

**Resolved** (commit `06bbd78`): `wrangler.jsonc` now has explicit `env.dev`, `env.staging`, `env.production` blocks with all vars declared per-env. Uncommitted refinements add `TWILIO_PHONE_NUMBER`, staging crons, and comment cleanup.

**Critical gap**: `sync-secrets.yml` catalog only syncs 7 of 33 secrets. The remaining 26 are either manually `wrangler secret put` or missing entirely.

**Critical gap**: 4 phantom bindings (`CONVERSATIONS`, `PREDICTION_CACHE`, `DOCUMENT_STORAGE`, `SESSION_STATE`) are accessed unconditionally in production code paths and will throw if unbound.

---

## 1. SECRETS (must be in Cloudflare Secrets, sourced from 1Password)

### Currently in sync-secrets.yml catalog (7/33) ✅

| Secret Name | 1Password Source | sync-secrets.yml | CF Secret | Notes |
|---|---|---|---|---|
| `NEON_DATABASE_URL` | ✅ chitty-app-{env} | ✅ | ✅ | |
| `GDRIVE_CLIENT_ID` | ✅ | ✅ | ✅ | |
| `GDRIVE_CLIENT_SECRET` | ✅ | ✅ | ✅ | |
| `GDRIVE_REFRESH_TOKEN` | ✅ | ✅ | ✅ | |
| `CHITTY_AUTH_SERVICE_TOKEN` | ✅ | ✅ | ✅ | Named `CHITTY_AUTH_TOKEN` in wrangler comment — **name mismatch** |
| `ONEPASSWORD_CONNECT_TOKEN` | ✅ | ✅ | ✅ | |
| `ONEPASSWORD_CONNECT_HOST` | ✅ | ✅ | ✅ | |

### Missing from sync-secrets.yml — must be added (26)

#### ChittyOS Service Tokens (12)
| Secret Name | Referenced In | In wrangler comment | In sync-secrets | Action |
|---|---|---|---|---|
| `CHITTY_ID_TOKEN` | chittyos-ecosystem.js:190 | ✅ | ❌ | **ADD to catalog** |
| `CHITTY_AUTH_TOKEN` | chittyos-ecosystem.js:267 | ✅ | ❌ | **ADD** |
| `CHITTY_REGISTRY_TOKEN` | chittyos-ecosystem.js:155,312 | ✅ | ❌ | **ADD** |
| `CHITTY_CHRONICLE_TOKEN` | webhook-router via env | ✅ | ❌ | **ADD** |
| `CHITTY_EVIDENCE_TOKEN` | via env | ✅ | ❌ | **ADD** |
| `CHITTY_DNA_TOKEN` | chittyos-ecosystem.js:223 | ✅ | ❌ | **ADD** |
| `CHITTY_VERIFY_TOKEN` | chittyos-ecosystem.js:349 | ✅ | ❌ | **ADD** |
| `CHITTY_CERTIFY_TOKEN` | chittyos-ecosystem.js:388 | ✅ | ❌ | **ADD** |
| `CHITTY_PROOF_TOKEN` | proof-queue.js:60, chittyproof-client.js:27 | ✅ | ❌ | **ADD** |
| `CHITTY_SYNC_TOKEN` | via env | ✅ | ❌ | **ADD** |
| `CHITTY_CONTEXTUAL_TOKEN` | via env | ✅ | ❌ | **ADD** |
| `CHITTY_TASK_TOKEN` | tool-dispatcher.js:1641 | ✅ | ❌ | **ADD** |

#### GitHub App (3)
| Secret Name | Referenced In | Action |
|---|---|---|
| `GITHUB_APP_ID` | via env | **ADD to catalog** |
| `GITHUB_APP_PK` | via env (private key PEM) | **ADD** |
| `GITHUB_WEBHOOK_SECRET` | via env | **ADD** |

#### Third-Party Integration Secrets (6)
| Secret Name | Referenced In | Action |
|---|---|---|
| `NOTION_TOKEN` | thirdparty.js (6 refs), github-actions.js | **ADD** |
| `OPENAI_API_KEY` | thirdparty.js:287,388, github-actions.js | **ADD** |
| `GOOGLE_ACCESS_TOKEN` | thirdparty.js:825 | **ADD** |
| `NEON_API_KEY` | secret-rotation.js:217, tenant-project-manager.js:35 | **ADD** |
| `TWILIO_ACCOUNT_SID` | credentials.js:491 | **ADD** |
| `TWILIO_AUTH_TOKEN` | credentials.js:492 | **ADD** |

#### Ollama / Cloudflare Access (2) — **currently ad hoc**
| Secret Name | Referenced In | Action |
|---|---|---|
| `OLLAMA_CF_CLIENT_ID` | thirdparty.js:344,468,517 | **ADD** — CF Access service token, not a var |
| `OLLAMA_CF_CLIENT_SECRET` | thirdparty.js:346,470,519 | **ADD** — CF Access service token secret |

#### Infrastructure Secrets (3)
| Secret Name | Referenced In | Action |
|---|---|---|
| `ENCRYPTION_KEY` | 1password-connect-client.js:316 | **ADD** — KV cache encryption key |
| `EMERGENCY_REVOKE_TOKEN` | wrangler comment only | **ADD** — emergency credential revoke |
| `OP_EVENTS_API_TOKEN` | onepassword-events.js:253 | **ADD** — 1Password Events API |

---

## 2. VARS (non-sensitive config, goes in wrangler `vars` per env)

### Currently in wrangler.jsonc `vars` block (10) ✅

| Var Name | Value | Per-env needed? | Status |
|---|---|---|---|
| `ENVIRONMENT` | `"production"` | ✅ must differ per env | **COMPLIANT** (but only in prod block) |
| `CHITTYID_SERVICE_URL` | `https://id.chitty.cc` | ✅ dev should point to dev | Needs env blocks |
| `REGISTRY_SERVICE_URL` | `https://registry.chitty.cc` | ✅ | Needs env blocks |
| `CHITTYOS_ACCOUNT_ID` | `0bc21e3a5a...` | Same across envs | ✅ |
| `CHITTYOS_DOMAIN` | `chitty.cc` | Same across envs | ✅ |
| `NEON_ORG_ID` | `org-old-mountain-22774840` | Same across envs | ✅ |
| `ONEPASSWORD_CONNECT_URL` | `https://1password-connect.chitty.cc` | Same across envs | ✅ |
| `ONEPASSWORD_VAULT_*` (4 vaults) | vault IDs | Same across envs | ✅ |
| `CREDENTIAL_FAILOVER_ENABLED` | `"true"` | Same across envs | ✅ |
| `CREDENTIAL_BROKER_TYPE` | `"auto"` | Same across envs | ✅ |
| `CHITTYSERV_URL` | `http://chittyserv-dev:8080` | ✅ dev vs prod differ | Needs env blocks |

### Previously missing vars — now resolved ✅ (commit `06bbd78` + uncommitted)

All of the following are now declared in all three env blocks:

| Var Name | Status | Notes |
|---|---|---|
| `OLLAMA_URL` | ✅ In all env blocks | Non-secret URL |
| `EVIDENCE_LEGACY_MODE` | ✅ In all env blocks | `"false"` default |
| `AI_MODEL_PRIMARY` | ✅ In all env blocks | `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `TWILIO_PHONE_NUMBER` | ✅ In uncommitted changes | Non-secret, `+1XXXXXXXXXX` placeholder |
| `CHITTYAUTH_SERVICE_URL` | ✅ In all env blocks | |
| `CHITTYCHRONICLE_SERVICE_URL` | ✅ In all env blocks | |
| `CHITTYROUTER_URL` | ✅ In all env blocks | |
| `CHITTYMINT_URL` | ✅ In all env blocks | |
| `CHITTY_FALLBACK_URL` | ✅ In all env blocks | |
| `NEON_ROLE_NAME` | ✅ In all env blocks | `chittyos_app` |
| `NEON_DATABASE` | ✅ In all env blocks | `neondb` |

### Remaining naming consolidation needed

| Code Reference | Canonical Name | Action |
|---|---|---|
| `CHITTYCHRONICLE_URL` (webhook-router.js:100) | `CHITTYCHRONICLE_SERVICE_URL` | **Update code** to use canonical name |

---

## 3. BINDINGS (KV, R2, D1, DO, Queue, Vectorize, AI)

### In wrangler.jsonc (9 binding types) ✅

| Binding | Type | wrangler.jsonc | Notes |
|---|---|---|---|
| `FILES` | R2 | ✅ | `chittyos-files` |
| `IDEMP_KV` | KV | ✅ | Idempotency + usage tracking |
| `TOKEN_KV` | KV | ✅ | Token storage |
| `API_KEYS` | KV | ✅ | API key validation |
| `OAUTH_KV` | KV | ✅ | OAuth 2.1 provider |
| `CREDENTIAL_CACHE` | KV | ✅ | Encrypted credential cache |
| `RATE_LIMIT` | KV | ✅ | Rate limiting |
| `TENANT_CONNECTIONS` | KV | ✅ | Tenant connection state |
| `DB` | D1 | ✅ | `chittyconnect` D1 |
| `MCP_AGENT` | DO | ✅ | `McpConnectAgent` |
| `EVENT_Q` | Queue | ✅ | `github-events` |
| `PROOF_Q` | Queue | ✅ | `documint-proofs` |
| `MEMORY_VECTORIZE` | Vectorize | ✅ | `memory-cloude` |
| `CONTEXT_VECTORIZE` | Vectorize | ✅ | `context-embeddings` |
| `AI` | Workers AI | ✅ | |

### Referenced in code but NOT in wrangler.jsonc — verified classification

| Binding | Type | Verdict | Evidence | Action |
|---|---|---|---|---|
| `CONVERSATIONS` | KV | **REQUIRED** | `c.env.CONVERSATIONS.put()` unconditional in composite.js:351 — will throw if unbound | **Provision KV namespace** |
| `PREDICTION_CACHE` | KV | **REQUIRED** | `this.predictionCache.put()` unconditional in prediction-engine.js:395 (cron handler path) | **Provision KV namespace** |
| `DOCUMENT_STORAGE` | R2 | **REQUIRED** | `this.bucket = env.DOCUMENT_STORAGE` unconditional in DocumentStorageService.js:17 (all /api/documents routes) | **Provision R2 bucket** or alias to `FILES` |
| `SESSION_STATE` | DO | **REQUIRED** | `this.env.SESSION_STATE.idFromName()` unconditional in SessionStateService.js:19 (all /api/sessions routes). Has KV fallback in catch but initial call throws | **Add DO binding** or guard constructor |
| `MEMORY_KV` | KV | **FALLBACK** | `env.MEMORY_KV \|\| env.TOKEN_KV` — silently falls back | Provision when MemoryCloude is promoted; works without |
| `CHRONICLE_KV` | KV | **OPTIONAL** | `if (env.CHRONICLE_KV)` guarded | Provision when Chronicle integration is promoted |
| `COMMAND_KV` | KV | **OPTIONAL** | `if (c.env.COMMAND_KV)` guarded | Provision when rate limit config is needed |
| `CONTEXT_CONSCIOUSNESS` | DO | **OPTIONAL** | `if (c.env.CONTEXT_CONSCIOUSNESS)` guarded | Provision when ContextConsciousness DO is deployed |
| `OAUTH_PROVIDER` | auto | **AUTO** | Injected by `@cloudflare/workers-oauth-provider` at runtime | No action needed |

---

## 4. DELETE (dead references, legacy, or unreachable)

| Name | Type | Referenced In | Reason |
|---|---|---|---|
| `CHITTY_DNA_TOKEN` | Secret | chittyos-ecosystem.js:223 | **Verify**: does `dna.chitty.cc` still exist? If not, delete |
| `CHITTY_CERTIFY_TOKEN` | Secret | chittyos-ecosystem.js:388 | **Verify**: is ChittyCertify deployed? |
| `CF_ACCOUNT_ID` | Var/Secret | tool-dispatcher.js:901, cloudflare-api-helper.js:28 | **Consolidate**: redundant with `CHITTYOS_ACCOUNT_ID` (already in vars) |
| `CHITTY_SERVICE_TOKEN` | Secret | chittyid-client.js:71 | **Consolidate**: overlaps with `CHITTY_ID_TOKEN` |
| `CHITTY_API_KEY` | Secret | chittyid-client.js:72 | **Clarify**: is this different from service token? |

---

## 5. STRUCTURAL GAPS

### Gap 1: No dev/stage wrangler env blocks

**Current state**: `wrangler.jsonc` is production-only. No `[env.staging]` or `[env.dev]` blocks exist.

**Required**: Self-contained env blocks per the canonical model:

```jsonc
{
  "env": {
    "dev": {
      "name": "chittyconnect-dev",
      "vars": {
        "ENVIRONMENT": "development",
        "CHITTYID_SERVICE_URL": "https://id-dev.chitty.cc",
        // ... per-env URLs
      },
      "kv_namespaces": [
        // dev KV namespace IDs (separate from prod)
      ]
    },
    "staging": {
      "name": "chittyconnect-staging",
      "vars": {
        "ENVIRONMENT": "staging",
        // ...
      }
    }
  }
}
```

### Gap 2: sync-secrets.yml catalog incomplete

**Current catalog** (7 entries):
```
NEON_DATABASE_URL, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET,
GDRIVE_REFRESH_TOKEN, CHITTY_AUTH_SERVICE_TOKEN,
ONEPASSWORD_CONNECT_TOKEN, ONEPASSWORD_CONNECT_HOST
```

**Required catalog** (33 entries): All secrets listed in Section 1 above.

### Gap 3: Ollama treated as ad hoc

`OLLAMA_CF_CLIENT_ID` and `OLLAMA_CF_CLIENT_SECRET` are CF Access service tokens — they are secrets. `OLLAMA_URL` is a var. None are in wrangler.jsonc or sync-secrets.yml. This is the exact kind of per-feature exception the canonical model prohibits.

### Gap 4: KV namespace sprawl

Code references 5 KV namespaces (`MEMORY_KV`, `CHRONICLE_KV`, `COMMAND_KV`, `CONVERSATIONS`, `PREDICTION_CACHE`) that don't exist in wrangler.jsonc. Either:
- Create them and add bindings, or
- Consolidate into existing namespaces with key prefixes, or
- Delete the dead code paths

### Gap 5: Duplicate naming

| Code Reference | wrangler Comment | Canonical Name | Action |
|---|---|---|---|
| `CHITTY_AUTH_SERVICE_TOKEN` | `CHITTY_AUTH_TOKEN` | Pick one | **Standardize** |
| `CF_ACCOUNT_ID` | `CHITTYOS_ACCOUNT_ID` | `CHITTYOS_ACCOUNT_ID` | **Remove `CF_ACCOUNT_ID` refs** |
| `CHITTYCHRONICLE_URL` | `CHITTYCHRONICLE_SERVICE_URL` | Pick one | **Standardize** |
| `CHITTY_SERVICE_TOKEN` | `CHITTY_ID_TOKEN` | `CHITTY_ID_TOKEN` | **Standardize** |

---

## 6. REMEDIATION RUNBOOK

### Phase 1: Structural (wrangler.jsonc) — MOSTLY COMPLETE ✅
1. ✅ Add `env.dev` block — commit `06bbd78`
2. ✅ Add `env.staging` block — commit `06bbd78`
3. ⏳ Create KV namespaces for dev/staging (preview_id auto-created by `wrangler dev`, staging needs manual)
4. ⏳ Provision 4 required phantom bindings: `CONVERSATIONS` (KV), `PREDICTION_CACHE` (KV), `DOCUMENT_STORAGE` (R2), `SESSION_STATE` (DO)
5. ✅ Add missing vars — commit `06bbd78` (OLLAMA_URL, AI_MODEL_PRIMARY, service URLs, etc.)
6. ⏳ Resolve `CHITTYCHRONICLE_URL` → `CHITTYCHRONICLE_SERVICE_URL` in code

### Phase 2: Secret Catalog (sync-secrets.yml)
7. Add all 26 missing secrets to the sync catalog
8. Create corresponding 1Password environment entries in `chitty-app-dev`, `chitty-app-stage`, `chitty-app-prod`
9. Run `sync-secrets.yml` for each environment (dry-run first)
10. Verify all secrets are set: `wrangler secret list --name chittyconnect`

### Phase 3: Code Cleanup
11. Replace `CF_ACCOUNT_ID` with `CHITTYOS_ACCOUNT_ID` in code
12. Consolidate `CHITTYCHRONICLE_URL` / `CHITTYCHRONICLE_SERVICE_URL`
13. Consolidate `CHITTY_SERVICE_TOKEN` / `CHITTY_ID_TOKEN`
14. Remove or bind `CONTEXT_CONSCIOUSNESS` and `SESSION_STATE` DO references
15. Decide on `DOCUMENT_STORAGE` vs `FILES` R2 binding

### Phase 4: Verification
16. Deploy to dev, verify all bindings resolve
17. Deploy to staging, run integration tests
18. Deploy to prod, verify no regressions
19. Update `.1password/environments.toml` to include all secrets
20. Close this audit with a PR linking to all changes

---

## KV Usage Classification

Per the canonical model, KV is only for **short-lived rotated values where justified**.

| KV Namespace | Current Use | Justified? |
|---|---|---|
| `IDEMP_KV` | Idempotency keys + usage counters (TTL) | ✅ Short-lived, auto-expiring |
| `TOKEN_KV` | OAuth tokens, session tokens | ✅ Rotated, TTL-based |
| `API_KEYS` | API key validation cache | ⚠️ Review — could be D1 |
| `OAUTH_KV` | OAuth 2.1 provider state | ✅ Required by @cloudflare/workers-oauth-provider |
| `CREDENTIAL_CACHE` | Encrypted credential cache from 1Password | ✅ Short-lived cache, encrypted |
| `RATE_LIMIT` | Rate limit counters | ✅ Short-lived counters |
| `TENANT_CONNECTIONS` | Tenant connection state | ⚠️ Review — could be D1 |
| `MEMORY_KV` (missing) | MemoryCloude persistence | ⚠️ May need Vectorize instead |
| `CHRONICLE_KV` (missing) | Event logging buffer | ⚠️ Review — should events go to Chronicle directly? |
| `COMMAND_KV` (missing) | Rate limit config | ✅ If short-lived |
| `CONVERSATIONS` (missing) | Conversation persistence | ❌ Likely should be D1 |
| `PREDICTION_CACHE` (missing) | Prediction results cache | ✅ If TTL-based |
