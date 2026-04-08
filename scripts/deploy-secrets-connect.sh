#!/usr/bin/env bash
# deploy-secrets-connect.sh — Deploy secrets via 1Password Connect + wrangler
#
# Uses the local 1Password Connect server to fetch secrets,
# then pipes them to `wrangler secret put`.
#
# Vault IDs here are from the Connect server's perspective — they differ
# from the `op` CLI vault IDs because Connect uses its own vault grants.
#
# Usage:
#   ./scripts/deploy-secrets-connect.sh [--env production|staging|dev] [--dry-run]

set -euo pipefail

WRANGLER_ENV="production"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --env requires a value (production|staging|dev)"; exit 1
      fi
      WRANGLER_ENV="$2"
      if [[ ! "$WRANGLER_ENV" =~ ^(production|staging|dev)$ ]]; then
        echo "ERROR: Invalid environment '$WRANGLER_ENV'. Must be production, staging, or dev."; exit 1
      fi
      shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

CONNECT_HOST="${OP_CONNECT_HOST:-http://localhost:8080}"
CONNECT_TOKEN="${OP_CONNECT_TOKEN:-}"

if [[ -z "$CONNECT_TOKEN" ]]; then
  echo "ERROR: OP_CONNECT_TOKEN not set"; exit 1
fi

# Check dependencies
for cmd in python3 npx curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found in PATH"; exit 1
  fi
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

VAULT_CORE="oxwo63jlcbo66c7kwx67lquw4i"    # ChittyOS-Core (Connect grant)
VAULT_SERVICES="pdn5ncm6ozne24gjsrl6sy3ju4" # ChittyOS (Connect grant)

echo "=========================================="
echo " ChittyConnect Secret Deployment (Connect)"
echo " Target: $WRANGLER_ENV"
echo "=========================================="
echo ""

# Preflight: verify Connect server is reachable and token is valid
echo -n "Checking 1Password Connect... "
if ! curl -s --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer ${CONNECT_TOKEN}" \
  "${CONNECT_HOST}/v1/vaults" >/dev/null 2>&1; then
  echo -e "${RED}FAILED${NC}"
  echo "ERROR: Cannot reach 1Password Connect at ${CONNECT_HOST}"
  echo "Verify OP_CONNECT_HOST and OP_CONNECT_TOKEN"
  exit 1
fi
echo -e "${GREEN}OK${NC}"
echo ""

# Fetch a field value from 1Password Connect.
# Returns: 0 = success (value on stdout), 1 = field not found, 2 = infrastructure error
fetch_field() {
  local vault_id="$1" item_id="$2" field_label="$3"
  local http_code body

  # Fetch item with explicit timeout; capture HTTP status
  body=$(curl -s --connect-timeout 5 --max-time 15 \
    -w '\n%{http_code}' \
    -H "Authorization: Bearer ${CONNECT_TOKEN}" \
    "${CONNECT_HOST}/v1/vaults/${vault_id}/items/${item_id}") || {
    echo "ERROR: curl failed for item $item_id" >&2
    return 2
  }

  http_code=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')

  if [[ "$http_code" -ge 400 ]]; then
    echo "ERROR: 1Password Connect returned HTTP $http_code for item $item_id" >&2
    return 2
  fi

  echo "$body" | python3 -c "
import sys, json
item = json.load(sys.stdin)
for f in item.get('fields', []):
    if f.get('label') == sys.argv[1] and f.get('value'):
        print(f['value'], end='')
        sys.exit(0)
sys.exit(1)
" "$field_label" 2>&1 || return 1
}

DEPLOYED=0; FAILED=0; SKIPPED=0; NOT_IN_VAULT=0

