# ChittyConnect - Access Provisioning Broker

**Version**: 1.0.0
**Status**: Implementation in Progress
**Updated**: October 21, 2025

---

## Overview

ChittyConnect is an **access provisioning broker**, not an executor. It authenticates identity, observes context, provisions credentials, and manages access lifecycle - but the user executes actions themselves with provisioned credentials.

---

## Architecture Pattern

```
┌──────────────────────────────────────────────────────────────┐
│                    Access Provisioning Flow                   │
└──────────────────────────────────────────────────────────────┘

1. AUTHENTICATE
   User → ChittyConnect.authenticate_chittyid()
   ↓
   Verify ChittyID ownership (JWT/signature)
   ↓
   Return: { session_token, chittyid, expires_at }

2. REQUEST ACCESS
   User → ChittyConnect.request_access(session_token, resource, context)
   ↓
   Observe context (what, where, when)
   Validate authority (ChittyAuth)
   ↓
   Provision credentials via 1Password
   ↓
   Return: { credential_path, expires_at, instructions }

3. EXECUTE
   User → Execute action with provisioned credentials
   ↓
   Example: git push using provisioned GitHub token
   ↓
   ChittyConnect observes (but does NOT execute)

4. REVOKE
   ChittyConnect → Automatic revocation when TTL expires
   ↓
   Credential lifecycle managed by ChittyConnect
```

---

## Core Components

### 1. Authentication Service

**Endpoint**: `POST /api/auth/chittyid`

**Request**:
```json
{
  "chittyid": "CHITTY-PEO-123456-ABC",
  "proof": "JWT_TOKEN_OR_SIGNATURE"
}
```

**Response**:
```json
{
  "success": true,
  "session_token": "sess_abc123...",
  "chittyid": "CHITTY-PEO-123456-ABC",
  "expires_at": "2025-10-21T18:00:00Z",
  "ttl_seconds": 3600
}
```

**Implementation**:
- Verify JWT signature against ChittyAuth
- Validate ChittyID format and checksum
- Create session in KV with TTL
- Return session token for subsequent requests

---

### 2. Context Observer

**Endpoint**: `POST /api/provision/observe`

**Request**:
```json
{
  "session_token": "sess_abc123...",
  "context": {
    "action": "git_push",
    "target": "github.com/chittyos/chittyos-data",
    "location": "/Users/nb/.claude/projects/-/CHITTYOS/chittyos-data",
    "branch": "main"
  }
}
```

**Response**:
```json
{
  "success": true,
  "observation_id": "obs_xyz789...",
  "inferred_resource": "github:push:chittyos-data",
  "required_permissions": ["repo", "workflow"],
  "next_step": "request_access"
}
```

**Implementation**:
- Parse context to understand user intent
- Infer required resource and permissions
- Validate request against ChittyAuth policies
- Log observation to ChittyChronicle

---

### 3. Credential Provisioner

**Endpoint**: `POST /api/provision/request`

**Request**:
```json
{
  "session_token": "sess_abc123...",
  "observation_id": "obs_xyz789...",
  "resource": "github:push:chittyos-data",
  "duration": "1h"
}
```

**Response**:
```json
{
  "success": true,
  "provision_id": "prov_def456...",
  "credential_source": "1password",
  "credential_reference": "op://ChittyOS/github-chittyos-data/token",
  "service_account": "chittyos-automation@github.com",
  "expires_at": "2025-10-21T18:00:00Z",
  "instructions": {
    "method": "environment_variable",
    "variable_name": "GITHUB_TOKEN",
    "command": "op run --env-file=- -- git push origin main"
  }
}
```

**Implementation**:
- Validate session token and observation
- Check ChittyAuth for authorization
- Provision credentials via 1Password Connect API
- Create access record in D1
- Return credential reference (NOT the credential itself)

---

### 4. Access Lifecycle Manager

**Automatic Background Process**

**Responsibilities**:
- Monitor active provisioned access records
- Revoke credentials when TTL expires
- Send notifications before expiration
- Log lifecycle events to ChittyChronicle

