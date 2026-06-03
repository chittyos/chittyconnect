# Deploying ChittyConnect

**TL;DR — do NOT run `wrangler deploy` directly. Use `npm run deploy`.**

## The sanctioned deploy path

```bash
# Production
npm run deploy
# or
scripts/safe-deploy.sh production

# Staging
npm run deploy:staging

# Audit live bindings without deploying
npm run deploy:audit
```

## Why this matters (issue #216 — binding-drift loop)

`wrangler deploy` with no `--env` flag uploads the **top-level** `wrangler.jsonc`
config, which intentionally has only the inherited Secrets Store bindings.
The named environments (`dev`, `staging`, `production`) **explicitly
redeclare** every KV, D1, R2, vectorize, service, AI, queue, and DO binding
they need — none of which are inherited (see the header comment in
`wrangler.jsonc` for the canonical reference to Cloudflare's binding
inheritance rules).

A bare `wrangler deploy` therefore silently **wipes every prod binding**,
leaving the worker live but broken — every `env.API_KEYS`, `env.DB`,
`env.SVC_*`, etc. becomes `undefined`, and every authed endpoint returns
`503 API_KEYS_BINDING_MISSING`. This caused 3 prod outages in 7 days
(#207 KV/D1/AI strip, 2026-06-03 05:18Z full wipe, 2026-06-03 05:22Z full wipe).

## What `scripts/safe-deploy.sh` does

1. **Refuses** to run without an explicit `staging | production` argument.
2. Runs `wrangler deploy --env <env>` with the correct config.
3. **Audits** the deployed bindings: fetches the live worker's binding list
   from the Cloudflare API and compares it against every binding declared
   in `wrangler.jsonc` under that env. Fails the deploy (exit 72) if
   anything declared is missing on the live worker — so a silently-wiped
   state cannot be reported as a successful deploy.

## Drift audit without deploying

```bash
scripts/audit-bindings.sh production
```

Same drift check, no deploy. Exits 72 if drift detected. Wire this into a
periodic GHA cron to catch out-of-band binding strips from any source.

## GitHub Actions

`.github/workflows/deploy.yml` is the only sanctioned automated deploy. It
uses `cloudflare/wrangler-action@v3` with `command: deploy --env production`
(correct). It currently fails because `CLOUDFLARE_API_TOKEN` lacks Secrets
Store scope (#215). Fixing that token eliminates manual deploys — and the
biggest source of binding-drift incidents — entirely.

## What NEVER to do

- `wrangler deploy` (bare) — strips all bindings. Now blocked by safe-deploy.
- `wrangler versions upload` then promoting a non-prod version to live.
- `wrangler deploy --config wrangler.jsonc` without `--env` — same as bare.
- Editing bindings in the Cloudflare dashboard. Source of truth is
  `wrangler.jsonc`; dashboard edits get reverted on the next deploy.

## Incident recovery

Symptom: `curl https://connect.chitty.cc/api/v1/context/resolve` returns
`503 {"error":"Auth backend unavailable","code":"API_KEYS_BINDING_MISSING"}`.

Recover:

```bash
export CLOUDFLARE_API_TOKEN=...      # or op run --env-file=...
git checkout main && git pull
npm run deploy                       # safe-deploy.sh production
```

The audit step at the end will confirm bindings are restored or fail loud.

## Secrets

Secrets are managed via the canonical flow:

1. **1Password** (cold source of truth) →
2. **Cloudflare Secrets Store** (`default_secrets_store`, account-shared) →
3. Bound into the worker via `secrets_store_secrets` in `wrangler.jsonc`.

`.github/workflows/sync-1p-to-cf-secrets.yml` runs the 1P → CF Secrets sync.
Per-worker `wrangler secret put` is **discouraged** — prefer Secrets Store.

## Custom GPT / API consumers

After deploy, generate an API key:

```bash
node scripts/generate-api-key.js "My Custom GPT" 5000
```

Then point the consumer at `https://connect.chitty.cc/openapi.json` with
header auth `X-ChittyOS-API-Key`.
