#!/usr/bin/env bash
# safe-deploy.sh — the ONLY sanctioned deploy path for chittyconnect.
#
# Why this exists (issue #216 / repeated incidents):
#   Bare `wrangler deploy` (no --env) deploys the top-level wrangler.jsonc,
#   which intentionally has minimal bindings. That silently overwrites the
#   prod worker, stripping every binding declared in env.production
#   (API_KEYS KV, D1 DB, R2, vectorize, service bindings, AI, ...).
#   This has now caused prod outages on:
#     - 2026-05-XX (#207)  — KV/D1/AI stripped
#     - 2026-06-03 05:18Z  — full binding wipe, restored via 0a0c3f84
#     - 2026-06-03 05:22Z  — full binding wipe again, restored via 76bf64af
#
# This wrapper:
#   1. REFUSES if --env is missing (unsafe, would wipe bindings).
#   2. Runs `wrangler deploy` with the requested env.
#   3. Audits the deployed bindings against wrangler.jsonc and FAILS LOUD
#      if anything declared is missing on the live worker.
#
# Usage:
#   scripts/safe-deploy.sh production
#   scripts/safe-deploy.sh staging
#   npm run deploy            (which calls this script)
#
# Required env:
#   CLOUDFLARE_API_TOKEN  — for both wrangler and the post-deploy audit
#   CLOUDFLARE_ACCOUNT_ID — defaults to chittyconnect account if unset

set -euo pipefail

ENV="${1:-}"
if [ -z "$ENV" ]; then
  echo "::error::safe-deploy: missing environment argument" >&2
  echo "usage: $0 <staging|production>" >&2
  exit 64
fi

case "$ENV" in
  staging|production) ;;
  *)
    echo "::error::safe-deploy: invalid environment '$ENV' (must be staging or production)" >&2
    exit 64
    ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRANGLER_CFG="$REPO_ROOT/wrangler.jsonc"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-0bc21e3a5a9de1a4cc843be9c3e98121}"

if [ ! -f "$WRANGLER_CFG" ]; then
  echo "::error::safe-deploy: wrangler.jsonc not found at $WRANGLER_CFG" >&2
  exit 65
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "::error::safe-deploy: CLOUDFLARE_API_TOKEN is not set" >&2
  echo "  hint: 'op run --env-file=.env.op -- npm run deploy' or export the token" >&2
  exit 66
fi

WORKER_NAME="$(node -e "const fs=require('fs');const r=fs.readFileSync('$WRANGLER_CFG','utf8').replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').split('\\n').map(l=>l.replace(/^\\s*\\/\\/.*$/,'')).join('\\n');const m=r.match(/\"name\"\\s*:\\s*\"([^\"]+)\"/);console.log(m?m[1]:'')")"
if [ "$ENV" = "staging" ]; then
  DEPLOYED_NAME="${WORKER_NAME}-staging"
else
  DEPLOYED_NAME="$WORKER_NAME"
fi

echo "[safe-deploy] env=$ENV worker=$DEPLOYED_NAME"

# ── 1. Deploy with explicit --env ────────────────────────────────────────────
# CHITTYCONNECT_SAFE_DEPLOY=1 is required by wrangler.jsonc's build.command
# guard (#219). Without it, wrangler aborts before writing any binding.
echo "[safe-deploy] running: npx wrangler deploy --env $ENV"
CHITTYCONNECT_SAFE_DEPLOY=1 npx wrangler deploy --env "$ENV"

# ── 2. Audit declared vs attached bindings ───────────────────────────────────
echo "[safe-deploy] auditing bindings on live worker $DEPLOYED_NAME ..."

# Extract declared binding NAMES from wrangler.jsonc for this env.
# We parse top-level secrets_store_secrets (inherited) + env.<env>.* binding
# blocks. JSONC: strip // comments first.
DECLARED="$(node "$REPO_ROOT/scripts/lib/extract-declared-bindings.mjs" "$ENV")"

if [ -z "$DECLARED" ]; then
  echo "::error::safe-deploy: could not extract any declared bindings from wrangler.jsonc env.$ENV" >&2
  exit 70
fi

ATTACHED_JSON="$(
  curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$DEPLOYED_NAME/bindings"
)" || {
  echo "::error::safe-deploy: failed to fetch live bindings from CF API" >&2
  exit 71
}

ATTACHED="$(echo "$ATTACHED_JSON" | jq -r '.result[].name // empty' | sort -u)"

MISSING=""
while IFS= read -r name; do
  [ -z "$name" ] && continue
  if ! grep -qxF "$name" <<<"$ATTACHED"; then
    MISSING+="$name"$'\n'
  fi
done <<<"$DECLARED"

if [ -n "$MISSING" ]; then
  echo "::error::safe-deploy: BINDING DRIFT DETECTED on $DEPLOYED_NAME" >&2
  echo "  Declared in wrangler.jsonc (env.$ENV) but NOT attached to live worker:" >&2
  while IFS= read -r m; do [ -n "$m" ] && echo "  - $m" >&2; done <<<"$MISSING"
  echo "  This usually means a bare 'wrangler deploy' (no --env) was run somewhere." >&2
  echo "  See issue #216 for context." >&2
  exit 72
fi

DECLARED_COUNT="$(grep -c . <<<"$DECLARED" || true)"
ATTACHED_COUNT="$(grep -c . <<<"$ATTACHED" || true)"
echo "[safe-deploy] OK — $DECLARED_COUNT declared bindings all present (live worker has $ATTACHED_COUNT total)"
