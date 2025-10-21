# GitHub App Setup Guide

## Overview

ChittyConnect integrates with GitHub via a GitHub App to provide:
- **Webhook Processing**: Fast-ack design for reliable event handling
- **Context-Aware Automation**: ChittyOS ecosystem integration
- **AI-Powered Workflows**: Intelligent routing and processing

## Quick Setup

### 1. Create GitHub App

```bash
# Navigate to GitHub > Settings > Developer settings > GitHub Apps
# Click "New GitHub App"

# Or use manifest URL:
https://github.com/settings/apps/new?manifest=https://connect.chitty.cc/github-app-manifest.json
```

### 2. Configure App

Use the provided `github-app-manifest.json` or manually configure:

**Basic Information**:
- **Name**: ChittyConnect - itsChitty™
- **Homepage URL**: https://connect.chitty.cc
- **Callback URL**: https://connect.chitty.cc/integrations/github/callback
- **Setup URL**: https://app.chitty.cc/integrations/github/setup
- **Webhook URL**: https://connect.chitty.cc/integrations/github/webhook
- **Webhook Secret**: Generate secure secret (store in Cloudflare Secrets)

**Permissions**:
- **Repository permissions**:
  - Actions: Read
  - Checks: Read & write
  - Contents: Read
  - Issues: Read & write
  - Pull requests: Read & write
  - Statuses: Read & write
  - Workflows: Read

- **Organization permissions**: None initially

**Subscribe to events**:
- `check_run`
- `check_suite`
- `issues`
- `issue_comment`
- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`
- `push`
- `workflow_run`
- `workflow_job`
- `status`

### 3. Generate Private Key

```bash
# In GitHub App settings, scroll to "Private keys"
# Click "Generate a private key"
# Download the PEM file
```

### 4. Store Secrets in Cloudflare

```bash
# GitHub App ID
npx wrangler secret put GITHUB_APP_ID
# Enter: <your-app-id>

# GitHub App Private Key (PEM format, PKCS#8)
npx wrangler secret put GITHUB_APP_PK
# Paste entire PEM file contents

# Webhook Secret
npx wrangler secret put GITHUB_WEBHOOK_SECRET
# Enter: <your-webhook-secret>
```

### 5. Install App

```bash
# Navigate to your GitHub App
# Click "Install App"
# Select repositories (or all repositories)
# Complete installation
```

## Architecture

### Webhook Processing Flow

```
GitHub Event
    ↓
ChittyConnect Webhook Endpoint
    ↓
1. Verify HMAC signature ✓
2. Check idempotency (IDEMP_KV) ✓
3. Queue event (EVENT_Q) ✓
4. Return 200 OK immediately
    ↓
Queue Consumer (async)
    ↓
1. Parse event
2. Mint ChittyID for event
3. Log to ChittyChronicle
4. Process with MCP tools
5. Dispatch actions
```

### Fast-Ack Design

**Response Time**: < 100ms
- Signature verification: ~10ms
- Idempotency check: ~5ms
- Queue dispatch: ~5ms
- Total: ~20-30ms

**Benefits**:
- GitHub webhook timeout: 10 seconds (we're well under)
- No duplicate processing
- Reliable event handling
- Async processing flexibility

## Event Processing

### Supported Events

| Event | ChittyOS Integration | Actions |
|-------|---------------------|---------|
| `pull_request` | ChittyCases (PR as case) | Auto-review, checks, labeling |
| `issue_comment` | ChittyChronicle (timeline) | Context analysis, auto-response |
| `check_run` | ChittyVerify | Verification status tracking |
| `workflow_run` | ChittySync | CI/CD integration |
| `push` | ChittyChronicle + DNA | Code evolution tracking |

### Event Normalization

All GitHub events are normalized to ChittyOS format:

```javascript
{
  chittyid: "CHITTY-EVNT-...",  // Minted via ChittyID
  type: "github.pull_request.opened",
  source: "github",
  payload: { /* original event */ },
  context: {
    repository: { /* ChittyID for repo */ },
    actor: { /* ChittyID for user */ },
    timestamp: "2025-10-20T...",
    ecosystem: { /* ChittyOS services involved */ }
  }
}
```

## OAuth Flow

### Installation Flow

1. User clicks "Install App" on GitHub
2. GitHub redirects to callback with `code` and `installation_id`
3. ChittyConnect exchanges code for installation token
4. Stores installation mapping in D1:
   ```sql
   installations (
     installation_id,
     chittyid,
     account_id,
     account_type,
     repository_selection,
     token_expires_at
   )
   ```
5. Initializes ChittyDNA record for installation
6. Redirects to success page

### Token Management

```javascript
// Installation tokens expire after 1 hour
// Stored in TOKEN_KV with automatic refresh

async function getInstallationToken(installationId) {
  // Check cache
  const cached = await TOKEN_KV.get(`gh:install:${installationId}`);
  if (cached) return JSON.parse(cached).token;

  // Refresh token
  const jwt = createJWT(GITHUB_APP_ID, GITHUB_APP_PK);
  const token = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` }
    }
  );

  // Cache with 55min TTL (5min buffer)
  await TOKEN_KV.put(
    `gh:install:${installationId}`,
    JSON.stringify(token),
    { expirationTtl: 3300 }
  );

  return token.token;
}
```

## Testing

### Local Development

```bash
# Use ngrok or similar for local webhook testing
ngrok http 8787

# Update webhook URL in GitHub App settings:
https://<your-ngrok-url>/integrations/github/webhook

# Start dev server
npm run dev
```

### Webhook Testing

```bash
# GitHub provides webhook delivery testing
# In App settings > Advanced > Recent Deliveries
# Click "Redeliver" to test

# Or use curl:
curl -X POST https://connect.chitty.cc/integrations/github/webhook \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: test-123" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"action":"ping"}'
```

## Monitoring

### Webhook Delivery Status

- Check GitHub App > Advanced > Recent Deliveries
- Monitor Cloudflare Workers logs
- Query IDEMP_KV for delivery tracking

### Metrics

```javascript
// Track in ChittyChronicle:
- Webhook delivery time
- Queue processing time
- Event type distribution
- Error rates
- ChittyOS service utilization
```

## Security

### Signature Verification

All webhook payloads are verified using HMAC-SHA256:

```javascript
const signature = hmac('sha256', GITHUB_WEBHOOK_SECRET, body);
const trusted = timingSafeEqual(signature, providedSignature);
```

### Idempotency

Duplicate deliveries are detected and rejected:

```javascript
const deliveryId = request.headers.get('X-GitHub-Delivery');
if (await IDEMP_KV.get(deliveryId)) {
  return new Response('ok', { status: 200 });
}
```

### Rate Limiting

- Webhook endpoints: No rate limit (GitHub controlled)
- API calls to GitHub: 5000/hour (via installation token)
- ChittyOS service calls: Per-service limits

## Troubleshooting

### Webhook Not Received

1. Check webhook URL is correct
2. Verify DNS resolution
3. Check Cloudflare Workers logs
4. Test webhook delivery in GitHub

### Signature Verification Failed

1. Verify webhook secret matches
2. Check raw body is used (not parsed)
3. Ensure constant-time comparison

### Queue Processing Slow

1. Check queue consumer metrics
2. Verify ChittyOS services are healthy
3. Monitor D1 database performance
4. Check KV operation latency

## References

- [GitHub Apps Documentation](https://docs.github.com/en/apps)
- [Webhook Events](https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads)
- [Authenticating as a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app)
