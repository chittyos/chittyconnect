#!/usr/bin/env bash
# audit-bindings.sh — read-only audit of live worker bindings vs wrangler.jsonc.
# Same drift check as safe-deploy.sh but does NOT deploy. Suitable for CI cron.
#
# Usage:  scripts/audit-bindings.sh production
# Exits 0 if no drift, 72 if drift detected, 64-71 on usage/config errors.

set -euo pipefail

ENV="${1:-production}"
case "$ENV" in
  staging|production) ;;
  *) echo "::error::audit-bindings: invalid env '$ENV'" >&2; exit 64 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRANGLER_CFG="$REPO_ROOT/wrangler.jsonc"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-0bc21e3a5a9de1a4cc843be9c3e98121}"

[ -f "$WRANGLER_CFG" ] || { echo "::error::wrangler.jsonc missing" >&2; exit 65; }
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "::error::CLOUDFLARE_API_TOKEN unset" >&2; exit 66; }

WORKER_NAME="$(node -e "const fs=require('fs');const r=fs.readFileSync('$WRANGLER_CFG','utf8').replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').split('\\n').map(l=>l.replace(/^\\s*\\/\\/.*$/,'')).join('\\n');const m=r.match(/\"name\"\\s*:\\s*\"([^\"]+)\"/);console.log(m?m[1]:'')")"
[ "$ENV" = "staging" ] && DEPLOYED="${WORKER_NAME}-staging" || DEPLOYED="$WORKER_NAME"

DECLARED="$(node "$REPO_ROOT/scripts/lib/extract-declared-bindings.mjs" "$ENV")"

ATTACHED="$(
  curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/services/$WORKER_NAME/environments/$ENV/bindings" \
  | jq -r '.result[].name // empty' | sort -u
)" || { echo "::error::CF API binding fetch failed" >&2; exit 71; }

MISSING=""
while IFS= read -r n; do
  [ -z "$n" ] && continue
  grep -qxF "$n" <<<"$ATTACHED" || MISSING+="$n"$'\n'
done <<<"$DECLARED"

if [ -n "$MISSING" ]; then
  echo "::error::binding drift on $DEPLOYED:" >&2
  while IFS= read -r m; do [ -n "$m" ] && echo "  - $m" >&2; done <<<"$MISSING"
  exit 72
fi

echo "[audit-bindings] OK — all declared bindings present on $DEPLOYED"
