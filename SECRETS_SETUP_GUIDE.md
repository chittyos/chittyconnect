# ChittyConnect Secrets Setup Guide

**Date**: November 2, 2025
**Account ID**: `0bc21e3a5a9de1a4cc843be9c3e98121`

---

## 🔐 Required Secrets Overview

ChittyConnect needs **three categories** of secrets:

1. **Cloudflare Deployment Secrets** (for CI/CD and CLI)
2. **ChittyOS Service Tokens** (for backend integrations)
3. **Third-Party API Keys** (optional - for proxy features)

---

## 1️⃣ Cloudflare Deployment Secrets

### Purpose
These allow GitHub Actions and CLI to deploy workers.

### Required Secrets

| Secret | Where to Set | Purpose | Required? |
|--------|--------------|---------|-----------|
| `CLOUDFLARE_API_TOKEN` | GitHub + Local Env | Deploy workers, manage KV/D1 | ✅ **YES** |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub (optional) | Account identifier | ⚠️ In code already |

### How to Create CLOUDFLARE_API_TOKEN

#### Step 1: Go to API Tokens Page
```
https://dash.cloudflare.com/profile/api-tokens
```

#### Step 2: Create Token
1. Click **"Create Token"**
2. Choose **"Edit Cloudflare Workers"** template
3. OR create custom token with these permissions:

**Required Permissions:**
```yaml
Account Permissions:
  - Workers Scripts: Edit
  - Workers KV Storage: Edit
  - Workers R2 Storage: Edit
  - D1: Edit
  - Account Settings: Read

Zone Permissions (if using custom domains):
  - Workers Routes: Edit
  - DNS: Edit
```

#### Step 3: Configure Token
- **Account Resources**: Include → Specific account → Select your account
- **Zone Resources**: (Optional) Include → All zones OR specific zones
- **Client IP Address Filtering**: (Optional) Add your IPs for security
- **TTL**: (Optional) Set expiration date

#### Step 4: Create and Copy
1. Click **"Continue to summary"**
2. Click **"Create Token"**
3. **⚠️ COPY THE TOKEN NOW** - it won't be shown again!

Example token format:
```
<your-token-will-look-like-this-long-string>
```

### Where to Set CLOUDFLARE_API_TOKEN

#### A. For GitHub Actions (CI/CD)

1. **Go to repository secrets**:
   ```
   https://github.com/chittyos/chittyconnect/settings/secrets/actions
   ```

2. **Click "New repository secret"**

3. **Add secret**:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: `<paste-your-token>`
   - Click "Add secret"

#### B. For Local Development (CLI)

**Option 1: Environment Variable (Temporary)**
```bash
export CLOUDFLARE_API_TOKEN="<your-token>"
```

**Option 2: Shell Profile (Permanent)**
```bash
# For bash
echo 'export CLOUDFLARE_API_TOKEN="<your-token>"' >> ~/.bashrc
source ~/.bashrc

# For zsh
echo 'export CLOUDFLARE_API_TOKEN="<your-token>"' >> ~/.zshrc
source ~/.zshrc
```

**Option 3: Wrangler Login (Easiest)**
```bash
npx wrangler login
# Opens browser for OAuth login
```

---

## 2️⃣ ChittyOS Service Tokens

### Purpose
Authenticate with ChittyOS ecosystem services (id.chitty.cc, auth.chitty.cc, etc.)

### Required Service Tokens

| Secret Name | Service | Endpoint | Required? |
|-------------|---------|----------|-----------|
| `CHITTY_ID_TOKEN` | ChittyID | id.chitty.cc | ✅ **YES** |
| `CHITTY_AUTH_TOKEN` | ChittyAuth | auth.chitty.cc | ✅ **YES** |
| `CHITTY_REGISTRY_TOKEN` | ChittyRegistry | registry.chitty.cc | ✅ **YES** |
| `CHITTY_CHRONICLE_TOKEN` | ChittyChronicle | chronicle.chitty.cc | ⚠️ Recommended |
| `CHITTY_CASES_TOKEN` | ChittyCases | cases.chitty.cc | ⚠️ If using cases |
| `CHITTY_FINANCE_TOKEN` | ChittyFinance | finance.chitty.cc | ⚠️ If using finance |
| `CHITTY_EVIDENCE_TOKEN` | ChittyEvidence | evidence.chitty.cc | ⚠️ If using evidence |
| `CHITTY_SYNC_TOKEN` | ChittySync | sync.chitty.cc | ⚠️ If using sync |
| `CHITTY_CONTEXTUAL_TOKEN` | ChittyContextual | contextual.chitty.cc | ⚠️ If using analysis |

### How to Get ChittyOS Tokens

**Option A: From ChittyAuth Service** (Recommended)
```bash
# If ChittyAuth has an API to generate tokens
curl -X POST https://auth.chitty.cc/api/tokens/generate \
  -H "Content-Type: application/json" \
  -d '{
    "service": "chittyconnect",
    "scopes": ["read", "write", "admin"]
  }'
```

