# ChittyConnect Setup Guide

**It's Chitty - Model Agnostic & CloudeConscious™**

Complete setup guide for connecting custom GPTs, Claude, and other AI models to ChittyOS.

## 🎯 Prerequisites

1. **Cloudflare Account**
   - Workers Paid plan (for AI binding)
   - Access to account: `bbf9fcd845e78035b7a135c481e88541`

2. **ChittyOS Access**
   - Service tokens for all ChittyOS services
   - Access to ChittyID service (id.chitty.cc)

3. **Development Tools**
   - Node.js 18+
   - Wrangler CLI 3.28+
   - Git

## 📦 Step 1: Initial Setup

```bash
# Navigate to project
cd /Users/nb/.claude/projects/-/CHITTYOS/chittyos-apps/chittyconnect

# Install dependencies
npm install

# Verify wrangler is authenticated
wrangler whoami
```

## 🗄️ Step 2: Create Infrastructure

### KV Namespaces

```bash
# Create production KV namespaces
wrangler kv:namespace create "IDEMP_KV" --env production
wrangler kv:namespace create "TOKEN_KV" --env production
wrangler kv:namespace create "API_KEYS" --env production
wrangler kv:namespace create "RATE_LIMIT" --env production

# Note the IDs returned and update wrangler.toml
```

### D1 Database

```bash
# Create database
wrangler d1 create chittyconnect-production

# Create tables
wrangler d1 execute chittyconnect-production --file=./schema.sql

# Note the database ID and update wrangler.toml
```

### Queue

```bash
# Create event queue
wrangler queues create github-events
```

## 🔐 Step 3: Configure Secrets

### ChittyOS Service Tokens

```bash
# Core services
wrangler secret put CHITTY_ID_TOKEN --env production
# Enter token from 1Password: mcp_auth_9b69455f5f799a73f16484eb268aea50

wrangler secret put CHITTY_AUTH_TOKEN --env production
wrangler secret put CHITTY_CASES_TOKEN --env production
wrangler secret put CHITTY_FINANCE_TOKEN --env production
wrangler secret put CHITTY_EVIDENCE_TOKEN --env production
wrangler secret put CHITTY_SYNC_TOKEN --env production
wrangler secret put CHITTY_CHRONICLE_TOKEN --env production
wrangler secret put CHITTY_CONTEXTUAL_TOKEN --env production
wrangler secret put CHITTY_REGISTRY_TOKEN --env production
```

### Third-Party API Keys

```bash
# Notion
wrangler secret put NOTION_TOKEN --env production
# Get from: https://www.notion.so/my-integrations

# OpenAI
wrangler secret put OPENAI_API_KEY --env production
# Get from: https://platform.openai.com/api-keys

# Google
wrangler secret put GOOGLE_ACCESS_TOKEN --env production
# Get from Google Cloud Console OAuth

# Neon
wrangler secret put NEON_DATABASE_URL --env production
# Format: postgresql://user:pass@host/db

# GitHub (optional)
wrangler secret put GITHUB_APP_ID --env production
wrangler secret put GITHUB_APP_PK --env production
wrangler secret put GITHUB_WEBHOOK_SECRET --env production
```

## 🚀 Step 4: Deploy

```bash
# Deploy to production
npm run deploy:production

# Verify deployment
curl https://itchitty.com/health
curl https://connect.chitty.cc/health
```

## 🔑 Step 5: Generate API Keys

```bash
# Generate API key for custom GPT
node scripts/generate-api-key.js "My Custom GPT" 5000

# Store in KV (use command from script output)
wrangler kv:key put --binding=API_KEYS --env production "key:chitty_XXX" '{...}'
```

## 🤖 Step 6: Configure Custom GPT

### OpenAI Custom GPT Setup

1. **Go to ChatGPT**
   - Visit https://chat.openai.com
   - Click "Explore GPTs" → "Create a GPT"

2. **Configure Actions**
   - Navigate to "Configure" → "Actions"
   - Click "Import from URL"
   - Enter: `https://itchitty.com/openapi.json`

3. **Set Authentication**
   - Authentication Type: "API Key"
   - API Key: Use generated key from Step 5
   - Auth Type: "Custom"
   - Custom Header Name: `X-ChittyOS-API-Key`

4. **Configure GPT Instructions**
   ```
   You are "It's Chitty" - an AI assistant with deep integration to the ChittyOS ecosystem.

   You have access to:
   - ChittyID: Universal identity system
   - ChittyCases: Legal case management
   - ChittyFinance: Banking and financial operations
   - ChittyEvidence: Evidence ingestion and analysis
   - ChittyContextual: ContextConsciousness™ analysis
   - ChittyChronicle: Event logging and timelines
   - ChittySync: Data synchronization
   - Third-party integrations: Notion, Neon, OpenAI, Google

   You are model agnostic and CloudeConscious™ - you understand context across
   services and maintain awareness of the entire ChittyOS ecosystem.
   ```

5. **Test Actions**
   ```
   "Check the health of all ChittyOS services"
   "Mint a new ChittyID for a PLACE entity"
   "Create an eviction case"
   "Analyze this legal document with ContextConsciousness"
   ```

## 🧩 Step 7: Configure Claude Code MCP

### Option A: HTTP Transport

Add to `~/.config/claude/mcp_settings.json`:

```json
{
  "mcpServers": {
    "chittyconnect": {
      "transport": {
        "type": "http",
        "url": "https://itchitty.com/mcp",
        "headers": {
          "X-ChittyOS-API-Key": "your-api-key-here"
        }
      }
    }
  }
}
```