**Database Schema**:
```sql
CREATE TABLE access_provisions (
  provision_id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL,
  chittyid TEXT NOT NULL,
  resource TEXT NOT NULL,
  credential_reference TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  status TEXT DEFAULT 'active' -- active, expired, revoked
);
```

**Cron Job** (via Cloudflare Scheduled Events):
```javascript
// Every 5 minutes
export default {
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();

    // Find expired provisions
    const expired = await env.DB.prepare(`
      SELECT * FROM access_provisions
      WHERE expires_at < ? AND status = 'active'
    `).bind(now).all();

    // Revoke each
    for (const provision of expired.results) {
      await revokeAccess(provision, env);
    }
  }
}
```

---

## Integration with 1Password

### 1Password Connect API

**Setup**:
```bash
# Store 1Password Connect credentials
wrangler secret put ONEPASSWORD_CONNECT_HOST
wrangler secret put ONEPASSWORD_CONNECT_TOKEN
```

**Provisioning Flow**:
```javascript
async function provisionCredential(resource, chittyid, env) {
  const vaultId = await getVaultId('ChittyOS', env);
  const itemId = await getItemId(vaultId, resource, env);

  // Create a temporary access token for the credential
  const accessToken = await create1PasswordAccessToken(
    itemId,
    chittyid,
    { ttl: 3600 }, // 1 hour
    env
  );

  return {
    credential_reference: `op://ChittyOS/${resource}/token`,
    access_token: accessToken,
    expires_at: new Date(Date.now() + 3600000).toISOString()
  };
}
```

**Revocation**:
```javascript
async function revokeAccess(provision, env) {
  // Revoke 1Password access token
  await revoke1PasswordAccessToken(provision.access_token, env);

  // Update database
  await env.DB.prepare(`
    UPDATE access_provisions
    SET status = 'revoked', revoked_at = datetime('now')
    WHERE provision_id = ?
  `).bind(provision.provision_id).run();

  // Log to ChittyChronicle
  await logToChronicle({
    event: 'access.revoked',
    provision_id: provision.provision_id,
    chittyid: provision.chittyid,
    resource: provision.resource
  }, env);
}
```

---

## MCP Tools (Broker-Only Mode)

### Before (Executor Mode) ❌
```javascript
{
  name: 'github_push_commits',
  description: 'Push local git commits to GitHub repository using API',
  handler: async (args) => {
    // ❌ ChittyConnect executes the push
    execSync(`git push ${remoteUrl} ${branch}`, { cwd: repoPath });
    return { success: true };
  }
}
```

### After (Broker Mode) ✅
```javascript
{
  name: 'provision_github_access',
  description: 'Provision GitHub push access for authenticated ChittyID',
  handler: async (args) => {
    // ✅ ChittyConnect provisions credentials
    const provision = await provisionCredential(
      'github:push:' + args.repo,
      args.chittyid,
      env
    );

    return {
      success: true,
      provision_id: provision.provision_id,
      instructions: {
        command: `op run --env-file=- -- git push origin ${args.branch}`,
        credential_path: provision.credential_reference,
        expires_at: provision.expires_at
      }
    };
  }
}
```

---

## Updated MCP Tool List

### Authentication
1. **authenticate_chittyid** - Verify ChittyID ownership
2. **refresh_session** - Extend session TTL
3. **revoke_session** - End session and revoke all access

### Context & Provisioning
4. **observe_context** - Register user intent
5. **request_access** - Provision credentials for resource
6. **list_active_access** - Show active provisions
7. **revoke_access** - Manually revoke provision

### Resource-Specific (Broker Mode)
8. **provision_github_access** - GitHub repo access
9. **provision_sendgrid_access** - SendGrid API access
10. **provision_notion_access** - Notion API access
11. **provision_1password_access** - 1Password vault access

---

## Example User Flow

### Scenario: Push commits to chittyos-data

```bash
# 1. Authenticate with ChittyID
curl -X POST https://connect.chitty.cc/api/auth/chittyid \
  -H "Content-Type: application/json" \
  -d '{
    "chittyid": "CHITTY-PEO-123456-ABC",
    "proof": "eyJhbGc..."
  }'