**Option B: From Environment/Config** (If you already have them)
- Check existing deployments for token values
- Check your password manager / secret store
- Ask the ChittyOS team admin

**Option C: Manual Generation** (If you control the services)
- Generate JWT tokens with appropriate claims
- Use service-specific API key generation endpoints

### How to Set ChittyOS Tokens

#### For Staging Environment

```bash
# Set each token via Wrangler
npx wrangler secret put CHITTY_ID_TOKEN --env staging
# Paste token when prompted

npx wrangler secret put CHITTY_AUTH_TOKEN --env staging
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env staging
npx wrangler secret put CHITTY_CHRONICLE_TOKEN --env staging

# Optional tokens (set if needed)
npx wrangler secret put CHITTY_CASES_TOKEN --env staging
npx wrangler secret put CHITTY_FINANCE_TOKEN --env staging
npx wrangler secret put CHITTY_EVIDENCE_TOKEN --env staging
npx wrangler secret put CHITTY_SYNC_TOKEN --env staging
npx wrangler secret put CHITTY_CONTEXTUAL_TOKEN --env staging
```

#### For Production Environment

```bash
# Same process, but use --env production
npx wrangler secret put CHITTY_ID_TOKEN --env production
npx wrangler secret put CHITTY_AUTH_TOKEN --env production
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env production
npx wrangler secret put CHITTY_CHRONICLE_TOKEN --env production
# ... etc
```

#### Via Cloudflare Dashboard

1. **Go to worker settings**:
   ```
   https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121/workers/services/view/chittyconnect-staging/production/settings
   ```

2. **Scroll to "Variables and Secrets"**

3. **Click "Add variable"**:
   - Type: **Secret** (encrypted)
   - Variable name: `CHITTY_ID_TOKEN`
   - Value: `<paste-token>`
   - Click "Save"

4. **Repeat for all tokens**

---

## 3️⃣ GitHub Integration Secrets (Optional)

### Purpose
Enable GitHub App webhook processing.

### Required Secrets

| Secret Name | Purpose | Required? |
|-------------|---------|-----------|
| `GITHUB_APP_ID` | GitHub App identifier | ⚠️ If using GitHub integration |
| `GITHUB_APP_PK` | GitHub App private key (PEM format) | ⚠️ If using GitHub integration |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature validation | ⚠️ If using GitHub integration |

### How to Get GitHub Secrets

**If you have a GitHub App installed:**

1. **Go to GitHub App settings**:
   ```
   https://github.com/settings/apps
   ```

2. **Select your app** (or create new)

3. **Get values**:
   - **App ID**: Shown at top of page
   - **Private Key**: Click "Generate a private key" → Download `.pem` file
   - **Webhook Secret**: Set in "Webhook" section

### How to Set GitHub Secrets

```bash
# App ID
npx wrangler secret put GITHUB_APP_ID --env staging
# Enter: your-app-id (numeric)

# Private Key (PEM format)
npx wrangler secret put GITHUB_APP_PK --env staging
# Paste entire PEM file contents:
# -----BEGIN PRIVATE KEY-----
# MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
# -----END PRIVATE KEY-----

# Webhook Secret
npx wrangler secret put GITHUB_WEBHOOK_SECRET --env staging
# Enter: your-webhook-secret
```

---

## 4️⃣ Third-Party API Keys (Optional)

### Purpose
Enable proxy features for Notion, OpenAI, etc.

### Optional Secrets

| Secret Name | Service | MCP Tool | Required? |
|-------------|---------|----------|-----------|
| `NOTION_TOKEN` | Notion API | `notion_query` | ❌ Optional |
| `OPENAI_API_KEY` | OpenAI API | `openai_chat` | ❌ Optional |
| `GOOGLE_ACCESS_TOKEN` | Google Calendar | Calendar tools | ❌ Optional |
| `NEON_DATABASE_URL` | Neon Database | SQL queries | ❌ Optional |

### How to Set Third-Party Keys

```bash
# Only set if you're using these features
npx wrangler secret put NOTION_TOKEN --env staging
npx wrangler secret put OPENAI_API_KEY --env staging
npx wrangler secret put GOOGLE_ACCESS_TOKEN --env staging
npx wrangler secret put NEON_DATABASE_URL --env staging
```

---

## 🎯 Minimum Required Setup

### For Basic MCP Functionality

**Absolutely Required:**
1. ✅ `CLOUDFLARE_API_TOKEN` (for deployment)
2. ✅ `CHITTY_ID_TOKEN` (for ChittyID minting)
3. ✅ `CHITTY_AUTH_TOKEN` (for authentication)
4. ✅ `CHITTY_REGISTRY_TOKEN` (for service discovery)

**Total**: 4 secrets minimum

### For Full Functionality

