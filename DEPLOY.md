# ChittyConnect - Quick Deploy Guide

## Prerequisites
- Cloudflare account (bbf9fcd845e78035b7a135c481e88541)
- Wrangler CLI installed
- All service tokens ready

## 1. Quick Deploy

```bash
cd /Users/nb/.claude/projects/-/CHITTYOS/chittyos-apps/chittyconnect

# Install
npm install

# Deploy to staging
npm run deploy:staging

# Test
curl https://chittyconnect-staging.chitty.workers.dev/health

# Deploy to production
npm run deploy:production

# Verify
curl https://connect.chitty.cc/health
curl https://connect.chitty.cc/openapi.json
```

## 2. Set Secrets

```bash
# ChittyOS services
wrangler secret put CHITTY_ID_TOKEN
wrangler secret put CHITTY_AUTH_TOKEN
wrangler secret put CHITTY_CASES_TOKEN
wrangler secret put CHITTY_FINANCE_TOKEN
wrangler secret put CHITTY_EVIDENCE_TOKEN
wrangler secret put CHITTY_SYNC_TOKEN
wrangler secret put CHITTY_CHRONICLE_TOKEN
wrangler secret put CHITTY_CONTEXTUAL_TOKEN
wrangler secret put CHITTY_REGISTRY_TOKEN

# Third-party (optional)
wrangler secret put NOTION_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_ACCESS_TOKEN
wrangler secret put NEON_DATABASE_URL
```

## 3. Generate API Key

```bash
node scripts/generate-api-key.js "My Custom GPT" 5000
```

## 4. Test Endpoints

```bash
# Health
curl https://connect.chitty.cc/api/health \
  -H "X-ChittyOS-API-Key: your-key"

# Mint ChittyID
curl -X POST https://connect.chitty.cc/api/chittyid/mint \
  -H "X-ChittyOS-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"entity": "PLACE"}'
```

## 5. Configure Custom GPT

1. Go to https://chat.openai.com
2. Create GPT → Actions
3. Import: `https://connect.chitty.cc/openapi.json`
4. Auth: API Key, Header: `X-ChittyOS-API-Key`
5. Test!

## Done!

**Docs**: See README.md for full guide
**Support**: docs/ folder for detailed info
