# Phase 3 Migration Guide: 1Password Connect Server Deployment

**Status:** Ready to Execute
**Prerequisites:** Phase 1 & 2 Complete (✅)
**Estimated Time:** 2-4 hours

---

## Overview

This guide walks through deploying a 1Password Connect server and migrating all ChittyConnect credentials from environment variables to 1Password vaults. The implementation is designed to be executed gradually with zero downtime.

**Current State:** All code is deployed and ready. The system currently uses automatic failover to environment variables because the 1Password Connect server is not yet deployed.

**After Phase 3:** All credentials will be retrieved dynamically from 1Password vaults at runtime, with environment variables serving as emergency fallback only.

---

## Architecture Recap

```
ChittyConnect Routes
    ↓
getServiceToken() / getCredential()
    ↓
OnePasswordConnectClient
    ├─→ [1] Try 1Password Connect Server (NEW in Phase 3)
    └─→ [2] Fallback to environment variables (CURRENT)
    ↓
ContextConsciousness™ Risk Analysis
    ↓
Encrypted KV Cache (TTL-based)
```

---

## Prerequisites

### Required Tools
- [ ] Docker or cloud hosting platform
- [ ] 1Password CLI (`op`) installed locally
- [ ] Access to 1Password account with admin permissions
- [ ] `wrangler` CLI for Cloudflare Workers
- [ ] `openssl` for generating encryption keys

### Required Secrets (Current Environment Variables)
You should have these already set in Cloudflare Workers:

**Infrastructure:**
- `CLOUDFLARE_MAKE_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEON_DATABASE_URL`

**ChittyOS Services:**
- `CHITTY_ID_TOKEN`
- `CHITTY_AUTH_TOKEN`
- `CHITTY_CHRONICLE_TOKEN`
- `CHITTY_FINANCE_TOKEN`
- `CHITTY_CASES_TOKEN`
- `CHITTY_SYNC_TOKEN`
- `CHITTY_EVIDENCE_TOKEN`
- `CHITTY_CONTEXTUAL_TOKEN`

**Third-Party Integrations:**
- `NOTION_TOKEN`
- `OPENAI_API_KEY`
- `GOOGLE_ACCESS_TOKEN`

---

## Step 1: Deploy 1Password Connect Server

### Option A: Docker Deployment (Recommended for Testing)

```bash
# 1. Create a 1Password Connect credentials file
# Log into 1Password and generate a credentials file from:
# https://my.1password.com/integrations/active

# Save the credentials.json file to a secure location
mkdir -p ~/1password-connect
cd ~/1password-connect

# 2. Run 1Password Connect server
docker run -d \
  --name 1password-connect \
  -p 8080:8080 \
  -v $(pwd)/1op-sessions:/home/opuser/.op/data \
  -v $(pwd)/credentials.json:/home/opuser/.op/credentials.json \
  1password/connect-api:latest

# 3. Verify it's running
docker ps | grep 1password-connect

# 4. Test health endpoint
curl http://localhost:8080/health
# Should return: {"name":"1Password Connect API","version":"1.x.x"}
```

### Option B: Cloud Deployment (Recommended for Production)

**AWS ECS:**
```bash
# Create ECS task definition with 1password/connect-api:latest
# Mount credentials.json as secret
# Expose port 8080
# Set up Application Load Balancer with SSL
```

**Google Cloud Run:**
```bash
# Deploy container to Cloud Run
# Set credentials.json as secret
# Enable HTTPS endpoint
```

**Cloudflare Workers (not supported - requires persistent storage)**

### Option C: Self-Hosted Server

```bash
# Set up a dedicated VM
# Install Docker
# Follow Option A steps
# Configure reverse proxy (nginx/caddy) with SSL
# Set up monitoring and logging
```

---

## Step 2: Create 1Password Vaults and Organize Credentials

### 2.1 Create Vaults

```bash
# Using 1Password CLI
op vault create "ChittyOS Infrastructure" --allow-admins-to-manage=true
op vault create "ChittyOS Services" --allow-admins-to-manage=true
op vault create "ChittyOS Integrations" --allow-admins-to-manage=true
op vault create "ChittyOS Emergency" --allow-admins-to-manage=true

# Note the vault UUIDs from the output - you'll need these later
```

### 2.2 Create Items and Organize Credentials

**Infrastructure Vault:**

```bash
# Cloudflare credentials
op item create \
  --category=login \
  --title="Cloudflare API Credentials" \
  --vault="ChittyOS Infrastructure" \
  make_api_key[password]="$(wrangler secret get CLOUDFLARE_MAKE_API_KEY)" \
  account_id[text]="$(wrangler secret get CLOUDFLARE_ACCOUNT_ID)" \
  zone_id[text]="your-zone-id"

# Neon database
op item create \
  --category=database \
  --title="Neon PostgreSQL" \
  --vault="ChittyOS Infrastructure" \
  database_url[password]="$(wrangler secret get NEON_DATABASE_URL)"
```

