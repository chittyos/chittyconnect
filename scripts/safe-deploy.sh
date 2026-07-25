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

# ── 1. Deploy with explicit --env and explicit --config ──────────────────────
# CHITTYCONNECT_SAFE_DEPLOY=1 is required by wrangler.jsonc's build.command
# guard (#219). Without it, wrangler aborts before writing any binding.
#
# --config is REQUIRED, not cosmetic. Wrangler's config discovery prefers
# `wrangler.json` over `wrangler.jsonc` and walks up parent directories. A
# stray untracked `wrangler.json` at the repo root (it is gitignored, so it
# never appears in CI) silently shadowed the tracked config: this script
# audited wrangler.jsonc while deploying whatever wrangler happened to find.
# Pinning --config makes the tracked, code-reviewed file authoritative for
# every deploy path — repo root, git worktrees, and CI alike.
echo "[safe-deploy] running: npx wrangler deploy --env $ENV --config $WRANGLER_CFG"
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT
set +e
CHITTYCONNECT_SAFE_DEPLOY=1 npx wrangler deploy --env "$ENV" --config "$WRANGLER_CFG" 2>&1 | tee "$DEPLOY_LOG"
WRANGLER_RC="${PIPESTATUS[0]}"
set -e

# ── 1a. Detect a CI-side Worker name override ────────────────────────────────
# Cloudflare Workers Builds IGNORES the name in wrangler.jsonc and forces the
# name of the script its build trigger is bound to. It prints a warning and
# then deploys anyway:
#
#   ▲ [WARNING] Failed to match Worker name. Your config file is using the
#     Worker name "chittyconnect-staging", but the CI system expected
#     "chittyconnect". Overriding using the CI provided Worker name.
#
# On 2026-07-25 that override put the *staging* var set onto the *production*
# script, because both build triggers were bound to the same script id. Nothing
# in this script noticed: the audit below checks the name we COMPUTED, not the
# name wrangler actually shipped to. Fail loud so a clobber is diagnosed in the
# build that caused it rather than discovered later in prod.
if grep -q "Failed to match Worker name" "$DEPLOY_LOG"; then
  echo "::error::safe-deploy: CI overrode the Worker name. This deploy may have written env.$ENV config onto a DIFFERENT worker than intended." >&2
  echo "  Expected to deploy: $DEPLOYED_NAME" >&2
  grep -m1 "but the CI system expected" "$DEPLOY_LOG" >&2 || true
  echo "  Fix the Workers Builds trigger so it is bound to a script named '$DEPLOYED_NAME', then redeploy." >&2
  echo "  If this ran against production, restore it before doing anything else." >&2
  exit 72
fi

# Cross-check the name wrangler reported uploading against the one we intended.
UPLOADED_NAME="$(sed -n 's/^Uploaded \([A-Za-z0-9_-]*\).*/\1/p' "$DEPLOY_LOG" | head -1)"
if [ -n "$UPLOADED_NAME" ] && [ "$UPLOADED_NAME" != "$DEPLOYED_NAME" ]; then
  echo "::error::safe-deploy: wrangler uploaded '$UPLOADED_NAME' but this script targeted '$DEPLOYED_NAME'" >&2
  exit 72
fi

if [ "$WRANGLER_RC" -ne 0 ]; then
  echo "::error::safe-deploy: wrangler deploy failed (exit $WRANGLER_RC)" >&2
  exit "$WRANGLER_RC"
fi

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

# Audit the SCRIPT, not a service environment. The old path here was
#   /workers/services/$WORKER_NAME/environments/$ENV/bindings
# which only resolves for a grandfathered service environment — it 404s for any
# real top-level worker (that 404 is what failed build fe9061f3). Now that
# staging is its own script rather than a service environment, the script-scoped
# settings endpoint is the only one that works for both envs.
ATTACHED_JSON="$(
  curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$DEPLOYED_NAME/settings"
)" || {
  echo "::error::safe-deploy: failed to fetch live bindings for script '$DEPLOYED_NAME' from CF API" >&2
  echo "  If this is the first deploy of a new worker, confirm the script exists and the token can read it." >&2
  exit 71
}

ATTACHED="$(echo "$ATTACHED_JSON" | jq -r '.result.bindings[].name // empty' | sort -u)"

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
