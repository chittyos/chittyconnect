# ChittyConnect Secrets - Quick Reference

**Account ID**: `0bc21e3a5a9de1a4cc843be9c3e98121`

---

## ⚡ TL;DR - What You Need

### Minimum to Deploy (4 secrets)

```bash
# 1. For deployment
export CLOUDFLARE_API_TOKEN="<get-from-cloudflare-dashboard>"

# 2. For ChittyOS integration
npx wrangler secret put CHITTY_ID_TOKEN --env staging
npx wrangler secret put CHITTY_AUTH_TOKEN --env staging
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env staging
```

**That's it for basic functionality!**

---

## 📊 Complete Secrets Checklist

### 1. Cloudflare (Required for Deployment)

| Secret | Get From | Set Where | Required? |
|--------|----------|-----------|-----------|
| `CLOUDFLARE_API_TOKEN` | [Create Token](https://dash.cloudflare.com/profile/api-tokens) | GitHub + Local | ✅ **YES** |

**How to create:**
1. Visit: https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Copy token (shown only once!)

**How to set:**
```bash
# For CLI deployment
export CLOUDFLARE_API_TOKEN="<your-token>"

# For GitHub Actions
# Go to: https://github.com/chittyos/chittyconnect/settings/secrets/actions
# Add: CLOUDFLARE_API_TOKEN = <your-token>
```

---

### 2. ChittyOS Services (Required for Functionality)

| Secret | Service | Required? | Used For |
|--------|---------|-----------|----------|
| `CHITTY_ID_TOKEN` | id.chitty.cc | ✅ **YES** | Minting ChittyIDs |
| `CHITTY_AUTH_TOKEN` | auth.chitty.cc | ✅ **YES** | Authentication |
| `CHITTY_REGISTRY_TOKEN` | registry.chitty.cc | ✅ **YES** | Service discovery |
| `CHITTY_CHRONICLE_TOKEN` | chronicle.chitty.cc | ⚠️ Recommended | Event logging |
| `CHITTY_DNA_TOKEN` | dna.chitty.cc | ⚠️ Recommended | Context tracking |
| `CHITTY_VERIFY_TOKEN` | verify.chitty.cc | ⚠️ Recommended | Verification flows |
| `CHITTY_CERTIFY_TOKEN` | certify.chitty.cc | ⚠️ Recommended | Certification |
| `CHITTY_CASES_TOKEN` | cases.chitty.cc | ❌ Optional | Legal cases |
| `CHITTY_FINANCE_TOKEN` | finance.chitty.cc | ❌ Optional | Banking features |
| `CHITTY_EVIDENCE_TOKEN` | evidence.chitty.cc | ❌ Optional | Evidence processing |
| `CHITTY_SYNC_TOKEN` | sync.chitty.cc | ❌ Optional | Data sync |
| `CHITTY_CONTEXTUAL_TOKEN` | contextual.chitty.cc | ❌ Optional | Context analysis |

**How to get tokens:**
- Ask ChittyOS admin/team
- Or use ChittyAuth API to generate
- Or check existing deployment

**How to set:**
```bash
# Set for staging
npx wrangler secret put CHITTY_ID_TOKEN --env staging
npx wrangler secret put CHITTY_AUTH_TOKEN --env staging
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env staging
npx wrangler secret put CHITTY_CHRONICLE_TOKEN --env staging
npx wrangler secret put CHITTY_DNA_TOKEN --env staging
npx wrangler secret put CHITTY_VERIFY_TOKEN --env staging
npx wrangler secret put CHITTY_CERTIFY_TOKEN --env staging

# Set for production (after testing)
npx wrangler secret put CHITTY_ID_TOKEN --env production
# ... repeat for all tokens
```

---

### 3. GitHub Integration (Optional - Only if Using GitHub App)

| Secret | Required? | Used For |
|--------|-----------|----------|
| `GITHUB_APP_ID` | ❌ Optional | GitHub App identifier |
| `GITHUB_APP_PK` | ❌ Optional | GitHub App private key |
| `GITHUB_WEBHOOK_SECRET` | ❌ Optional | Webhook validation |

**Skip if:** You're not using GitHub webhook integration

**How to get:**
- Go to: https://github.com/settings/apps
- Select your app or create new
- App ID: shown at top
- Private Key: Generate and download
- Webhook Secret: Set in webhook settings

**How to set:**
```bash
npx wrangler secret put GITHUB_APP_ID --env staging
npx wrangler secret put GITHUB_APP_PK --env staging
npx wrangler secret put GITHUB_WEBHOOK_SECRET --env staging
```

---

### 4. Third-Party APIs (Optional - Only if Using Proxy Features)

| Secret | Service | MCP Tool | Required? |
|--------|---------|----------|-----------|
| `NOTION_TOKEN` | Notion | `notion_query` | ❌ Optional |
| `OPENAI_API_KEY` | OpenAI | `openai_chat` | ❌ Optional |
| `GOOGLE_ACCESS_TOKEN` | Google | Calendar tools | ❌ Optional |
| `NEON_DATABASE_URL` | Neon DB | SQL queries | ❌ Optional |

**Skip if:** You're not using third-party integrations

**How to get:**
- Notion: https://www.notion.so/my-integrations
- OpenAI: https://platform.openai.com/api-keys
- Google: https://console.cloud.google.com/apis/credentials
- Neon: Your database connection string

**How to set:**
```bash
npx wrangler secret put NOTION_TOKEN --env staging
npx wrangler secret put OPENAI_API_KEY --env staging
# ... etc
```

---

## 🎯 Recommended Setup Priority

### Phase 1: Minimum Viable (Start Here)
```bash
export CLOUDFLARE_API_TOKEN="<your-token>"
npx wrangler secret put CHITTY_ID_TOKEN --env staging
npx wrangler secret put CHITTY_AUTH_TOKEN --env staging
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env staging
```
✅ **Can deploy and test basic MCP functionality**

### Phase 2: Core Features
```bash
npx wrangler secret put CHITTY_CHRONICLE_TOKEN --env staging
npx wrangler secret put CHITTY_DNA_TOKEN --env staging
npx wrangler secret put CHITTY_VERIFY_TOKEN --env staging
npx wrangler secret put CHITTY_CERTIFY_TOKEN --env staging
```
✅ **Full ChittyOS ecosystem integration**

### Phase 3: Optional Features (As Needed)
```bash
# Only set what you need
npx wrangler secret put CHITTY_CASES_TOKEN --env staging
npx wrangler secret put GITHUB_APP_ID --env staging
npx wrangler secret put NOTION_TOKEN --env staging
```
✅ **Extended functionality**

---

## 🚀 Quick Setup Script

```bash
#!/bin/bash
# save as: setup-secrets.sh

echo "🔐 ChittyConnect Secrets Setup"
echo "=============================="
echo ""

# Check for Cloudflare token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set"
  echo "   Get it from: https://dash.cloudflare.com/profile/api-tokens"
  exit 1
fi

echo "✅ CLOUDFLARE_API_TOKEN found"
echo ""

# Environment selection
read -p "Deploy to [staging/production]: " ENV
ENV=${ENV:-staging}

echo "📝 Setting secrets for: $ENV"
echo ""

# Required ChittyOS tokens
echo "Setting required ChittyOS tokens..."
npx wrangler secret put CHITTY_ID_TOKEN --env $ENV
npx wrangler secret put CHITTY_AUTH_TOKEN --env $ENV
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env $ENV

echo ""
read -p "Set recommended tokens? [y/N]: " SET_RECOMMENDED

if [ "$SET_RECOMMENDED" = "y" ]; then
  echo "Setting recommended tokens..."
  npx wrangler secret put CHITTY_CHRONICLE_TOKEN --env $ENV
  npx wrangler secret put CHITTY_DNA_TOKEN --env $ENV
  npx wrangler secret put CHITTY_VERIFY_TOKEN --env $ENV
  npx wrangler secret put CHITTY_CERTIFY_TOKEN --env $ENV
fi

echo ""
echo "✅ Secrets setup complete!"
echo ""
echo "Next steps:"
echo "  1. Deploy: npm run deploy:$ENV"
echo "  2. Test: curl https://chittyconnect-$ENV.ccorp.workers.dev/mcp/manifest"
```

**Usage:**
```bash
chmod +x setup-secrets.sh
export CLOUDFLARE_API_TOKEN="<your-token>"
./setup-secrets.sh
```

---

## 🔍 Verify Secrets Are Set

### Via Wrangler CLI
```bash
# List all secrets (names only, not values)
npx wrangler secret list --env staging
npx wrangler secret list --env production
```

### Via Cloudflare Dashboard
1. Go to worker settings:
   - Staging: https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121/workers/services/view/chittyconnect-staging/production/settings
   - Production: https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121/workers/services/view/chittyconnect-production/production/settings

2. Scroll to "Variables and Secrets"

3. Verify secrets are listed (values are hidden for security)

---

## ❓ FAQ

### Q: Where do I get ChittyOS tokens?

**A:** Three options:
1. Ask your ChittyOS admin/team
2. Use ChittyAuth API (if available)
3. Check existing deployments for current values

### Q: Do I need GitHub secrets if I'm not using GitHub integration?

**A:** No, skip them. They're only needed for GitHub App webhook processing.

### Q: Can I use the same tokens for staging and production?

**A:** Not recommended. Use separate tokens for:
- Better security (revoke staging without affecting prod)
- Easier debugging (track which env is calling)
- Safer testing (staging can't affect prod data)

### Q: What if I don't have a Cloudflare API token?

**A:** You have two options:
1. Create one: https://dash.cloudflare.com/profile/api-tokens
2. Deploy via Cloudflare Dashboard instead of CLI

### Q: How do I rotate secrets?

**A:**
```bash
# Generate new token/key
# Then update secret:
npx wrangler secret put CHITTY_ID_TOKEN --env staging

# Enter new value when prompted
```

### Q: Can I see secret values after setting them?

**A:** No, secrets are encrypted and hidden. You can only:
- See that they exist (list names)
- Update them (set new value)
- Delete them

If you lose a secret value, you must regenerate it.

---

## 📊 Summary Table

| Priority | Secrets | Count | Can Deploy? | Full Functionality? |
|----------|---------|-------|-------------|---------------------|
| **Minimum** | CLOUDFLARE_API_TOKEN<br>CHITTY_ID_TOKEN<br>CHITTY_AUTH_TOKEN<br>CHITTY_REGISTRY_TOKEN | 4 | ✅ Yes | ⚠️ Basic only |
| **Recommended** | + CHITTY_CHRONICLE_TOKEN<br>+ CHITTY_DNA_TOKEN<br>+ CHITTY_VERIFY_TOKEN<br>+ CHITTY_CERTIFY_TOKEN | 8 | ✅ Yes | ✅ Yes |
| **Complete** | + GitHub secrets<br>+ Third-party keys | 12-15 | ✅ Yes | ✅ Yes + extras |

---

## 🎯 Next Steps After Setting Secrets

1. **Verify setup:**
   ```bash
   npx wrangler secret list --env staging
   ```

2. **Deploy:**
   ```bash
   npm run deploy:staging
   ```

3. **Test:**
   ```bash
   curl https://chittyconnect-staging.ccorp.workers.dev/mcp/manifest
   ```

4. **Generate MCP API key:**
   ```bash
   node scripts/generate-mcp-api-key.js --name "Test"
   ```

5. **Test authentication:**
   ```bash
   curl https://chittyconnect-staging.ccorp.workers.dev/mcp/tools/list \
     -H "X-ChittyOS-API-Key: <generated-key>"
   ```

---

**For detailed instructions, see:** `SECRETS_SETUP_GUIDE.md`