**Services Vault:**

```bash
# ChittyID
op item create \
  --category=api \
  --title="ChittyID Service Token" \
  --vault="ChittyOS Services" \
  service_token[password]="$(wrangler secret get CHITTY_ID_TOKEN)"

# ChittyAuth
op item create \
  --category=api \
  --title="ChittyAuth Service Token" \
  --vault="ChittyOS Services" \
  service_token[password]="$(wrangler secret get CHITTY_AUTH_TOKEN)"

# Repeat for all ChittyOS services...
# ChittyChronicle, ChittyFinance, ChittyCases, etc.
```

**Integrations Vault:**

```bash
# Notion
op item create \
  --category=api \
  --title="Notion Integration" \
  --vault="ChittyOS Integrations" \
  api_key[password]="$(wrangler secret get NOTION_TOKEN)"

# OpenAI
op item create \
  --category=api \
  --title="OpenAI API" \
  --vault="ChittyOS Integrations" \
  api_key[password]="$(wrangler secret get OPENAI_API_KEY)"

# Google
op item create \
  --category=api \
  --title="Google Calendar" \
  --vault="ChittyOS Integrations" \
  access_token[password]="$(wrangler secret get GOOGLE_ACCESS_TOKEN)"
```

### 2.3 Verify Vault Structure

```bash
# List all vaults
op vault list

# List items in each vault
op item list --vault="ChittyOS Infrastructure"
op item list --vault="ChittyOS Services"
op item list --vault="ChittyOS Integrations"

# Test retrieving a credential
op item get "Cloudflare API Credentials" --vault="ChittyOS Infrastructure" --fields make_api_key
```

---

## Step 3: Configure ChittyConnect with 1Password Connect

### 3.1 Generate Service Account Token

```bash
# In 1Password web interface:
# 1. Go to Integrations → 1Password Connect
# 2. Create new service account
# 3. Grant access to all four vaults (Infrastructure, Services, Integrations, Emergency)
# 4. Copy the token (you'll only see it once!)

# Save the token securely
echo "your-1password-connect-token" > ~/1password-connect-token.txt
```

### 3.2 Generate Encryption Key

```bash
# Generate a 32-byte random encryption key for KV cache
openssl rand -base64 32

# Save this securely - you'll need it for Wrangler secrets
```

### 3.3 Update wrangler.toml with Vault UUIDs

```bash
# Get vault UUIDs
op vault list --format=json | jq '.[] | {name: .name, id: .id}'

# Update wrangler.toml
# Replace placeholder UUIDs with real ones:
# ONEPASSWORD_VAULT_INFRASTRUCTURE = "your-infrastructure-vault-uuid"
# ONEPASSWORD_VAULT_SERVICES = "your-services-vault-uuid"
# ONEPASSWORD_VAULT_INTEGRATIONS = "your-integrations-vault-uuid"
# ONEPASSWORD_VAULT_EMERGENCY = "your-emergency-vault-uuid"
```

### 3.4 Set Wrangler Secrets

```bash
# Set 1Password Connect URL (update if using custom domain)
# Default assumes localhost for testing
# For production, use your actual domain

# Set 1Password Connect token
cat ~/1password-connect-token.txt | wrangler secret put ONEPASSWORD_CONNECT_TOKEN --env=staging
cat ~/1password-connect-token.txt | wrangler secret put ONEPASSWORD_CONNECT_TOKEN --env=production

# Set encryption key
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --env=staging
openssl rand -base64 32 | wrangler secret put ENCRYPTION_KEY --env=production

# Verify secrets are set
wrangler secret list --env=staging | grep -E "(ONEPASSWORD|ENCRYPTION)"
wrangler secret list --env=production | grep -E "(ONEPASSWORD|ENCRYPTION)"
```

### 3.5 Update ONEPASSWORD_CONNECT_URL for Production

```toml
# In wrangler.toml, update for your actual 1Password Connect server:

[env.staging.vars]
ONEPASSWORD_CONNECT_URL = "https://1password-connect-staging.chitty.cc"  # Your staging URL

[env.production.vars]
ONEPASSWORD_CONNECT_URL = "https://1password-connect.chitty.cc"  # Your production URL
```

---

## Step 4: Testing

### 4.1 Test 1Password Connect Retrieval Locally

```bash
# Test with curl
curl -H "Authorization: Bearer YOUR_CONNECT_TOKEN" \
  http://localhost:8080/v1/vaults

# Should return JSON with all vaults

# Test retrieving an item
curl -H "Authorization: Bearer YOUR_CONNECT_TOKEN" \
  "http://localhost:8080/v1/vaults/VAULT_UUID/items/ITEM_UUID"
```

