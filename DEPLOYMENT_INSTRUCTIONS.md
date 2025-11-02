# Deployment Instructions

**Date**: November 2, 2025
**Branch**: `claude/check-chitty-oc-status-011CUgwf7SeNbXcBkF7i4Wga`
**Commit**: `8c53fac`

---

## 🚨 Wrangler Authentication Required

The CLI deployment requires a Cloudflare API token. You have two options:

---

## Option 1: Deploy via Cloudflare Dashboard (Recommended - Fastest)

### Step 1: Access Cloudflare Dashboard

Visit the workers dashboard:
```
https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121/workers-and-pages
```

### Step 2: Deploy Staging Worker

1. **Navigate to staging worker**:
   - Click on `chittyconnect-staging`

2. **Open deployments**:
   - Click on "Deployments" tab

3. **Create new deployment**:
   - Click "Create deployment" button
   - OR click "Quick edit" → "Deploy"

4. **Upload files** (if using upload):
   - Upload the entire `src/` directory
   - Ensure `wrangler.toml` configuration is applied

**Alternative - Git Integration** (if enabled):
   - Go to Settings → Deployments
   - Connect to GitHub repository
   - Select branch: `claude/check-chitty-oc-status-011CUgwf7SeNbXcBkF7i4Wga`
   - Enable automatic deployments

### Step 3: Verify Deployment

After deployment completes:

```bash
# Test manifest (no auth required)
curl https://chittyconnect-staging.ccorp.workers.dev/mcp/manifest

# Should return JSON with MCP server info
```

---

## Option 2: Set Up Wrangler CLI Authentication

### Step 1: Create Cloudflare API Token

1. **Go to API Tokens page**:
   ```
   https://dash.cloudflare.com/profile/api-tokens
   ```

2. **Create Token**:
   - Click "Create Token"
   - Use template: "Edit Cloudflare Workers"
   - OR create custom token with permissions:
     - Account > Workers Scripts > Edit
     - Account > Workers KV Storage > Edit
     - Account > Workers R2 Storage > Edit
     - Account > D1 > Edit

3. **Copy the token** (shown only once!)

### Step 2: Set Environment Variable

```bash
# For current session
export CLOUDFLARE_API_TOKEN="your-token-here"

# Or permanently (add to ~/.bashrc or ~/.zshrc)
echo 'export CLOUDFLARE_API_TOKEN="your-token-here"' >> ~/.bashrc
source ~/.bashrc
```

### Step 3: Deploy via CLI

```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production (after testing)
npm run deploy:production
```

---

## Option 3: GitHub Actions (Automated)

### Step 1: Set GitHub Secrets

Go to repository settings:
```
https://github.com/chittyos/chittyconnect/settings/secrets/actions
```

Add secrets:
- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Already in wrangler.toml: `0bc21e3a5a9de1a4cc843be9c3e98121`

### Step 2: Check Workflow File

The workflow exists at:
```
.github/workflows/deploy.yml
```

### Step 3: Trigger Deployment

**Automatic**: Push to branch triggers deployment
```bash
git push origin claude/check-chitty-oc-status-011CUgwf7SeNbXcBkF7i4Wga
```

**Manual**: Via GitHub Actions tab
1. Go to: https://github.com/chittyos/chittyconnect/actions
2. Select workflow: "Deploy"
3. Click "Run workflow"
4. Select branch: `claude/check-chitty-oc-status-011CUgwf7SeNbXcBkF7i4Wga`

---

## After Deployment: Testing

### Step 1: Generate API Key

```bash
# Set environment variables
export CLOUDFLARE_ACCOUNT_ID=0bc21e3a5a9de1a4cc843be9c3e98121
export CLOUDFLARE_API_TOKEN="your-token"

# Generate key
node scripts/generate-mcp-api-key.js \
  --name "Test Key - Staging" \
  --user "staging-test"
```

Save the generated API key!

