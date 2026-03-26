#!/usr/bin/env bash
# deploy-missing-secrets.sh — Deploy secrets documented in manifest but not yet in Cloudflare
#
# Usage:
#   ./scripts/deploy-missing-secrets.sh [--env production|staging|dev] [--dry-run]
#
# Source of truth: 1Password vaults → Cloudflare Secrets (hot runtime delivery)
# Each secret must exist in 1Password BEFORE running this script.
#
# Prerequisites:
#   - `op` CLI authenticated (eval $(op signin))
#   - `wrangler` authenticated (npx wrangler whoami)

set -euo pipefail

# Parse arguments
WRANGLER_ENV="production"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) WRANGLER_ENV="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; echo "Usage: $0 [--env production|staging|dev] [--dry-run]"; exit 1 ;;
  esac
done

ENV="--env $WRANGLER_ENV"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1Password vault references
VAULT_INFRA="oxwo63jlcbo66c7kwx67lquw4i"       # ChittyOS-Core
VAULT_SERVICES="xgevq7nkt6t4bfokjaczht5gdy"     # ChittyOS-Deployment
VAULT_INTEGRATIONS="3ngilqu4qsp4mlr53xhvyi4sry" # ChittyOS-Integrations
VAULT_EMERGENCY="shl646vf4snnrkx6linyk3yis4"    # ChittyConnect Only

echo "=========================================="
echo " ChittyConnect Secret Deployment"
echo " Target: $WRANGLER_ENV"
echo "=========================================="
echo ""

# Secrets that are in the manifest AND used in code but NOT deployed
# Format: SECRET_NAME|OP_VAULT|OP_ITEM|OP_FIELD (pipe-delimited)
MISSING_SECRETS=(
  # GitHub Integration
  "GITHUB_APP_ID|$VAULT_INTEGRATIONS|github-app|app_id"

  # ChittyOS Service Tokens (used in code, not deployed)
  "CHITTY_ID_TOKEN|$VAULT_SERVICES|chittyid|service_token"
  "CHITTYCONNECT_SERVICE_TOKEN|$VAULT_SERVICES|chittyconnect|service_token"
  "CHITTY_CERTIFY_TOKEN|$VAULT_SERVICES|chittycertify|service_token"
  "CHITTY_DNA_TOKEN|$VAULT_SERVICES|chittydna|service_token"
  "CHITTY_VERIFY_TOKEN|$VAULT_SERVICES|chittyverify|service_token"
  "CHITTY_SERV_TOKEN|$VAULT_SERVICES|chittyserv|service_token"
  "CHITTY_PROOF_TOKEN|$VAULT_SERVICES|chittyproof|service_token"
  "CHITTY_TASK_TOKEN|$VAULT_SERVICES|chittytask|service_token"
  "CHITTY_TRUST_TOKEN|$VAULT_SERVICES|chittytrust|service_token"

  # Third-Party Integrations
  "OLLAMA_CF_CLIENT_ID|$VAULT_INTEGRATIONS|ollama-cf-access|client_id"
  "OLLAMA_CF_CLIENT_SECRET|$VAULT_INTEGRATIONS|ollama-cf-access|client_secret"
  "GDRIVE_CLIENT_ID|$VAULT_INTEGRATIONS|google-drive|client_id"
  "GDRIVE_CLIENT_SECRET|$VAULT_INTEGRATIONS|google-drive|client_secret"

  # Neon (secret rotation service)
  "NEON_PROJECT_ID|$VAULT_INFRA|neon|project_id"
  "NEON_BRANCH_ID|$VAULT_INFRA|neon|branch_id"
  "NEON_HOST|$VAULT_INFRA|neon|host"

  # Credential Provisioning & Emergency
  # Note: CHITTYOS_ACCOUNT_ID is a wrangler var, not a secret — no deployment needed
  "ENCRYPTION_KEY|$VAULT_EMERGENCY|encryption|key"
  "INTERNAL_WEBHOOK_SECRET|$VAULT_EMERGENCY|internal-webhook|secret"
  "OP_EVENTS_API_TOKEN|$VAULT_EMERGENCY|1password-events|api_token"
  "EMERGENCY_REVOKE_TOKEN|$VAULT_EMERGENCY|emergency-revoke|token"

  # Google Integration
  "GOOGLE_ACCESS_TOKEN|$VAULT_INTEGRATIONS|google-drive|access_token"
)

DEPLOYED=0
FAILED=0
SKIPPED=0

for entry in "${MISSING_SECRETS[@]}"; do
  IFS='|' read -r SECRET_NAME VAULT ITEM FIELD <<< "$entry"

  echo -n "  $SECRET_NAME ... "

  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}DRY RUN${NC} (would fetch op://$VAULT/$ITEM/$FIELD)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Fetch from 1Password
  VALUE=$(op item get "$ITEM" --vault "$VAULT" --fields "$FIELD" 2>/dev/null) || true

  if [[ -z "$VALUE" ]]; then
    echo -e "${RED}MISSING in 1Password${NC} (op://$VAULT/$ITEM/$FIELD)"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Deploy to Cloudflare (printf avoids secret appearing in /proc/*/cmdline unlike echo)
  printf '%s' "$VALUE" | npx wrangler secret put "$SECRET_NAME" $ENV 2>/dev/null
  echo -e "${GREEN}DEPLOYED${NC}"
  DEPLOYED=$((DEPLOYED + 1))
done

echo ""
echo "=========================================="
echo " Results: $DEPLOYED deployed, $FAILED missing in 1P, $SKIPPED skipped"
echo "=========================================="

# Also remove TWILIO_PHONE_NUMBER from secrets (it's a var, not a secret)
echo ""
echo "NOTE: TWILIO_PHONE_NUMBER is deployed as a secret but should be a var."
echo "      It's already declared in wrangler vars for all 3 envs."
echo "      To remove the secret: npx wrangler secret delete TWILIO_PHONE_NUMBER $ENV"