### 4.2 Test ChittyConnect Integration

```bash
# Deploy to staging first
npm run deploy:staging

# Test credential provisioning endpoint
curl -X POST https://chittyconnect-staging.workers.dev/api/credentials/provision \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "openai_api_key",
    "context": {
      "service": "chittyconnect",
      "purpose": "api-call"
    }
  }'

# Should return credential successfully retrieved from 1Password

# Check health endpoint
curl https://chittyconnect-staging.workers.dev/api/credentials/health \
  -H "Authorization: Bearer $API_KEY"

# Should show: "onepassword_connect": "healthy"
```

### 4.3 Test Automatic Failover

```bash
# Stop 1Password Connect server temporarily
docker stop 1password-connect

# Test that ChittyConnect still works (should fall back to env vars)
curl -X POST https://chittyconnect-staging.workers.dev/api/credentials/provision \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "openai_api_key",
    "context": {
      "service": "chittyconnect",
      "purpose": "api-call"
    }
  }'

# Should still succeed (using environment variable fallback)
# Check logs - should see warning about 1Password fallback

# Restart 1Password Connect
docker start 1password-connect

# Verify it switches back to 1Password
# (may take up to cache TTL - 15 min for integrations)
```

### 4.4 Test All Service Proxies

```bash
# Test ChittyID
curl -X POST https://chittyconnect-staging.workers.dev/api/chittyid/mint \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entity": "PEO"}'

# Test Notion integration
curl -X POST https://chittyconnect-staging.workers.dev/api/thirdparty/notion/query \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"databaseId": "your-db-id"}'

# Test OpenAI integration
curl -X POST https://chittyconnect-staging.workers.dev/api/thirdparty/openai/chat \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# All should succeed using 1Password-retrieved credentials
```

---

## Step 5: Production Deployment

### 5.1 Deploy Production 1Password Connect Server

```bash
# Use production-grade hosting (AWS ECS, GKE, etc.)
# Ensure SSL/TLS enabled
# Set up monitoring and alerting
# Configure backup for credentials.json
# Set up logging to ChittyChronicle
```

### 5.2 Update Production Configuration

```bash
# Update wrangler.toml production URL
# Set production secrets
# Deploy to production

npm run deploy:production
```

### 5.3 Smoke Test Production

```bash
# Test health endpoint
curl https://connect.chitty.cc/api/credentials/health \
  -H "Authorization: Bearer $API_KEY"

# Test one integration from each category
# - Third-party (Notion/OpenAI)
# - ChittyOS service (ChittyID)
# - Infrastructure (Cloudflare credentials)

# Monitor logs for any issues
npm run tail --env=production
```

---

## Step 6: Gradual Migration Strategy

### Phase 3A: Monitor (Week 1)

- ✅ 1Password Connect deployed and tested
- ✅ All credentials in vaults
- ✅ ChittyConnect retrieving from 1Password
- ✅ Environment variables still in place as failback
- 📊 Monitor cache hit rates
- 📊 Monitor 1Password Connect uptime
- 📊 Monitor for any failover events

### Phase 3B: Optimize (Week 2-3)

- 🔧 Tune cache TTLs based on actual usage
- 🔧 Add more detailed metrics to ChittyChronicle
- 🔧 Implement credential rotation schedules
- 🔧 Set up alerting for high-risk access patterns

### Phase 3C: Full Migration (Week 4+)

**Only after confirming 99.9% uptime and no issues:**

```bash
# Begin removing environment variable fallbacks (optional)
# This makes the system fully dependent on 1Password Connect

# Start with non-critical integrations
wrangler secret delete NOTION_TOKEN --env=production
wrangler secret delete GOOGLE_ACCESS_TOKEN --env=production

# Monitor for 1 week - any issues?

# Continue with service tokens
wrangler secret delete CHITTY_SYNC_TOKEN --env=production
wrangler secret delete CHITTY_EVIDENCE_TOKEN --env=production

# Monitor for 1 week

# Finally, critical services (keep as emergency backup)
# KEEP THESE: CHITTY_ID_TOKEN, CHITTY_AUTH_TOKEN, CHITTY_CHRONICLE_TOKEN
# KEEP THESE: CLOUDFLARE_MAKE_API_KEY, NEON_DATABASE_URL
```

**Recommendation:** Keep critical infrastructure credentials in environment variables permanently as emergency fallback.

---

## Step 7: Monitoring & Maintenance

### 7.1 Set Up Monitoring