### Option B: stdio Transport (local development)

```json
{
  "mcpServers": {
    "chittyconnect": {
      "command": "wrangler",
      "args": ["dev", "--local"],
      "cwd": "/Users/nb/.claude/projects/-/CHITTYOS/chittyos-apps/chittyconnect"
    }
  }
}
```

### Test MCP Integration

In Claude Code:
```
Use chittyid_mint to create a new ChittyID
Check chitty://services/status resource
Use chitty_contextual_analyze on this text
```

## 🌐 Step 8: DNS Configuration

### Primary Domain (itchitty.com)

```bash
# Add to Cloudflare DNS
A    itchitty.com    192.0.2.1    Proxied
AAAA itchitty.com    2606:4700::1 Proxied
```

### Alternative Domain (connect.chitty.cc)

Already configured in wrangler.toml:
```toml
[[env.production.routes]]
pattern = "connect.chitty.cc/*"
zone_name = "chitty.cc"
```

## 🧪 Step 9: Testing

### Health Checks

```bash
# Main health
curl https://itchitty.com/health

# API health
curl https://itchitty.com/api/health \
  -H "X-ChittyOS-API-Key: your-key"

# MCP manifest
curl https://itchitty.com/mcp/manifest
```

### API Tests

```bash
# Mint ChittyID
curl -X POST https://itchitty.com/api/chittyid/mint \
  -H "X-ChittyOS-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"entity": "PLACE", "metadata": {"name": "Test Location"}}'

# Check services
curl https://itchitty.com/api/services/status \
  -H "X-ChittyOS-API-Key: your-key"

# Contextual analysis
curl -X POST https://itchitty.com/api/chittycontextual/analyze \
  -H "X-ChittyOS-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"text": "Sample legal text", "analysisType": "legal"}'
```

### MCP Tests

```bash
# List tools
curl https://itchitty.com/mcp/tools/list

# Call tool
curl -X POST https://itchitty.com/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "chitty_services_status",
    "arguments": {"detailed": true}
  }'

# Read resource
curl "https://itchitty.com/mcp/resources/read?uri=chitty://context/awareness"
```

## 📊 Step 10: Monitoring

### Cloudflare Dashboard

Monitor at:
- https://dash.cloudflare.com/workers
- Account: bbf9fcd845e78035b7a135c481e88541
- Worker: chittyconnect-production

### Key Metrics

- **Request Rate** - Should match GPT usage
- **Error Rate** - Target < 1%
- **P95 Latency** - Target < 500ms
- **KV Operations** - Monitor rate limit checks

### Logs

```bash
# Tail production logs
wrangler tail --env production

# Filter for errors
wrangler tail --env production --status error
```

## 🔄 Step 11: Maintenance

### Update Secrets

```bash
# Rotate API key
wrangler secret put CHITTY_ID_TOKEN --env production

# Test after rotation
curl https://itchitty.com/api/chittyid/validate \
  -H "X-ChittyOS-API-Key: your-key"
```

### Update Code

```bash
# Pull changes
git pull origin main

# Deploy
npm run deploy:production

# Verify
curl https://itchitty.com/health
```

### API Key Management

```bash
# List keys
wrangler kv:key list --binding=API_KEYS --env production

# Revoke key
wrangler kv:key delete --binding=API_KEYS --env production "key:chitty_XXX"

# Generate new key
node scripts/generate-api-key.js "Replacement Key" 5000
```

## 🚨 Troubleshooting

### "Missing API key" errors

```bash
# Check API key exists in KV
wrangler kv:key get --binding=API_KEYS --env production "key:your-key"

# Verify key format
# Should be: {"status":"active","rateLimit":1000,"name":"..."}
```

### ChittyID service errors

```bash
# Test ChittyID service directly
curl https://id.chitty.cc/health

# Verify token is set
wrangler secret list --env production | grep CHITTY_ID_TOKEN
```

### Rate limit errors

```bash
# Check rate limit KV
wrangler kv:key get --binding=RATE_LIMIT --env production "ratelimit:your-key:..."

# Increase limit
wrangler kv:key put --binding=API_KEYS --env production "key:your-key" \
  '{"status":"active","rateLimit":10000,"name":"..."}'
```

### MCP connection failures

```bash
# Verify MCP manifest loads
curl https://itchitty.com/mcp/manifest

# Check tools list
curl https://itchitty.com/mcp/tools/list

# Test tool execution
curl -X POST https://itchitty.com/mcp/tools/call \
  -d '{"name":"chitty_services_status","arguments":{}}'
```

## 📚 Additional Resources

- **ChittyOS Documentation**: https://docs.chitty.cc
- **OpenAPI Spec**: https://itchitty.com/openapi.json
- **MCP Manifest**: https://itchitty.com/mcp/manifest
- **Support**: support@chitty.cc

## 🎉 Success Criteria

You've successfully set up ChittyConnect when:

- ✅ Health endpoint returns 200
- ✅ Custom GPT can call ChittyOS services
- ✅ Claude Code can use MCP tools
- ✅ API key authentication works
- ✅ Rate limiting functions properly
- ✅ ContextConsciousness™ provides ecosystem awareness
- ✅ Third-party integrations proxy correctly

---

**It's Chitty™** - *Model Agnostic & CloudeConscious*

**Domains**: itchitty.com | connect.chitty.cc
