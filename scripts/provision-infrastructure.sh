#!/bin/bash

#############################################
# ChittyConnect Infrastructure Provisioning
#############################################
#
# This script provisions all required Cloudflare resources:
# - KV Namespaces (5)
# - D1 Databases (2: production + staging)
# - Queues (3)
#
# Prerequisites:
# - Cloudflare account
# - wrangler CLI installed (npm install -g wrangler)
# - Authenticated (wrangler login)
#
# Usage:
#   ./scripts/provision-infrastructure.sh [production|staging|all]
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment selection
ENV=${1:-all}

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ChittyConnect Infrastructure Provisioning    ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}Error: wrangler CLI not found${NC}"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

# Check if authenticated
if ! wrangler whoami &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with Cloudflare${NC}"
    echo "Run: wrangler login"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo ""

#############################################
# Function: Create KV Namespace
#############################################
create_kv_namespace() {
    local name=$1
    local env_flag=$2

    echo -e "${YELLOW}Creating KV namespace: ${name}${NC}"

    if [ -z "$env_flag" ]; then
        # Production
        output=$(npx wrangler kv:namespace create "$name" 2>&1)
    else
        # Staging
        output=$(npx wrangler kv:namespace create "$name" --env staging 2>&1)
    fi

    # Extract ID from output
    id=$(echo "$output" | grep -oP 'id = "\K[^"]+' || echo "")

    if [ -z "$id" ]; then
        echo -e "${RED}✗ Failed to create $name${NC}"
        echo "$output"
        return 1
    fi

    echo -e "${GREEN}✓ Created: $name${NC}"
    echo "  ID: $id"
    echo "$name=$id" >> .env.infrastructure
    echo ""
}

#############################################
# Function: Create D1 Database
#############################################
create_d1_database() {
    local name=$1
    local env_flag=$2

    echo -e "${YELLOW}Creating D1 database: ${name}${NC}"

    if [ -z "$env_flag" ]; then
        # Production
        output=$(npx wrangler d1 create "$name" 2>&1)
    else
        # Staging
        output=$(npx wrangler d1 create "$name" 2>&1)
    fi

    # Extract ID
    id=$(echo "$output" | grep -oP 'database_id = "\K[^"]+' || echo "")

    if [ -z "$id" ]; then
        echo -e "${RED}✗ Failed to create $name${NC}"
        echo "$output"
        return 1
    fi

    echo -e "${GREEN}✓ Created: $name${NC}"
    echo "  ID: $id"
    echo "${name}_ID=$id" >> .env.infrastructure
    echo ""
}

#############################################
# Function: Create Queue
#############################################
create_queue() {
    local name=$1

    echo -e "${YELLOW}Creating Queue: ${name}${NC}"

    output=$(npx wrangler queues create "$name" 2>&1)

    if echo "$output" | grep -q "Created queue"; then
        echo -e "${GREEN}✓ Created: $name${NC}"
        echo ""
    else
        echo -e "${RED}✗ Failed to create $name${NC}"
        echo "$output"
        return 1
    fi
}

#############################################
# Production Infrastructure
#############################################
provision_production() {
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo -e "${BLUE}  Provisioning PRODUCTION Resources  ${NC}"
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo ""

    # Clear previous infrastructure file
    > .env.infrastructure

    # KV Namespaces
    echo -e "${YELLOW}[1/5] Creating KV Namespaces...${NC}"
    echo ""
    create_kv_namespace "CHITTYCONNECT_KV"
    create_kv_namespace "TOKEN_KV"
    create_kv_namespace "API_KEYS"
    create_kv_namespace "RATE_LIMIT"
    create_kv_namespace "IDEMP_KV"

    # D1 Database
    echo -e "${YELLOW}[2/5] Creating D1 Database...${NC}"
    echo ""
    create_d1_database "chittyconnect"

    # Queues
    echo -e "${YELLOW}[3/5] Creating Queues...${NC}"
    echo ""
    create_queue "chittyconnect-context-ops"
    create_queue "chittyconnect-github-events"
    create_queue "chittyconnect-dlq"

    # Run migrations
    echo -e "${YELLOW}[4/5] Running Database Migrations...${NC}"
    echo ""
    run_migrations "production"

    echo -e "${YELLOW}[5/5] Updating wrangler.toml...${NC}"
    echo ""
    update_wrangler_config "production"

    echo -e "${GREEN}════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ Production infrastructure complete${NC}"
    echo -e "${GREEN}════════════════════════════════════${NC}"
}

#############################################
# Staging Infrastructure
#############################################
provision_staging() {
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo -e "${BLUE}  Provisioning STAGING Resources     ${NC}"
    echo -e "${BLUE}════════════════════════════════════${NC}"
    echo ""

    # KV Namespaces (staging)
    echo -e "${YELLOW}[1/3] Creating Staging KV Namespaces...${NC}"
    echo ""
    create_kv_namespace "CHITTYCONNECT_KV" "staging"
    create_kv_namespace "TOKEN_KV" "staging"
    create_kv_namespace "API_KEYS" "staging"
    create_kv_namespace "RATE_LIMIT" "staging"
    create_kv_namespace "IDEMP_KV" "staging"

    # D1 Database (staging)
    echo -e "${YELLOW}[2/3] Creating Staging D1 Database...${NC}"
    echo ""
    create_d1_database "chittyconnect-staging" "staging"

    # Run migrations
    echo -e "${YELLOW}[3/3] Running Staging Database Migrations...${NC}"
    echo ""
    run_migrations "staging"

    echo -e "${GREEN}════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ Staging infrastructure complete${NC}"
    echo -e "${GREEN}════════════════════════════════════${NC}"
}

#############################################
# Run Database Migrations
#############################################
run_migrations() {
    local env=$1

    echo "Running migrations for $env..."

    if [ "$env" = "production" ]; then
        cat migrations/*.sql | npx wrangler d1 execute chittyconnect --command=-
    else
        cat migrations/*.sql | npx wrangler d1 execute chittyconnect-staging --env staging --command=-
    fi

    echo -e "${GREEN}✓ Migrations complete${NC}"
    echo ""
}

#############################################
# Update wrangler.toml with IDs
#############################################
update_wrangler_config() {
    local env=$1

    echo "Updating wrangler.toml with provisioned resource IDs..."
    echo ""
    echo -e "${YELLOW}MANUAL STEP REQUIRED:${NC}"
    echo "Update wrangler.toml with the IDs from .env.infrastructure"
    echo ""
    echo "Resource IDs have been saved to: .env.infrastructure"
    echo "Copy these IDs into wrangler.toml replacing PLACEHOLDER values"
    echo ""
}

#############################################
# Main Execution
#############################################

case $ENV in
    production)
        provision_production
        ;;
    staging)
        provision_staging
        ;;
    all)
        provision_production
        echo ""
        provision_staging
        ;;
    *)
        echo -e "${RED}Invalid environment: $ENV${NC}"
        echo "Usage: $0 [production|staging|all]"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}════════════════════════════════════${NC}"
echo -e "${BLUE}  Next Steps                          ${NC}"
echo -e "${BLUE}════════════════════════════════════${NC}"
echo ""
echo "1. Review generated IDs in: .env.infrastructure"
echo "2. Update wrangler.toml with the IDs (replace PLACEHOLDER_* values)"
echo "3. Configure secrets: ./scripts/configure-secrets.sh"
echo "4. Deploy to staging: npm run deploy:staging"
echo "5. Test: curl https://connect-staging.chitty.cc/health"
echo ""
echo -e "${GREEN}Infrastructure provisioning complete!${NC}"