deploy_secret() {
  local secret_name="$1" vault_id="$2" item_id="$3" field_label="$4"
  echo -n "  $secret_name ... "

  local value exit_code=0
  value=$(fetch_field "$vault_id" "$item_id" "$field_label") || exit_code=$?

  if [[ $exit_code -eq 2 ]]; then
    echo -e "${RED}CONNECT ERROR${NC}"
    FAILED=$((FAILED + 1))
    return
  elif [[ $exit_code -ne 0 ]] || [[ -z "$value" ]]; then
    echo -e "${RED}NOT IN VAULT${NC} ($field_label)"
    FAILED=$((FAILED + 1))
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN${NC} (found, ${#value} chars)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  # Deploy: suppress stdout chatter but preserve stderr for diagnostics
  if printf '%s' "$value" | npx wrangler secret put "$secret_name" --env "$WRANGLER_ENV" >/dev/null; then
    echo -e "${GREEN}DEPLOYED${NC}"
    DEPLOYED=$((DEPLOYED + 1))
  else
    echo -e "${RED}WRANGLER FAILED${NC}"
    FAILED=$((FAILED + 1))
  fi
}

# === Secrets with verified 1Password Connect mappings ===

# Service tokens (ChittyOS-Core vault)
deploy_secret "CHITTY_ID_TOKEN"         "$VAULT_CORE" "in62ym7ojib2t3fomxwmqrkwwq" "password"
deploy_secret "CHITTY_ID_SERVICE_TOKEN" "$VAULT_CORE" "in62ym7ojib2t3fomxwmqrkwwq" "password"

# Encryption key (ChittyAuth Setup in Core vault)
deploy_secret "ENCRYPTION_KEY"          "$VAULT_CORE" "cbntnzm43dtolsz3cpfubst65u" "encryption_key"

# CHITTY_AUTH_SERVICE_TOKEN → used as CHITTYCONNECT_SERVICE_TOKEN fallback
deploy_secret "CHITTYCONNECT_SERVICE_TOKEN" "$VAULT_SERVICES" "h5nhajyt33pexhh5qswsznflba" "credential"

# Service tokens from ChittyOS vault
# TODO: These 5 share one 1Password item (sozaa...). Create per-service items
# to enable independent rotation and reduce blast radius on compromise.
deploy_secret "CHITTY_CERTIFY_TOKEN"    "$VAULT_SERVICES" "xfu6fpk4lvlmmd5lf2zv6vjvni" "credential"
deploy_secret "CHITTY_DNA_TOKEN"        "$VAULT_SERVICES" "agd7l6vbolyn4rtoxrafmst25u" "credential"
deploy_secret "CHITTY_VERIFY_TOKEN"     "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_SERV_TOKEN"       "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
deploy_secret "CHITTY_PROOF_TOKEN"      "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"
# CHITTY_TASK_TOKEN — auth token chittyconnect sends to tasks.chitty.cc (chittyagent-tasks)
# Source: CHITTY_API_GATEWAY_SERVICE_TOKEN (ChittyGateway API Token, item 6pnxym6ke46wote7qwexaakni4)
# NOTE: the chittyconnect-prod item (sozaaemylfw3krabpyueqwmytq) credential field is empty.
# chittyagent-tasks validates against CHITTY_AUTH_SERVICE_TOKEN which was provisioned via
# set-worker-secret.yml using the GitHub repo secret CHITTY_API_GATEWAY_SERVICE_TOKEN.
# Until vault item 6pnxym6ke46wote7qwexaakni4 is populated, this line will fail. The secret
# is currently set directly in Cloudflare. To re-provision:
#   op read "op://ChittyOS/ChittyGateway API Token/credential" | \
#     wrangler secret put CHITTY_TASK_TOKEN --env production
deploy_secret "CHITTY_TASK_TOKEN"       "$VAULT_SERVICES" "6pnxym6ke46wote7qwexaakni4" "credential"
deploy_secret "CHITTY_TRUST_TOKEN"      "$VAULT_SERVICES" "sozaaemylfw3krabpyueqwmytq" "credential"

# GitHub App ID — from GitHub App PK item (Core vault)
deploy_secret "GITHUB_APP_ID"           "$VAULT_CORE" "amu6qerkers5yf6u6zoy4r2ktu" "app_id"

# Neon fields — from ChittyChain DB item (limited fields available)
deploy_secret "NEON_PROJECT_ID"         "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "project_id"
deploy_secret "NEON_BRANCH_ID"          "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "branch_id"
deploy_secret "NEON_HOST"               "$VAULT_CORE" "r6tbr6654tipqp72pnlaxvwrs4" "host"

# Third-party integrations
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
echo " Results: $DEPLOYED deployed, $FAILED failed, $SKIPPED dry-run, $NOT_IN_VAULT inaccessible"
echo "=========================================="

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
