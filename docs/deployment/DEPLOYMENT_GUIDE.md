# ChittyConnect Deployment Guide

**Version:** 1.0.0
**Last Updated:** October 21, 2025
**Status:** Week 3 - Ready for Deployment

---

## Overview

This guide walks through the complete deployment process for ChittyConnect, from infrastructure provisioning to production deployment.

**Deployment Strategy:**
1. Provision infrastructure (KV, D1, Queues)
2. Configure secrets
3. Deploy to staging
4. Test staging
5. Deploy to production
6. Monitor

---

## Prerequisites

### Required

- ✅ Cloudflare account with Workers enabled
- ✅ Node.js 18+ installed
- ✅ wrangler CLI installed (`npm install -g wrangler`)
- ✅ Git repository cloned
- ✅ Domain: `chitty.cc` configured in Cloudflare

### ChittyOS Service Tokens Required

You'll need API tokens from these ChittyOS services:

1. **ChittyID** (`id.chitty.cc`) - Identity authority
2. **ChittyAuth** (`auth.chitty.cc`) - Authentication
3. **ChittyRegistry** (`registry.chitty.cc`) - Service discovery
4. **ChittyDNA** (`dna.chitty.cc`) - Genetic tracking
5. **ChittyChronicle** (`chronicle.chitty.cc`) - Event logging
6. **ChittyVerify** (`verify.chitty.cc`) - Verification
7. **ChittyCertify** (`certify.chitty.cc`) - Certification

Contact ChittyOS team to obtain these tokens.

### Optional (for GitHub App)

- GitHub App created (see [GITHUB_APP_SETUP.md](../GITHUB_APP_SETUP.md))
- GitHub App ID
- GitHub App Private Key (PEM format)
- GitHub Webhook Secret

---

## Step 1: Authentication

### Authenticate with Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Verify authentication
npx wrangler whoami
```

You should see your account email and account ID.

---

## Step 2: Infrastructure Provisioning

### Option A: Automated Provisioning (Recommended)

```bash
# Install dependencies
npm install

# Provision all infrastructure (production + staging)
npm run provision

# Or provision individually:
npm run provision:prod      # Production only
npm run provision:staging   # Staging only
```

This creates:
- 5 KV namespaces per environment (10 total)
- 2 D1 databases (production + staging)
- 3 Queues (shared across environments)

### Option B: Manual Provisioning

If automated provisioning fails, create resources manually:

#### KV Namespaces (Production)

```bash
npx wrangler kv:namespace create "CHITTYCONNECT_KV"
npx wrangler kv:namespace create "TOKEN_KV"
npx wrangler kv:namespace create "API_KEYS"
npx wrangler kv:namespace create "RATE_LIMIT"
npx wrangler kv:namespace create "IDEMP_KV"
```

#### KV Namespaces (Staging)

```bash
npx wrangler kv:namespace create "CHITTYCONNECT_KV" --env staging
npx wrangler kv:namespace create "TOKEN_KV" --env staging
npx wrangler kv:namespace create "API_KEYS" --env staging
npx wrangler kv:namespace create "RATE_LIMIT" --env staging
npx wrangler kv:namespace create "IDEMP_KV" --env staging
```

#### D1 Databases

```bash
npx wrangler d1 create chittyconnect
npx wrangler d1 create chittyconnect-staging
```

#### Queues

```bash
npx wrangler queues create chittyconnect-context-ops
npx wrangler queues create chittyconnect-github-events
npx wrangler queues create chittyconnect-dlq
```

### Update wrangler.toml

After provisioning, update `wrangler.toml` with the generated IDs:

1. Copy IDs from `.env.infrastructure` (created by provisioning script)
2. Replace all `PLACEHOLDER_*` values in `wrangler.toml`

Example:
```toml
# Before
id = "PLACEHOLDER_TOKEN_KV"

# After (use actual ID from provisioning output)
id = "abc123def456..."
```

---

## Step 3: Run Database Migrations

### Production

```bash
npm run db:migrate
```

### Staging

```bash
npm run db:migrate:staging
```

### Verify Migrations

```bash
# Check tables exist
npx wrangler d1 execute chittyconnect --command="SELECT name FROM sqlite_master WHERE type='table'"

