# GitHub App Setup Guide

Complete guide for creating and configuring the ChittyConnect GitHub App.

## Overview

ChittyConnect integrates with GitHub as a GitHub App to:
- Track all GitHub activity with ChittyIDs
- Process webhooks with fast-ack design (<100ms)
- Mint unique ChittyIDs for installations, events, commits, PRs, and issues
- Log all activity to ChittyChronicle
- Provide MCP tools for GitHub integration

## Prerequisites

- GitHub account with organization (for GitHub Apps)
- ChittyConnect deployed to Cloudflare Workers
- Access to Cloudflare dashboard for secrets management

## Step 1: Create GitHub App

### Option A: Using Manifest (Recommended)

1. Navigate to: https://github.com/settings/apps/new

2. Click "Create a GitHub App from a manifest"

3. Select your organization

4. Paste the contents of `github-app-manifest.json`:

```json
{
  "name": "ChittyConnect",
  "url": "https://connect.chitty.cc",
  "hook_attributes": {
    "url": "https://connect.chitty.cc/integrations/github/webhook",
    "active": true
  },
  "redirect_url": "https://connect.chitty.cc/integrations/github/callback",
  ...
}
```

5. Click "Create GitHub App"

### Option B: Manual Setup

1. Go to: https://github.com/settings/apps/new

2. Fill in basic information:
   - **GitHub App name**: ChittyConnect
   - **Homepage URL**: https://connect.chitty.cc
   - **Webhook URL**: https://connect.chitty.cc/integrations/github/webhook
   - **Webhook secret**: Generate a strong secret (save for later)

3. Set permissions:
   - **Repository permissions:**
     - Contents: Read
     - Issues: Read & write
     - Pull requests: Read & write
     - Metadata: Read (automatic)
   - **Organization permissions:**
     - Members: Read (optional)

4. Subscribe to events:
   - installation
   - installation_repositories
   - push
   - pull_request
   - pull_request_review
   - pull_request_review_comment
   - issues
   - issue_comment
   - commit_comment
   - create
   - delete
   - fork
   - release
   - star
   - watch

5. Set **Callback URL**: https://connect.chitty.cc/integrations/github/callback

6. Choose **Where can this GitHub App be installed?**:
   - Only on this account (recommended for private use)
   - Any account (for public distribution)

7. Click **Create GitHub App**

## Step 2: Generate Private Key

1. After creating the app, scroll down to **Private keys**

2. Click **Generate a private key**

3. Download the `.pem` file (keep it secure!)

4. Save the **App ID** (shown at the top of the page)

## Step 3: Configure Cloudflare Secrets

Set the following secrets in Cloudflare Workers:

```bash
# GitHub App ID
npx wrangler secret put GITHUB_APP_ID

# GitHub App Private Key (paste entire PEM file contents)
npx wrangler secret put GITHUB_APP_PRIVATE_KEY

# GitHub Webhook Secret
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

**Important**: When setting `GITHUB_APP_PRIVATE_KEY`, paste the entire PEM file including:
```
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
```

## Step 4: Install GitHub App

1. Go to your GitHub App settings page:
   https://github.com/settings/apps/[your-app-name]

2. Click **Install App** in the left sidebar

3. Choose which account to install it on

4. Select repositories:
   - All repositories (grants access to all current and future repos)
   - Only select repositories (choose specific repos)

5. Click **Install**

6. You'll be redirected to ChittyConnect callback URL:
   ```
   https://connect.chitty.cc/integrations/github/callback?installation_id=...
   ```

7. ChittyConnect will automatically:
   - Fetch installation details
   - Mint ChittyID for the installation
   - Initialize ChittyDNA record
   - Store in D1 database
   - Cache installation token
   - Log to ChittyChronicle
   - Show success page

## Step 5: Verify Installation

### Check Webhook Delivery

1. Go to: https://github.com/settings/apps/[your-app-name]/advanced

2. Click on **Recent Deliveries**

3. Verify webhook payloads are being delivered successfully (200 OK)

### Test Webhook Events

1. Create a test issue in an installed repository

2. Check Cloudflare Workers logs:
   ```bash
   npx wrangler tail
   ```

3. Look for:
   ```
   [GitHub Webhook] Queued issues in XXms
   [GitHub Processor] Processing issues event: ...
   [GitHub Processor] Event ChittyID: CHITTY-EVNT-...
   ```

### Query Installation

Use the REST API to verify installation:

```bash
curl https://connect.chitty.cc/api/github/installations
```

Or use MCP:

```json
{
  "method": "tools/call",
  "params": {
    "name": "github_list_installations"
  }
}
```

## Architecture

### Fast-Ack Webhook Design

ChittyConnect uses a fast-acknowledgment pattern:

```
GitHub → ChittyConnect Webhook
           ↓
    1. Verify Signature (HMAC-SHA256)
    2. Check Idempotency (IDEMP_KV)
    3. Queue Event (EVENT_Q)
    4. Return 200 OK (<100ms)
           ↓
    Queue Consumer (async)
           ↓
    Process Event:
    - Mint ChittyID
    - Initialize ChittyDNA
    - Log to ChittyChronicle
    - Execute actions