# Response:
# {
#   "session_token": "sess_abc123...",
#   "expires_at": "2025-10-21T18:00:00Z"
# }

# 2. Request GitHub push access
curl -X POST https://connect.chitty.cc/api/provision/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sess_abc123..." \
  -d '{
    "resource": "github:push:chittyos-data",
    "context": {
      "action": "git_push",
      "location": "/Users/nb/.claude/projects/-/CHITTYOS/chittyos-data",
      "branch": "main"
    },
    "duration": "1h"
  }'

# Response:
# {
#   "provision_id": "prov_def456...",
#   "credential_reference": "op://ChittyOS/github-chittyos-data/token",
#   "expires_at": "2025-10-21T18:00:00Z",
#   "instructions": {
#     "command": "op run --env-file=- -- git push origin main"
#   }
# }

# 3. Execute git push with provisioned credentials
cd /Users/nb/.claude/projects/-/CHITTYOS/chittyos-data
op run --env-file=- -- git push origin main

# ChittyConnect observes but does NOT execute
# Credentials auto-revoke at 18:00:00Z
```

---

## Security Model

### Zero Trust Principles
- **Always authenticate**: Every request requires valid ChittyID
- **Context-aware**: Permissions based on what/where/when
- **Time-limited**: All access has TTL (default 1h, max 24h)
- **Audit everything**: All provisioning logged to ChittyChronicle

### Credential Isolation
- Credentials never returned directly to user
- Accessed via 1Password CLI or environment injection
- Automatic revocation on expiry
- No long-lived tokens

### Authority Chain
```
User (ChittyID)
  ↓
ChittyConnect (Broker)
  ↓
ChittyAuth (Authorization)
  ↓
1Password (Credential Store)
  ↓
External Service (GitHub, etc.)
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure ✅
- [x] Rate limiting middleware
- [x] Circuit breakers
- [x] Error handling
- [x] ChittyOS ecosystem integration

### Phase 2: Authentication (In Progress)
- [ ] ChittyID authentication endpoint
- [ ] Session management (KV-based)
- [ ] JWT verification with ChittyAuth
- [ ] Session refresh mechanism

### Phase 3: Provisioning
- [ ] Context observer implementation
- [ ] 1Password Connect API integration
- [ ] Credential provisioning flow
- [ ] Resource-to-credential mapping

### Phase 4: Lifecycle
- [ ] Access provisions database schema
- [ ] TTL-based revocation cron
- [ ] Pre-expiry notifications
- [ ] ChittyChronicle integration

### Phase 5: MCP Tools
- [ ] Remove executor tools (github_push_commits)
- [ ] Add broker tools (provision_github_access)
- [ ] Update tool descriptions
- [ ] Add usage examples

### Phase 6: Testing
- [ ] Authentication flow tests
- [ ] Provisioning flow tests
- [ ] Lifecycle management tests
- [ ] End-to-end integration tests

### Phase 7: Documentation
- [ ] API reference
- [ ] User guide
- [ ] Security documentation
- [ ] Integration examples

---

## Timeline

- **Phase 2 (Auth)**: 2-3 days
- **Phase 3 (Provisioning)**: 3-4 days
- **Phase 4 (Lifecycle)**: 2-3 days
- **Phase 5 (MCP)**: 1-2 days
- **Phase 6 (Testing)**: 2-3 days
- **Phase 7 (Docs)**: 1-2 days

**Total**: ~2-3 weeks to full implementation

---

## Related Services

- **ChittyAuth**: Authorization and policy enforcement
- **ChittyID**: Identity authority and minting
- **ChittyChronicle**: Audit logging
- **1Password**: Credential storage and provisioning
- **ChittyRegistry**: Service discovery

---

**Status**: 🟡 Design Complete, Implementation Starting
**Next**: Implement ChittyID authentication endpoint
