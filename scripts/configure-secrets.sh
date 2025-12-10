#!/bin/bash

#############################################
# ChittyConnect Secrets Configuration
#############################################
#
# This script sets all required secrets for ChittyConnect
#
# Prerequisites:
# - wrangler CLI authenticated
# - Infrastructure provisioned
#
# Usage:
#   ./scripts/configure-secrets.sh [production|staging|all]
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENV=${1:-production}

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ChittyConnect Secrets Configuration       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

#############################################
# Function: Set Secret
#############################################
set_secret() {
    local name=$1
    local description=$2
    local env_flag=$3

    echo -e "${YELLOW}Setting secret: ${name}${NC}"
    echo "Description: $description"
    echo ""

    if [ -z "$env_flag" ]; then
        # Production
        npx wrangler secret put "$name"
    else
        # Staging
        npx wrangler secret put "$name" --env staging
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Set: $name${NC}"
        echo ""
    else
        echo -e "${RED}✗ Failed to set: $name${NC}"
        echo ""
    fi
}

#############################################
# ChittyOS Service Tokens
#############################################
configure_chittyos_secrets() {
    local env_flag=$1

    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo -e "${BLUE}  ChittyOS Service Tokens            ${NC}"
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo ""

    set_secret "CHITTY_ID_SERVICE_TOKEN" \
        "Token for id.chitty.cc API (ChittyID minting)" \
        "$env_flag"

    set_secret "CHITTY_AUTH_SERVICE_TOKEN" \
        "Token for auth.chitty.cc API (Authentication)" \
        "$env_flag"

    set_secret "CHITTY_REGISTRY_TOKEN" \
        "Token for registry.chitty.cc API (Service discovery)" \
        "$env_flag"

    set_secret "CHITTY_DNA_TOKEN" \
        "Token for dna.chitty.cc API (Genetic tracking)" \
        "$env_flag"

    set_secret "CHITTY_CHRONICLE_TOKEN" \
        "Token for chronicle.chitty.cc API (Event logging)" \
        "$env_flag"

    set_secret "CHITTY_VERIFY_TOKEN" \
        "Token for verify.chitty.cc API (Verification)" \
        "$env_flag"

    set_secret "CHITTY_CERTIFY_TOKEN" \
        "Token for certify.chitty.cc API (Certification)" \
        "$env_flag"
}

#############################################
# GitHub App Secrets
#############################################
configure_github_secrets() {
    local env_flag=$1

    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo -e "${BLUE}  GitHub App Credentials             ${NC}"
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo ""

    set_secret "GITHUB_APP_ID" \
        "GitHub App ID (from app settings)" \
        "$env_flag"

    set_secret "GITHUB_APP_PRIVATE_KEY" \
        "GitHub App Private Key (RSA key, PEM format)" \
        "$env_flag"

    set_secret "GITHUB_WEBHOOK_SECRET" \
        "GitHub Webhook Secret (for HMAC verification)" \
        "$env_flag"
}

#############################################
# Optional Third-Party API Keys
#############################################
configure_optional_secrets() {
    local env_flag=$1

    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo -e "${BLUE}  Optional Third-Party API Keys      ${NC}"
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}These are optional for extended API features:${NC}"
    echo ""

    read -p "Configure OpenAI API key? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        set_secret "OPENAI_API_KEY" \
            "OpenAI API key for chat completions" \
            "$env_flag"
    fi

    read -p "Configure Notion API token? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        set_secret "NOTION_TOKEN" \
            "Notion API token for database access" \
            "$env_flag"
    fi

    read -p "Configure Google API key? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        set_secret "GOOGLE_API_KEY" \
            "Google API key for Calendar/etc" \
            "$env_flag"
    fi
}

#############################################
# Main Configuration
#############################################

case $ENV in
    production)
        echo -e "${GREEN}Configuring PRODUCTION secrets${NC}"
        echo ""
        configure_chittyos_secrets ""
        configure_github_secrets ""
        configure_optional_secrets ""
        ;;
    staging)
        echo -e "${GREEN}Configuring STAGING secrets${NC}"
        echo ""
        configure_chittyos_secrets "staging"
        configure_github_secrets "staging"
        configure_optional_secrets "staging"
        ;;
    all)
        echo -e "${GREEN}Configuring PRODUCTION secrets${NC}"
        echo ""
        configure_chittyos_secrets ""
        configure_github_secrets ""
        configure_optional_secrets ""

        echo ""
        echo -e "${GREEN}Configuring STAGING secrets${NC}"
        echo ""
        configure_chittyos_secrets "staging"
        configure_github_secrets "staging"
        configure_optional_secrets "staging"
        ;;
    *)
        echo -e "${RED}Invalid environment: $ENV${NC}"
        echo "Usage: $0 [production|staging|all]"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Secrets configuration complete${NC}"
echo -e "${GREEN}════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo "1. Verify secrets: npx wrangler secret list"
echo "2. Deploy: npm run deploy:staging"
echo ""
