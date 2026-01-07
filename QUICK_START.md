# ChittyConnect Quick Start Guide

**Get ChittyConnect operational in < 30 minutes**

---

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)
- ChittyOS service tokens
- Node.js 18+

---

## Step 1: Install Dependencies

```bash
cd /Users/nb/.claude/projects/-/CHITTYOS/chittyos-apps/chittyconnect
npm install
```

---

## Step 2: Create Cloudflare Resources

### KV Namespaces

```bash
# Create KV namespaces
wrangler kv:namespace create "IDEMP_KV" --preview false
wrangler kv:namespace create "TOKEN_KV" --preview false
wrangler kv:namespace create "API_KEYS" --preview false
wrangler kv:namespace create "RATE_LIMIT" --preview false

# Note the IDs returned - you'll need them for wrangler.toml
```

### D1 Database

```bash
# Create D1 database
wrangler d1 create chittyconnect

# Create schema
wrangler d1 execute chittyconnect --command "
  CREATE TABLE IF NOT EXISTS installations (
    installation_id INTEGER PRIMARY KEY,
    account_id TEXT,
    tenant_id TEXT,
    access_token TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    user_id TEXT,
    action TEXT,
    resource TEXT,
    metadata TEXT
  );
"
```

### Queues

```bash
# Create event queue
wrangler queues create github-events
```

---

## Step 3: Update wrangler.toml

Update the IDs in `wrangler.toml` with the values from Step 2:

```toml
[[kv_namespaces]]
binding = "IDEMP_KV"
id = "YOUR_IDEMP_KV_ID_HERE"

[[kv_namespaces]]
binding = "TOKEN_KV"
id = "YOUR_TOKEN_KV_ID_HERE"

[[kv_namespaces]]
binding = "API_KEYS"
id = "YOUR_API_KEYS_KV_ID_HERE"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "YOUR_RATE_LIMIT_KV_ID_HERE"

[[d1_databases]]
binding = "DB"
database_name = "chittyconnect"
database_id = "YOUR_D1_DB_ID_HERE"
```

---

## Step 4: Set Secrets

### ChittyOS Service Tokens

```bash
# Core services
wrangler secret put CHITTY_ID_TOKEN
wrangler secret put CHITTY_AUTH_TOKEN
wrangler secret put CHITTY_CASES_TOKEN
wrangler secret put CHITTY_FINANCE_TOKEN
wrangler secret put CHITTY_EVIDENCE_TOKEN
wrangler secret put CHITTY_SYNC_TOKEN
wrangler secret put CHITTY_CHRONICLE_TOKEN
wrangler secret put CHITTY_CONTEXTUAL_TOKEN
wrangler secret put CHITTY_REGISTRY_TOKEN
```

### Third-Party API Keys (Optional)

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_ACCESS_TOKEN
wrangler secret put NEON_DATABASE_URL
```

### GitHub App (Optional)

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PK
wrangler secret put GITHUB_WEBHOOK_SECRET
```

---

## Step 5: Generate API Key

```bash
# Generate API key for testing
node scripts/generate-api-key.js
```

Save the generated API key - you'll need it for testing.

**Store it in KV**:

```bash
wrangler kv:key put --binding=API_KEYS "key:YOUR_GENERATED_KEY" \
  '{"status":"active","rateLimit":1000,"name":"Test Key"}' \
  --preview false
```

---

## Step 6: Deploy

### Deploy to Staging

```bash
npm run deploy:staging
```

### Deploy to Production

```bash
npm run deploy:production
```

---

## Step 7: Test Deployment

### Health Check

```bash
curl https://connect.chitty.cc/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "service": "chittyconnect",
  "brand": "itsChitty™",
  "tagline": "The AI-intelligent spine with ContextConsciousness™",
  "version": "1.0.0",
  "timestamp": "2025-10-20T...",
  "endpoints": {
    "api": "/api/*",
    "mcp": "/mcp/*",
    "github": "/integrations/github/*",
    "openapi": "/openapi.json"
  }
}
```

### API Health