### Step 2: Test Endpoints

```bash
# 1. Test manifest (no auth required)
curl https://chittyconnect-staging.ccorp.workers.dev/mcp/manifest

# Expected: JSON response with server info

# 2. Test tools list without auth (should fail)
curl https://chittyconnect-staging.ccorp.workers.dev/mcp/tools/list

# Expected: 401 error with "Authentication required"

# 3. Test tools list with auth (should succeed)
curl https://chittyconnect-staging.ccorp.workers.dev/mcp/tools/list \
  -H "X-ChittyOS-API-Key: chitty_abc123..."

# Expected: JSON array with 17 tools

# 4. Test tool execution
curl -X POST https://chittyconnect-staging.ccorp.workers.dev/mcp/tools/call \
  -H "X-ChittyOS-API-Key: chitty_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"name":"chitty_services_status","arguments":{"detailed":false}}'

# Expected: Service status data
```

### Step 3: Test Intelligence Endpoints

```bash
# Test health endpoint
curl https://chittyconnect-staging.ccorp.workers.dev/health

# Test intelligence health
curl https://chittyconnect-staging.ccorp.workers.dev/intelligence/health
```

### Step 4: Check Logs

1. **Via Dashboard**:
   ```
   https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121/workers/services/view/chittyconnect-staging/production/logs
   ```

2. **Look for**:
   - Successful initialization logs
   - Authentication logs: `[MCP Auth] Authenticated request`
   - No errors or warnings

---

## Deploy to Production

**After successful staging testing** (recommend 24+ hours):

### Via Dashboard
1. Navigate to `chittyconnect-production` worker
2. Follow same steps as staging

### Via CLI
```bash
npm run deploy:production
```

### Via GitHub Actions
1. Create pull request from feature branch to main
2. Merge after approval
3. Automatic deployment triggers

---

## Rollback Plan

If deployment causes issues:

### Via Dashboard
1. Go to worker → Deployments
2. Click on previous deployment
3. Click "Rollback to this deployment"

### Via CLI
```bash
# Deploy previous commit
git checkout <previous-commit-hash>
npm run deploy:staging
```

---

## Troubleshooting

### Issue: "Access denied" still appears

**Solution**: Check if deployment completed
```bash
curl -I https://chittyconnect-staging.ccorp.workers.dev/mcp/manifest
```
Look for `200 OK` status.

### Issue: Authentication errors

**Solution**: Verify API key is correctly stored
1. Go to KV namespaces in dashboard
2. Check `API_KEYS` namespace
3. Verify key exists with prefix `key:chitty_...`

### Issue: Deployment fails

**Solution**: Check logs
1. Dashboard → Worker → Logs → Real-time logs
2. Look for build errors or runtime errors
3. Check bindings are correctly configured

---

## Post-Deployment Checklist

- [ ] Staging deployment successful
- [ ] Manifest endpoint returns 200
- [ ] Unauthenticated requests return 401
- [ ] Authenticated requests return 200
- [ ] All 17 MCP tools functional
- [ ] Intelligence modules working
- [ ] Logs show no errors
- [ ] 24 hours stable operation
- [ ] Ready for production deployment

---

## Support

### Cloudflare Resources
- **Dashboard**: https://dash.cloudflare.com/0bc21e3a5a9de1a4cc843be9c3e98121
- **Workers Docs**: https://developers.cloudflare.com/workers
- **API Tokens**: https://dash.cloudflare.com/profile/api-tokens

### ChittyConnect Resources
- **GitHub Repo**: https://github.com/chittyos/chittyconnect
- **Branch**: https://github.com/chittyos/chittyconnect/tree/claude/check-chitty-oc-status-011CUgwf7SeNbXcBkF7i4Wga
- **Commit**: `8c53fac`

---

**Created**: November 2, 2025
**Status**: Ready for deployment
**Next**: Choose deployment method and execute
