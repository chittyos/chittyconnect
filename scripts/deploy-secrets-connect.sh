#!/usr/bin/env bash
# deploy-secrets-connect.sh — Deploy secrets via 1Password Connect + wrangler
#
# Uses the local 1Password Connect server (localhost:8080) to fetch secrets,
# then pipes them to `wrangler secret put`.
#
# Usage:
#   ./scripts/deploy-secrets-connect.sh [--env production|staging|dev] [--dry-run]

set -euo pipefail

WRANGLER_ENV="production"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) WRANGLER_ENV="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

CONNECT_HOST="${OP_CONNECT_HOST:-http://localhost:8080}"
CONNECT_TOKEN="${OP_CONNECT_TOKEN}"

if [[ -z "$CONNECT_TOKEN" ]]; then
  echo "ERROR: OP_CONNECT_TOKEN not set"; exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

VAULT_CORE="oxwo63jlcbo66c7kwx67lquw4i"    # ChittyOS-Core
VAULT_SERVICES="pdn5ncm6ozne24gjsrl6sy3ju4" # ChittyOS

echo "=========================================="
echo " ChittyConnect Secret Deployment (Connect)"
echo " Target: $WRANGLER_ENV"
echo "=========================================="
echo ""

# Fetch a field value from 1Password Connect
fetch_field() {
  local vault_id="$1" item_id="$2" field_label="$3"
  curl -sf \
    -H "Authorization: Bearer ${CONNECT_TOKEN}" \
    "${CONNECT_HOST}/v1/vaults/${vault_id}/items/${item_id}" \
    | python3 -c "
import sys, json
item = json.load(sys.stdin)
for f in item.get('fields', []):
    if f.get('label') == sys.argv[1] and f.get('value'):
        print(f['value'], end='')
        sys.exit(0)
sys.exit(1)
" "$field_label" 2>/dev/null
}

DEPLOYED=0; FAILED=0; SKIPPED=0; NOT_IN_VAULT=0

deploy_secret() {
  local secret_name="$1" vault_id="$2" item_id="$3" field_label="$4"
  echo -n "  $secret_name ... "

  if [[ "$DRY_RUN" == "true" ]]; then
    # Verify the value exists even in dry-run
    local value
    value=$(fetch_field "$vault_id" "$item_id" "$field_label") || true
    if [[ -z "$value" ]]; then
      echo -e "${RED}NOT IN VAULT${NC} ($field_label)"
      FAILED=$((FAILED + 1))
    else
      echo -e "${YELLOW}DRY RUN${NC} (found, ${#value} chars)"
      SKIPPED=$((SKIPPED + 1))
    fi
    return
  fi

  local value
  value=$(fetch_field "$vault_id" "$item_id" "$field_label") || true
  if [[ -z "$value" ]]; then
    echo -e "${RED}NOT IN VAULT${NC}"
    FAILED=$((FAILED + 1))
    return
  fi

  printf '%s' "$value" | npx wrangler secret put "$secret_name" --env "$WRANGLER_ENV" 2>/dev/null
  echo -e "${GREEN}DEPLOYED${NC}"
  DEPLOYED=$((DEPLOYED + 1))
}

# === Secrets with verified 1Password Connect mappings ===

# Service tokens (ChittyOS-Core vault)
deploy_secret "CHITTY_ID_TOKEN"         "$VAULT_CORE" "in62ym7ojib2t3fomxwmqrkwwq" "password"
deploy_secret "CHITTY_ID_SERVICE_TOKEN" "$VAULT_CORE" "in62ym7ojib2t3fomxwmqrkwwq" "password"

# Encryption key (ChittyAuth Setup in Core vault)
deploy_secret "ENCRYPTION_KEY"          "$VAULT_CORE" "cbntnzm43dtolsz3cpfubst65u" "encryption_key"

# CHITTY_AUTH_SERVICE_TOKEN → used as CHITTYCONNECT_SERVICE_TOKEN fallback
deploy_secret "CHITTYCONNECT_SERVICE_TOKEN" "$VAULT_SERVICES" "h5nhajyt33pexhh5qswsznflba" "credential"

# Service tokens from ChittyOS vault (many are empty stubs — will report failures)
deploy_secret "CHITTY_CERTIFY_TOKEN"    "$VAULT_SERVICES" "xfu6fpk4lvlmmd5lf2zv6vjvni" "credential"
deploy_secret "CHITTY_DNA_TOKEN"        "$VAULT_SERVICES" "agd7l6vbolyn4rtoxrafmst25u" "credential"
deploy_secret "CHITTY_VERIFY_TOKEN"     "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_SERV_TOKEN"       "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_PROOF_TOKEN"      "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_TASK_TOKEN"       "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_TRUST_TOKEN"      "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"

# GitHub App ID — from GitHub App PK item (Core vault)
deploy_secret "GITHUB_APP_ID"           "$VAULT_CORE" "amu6qerkers5yf6u6zoy4r2ktu" "app_id"

# Neon fields — from ChittyChain DB item (limited fields available)
deploy_secret "NEON_PROJECT_ID"         "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "project_id"
deploy_secret "NEON_BRANCH_ID"          "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "branch_id"
deploy_secret "NEON_HOST"               "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "host"

# Third-party integrations (not in accessible vaults — will fail)
deploy_secret "OLLAMA_CF_CLIENT_ID"     "$VAULT_CORE" "bb3gyeypuwv6kbiqtsl3qfqvqi" "client_id"
deploy_secret "OLLAMA_CF_CLIENT_SECRET" "$VAULT_CORE" "bb3gyeypuwv6kbiqtsl3qfqvqi" "client_secret"
deploy_secret "GDRIVE_CLIENT_ID"        "$VAULT_CORE" "tequr4m2sznmmonedzeatg2s2m" "client_id"
deploy_secret "GDRIVE_CLIENT_SECRET"    "$VAULT_CORE" "tequr4m2sznmmonedzeatg2s2m" "client_secret"

# Webhook / emergency (Connect vault — ChittyConnect MCP Token)
deploy_secret "INTERNAL_WEBHOOK_SECRET" "$VAULT_CORE" "n2gxtnal4lnaueotgx3apeb7ua" "value"

# These require vaults not accessible via Connect:
echo ""
echo -e "  ${YELLOW}SKIPPED${NC} — Not in accessible vaults:"
for name in GOOGLE_ACCESS_TOKEN OP_EVENTS_API_TOKEN EMERGENCY_REVOKE_TOKEN; do
  echo "    - $name"
  NOT_IN_VAULT=$((NOT_IN_VAULT + 1))
done

echo ""
echo "=========================================="
echo " Results: $DEPLOYED deployed, $FAILED not found, $SKIPPED dry-run, $NOT_IN_VAULT inaccessible"
echo "=========================================="