```bash
curl https://connect.chitty.cc/api/health \
  -H "X-ChittyOS-API-Key: YOUR_API_KEY"
```

### MCP Manifest

```bash
curl https://connect.chitty.cc/mcp/manifest
```

**Expected Response**:
```json
{
  "schema_version": "2024-11-05",
  "name": "chittyconnect",
  "version": "1.0.0",
  "description": "ChittyConnect MCP Server - ContextConsciousness™ AI spine for ChittyOS ecosystem",
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": true
  }
}
```

### Test ChittyID Minting

```bash
curl -X POST https://connect.chitty.cc/api/chittyid/mint \
  -H "X-ChittyOS-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entity": "PLACE", "metadata": {"name": "Test Location"}}'
```

### Test Services Status

```bash
curl https://connect.chitty.cc/api/services/status \
  -H "X-ChittyOS-API-Key: YOUR_API_KEY"
```

---

## Step 8: Configure Custom GPT

1. **Go to ChatGPT** → Create GPT → Configure → Actions

2. **Import OpenAPI Schema**:
   ```
   https://connect.chitty.cc/openapi.json
   ```

3. **Set Authentication**:
   - Type: API Key
   - Header name: `X-ChittyOS-API-Key`
   - Value: `YOUR_API_KEY`

4. **Test in GPT**:
   ```
   Check the status of all ChittyOS services
   ```

---

## Step 9: Configure Claude MCP Integration

### Add to Claude Desktop Config

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chittyconnect": {
      "url": "https://connect.chitty.cc/mcp",
      "transport": "sse",
      "headers": {
        "X-ChittyOS-API-Key": "YOUR_API_KEY"
      }
    }
  }
}
```

### Restart Claude Desktop

The ChittyConnect MCP tools should now be available in Claude.

---

## Troubleshooting

### Issue: DNS Error "prohibited IP"

**Solution**: Check Cloudflare DNS settings for connect.chitty.cc

```bash
# Ensure route is configured
wrangler routes list
```

Add route if missing:
```toml
[[env.production.routes]]
pattern = "connect.chitty.cc/*"
zone_name = "chitty.cc"
```

### Issue: 401 Unauthorized

**Solution**: Check API key is stored in KV

```bash
wrangler kv:key get --binding=API_KEYS "key:YOUR_API_KEY" --preview false
```

### Issue: Service calls return 500

**Solution**: Check secrets are set

```bash
wrangler secret list
```

### Issue: MCP tools not appearing in Claude

**Solution**:
1. Check manifest endpoint is accessible
2. Verify claude_desktop_config.json syntax
3. Restart Claude Desktop
4. Check Claude logs: `~/Library/Logs/Claude/`

---

## Next Steps

After successful deployment:

1. ✅ **Review Architecture Analysis**
   - Read `ARCHITECTURE_ANALYSIS.md`
   - Plan ContextConsciousness™ implementation

2. ✅ **Add Testing**
   - Run: `npm test`
   - Review test coverage

3. ✅ **Set Up Monitoring**
   - Cloudflare Analytics
   - Custom metrics

4. ✅ **Implement MemoryCloude™**
   - Create Vectorize index
   - Build conversation persistence

5. ✅ **Scale & Optimize**
   - Review performance metrics
   - Implement caching
   - Add circuit breakers

---

## Useful Commands

```bash
# Development
npm run dev                     # Local development

# Deployment
npm run deploy:staging          # Deploy to staging
npm run deploy:production       # Deploy to production

# Testing
npm test                        # Run tests
npm run test:watch              # Watch mode

# Code Quality
npm run lint                    # Lint code
npm run format                  # Format code

# Wrangler
wrangler tail                   # View logs
wrangler kv:key list --binding=API_KEYS  # List API keys
wrangler d1 execute chittyconnect --command "SELECT * FROM audit_log"
```

---

## Support

- **Documentation**: `README.md`, `ARCHITECTURE_ANALYSIS.md`
- **Issues**: https://github.com/chittyos/chittyconnect/issues
- **ChittyOS Docs**: https://docs.chitty.cc

---

**itsChitty™** - *Now with ContextConsciousness & MemoryCloude*