# Should show: contexts, installations, actors, connections
```

---

## Step 4: Configure Secrets

### ChittyOS Service Tokens

```bash
# Interactive secrets configuration
npm run secrets:prod      # Production
npm run secrets:staging   # Staging
# Or both
npm run secrets
```

This will prompt you to enter each secret. Have your ChittyOS tokens ready.

### Manual Secret Configuration

If you prefer to set secrets manually:

```bash
# ChittyOS tokens
npx wrangler secret put CHITTY_ID_SERVICE_TOKEN
npx wrangler secret put CHITTY_AUTH_SERVICE_TOKEN
npx wrangler secret put CHITTY_REGISTRY_TOKEN
npx wrangler secret put CHITTY_DNA_TOKEN
npx wrangler secret put CHITTY_CHRONICLE_TOKEN
npx wrangler secret put CHITTY_VERIFY_TOKEN
npx wrangler secret put CHITTY_CERTIFY_TOKEN

# GitHub App (optional, for Week 4-6)
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET

# For staging, add --env staging
npx wrangler secret put CHITTY_ID_SERVICE_TOKEN --env staging
```

### Verify Secrets

```bash
npx wrangler secret list
npx wrangler secret list --env staging
```

---

## Step 5: Deploy to Staging

### Deploy

```bash
npm run deploy:staging
```

### Verify Deployment

```bash
# Health check
curl https://connect-staging.chitty.cc/health

# Should return:
# {
#   "status": "healthy",
#   "service": "chittyconnect",
#   "version": "1.0.0",
#   ...
# }
```

### Full Health Check (with ChittyOS services)

```bash
curl "https://connect-staging.chitty.cc/health?full=true"
```

This checks connectivity to all ChittyOS services.

---

## Step 6: Staging Tests

### Manual Tests

```bash
# 1. Health check
curl https://connect-staging.chitty.cc/health

# 2. Test endpoints (requires ChittyAuth token)
# Get your token from ChittyAuth first

export AUTH_TOKEN="your_chittyauth_token"

# Register as actor
curl -X POST https://connect-staging.chitty.cc/v1/actors/register \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actor_type": "human",
    "display_name": "Test User",
    "capabilities": ["developer"]
  }'

# Get authenticated actor
curl https://connect-staging.chitty.cc/v1/actors/me \
  -H "Authorization: Bearer $AUTH_TOKEN"

# Create a context
curl -X POST https://connect-staging.chitty.cc/v1/contexts/create \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type": "application/json" \
  -d '{
    "name": "test-context",
    "systems": ["chittyid", "chittyauth"],
    "tools": ["search"]
  }'

# List contexts
curl https://connect-staging.chitty.cc/v1/contexts/list \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

### Monitor Logs

```bash
# Watch real-time logs
npm run tail:staging

# Or
npx wrangler tail --env staging
```

Look for:
- ✅ `[Init] ChittyConnect initialization complete`
- ✅ `[DB] Database schema initialized successfully`
- ✅ `[Ecosystem] ChittyConnect context initialized`
- ⚠️ Any errors or warnings

---

## Step 7: Deploy to Production

### Pre-Deployment Checklist

- [ ] Staging deployment successful
- [ ] Health check passing
- [ ] Manual tests passing
- [ ] Logs clean (no errors)
- [ ] DNS configured for `connect.chitty.cc`
- [ ] All secrets configured for production
- [ ] Database migrations run successfully
- [ ] Stakeholders notified

### Deploy

```bash
npm run deploy:production

# Or
npm run deploy
```

### Verify Production

```bash
# Health check
curl https://connect.chitty.cc/health

# Full health check
curl "https://connect.chitty.cc/health?full=true"
```

### Monitor Production

```bash
npm run tail

# Or
npx wrangler tail
```

---

## Step 8: Post-Deployment

### Configure DNS (if not already done)

In Cloudflare dashboard:

1. Go to chitty.cc zone
2. Add DNS records:
   - **Production:** CNAME `connect` → your worker URL
   - **Staging:** CNAME `connect-staging` → your worker URL

Or use Cloudflare API:

```bash
# Production
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "connect",
    "content": "chittyconnect.{account}.workers.dev",
    "proxied": true
  }'
```

### Set Up Monitoring

1. **Cloudflare Analytics**
   - Dashboard → Workers → chittyconnect → Analytics
   - Monitor request volume, error rates, latency

2. **ChittyChronicle**
   - All events logged to chronicle.chitty.cc
   - Query timeline: `GET https://chronicle.chitty.cc/v1/timeline/{chittyconnect_id}`

