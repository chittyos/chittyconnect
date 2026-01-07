# Credential Provisioning Service

ChittyConnect now acts as the central credential management service for the ChittyOS ecosystem. Services can request appropriately scoped credentials (like Cloudflare API tokens) through a secure API, rather than directly accessing sensitive root credentials.

## Architecture

```
┌─────────────────┐
│  GitHub Actions │
│   (Service)     │
└────────┬────────┘
         │ 1. Request credential
         ▼
┌─────────────────────────┐
│   ChittyConnect API     │
│  /api/credentials/*     │
└────────┬────────────────┘
         │ 2. Authenticate request
         │ 3. Check rate limits
         ▼
┌─────────────────────────┐
│ CredentialProvisioner   │
│      (Service)          │
└────────┬────────────────┘
         │ 4. Retrieve make_api_key from env
         │ 5. Create scoped token via Cloudflare API
         ▼
┌─────────────────────────┐
│   Cloudflare API        │
│  (Token Creation)       │
└────────┬────────────────┘
         │ 6. Return scoped token
         ▼
┌─────────────────────────┐
│   ChittyChronicle +     │
│   D1 Audit Trail        │
└─────────────────────────┘
```

## Setup

### 1. Apply Database Migration

```bash
# Local development
wrangler d1 execute chittyconnect --local --file=migrations/001_credential_provisions.sql

# Staging
wrangler d1 execute chittyconnect --env=staging --file=migrations/001_credential_provisions.sql

# Production
wrangler d1 execute chittyconnect-production --env=production --file=migrations/001_credential_provisions.sql
```

### 2. Set Required Secrets

Retrieve credentials from 1Password and set as Wrangler secrets:

```bash
# Get the make_api_key from 1Password
op read "op://Private/gxyne23yqngvk2nzjwl62uakx4/m4unvf5sbz3rm7ny2ys5siy5om/make_api_key"

# Set as Wrangler secret
echo "paste_the_key_here" | wrangler secret put CLOUDFLARE_MAKE_API_KEY

# Get account_id from 1Password (optional - defaults to 0bc21e3a5a9de1a4cc843be9c3e98121)
op read "op://Private/gxyne23yqngvk2nzjwl62uakx4/ChittyCorp LLC/account_id"

# Set as Wrangler secret (optional)
echo "paste_the_account_id_here" | wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

For staging/production environments, add `--env=staging` or `--env=production` to the wrangler commands.

### 3. Verify Setup

```bash
# Check health endpoint
curl https://connect.chitty.cc/api/credentials/health \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Expected response:
```json
{
  "status": "healthy",
  "checks": {
    "cloudflare_make_api_key": "configured",
    "cloudflare_account_id": "configured",
    "database": "connected",
    "rate_limit": "available",
    "chronicle": "configured"
  },
  "timestamp": "2025-11-06T10:00:00Z"
}
```

## API Endpoints

### POST /api/credentials/provision

Provision a new credential for a service.

**Authentication:** Required (ChittyAuth token or ChittyConnect API key)

**Rate Limit:** 10 provisions per hour per requesting service

**Request:**
```json
{
  "type": "cloudflare_workers_deploy",
  "context": {
    "service": "chittyregister",
    "purpose": "github_actions"
  }
}
```

**Response:**
```json
{
  "success": true,
  "credential": {
    "type": "cloudflare_api_token",
    "value": "your_generated_token_here",
    "expires_at": "2026-11-06T00:00:00Z",
    "scopes": [
      "Workers Scripts Write",
      "Workers KV Storage Write",
      "Account Settings Read"
    ],
    "account_id": "0bc21e3a5a9de1a4cc843be9c3e98121",
    "token_id": "xxx"
  },
  "usage_instructions": {
    "github_secret_name": "CLOUDFLARE_API_TOKEN",
    "command": "gh secret set CLOUDFLARE_API_TOKEN --body \"token_value\"",
    "wrangler_command": "wrangler secret put CLOUDFLARE_API_TOKEN",
    "note": "This token has Workers Scripts Write, KV Write, and Account Settings Read permissions"
  }
}
```

### GET /api/credentials/types