```

### OAuth Flow

Installation callback flow:

```
User Installs App → GitHub → ChittyConnect Callback
                                    ↓
                    1. Fetch installation details
                    2. Mint ChittyID (CONTEXT type)
                    3. Initialize ChittyDNA
                    4. Store in D1 database
                    5. Cache installation token
                    6. Log to ChittyChronicle
                    7. Redirect to success page
```

## Security Best Practices

### Webhook Security

1. **Signature Verification**: All webhooks verified with HMAC-SHA256
2. **Constant-Time Comparison**: Prevents timing attacks
3. **Idempotency**: Prevents duplicate processing (24h TTL)
4. **Secrets Management**: All secrets in Cloudflare Workers secrets

### Token Management

1. **Installation Tokens**: Cached for 55 minutes (expire in 60)
2. **JWT Generation**: RS256 with 10-minute expiration
3. **Token Refresh**: Automatic refresh on expiration
4. **Secure Storage**: Tokens stored in TOKEN_KV namespace

### Rate Limiting

GitHub API rate limits:
- **REST API**: 5,000 requests/hour per installation
- **GraphQL API**: 5,000 points/hour per installation
- **Webhook Events**: No limit

ChittyConnect automatically handles:
- Token caching (reduces API calls)
- Graceful degradation on rate limits
- Exponential backoff on failures

## Troubleshooting

### Webhook Delivery Failures

**Problem**: Webhooks returning 401 Unauthorized

**Solution**: Verify webhook secret matches:
```bash
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

**Problem**: Webhooks timing out

**Solution**: Check fast-ack is working (<100ms response). Queue processing happens asynchronously.

### Installation Issues

**Problem**: Installation callback fails

**Solution**:
1. Check private key is correctly formatted (include BEGIN/END lines)
2. Verify App ID is correct
3. Check Cloudflare Workers logs for errors

**Problem**: ChittyID minting fails

**Solution**: Verify `CHITTY_ID_SERVICE_TOKEN` is set:
```bash
npx wrangler secret put CHITTY_ID_SERVICE_TOKEN
```

### Token Problems

**Problem**: Installation token expired

**Solution**: Token auto-refresh should handle this. Check TOKEN_KV namespace and expiration TTL (3300s = 55 minutes).

**Problem**: JWT generation fails

**Solution**: Verify private key format. Must be valid PEM format with RSA key.

## API Reference

### Webhook Endpoint

```
POST /integrations/github/webhook
```

**Headers:**
- `x-hub-signature-256`: HMAC-SHA256 signature
- `x-github-event`: Event type
- `x-github-delivery`: Unique delivery ID

**Response:**
```json
{
  "status": "ok",
  "deliveryId": "12345-67890",
  "eventType": "push",
  "responseTime": "45ms"
}
```

### OAuth Callback Endpoint

```
GET /integrations/github/callback?installation_id=123&setup_action=install
```

**Response**: Redirect to success page or error page

### Installation Details

```
GET /api/github/installations
```

**Response:**
```json
{
  "installations": [
    {
      "installationId": 123,
      "chittyId": "CHITTY-CONTEXT-...",
      "account": "myorg",
      "accountType": "Organization",
      "repositorySelection": "all"
    }
  ]
}
```

## Next Steps

1. **Install on repositories**: Add ChittyConnect to your repositories
2. **Test webhook events**: Create issues, PRs, commits
3. **Use MCP tools**: Access via Claude Code or other MCP clients
4. **Query REST API**: Integrate with other services
5. **Monitor ChittyChronicle**: View complete event timeline

## Support

- **Documentation**: https://docs.chitty.cc
- **GitHub**: https://github.com/chittyos/chittyconnect
- **Issues**: https://github.com/chittyos/chittyconnect/issues

---

**ChittyConnect™** - The AI-intelligent spine with ContextConsciousness™
Part of the ChittyOS ecosystem