3. **Alerting** (optional)
   - Set up alerts for error rate > 5%
   - Set up alerts for latency > 1s
   - Set up alerts for 5xx errors

---

## Troubleshooting

### Issue: "Not authenticated" error

**Solution:**
```bash
wrangler login
wrangler whoami  # Verify
```

### Issue: "Namespace not found"

**Solution:**
```bash
# List KV namespaces
npx wrangler kv:namespace list

# Verify IDs in wrangler.toml match
# Re-run provisioning if needed
npm run provision
```

### Issue: Database errors

**Solution:**
```bash
# Check if migrations ran
npx wrangler d1 execute chittyconnect --command="SELECT name FROM sqlite_master WHERE type='table'"

# Re-run migrations
npm run db:migrate
```

### Issue: 500 errors in production

**Solution:**
```bash
# Check logs
npm run tail

# Look for errors, common issues:
# - Missing secrets (ChittyOS tokens)
# - Database not initialized
# - ChittyOS service unavailable
```

### Issue: ChittyOS service timeout

**Solution:**
- Check ChittyOS service status
- Verify tokens are correct
- Check network connectivity
- System will gracefully degrade - initialization will continue

---

## Rollback Procedure

If production deployment has critical issues:

### Quick Rollback

```bash
# Deploy previous version
git checkout <previous-commit>
npm run deploy:production

# Or use Cloudflare dashboard:
# Workers → chittyconnect → Deployments → Rollback
```

### Full Rollback with Data

```bash
# 1. Stop traffic (optional)
# Set maintenance mode or disable routes

# 2. Restore database from backup
# (If you have D1 backups)

# 3. Deploy previous version
git checkout <previous-commit>
npm run deploy:production

# 4. Verify health
curl https://connect.chitty.cc/health

# 5. Re-enable traffic
```

---

## Deployment Environments

### Staging

- **URL:** https://connect-staging.chitty.cc
- **Purpose:** Pre-production testing
- **Data:** Test data only
- **Secrets:** Staging ChittyOS tokens

### Production

- **URL:** https://connect.chitty.cc
- **Purpose:** Live service
- **Data:** Real data
- **Secrets:** Production ChittyOS tokens

---

## Performance Benchmarks

### Target Metrics

| Metric | Target | Measured |
|--------|--------|----------|
| Health endpoint | <200ms | TBD |
| API endpoints | <500ms | TBD |
| Webhook ack | <100ms | TBD |
| Queue processing | <1s/msg | TBD |
| Error rate | <1% | TBD |
| Uptime | >99.5% | TBD |

### Run Benchmarks

```bash
# Coming in Week 3 testing phase
# npm run benchmark
```

---

## Security Checklist

- [ ] All secrets configured (not in code)
- [ ] HTTPS only (enforced by Cloudflare)
- [ ] ChittyAuth validation on all endpoints
- [ ] Zero ChittyID violations
- [ ] SQL injection prevented (parameterized queries)
- [ ] Rate limiting configured
- [ ] HMAC webhook verification (for GitHub)
- [ ] Audit logging enabled (ChittyChronicle)

---

## Cost Estimation

### Free Tier Limits (Cloudflare Workers)

- 100,000 requests/day
- 10ms CPU time per request
- 5 GB D1 storage
- 5 million D1 reads/day

### Estimated Costs (Production)

**At 100K requests/day (~3M/month):**
- Workers: $0 (within free tier)
- KV: $1/month
- D1: $5/month
- Queues: $2/month
- Workers AI: $10/month

**Total: ~$18/month**

**At 1M requests/day:**
- Workers: $5/month
- KV: $3/month
- D1: $15/month
- Queues: $10/month
- Workers AI: $30/month

**Total: ~$63/month**

---

## Next Steps

After successful deployment:

1. **Week 4-6: GitHub App Integration**
   - Create GitHub App
   - Configure webhooks
   - Test OAuth flow

2. **Monitoring & Optimization**
   - Set up dashboards
   - Optimize slow queries
   - Add caching where needed

3. **Documentation**
   - API documentation
   - User guides
   - Runbooks

---

## Support

**Issues:** https://github.com/chittyos/chittyconnect/issues
**Documentation:** `/docs`
**ChittyOS:** Contact ChittyOS team for service tokens

---

**Deployment Guide Version:** 1.0.0
**Last Updated:** October 21, 2025
**Status:** Ready for Week 3 Deployment