List all supported credential types.

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "types": [
    {
      "type": "cloudflare_workers_deploy",
      "description": "Cloudflare Workers deployment token with write permissions",
      "required_context": ["service"],
      "optional_context": ["purpose"],
      "scopes": ["Workers Scripts Write", "Workers KV Storage Write", "Account Settings Read"],
      "ttl": "365 days",
      "status": "available"
    },
    {
      "type": "cloudflare_workers_read",
      "description": "Read-only Cloudflare Workers token",
      "required_context": ["service"],
      "optional_context": ["purpose"],
      "scopes": ["Workers Scripts Read", "Account Settings Read"],
      "ttl": "90 days",
      "status": "available"
    }
  ],
  "metadata": {
    "timestamp": "2025-11-06T10:00:00Z",
    "total": 6,
    "available": 2
  }
}
```

### GET /api/credentials/audit

Get credential provisioning audit log.

**Authentication:** Required

**Query Parameters:**
- `limit` - Number of records (default: 50, max: 500)
- `offset` - Pagination offset
- `service` - Filter by service name
- `type` - Filter by credential type

**Response:**
```json
{
  "success": true,
  "provisions": [
    {
      "id": 1,
      "type": "cloudflare_workers_deploy",
      "service": "chittyregister",
      "purpose": "github_actions",
      "requesting_service": "chittyconnect-api-client",
      "token_id": "xxx",
      "expires_at": "2026-11-06T00:00:00Z",
      "created_at": "2025-11-06T10:00:00Z",
      "revoked_at": null
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

### DELETE /api/credentials/revoke

Revoke a previously provisioned credential.

**Authentication:** Required

**Request:**
```json
{
  "token_id": "xxx"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Token revoked successfully",
  "token_id": "xxx",
  "timestamp": "2025-11-06T10:00:00Z"
}
```

### GET /api/credentials/health

Check credential provisioning service health.

**Authentication:** Required

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "cloudflare_make_api_key": "configured",
    "cloudflare_account_id": "configured",
    "database": "connected",
    "rate_limit": "available",
    "chronicle": "configured"
  },
  "timestamp": "2025-11-06T10:00:00Z"
}
```

## Usage Examples

### For ChittyRegister GitHub Actions

```bash
# 1. Request a deployment token from ChittyConnect
curl -X POST https://connect.chitty.cc/api/credentials/provision \
  -H "Authorization: Bearer $CHITTYCONNECT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cloudflare_workers_deploy",
    "context": {
      "service": "chittyregister",
      "purpose": "github_actions"
    }
  }' | jq -r '.credential.value'

# 2. Store the token as a GitHub secret
gh secret set CLOUDFLARE_API_TOKEN --body "$TOKEN_VALUE"

# 3. Use in GitHub Actions workflow
# .github/workflows/deploy.yml
# - uses: cloudflare/wrangler-action@v3
#   with:
#     apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### For Development

```bash
# List available credential types
curl https://connect.chitty.cc/api/credentials/types \
  -H "Authorization: Bearer $API_KEY" | jq .

# Check service health
curl https://connect.chitty.cc/api/credentials/health \
  -H "Authorization: Bearer $API_KEY" | jq .

# View audit log
curl "https://connect.chitty.cc/api/credentials/audit?service=chittyregister" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

## Supported Credential Types

### Available Now

1. **cloudflare_workers_deploy** - Deployment token with write permissions
   - Scopes: Workers Scripts Write, KV Write, Account Settings Read
   - TTL: 365 days
   - Use for: GitHub Actions deployments, automated deployments

2. **cloudflare_workers_read** - Read-only token
   - Scopes: Workers Scripts Read, Account Settings Read
   - TTL: 90 days
   - Use for: Monitoring, auditing, status checks

### Planned (Not Yet Implemented)

3. **github_deploy_token** - GitHub deployment token
4. **neon_database_connection** - Neon PostgreSQL connection string
5. **openai_api_key** - OpenAI API key
6. **notion_integration_token** - Notion integration token

To request implementation of planned credential types, create an issue or contact the ChittyOS team.

## Security Principles

### Never Return Raw Root Credentials

The `CLOUDFLARE_MAKE_API_KEY` is never returned to clients. It is only used internally to create scoped, time-limited tokens with minimal necessary permissions.

### Principle of Least Privilege

Each provisioned token has only the permissions required for its specific use case:
- Deployment tokens: Write access to Workers Scripts and KV
- Read-only tokens: Read access only
- Time-limited: All tokens have expiration dates

### Audit Trail

Every credential provision is logged to:
1. **ChittyChronicle** - Central audit logging service
2. **D1 Database** - Local audit table for quick queries

Audit logs include:
- Credential type
- Target service
- Requesting service
- Token ID (for revocation)
- Timestamps (created, expires, revoked)

### Rate Limiting

Credential provisioning is rate-limited to prevent abuse:
- **10 provisions per hour** per requesting service
- Rate limits enforced at the service level
- Exceeded limits return HTTP 429

### Token Lifecycle Management

1. **Creation** - Token created via Cloudflare API with specific scopes
2. **Provision** - Token returned to requesting service
3. **Usage** - Service uses token for authorized operations
4. **Expiration** - Token automatically expires (365 days for deploy, 90 days for read)
5. **Revocation** - Manual revocation via DELETE /api/credentials/revoke

## Monitoring & Operations

### View Recent Provisions

```bash
curl "https://connect.chitty.cc/api/credentials/audit?limit=10" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