**Add these:**
5. ✅ `CHITTY_CHRONICLE_TOKEN` (event logging)
6. ✅ `GITHUB_APP_ID` (if using GitHub integration)
7. ✅ `GITHUB_APP_PK` (if using GitHub integration)
8. ✅ `GITHUB_WEBHOOK_SECRET` (if using GitHub integration)

**Total**: 8 secrets for complete setup

---

## 📋 Setup Checklist

### Phase 1: Cloudflare Access (Required)

- [ ] Create Cloudflare API token
- [ ] Set `CLOUDFLARE_API_TOKEN` in GitHub Secrets
- [ ] Set `CLOUDFLARE_API_TOKEN` in local environment
- [ ] Test: `npx wrangler whoami` shows your account

### Phase 2: ChittyOS Integration (Required)

- [ ] Obtain `CHITTY_ID_TOKEN` from ChittyAuth
- [ ] Obtain `CHITTY_AUTH_TOKEN` from ChittyAuth
- [ ] Obtain `CHITTY_REGISTRY_TOKEN` from ChittyAuth
- [ ] Set all three tokens via `wrangler secret put`
- [ ] Verify tokens work by calling service endpoints

### Phase 3: Optional Features

- [ ] Set `CHITTY_CHRONICLE_TOKEN` (recommended)
- [ ] Set GitHub secrets (if using GitHub integration)
- [ ] Set third-party keys (if using proxy features)

### Phase 4: Verification

- [ ] Deploy to staging
- [ ] Test MCP endpoints with authentication
- [ ] Verify ChittyOS service calls work
- [ ] Check logs for authentication errors
- [ ] Test all enabled features

---

## 🔒 Security Best Practices

### Token Management

1. **Never commit secrets to Git**
   - Use `.gitignore` for `.env` files
   - Always use `wrangler secret put` for production

2. **Use separate tokens per environment**
   - Staging tokens ≠ Production tokens
   - Easier to rotate and revoke

3. **Set expiration dates**
   - Create tokens with TTL (time-to-live)
   - Rotate regularly (every 90 days)

4. **Restrict permissions**
   - Use minimum required scopes
   - Cloudflare: Only Workers permissions needed
   - ChittyOS: Only required service access

5. **Monitor usage**
   - Check Cloudflare audit logs
   - Track API usage per token
   - Alert on suspicious activity

### GitHub Secrets Security

- ✅ Repository secrets are encrypted at rest
- ✅ Only accessible during workflow runs
- ✅ Not exposed in logs (use `secrets.` context)
- ✅ Can be scoped to environments (staging/production)

---

## 🚨 Troubleshooting

### Issue: "wrangler: command not found"

**Solution**: Use npx
```bash
npx wrangler secret put CHITTY_ID_TOKEN
```

### Issue: "Authentication failed"

**Solution**: Check token permissions
1. Go to Cloudflare API tokens page
2. Verify token has "Workers Scripts: Edit" permission
3. Regenerate if needed

### Issue: "ChittyOS service calls failing"

**Solution**: Verify service tokens
```bash
# Test token directly
curl https://id.chitty.cc/v1/health \
  -H "Authorization: Bearer $CHITTY_ID_TOKEN"

# Should return 200 OK
```

### Issue: "GitHub webhook signature invalid"

**Solution**: Verify webhook secret matches
1. Check GitHub App webhook settings
2. Ensure secret in Cloudflare matches exactly
3. Regenerate webhook secret if needed

---

## 📞 Getting Help

### If You Don't Have Tokens

**ChittyOS Tokens**:
- Contact ChittyOS team admin
- Or use ChittyAuth API to generate
- Or check existing deployment secrets

**GitHub App**:
- Check if app exists: https://github.com/settings/apps
- Or create new GitHub App
- Or skip GitHub integration for now

**Third-Party Keys**:
- Notion: https://www.notion.so/my-integrations
- OpenAI: https://platform.openai.com/api-keys
- Google: https://console.cloud.google.com/apis/credentials

### Support Links

- **Cloudflare Tokens**: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- **Wrangler Secrets**: https://developers.cloudflare.com/workers/wrangler/commands/#secret
- **GitHub Secrets**: https://docs.github.com/en/actions/security-guides/encrypted-secrets

---

## 🎯 Quick Start Commands

```bash
# 1. Set Cloudflare token (local)
export CLOUDFLARE_API_TOKEN="<your-cloudflare-token>"

# 2. Verify authentication
npx wrangler whoami

# 3. Set minimum required secrets (staging)
npx wrangler secret put CHITTY_ID_TOKEN --env staging
npx wrangler secret put CHITTY_AUTH_TOKEN --env staging
npx wrangler secret put CHITTY_REGISTRY_TOKEN --env staging

# 4. Deploy
npm run deploy:staging

# 5. Test
curl https://chittyconnect-staging.ccorp.workers.dev/mcp/manifest
```

---

**Created**: November 2, 2025
**Updated**: November 2, 2025
**Status**: Ready for setup
