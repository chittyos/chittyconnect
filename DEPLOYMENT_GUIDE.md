# ChittyConnect Cloudflare Optimization Deployment Guide

This guide provides step-by-step instructions for deploying the three major Cloudflare optimizations:

1. Durable Objects for ContextConsciousness™ session state
2. R2 Document Storage
3. Cloudflare Tunnel + 1Password Connect

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment 1: Durable Objects](#deployment-1-durable-objects)
- [Deployment 2: R2 Document Storage](#deployment-2-r2-document-storage)
- [Deployment 3: Cloudflare Tunnel + 1Password Connect](#deployment-3-cloudflare-tunnel--1password-connect)
- [Testing & Validation](#testing--validation)
- [Rollback Procedures](#rollback-procedures)
- [Cost Estimates](#cost-estimates)

---

## Prerequisites

### Required Tools
```bash
# Wrangler CLI (latest version)
npm install -g wrangler@latest

# Cloudflare account access
wrangler login

# 1Password CLI (for 1Password Connect setup)
brew install --cask 1password-cli  # macOS
# OR download from https://1password.com/downloads/command-line/

# Docker and Docker Compose (for 1Password Connect server)
docker --version
docker-compose --version
```

### Required Credentials
- Cloudflare account ID: `0bc21e3a5a9de1a4cc843be9c3e98121`
- Cloudflare API token with permissions:
  - Workers Scripts: Edit
  - Workers KV Storage: Edit
  - Workers R2 Storage: Edit
  - Workers Durable Objects: Edit
  - Account Settings: Read
- 1Password account with Connect Server credentials
- Infrastructure server with Docker support

---

## Deployment 1: Durable Objects

### Overview
Deploy Durable Objects to replace KV-based session state with stateful, real-time session management.

**Estimated Downtime**: Zero (gradual migration)
**Free Tier Limits**: 1M requests/month, 1GB storage

### Step 1: Update wrangler.toml

Add Durable Objects configuration to your existing `wrangler.toml`:

```bash
cd /Users/nb/Projects/development/chittyconnect

# Backup current configuration
cp wrangler.toml wrangler.toml.backup

# Add DO configuration from wrangler-durable-objects.toml
cat >> wrangler.toml << 'EOF'

# Durable Objects Configuration
[durable_objects]
classes = [
  { binding = "SESSION_STATE", class_name = "SessionStateDO", script_name = "chittyconnect" }
]

[[durable_objects.bindings]]
name = "SESSION_STATE"
class_name = "SessionStateDO"
script_name = "chittyconnect"

# Migration
[[migrations]]
tag = "v1"
new_classes = ["SessionStateDO"]
EOF
```

### Step 2: Update Worker Entry Point

Update `src/index.js` to export the Durable Object class:

```javascript
// Import the Durable Object class
import { SessionStateDO } from './durable-objects/SessionStateDO.js';

// Export for Cloudflare Workers runtime
export { SessionStateDO };

// Your existing default export
export default {
  async fetch(request, env, ctx) {
    // Your existing handler
  },

  async queue(batch, env, ctx) {
    // Your existing queue handler
  }
};
```

### Step 3: Deploy to Staging

```bash
# Deploy to staging environment
wrangler deploy --env staging

# Verify deployment
wrangler tail --env staging

# Test DO creation
curl -X POST https://connect-staging.chitty.cc/api/v1/sessions \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chittyId": "01-C-PROD-0001-P-2501-A-X",
    "sessionId": "test-session-123",
    "metadata": {"test": true}
  }'
```

### Step 4: Gradual Migration Strategy

Implement feature flag to gradually migrate sessions:

```javascript
// In your session creation logic
const useDurableObjects = env.ENABLE_DURABLE_OBJECTS === 'true' ||
                          Math.random() < parseFloat(env.DO_ROLLOUT_PERCENTAGE || '0.1');

if (useDurableObjects) {
  // Use Durable Objects
  const sessionService = new SessionStateService(env);
  await sessionService.createSession(chittyId, sessionId, metadata);
} else {
  // Use existing KV approach
  await env.TOKEN_KV.put(`session:${sessionId}`, JSON.stringify(session));
}
```

Set environment variable:
```bash
# Start with 10% rollout
wrangler secret put ENABLE_DURABLE_OBJECTS --env staging
# Enter: false

wrangler secret put DO_ROLLOUT_PERCENTAGE --env staging
# Enter: 0.10
```

### Step 5: Monitor and Scale

```bash
# Monitor DO usage
wrangler tail --env staging --format json | grep SessionStateDO

# Check DO metrics via API
curl https://connect-staging.chitty.cc/api/v1/sessions/metrics \
  -H "Authorization: Bearer $STAGING_TOKEN"

# Gradually increase rollout
# 10% → 25% → 50% → 100%
wrangler secret put DO_ROLLOUT_PERCENTAGE --env staging
# Enter: 0.25
```

### Step 6: Deploy to Production

```bash
# Once staging is stable (24-48 hours)
wrangler deploy --env production

# Enable 10% rollout in production
wrangler secret put DO_ROLLOUT_PERCENTAGE --env production
# Enter: 0.10

# Monitor for 24 hours, then increase to 100%
wrangler secret put ENABLE_DURABLE_OBJECTS --env production
# Enter: true
```

---

## Deployment 2: R2 Document Storage

### Overview
Deploy R2 bucket for document storage with D1 metadata indexing.

**Estimated Downtime**: Zero
**Free Tier Limits**: 10GB storage, 1M Class A operations, 10M Class B operations

### Step 1: Create R2 Bucket

```bash
# Create R2 bucket for production
wrangler r2 bucket create chittyconnect-documents

# Create bucket for staging
wrangler r2 bucket create chittyconnect-documents-staging

# Verify creation
wrangler r2 bucket list
```

### Step 2: Update wrangler.toml

```bash
# Add R2 bucket binding to wrangler.toml
cat >> wrangler.toml << 'EOF'

# R2 Document Storage
[[r2_buckets]]
binding = "DOCUMENT_STORAGE"
bucket_name = "chittyconnect-documents"

# Staging environment
[[env.staging.r2_buckets]]
binding = "DOCUMENT_STORAGE"
bucket_name = "chittyconnect-documents-staging"

# Production environment
[[env.production.r2_buckets]]
binding = "DOCUMENT_STORAGE"
bucket_name = "chittyconnect-documents"
EOF
```

### Step 3: Run D1 Migration

```bash
# Apply document storage schema to staging
wrangler d1 execute chittyconnect --env staging \
  --file=./migrations/003_document_storage.sql

# Verify tables
wrangler d1 execute chittyconnect --env staging \
  --command="SELECT name FROM sqlite_master WHERE type='table'"

# Apply to production
wrangler d1 execute chittyconnect-production --env production \
  --file=./migrations/003_document_storage.sql
```

### Step 4: Configure CORS (Optional)

```bash
# Create CORS configuration
cat > r2-cors-config.json << 'EOF'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://connect.chitty.cc"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

# Apply CORS configuration (requires API call)
# Note: wrangler doesn't support CORS config yet, use Cloudflare API
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/chittyconnect-documents/cors" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @r2-cors-config.json
```

### Step 5: Deploy Updated Worker

```bash
# Deploy to staging
wrangler deploy --env staging

# Test document upload
curl -X POST https://connect-staging.chitty.cc/api/v1/documents/upload \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  -F "file=@test-document.pdf" \
  -F "chittyId=01-C-PROD-0001-P-2501-A-X" \
  -F "type=evidence"

# Verify in R2
wrangler r2 object list chittyconnect-documents-staging \
  --prefix="chittyid/01-C-PROD-0001-P-2501-A-X/"
```

### Step 6: Set Up Lifecycle Policies (Optional)

```bash
# Configure lifecycle policy for temporary files
cat > r2-lifecycle-policy.json << 'EOF'
{
  "Rules": [
    {
      "Id": "delete-temp-files",
      "Filter": {
        "Prefix": "temp/"
      },
      "Status": "Enabled",
      "Expiration": {
        "Days": 7
      }
    },
    {
      "Id": "transition-old-files",
      "Filter": {
        "Prefix": "archive/"
      },
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "INFREQUENT_ACCESS"
        }
      ]
    }
  ]
}
EOF

# Apply lifecycle policy (via API)
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/chittyconnect-documents/lifecycle" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @r2-lifecycle-policy.json
```

### Step 7: Production Deployment

```bash
# Deploy to production
wrangler deploy --env production

# Monitor document storage
curl https://connect.chitty.cc/api/v1/documents/stats \
  -H "Authorization: Bearer $PRODUCTION_TOKEN"
```

---

## Deployment 3: Cloudflare Tunnel + 1Password Connect

### Overview
Deploy 1Password Connect server with Cloudflare Tunnel for secure, private access.

**Estimated Downtime**: None (new service)
**Free Tier**: Cloudflare Tunnel is free, 1Password Connect requires Business plan

### Step 1: Provision 1Password Connect Credentials

```bash
# Using 1Password CLI
op signin

# Create Connect server credentials
op connect server create "ChittyOS Infrastructure" \
  --vaults "infrastructure,services,integrations,emergency" \
  > infrastructure/1password-connect/credentials/1password-credentials.json

# Secure the credentials file
chmod 600 infrastructure/1password-connect/credentials/1password-credentials.json
```

### Step 2: Create Cloudflare Tunnel

```bash
# Login to Cloudflare
wrangler login

# Create tunnel via Cloudflare Dashboard (preferred):
# 1. Go to https://one.dash.cloudflare.com/
# 2. Navigate to Zero Trust > Networks > Tunnels
# 3. Click "Create a tunnel"
# 4. Name: "1password-connect-chittyos"
# 5. Save the tunnel token

# OR create via CLI:
cloudflared tunnel create 1password-connect-chittyos

# Configure tunnel routing
cloudflared tunnel route dns 1password-connect-chittyos 1password-connect.chitty.cc
```

### Step 3: Configure Environment Variables

```bash
cd infrastructure/1password-connect

# Create .env file
cat > .env << 'EOF'
# 1Password Connect
OP_SESSION=your-session-token-here
OP_LOG_LEVEL=info

# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token-here
TUNNEL_LOGLEVEL=info
EOF

# Secure the .env file
chmod 600 .env
```

### Step 4: Deploy Docker Compose Stack

```bash
# Start the services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Check health
docker-compose exec connect-api wget -qO- http://localhost:8080/health
```

### Step 5: Configure Cloudflare Access (Optional but Recommended)

```bash
# Via Cloudflare Dashboard:
# 1. Go to Zero Trust > Access > Applications
# 2. Add application
# 3. Type: Self-hosted
# 4. Name: "1Password Connect API"
# 5. Subdomain: 1password-connect
# 6. Domain: chitty.cc
# 7. Add policy:
#    - Name: "ChittyOS Services Only"
#    - Action: Allow
#    - Include: IP ranges (your infrastructure IPs)
# 8. Save

# Test access
curl https://1password-connect.chitty.cc/v1/health \
  -H "Authorization: Bearer $ONEPASSWORD_CONNECT_TOKEN"
```

### Step 6: Update ChittyConnect Configuration

```bash
# Set 1Password Connect URL in wrangler.toml
# (Already configured in your wrangler.toml under vars)

# Set the Connect token as secret
wrangler secret put ONEPASSWORD_CONNECT_TOKEN --env production
# Enter the token from 1Password Connect

# Deploy updated configuration
wrangler deploy --env production
```

### Step 7: Test End-to-End Integration

```bash
# Test credential retrieval via ChittyConnect
curl -X POST https://connect.chitty.cc/api/v1/credentials/provision \
  -H "Authorization: Bearer $PRODUCTION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "chittyid",
    "credentialPath": "services/chittyid/service_token",
    "purpose": "inter-service-call"
  }'

# Verify in logs
wrangler tail --env production
```

---

## Testing & Validation

### Durable Objects Testing Checklist

- [ ] Session creation works
- [ ] Session updates persist
- [ ] Session retrieval returns correct data
- [ ] WebSocket connections establish successfully
- [ ] Hibernation works after 60 seconds inactivity
- [ ] Alarm-based cleanup runs
- [ ] Concurrent session access works
- [ ] Fallback to KV works when DO unavailable
- [ ] Memory usage stays under 128MB per DO
- [ ] Metrics endpoint returns data

### R2 Document Storage Testing Checklist

- [ ] Document upload succeeds
- [ ] Document download works
- [ ] Presigned URLs generate correctly
- [ ] Presigned URLs expire after specified time
- [ ] Document metadata indexed in D1
- [ ] Document search returns results
- [ ] Storage quotas tracked correctly
- [ ] Multipart upload works for large files (>5MB)
- [ ] Document deletion removes from R2 and D1
- [ ] CORS headers present on responses
- [ ] Lifecycle policies execute

### 1Password Connect Testing Checklist

- [ ] Connect API health endpoint responds
- [ ] Connect Sync health endpoint responds
- [ ] Cloudflare Tunnel establishes connection
- [ ] DNS resolves 1password-connect.chitty.cc
- [ ] Authentication token validates
- [ ] Credential retrieval works
- [ ] Vault access permissions correct
- [ ] Rate limiting enforced (100 req/min)
- [ ] Nginx caching works
- [ ] Docker containers restart on failure
- [ ] Metrics exporters running
- [ ] Health check aggregator reporting

---

## Rollback Procedures

### Rollback: Durable Objects

```bash
# Immediate rollback - disable DO usage
wrangler secret put ENABLE_DURABLE_OBJECTS --env production
# Enter: false

# Verify KV fallback working
curl https://connect.chitty.cc/api/v1/sessions \
  -H "Authorization: Bearer $PRODUCTION_TOKEN"

# If needed, rollback deployment
wrangler rollback --env production

# Remove DO configuration from wrangler.toml
# Comment out [durable_objects] section and redeploy
wrangler deploy --env production
```

### Rollback: R2 Document Storage

```bash
# Update code to skip R2 operations
# Set feature flag
wrangler secret put ENABLE_R2_STORAGE --env production
# Enter: false

# Documents will fall back to previous storage method
# No data loss - R2 bucket remains intact

# To completely remove R2 binding
# Comment out [[r2_buckets]] in wrangler.toml
wrangler deploy --env production
```

### Rollback: 1Password Connect

```bash
# Stop Docker services
cd infrastructure/1password-connect
docker-compose down

# Disable in ChittyConnect
wrangler secret put ONEPASSWORD_CONNECT_URL --env production
# Enter: (empty string)

# ChittyConnect will fall back to existing secrets
wrangler deploy --env production

# Delete Cloudflare Tunnel (optional)
cloudflared tunnel delete 1password-connect-chittyos

# Remove DNS record
# Via Cloudflare Dashboard: DNS > Records > Delete 1password-connect
```

---

## Cost Estimates

### Durable Objects

**Free Tier (Included)**:
- 1M requests/month
- 1GB storage per DO
- Hibernation automatically reduces costs

**Paid Tier (if exceeded)**:
- $0.15 per million requests
- $0.20 per GB-month storage

**Estimated Monthly Cost** (ChittyConnect):
- Sessions: ~500K requests/month = **FREE**
- Storage: ~500MB total = **FREE**
- **Total: $0/month**

### R2 Document Storage

**Free Tier (Included)**:
- 10GB storage
- 1M Class A operations (PUT, LIST)
- 10M Class B operations (GET, HEAD)

**Paid Tier (if exceeded)**:
- $0.015 per GB-month storage
- $4.50 per million Class A operations
- $0.36 per million Class B operations

**Estimated Monthly Cost** (ChittyConnect):
- Storage: ~5GB = **FREE**
- Uploads: ~50K/month = **FREE**
- Downloads: ~200K/month = **FREE**
- **Total: $0/month**

### Cloudflare Tunnel + 1Password Connect

**Cloudflare Tunnel**: **FREE** (unlimited bandwidth)

**1Password Connect**:
- Requires 1Password Business plan: **$7.99/user/month**
- Infrastructure-only usage: **~$8-16/month**

**Infrastructure Server**:
- DigitalOcean Droplet (2GB RAM): **$12/month**
- AWS t3.small: **~$15/month**
- Hetzner VPS: **€4.51/month (~$5/month)**

**Estimated Monthly Cost**:
- 1Password Connect: **$8/month**
- Server: **$5-15/month**
- **Total: $13-23/month**

### Grand Total

**Monthly Cost for All Three Optimizations**:
- Durable Objects: **$0**
- R2 Storage: **$0**
- 1Password Connect: **$13-23**
- **Total: $13-23/month**

**Annual Cost**: **$156-276/year**

**Value Delivered**:
- Improved performance and reliability
- Enhanced security and credential management
- Reduced KV write operations (cost savings)
- Real-time session state
- Scalable document storage
- Zero-trust credential access

---

## Monitoring & Maintenance

### Daily Checks
```bash
# Check service health
curl https://connect.chitty.cc/health
curl https://1password-connect.chitty.cc/v1/health

# Check DO metrics
curl https://connect.chitty.cc/api/v1/sessions/metrics

# Check R2 usage
wrangler r2 bucket list
```

### Weekly Checks
```bash
# Review logs for errors
wrangler tail --env production | grep ERROR

# Check storage quotas
curl https://connect.chitty.cc/api/v1/documents/stats

# Review Docker container health
docker-compose ps
```

### Monthly Checks
- Review Cloudflare Analytics dashboard
- Check R2 storage costs
- Review 1Password Connect access logs
- Test disaster recovery procedures

---

## Support & Troubleshooting

### Common Issues

**Issue: DO not responding**
```bash
# Check DO health
wrangler tail --env production --format json | grep SessionStateDO

# Test DO creation directly
curl -X POST https://connect.chitty.cc/api/v1/sessions/test-do

# Fallback to KV if needed
wrangler secret put ENABLE_DURABLE_OBJECTS --env production
# Enter: false
```

**Issue: R2 upload fails**
```bash
# Check R2 bucket exists
wrangler r2 bucket list

# Check quota limits
wrangler r2 object list chittyconnect-documents | wc -l

# Test direct R2 access
wrangler r2 object put chittyconnect-documents/test.txt --file=test.txt
```

**Issue: 1Password Connect unreachable**
```bash
# Check Docker containers
docker-compose ps

# Check tunnel status
docker-compose logs cloudflare-tunnel

# Test direct container access
docker-compose exec connect-api wget -qO- http://localhost:8080/health

# Restart services
docker-compose restart
```

---

## Next Steps

After successful deployment:

1. **Monitor Performance**: Set up Cloudflare Analytics and custom logging
2. **Optimize Costs**: Review usage patterns and adjust configurations
3. **Scale Gradually**: Increase traffic to new systems incrementally
4. **Document Learnings**: Update runbooks with operational insights
5. **Train Team**: Ensure team understands new architecture

For questions or issues, refer to:
- Cloudflare Workers docs: https://developers.cloudflare.com/workers/
- 1Password Connect docs: https://developer.1password.com/docs/connect/
- ChittyOS documentation: /Users/nb/Projects/development/CLAUDE.md