### Check for Expired Tokens

```sql
-- Run via wrangler d1
SELECT * FROM credential_provisions
WHERE expires_at < datetime('now')
  AND revoked_at IS NULL;
```

### Revoke a Token

```bash
curl -X DELETE https://connect.chitty.cc/api/credentials/revoke \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token_id": "xxx"}'
```

### Monitor Rate Limits

Rate limit counters are stored in the `RATE_LIMIT` KV namespace with keys:
- Pattern: `credential:ratelimit:{service}:{hour_timestamp}`
- TTL: 1 hour

## Troubleshooting

### Error: "CLOUDFLARE_MAKE_API_KEY not configured"

The root Cloudflare API key hasn't been set. Retrieve from 1Password and set via:

```bash
op read "op://Private/gxyne23yqngvk2nzjwl62uakx4/m4unvf5sbz3rm7ny2ys5siy5om/make_api_key" | \
  wrangler secret put CLOUDFLARE_MAKE_API_KEY
```

### Error: "Rate limit exceeded"

The requesting service has exceeded 10 provisions per hour. Wait for the hour to roll over, or contact an administrator to manually reset the rate limit counter.

### Error: "Failed to create Cloudflare token: 401"

The `CLOUDFLARE_MAKE_API_KEY` is invalid or expired. Verify the key in 1Password and update the secret.

### Health Check Shows "degraded"

Check which components are failing:

```bash
curl https://connect.chitty.cc/api/credentials/health \
  -H "Authorization: Bearer $API_KEY" | jq .checks
```

Common issues:
- `cloudflare_make_api_key: "missing"` - Secret not set
- `database: "error"` - D1 database connection failed
- `chronicle: "missing"` - ChittyChronicle token not set

## Implementation Files

- **Service:** `src/services/credential-provisioner.js`
- **Routes:** `src/api/routes/credentials.js`
- **Migration:** `migrations/001_credential_provisions.sql`
- **Configuration:** `wrangler.toml` (secrets section)

## Future Enhancements

### Planned Features

1. **Automatic Token Rotation**
   - Monitor token expiration
   - Auto-provision replacement tokens
   - Update GitHub secrets automatically

2. **Token Usage Tracking**
   - Track API calls made with provisioned tokens
   - Alert on unusual usage patterns
   - Generate usage reports

3. **Service-Specific Policies**
   - Define allowed credential types per service
   - Enforce approval workflows for sensitive credentials
   - Multi-factor authentication for production provisions

4. **Integration with 1Password CLI**
   - Direct retrieval from 1Password vaults
   - No need to set Wrangler secrets manually
   - Automatic credential rotation

5. **Additional Credential Types**
   - GitHub deployment tokens
   - Neon database connections
   - OpenAI API keys
   - Notion integration tokens
   - Custom credential providers

## Contributing

To add support for a new credential type:

1. Update `CredentialProvisioner` class in `src/services/credential-provisioner.js`
2. Add a new `provision{Type}` method
3. Update the `/api/credentials/types` response in `src/api/routes/credentials.js`
4. Add tests for the new credential type
5. Document the new type in this file

## Support

For questions or issues with credential provisioning:
- Check the troubleshooting section above
- Review audit logs: `/api/credentials/audit`
- Check health status: `/api/credentials/health`
- Contact ChittyOS infrastructure team