```sql
-- Query cache performance
SELECT
  credential_path,
  cache_hits,
  cache_misses,
  ROUND(cache_hits * 100.0 / (cache_hits + cache_misses), 2) as hit_rate_percent,
  average_fetch_time_ms
FROM onepassword_cache_metadata
ORDER BY cache_hits + cache_misses DESC
LIMIT 20;

-- Query credential access patterns
SELECT
  service,
  credential_path,
  access_count,
  average_risk_score,
  anomaly_count,
  last_access
FROM credential_access_patterns
WHERE anomaly_count > 0 OR average_risk_score > 50
ORDER BY average_risk_score DESC;
```

### 7.2 Set Up Alerts

- Alert on 1Password Connect health check failures
- Alert on high cache miss rates (> 20%)
- Alert on high-risk credential requests (score >= 70)
- Alert on anomaly detection
- Alert on failover events

### 7.3 Regular Maintenance Tasks

**Weekly:**
- Review credential access patterns
- Check for anomalies
- Review cache performance metrics

**Monthly:**
- Rotate service tokens
- Audit vault access logs
- Review and update credential purposes
- Update vault organization if needed

**Quarterly:**
- Full security audit
- Review and update risk scoring thresholds
- Test disaster recovery procedures

---

## Disaster Recovery

### Scenario 1: 1Password Connect Server Down

**Automatic:** System automatically falls back to environment variables (if still set)

**Manual Steps:**
1. Check 1Password Connect server logs
2. Restart 1Password Connect container/service
3. Verify health endpoint
4. Monitor ChittyConnect logs for automatic recovery

### Scenario 2: Lost 1Password Connect Token

**Steps:**
1. Generate new service account token in 1Password web interface
2. Update Wrangler secrets:
   ```bash
   echo "new-token" | wrangler secret put ONEPASSWORD_CONNECT_TOKEN --env=production
   ```
3. Clear credential cache in KV (to force re-fetch with new token)
4. Monitor logs for successful retrieval

### Scenario 3: Vault Corruption or Deletion

**Prevention:** Regular backups of 1Password vaults

**Recovery:**
1. Restore vault from 1Password backup
2. Verify all credentials are present
3. Update vault UUID in wrangler.toml if changed
4. Redeploy ChittyConnect
5. Test all integrations

### Scenario 4: Complete 1Password Outage

**If environment variables still set:** Automatic failover, zero downtime

**If environment variables removed:**
1. Emergency restore environment variables from secure backup
2. Deploy with environment variables
3. Investigate 1Password outage
4. Restore 1Password Connect when available

---

## Success Criteria

✅ **Phase 3 Complete When:**

1. 1Password Connect server deployed and healthy
2. All credentials migrated to 1Password vaults
3. ChittyConnect successfully retrieving credentials from vaults
4. Cache hit rate > 80%
5. Zero production incidents related to credentials
6. All service proxies and integrations working
7. Monitoring and alerting configured
8. Documentation updated
9. Team trained on new system

---

## Rollback Plan

If Phase 3 needs to be rolled back:

```bash
# 1. Stop 1Password Connect server
docker stop 1password-connect

# 2. Verify automatic failover to environment variables works
# (Should be seamless if env vars still set)

# 3. If needed, redeploy previous version
git checkout <previous-commit>
npm run deploy:production

# 4. Investigate issues before retrying Phase 3
```

---

## Cost Analysis

**1Password Connect Server:**
- Docker (self-hosted): ~$10-50/month (VM costs)
- AWS ECS: ~$30-100/month (container + load balancer)
- Google Cloud Run: ~$20-80/month (container + ingress)

**1Password Business Account:**
- Required for Connect API
- ~$8-20/user/month

**Cloudflare KV (Credential Cache):**
- Read operations: ~1M/month = $0.50
- Write operations: ~100K/month = $0.50
- Storage: Negligible (< 1MB)
- **Total KV: ~$1/month**

**Total Estimated Monthly Cost: $40-170**
(Mainly 1Password subscription + hosting)

**ROI:** Enhanced security, centralized credential management, automated rotation, comprehensive audit trail

---

## Support & Troubleshooting

### Common Issues

**Issue:** "1Password Connect not healthy"
- Check 1Password Connect server logs
- Verify network connectivity
- Verify credentials.json is valid
- Check service account token hasn't expired

**Issue:** "High cache miss rate"
- Check cache TTL settings
- Verify ENCRYPTION_KEY is set correctly
- Check KV namespace is accessible
- Review credential access patterns

**Issue:** "Risk score too high, access denied"
- Review ContextConsciousness™ analysis
- Check if service is in registry
- Verify purpose is valid for credential type
- Check time-based patterns (unusual hours)

### Getting Help

- **Documentation:** See 1PASSWORD_ARCHITECT_IMPLEMENTATION.md
- **Logs:** `npm run tail --env=production`
- **Database Queries:** Use D1 to query credential_access_patterns
- **1Password Support:** https://support.1password.com

---

**Phase 3 migration complete! ChittyConnect is now a fully operational context-aware credential orchestration platform powered by 1Password Connect. 🎉**
