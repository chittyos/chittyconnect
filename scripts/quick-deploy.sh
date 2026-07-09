#!/bin/bash
# Quick Deploy Script for ChittyConnect

set -e

echo "🚀 ChittyConnect Quick Deploy"
echo "=============================="
echo ""

# Check prerequisites
command -v wrangler >/dev/null 2>&1 || { echo "❌ wrangler not installed. Run: npm install -g wrangler"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "❌ jq not installed. Run: brew install jq"; exit 1; }

# Determine environment
ENV=${1:-staging}

if [ "$ENV" != "staging" ] && [ "$ENV" != "production" ]; then
    echo "❌ Invalid environment. Use: staging or production"
    exit 1
fi

echo "📦 Environment: $ENV"
echo ""

# Validate files
echo "🔍 Validating files..."
required_files=(
    "wrangler.toml"
    "package.json"
    "src/index.js"
    "public/openapi.json"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing required file: $file"
        exit 1
    fi
    echo "  ✅ $file"
done

# Validate OpenAPI spec
echo ""
echo "🔍 Validating OpenAPI spec..."
if ! jq empty public/openapi.json 2>/dev/null; then
    echo "❌ Invalid JSON in openapi.json"
    exit 1
fi
echo "  ✅ OpenAPI spec is valid"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm ci --quiet

# Deploy
echo ""
echo "🚀 Deploying to $ENV..."
if [ "$ENV" = "production" ]; then
    echo "⚠️  DEPLOYING TO PRODUCTION"
    echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
    sleep 5
fi

wrangler deploy --env $ENV

# Health check
echo ""
echo "🏥 Running health checks..."
sleep 5

if [ "$ENV" = "production" ]; then
    URL="https://connect.chitty.cc"
else
    URL="https://chittyconnect-staging.chitty.workers.dev"
fi

echo "  Testing: $URL/health"
if curl -f -s "$URL/health" > /dev/null; then
    echo "  ✅ Health check passed"
else
    echo "  ❌ Health check failed"
    exit 1
fi

echo ""
echo "  Testing: $URL/openapi.json"
if curl -f -s "$URL/openapi.json" > /dev/null; then
    echo "  ✅ OpenAPI endpoint accessible"
else
    echo "  ⚠️  OpenAPI endpoint check failed"
fi

echo ""
echo "  Testing: $URL/mcp/manifest"
if curl -f -s "$URL/mcp/manifest" > /dev/null; then
    echo "  ✅ MCP endpoint accessible"
else
    echo "  ⚠️  MCP endpoint check failed"
fi

# Success
echo ""
echo "=========================================="
echo "✅ Deployment successful!"
echo ""
echo "🔗 URLs:"
echo "  Main: $URL"
echo "  Health: $URL/health"
echo "  OpenAPI: $URL/openapi.json"
echo "  MCP: $URL/mcp/manifest"
echo ""

if [ "$ENV" = "production" ]; then
    echo "📝 Next steps:"
    echo "  1. Generate API key: node scripts/generate-api-key.js"
    echo "  2. Configure custom GPT with OpenAPI spec"
    echo "  3. Monitor at: https://dash.cloudflare.com/workers"
fi

echo ""
echo "✨ It's Chitty - Model Agnostic & CloudeConscious"
