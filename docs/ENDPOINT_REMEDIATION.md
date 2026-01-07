# ChittyOS Endpoint Remediation Plan

## Overview

This document outlines the remediation plan for unifying and de-duplicating endpoints across the ChittyOS ecosystem after implementing the unified discovery and routing system in ChittyConnect.

## Current State (Before Remediation)

### Route Ownership Issues

Currently, these routes may be assigned to multiple Workers:

1. **`mcp.chitty.cc/*`** - May be claimed by individual services
2. **`api.chitty.cc/*`** - May be claimed by individual services
3. **`connect.chitty.cc/*`** - ChittyConnect (correct)

## Target State (After Remediation)

### Route Assignment

| Route Pattern | Assigned To | Purpose |
|---------------|-------------|---------|
| `connect.chitty.cc/*` | ChittyConnect | Main hub |
| `mcp.chitty.cc/*` | ChittyConnect | Unified MCP gateway |
| `api.chitty.cc/*` | ChittyConnect | Unified API gateway |
| `id.chitty.cc/*` | ChittyID | Direct service access |
| `auth.chitty.cc/*` | ChittyAuth | Direct service access |
| `registry.chitty.cc/*` | ChittyRegistry | Direct service access |
| `verify.chitty.cc/*` | ChittyVerify | Direct service access |
| `{service}.chitty.cc/*` | Individual services | Direct service access |

### Routing Architecture

```
Agent/Client
    ↓
mcp.chitty.cc or api.chitty.cc (ChittyConnect)
    ↓
┌─────────────────────────────┐
│ ChittyConnect Decision:     │
│ - Handle locally? (context) │
│ - Proxy to service?         │
└─────────────────────────────┘
    ↓
┌─────────────────────────────┐
│ If proxy:                   │
│ /{service}/mcp/* →          │
│   https://{service}.chitty.cc/mcp/* │
│                             │
│ If local:                   │
│ /api/context/*, /mcp/*, etc │
└─────────────────────────────┘
```

## Remediation Steps

### Phase 1: Identify Current Route Assignments

**Action**: Run Cloudflare inventory to find all route assignments

```bash
cd /Volumes/thumb/development/chittyconnect
npm run cloudflare:inventory
```

**Expected Output**:
- List of all Workers
- Route assignments for each Worker
- Identify conflicts (multiple Workers claiming same route)

### Phase 2: Document Competing Routes

**Create file**: `docs/COMPETING_ROUTES.md`

**Format**:
```markdown
## Route: mcp.chitty.cc/*

Currently assigned to:
- ChittyConnect (✓ correct)
- ChittyID (❌ should be removed)
- ChittyAuth (❌ should be removed)

Action: Unassign from ChittyID and ChittyAuth
```

### Phase 3: Unassign Routes from Individual Services

**For each competing service**:

1. **ChittyID** (if claiming mcp.chitty.cc or api.chitty.cc):
   ```bash
   cd ../chittyid
   # Edit wrangler.toml - remove competing routes
   # Keep: id.chitty.cc/*
   # Remove: mcp.chitty.cc/*, api.chitty.cc/*
   ```

2. **ChittyAuth**:
   ```bash
   cd ../chittyauth
   # Edit wrangler.toml
   # Keep: auth.chitty.cc/*
   # Remove: mcp.chitty.cc/*, api.chitty.cc/*
   ```

3. **ChittyRegistry**:
   ```bash
   cd ../chittyregistry
   # Edit wrangler.toml
   # Keep: registry.chitty.cc/*
   # Remove: mcp.chitty.cc/*, api.chitty.cc/*
   ```

4. **ChittyVerify**:
   ```bash
   cd ../chittyverify
   # Edit wrangler.toml
   # Keep: verify.chitty.cc/*
   # Remove: mcp.chitty.cc/*, api.chitty.cc/*
   ```

### Phase 4: Verify ChittyConnect Has Correct Routes

**File**: `wrangler.toml` (ChittyConnect)

**Ensure these routes are present**:

```toml
[env.production]
routes = [
  { pattern = "connect.chitty.cc/*", zone_name = "chitty.cc" },
  { pattern = "mcp.chitty.cc/*", zone_name = "chitty.cc" },
  { pattern = "api.chitty.cc/*", zone_name = "chitty.cc" }
]
```

### Phase 5: Update Service Integrations

**Services that call ChittyConnect**:

1. **ChittyID** - Update to call via unified gateway (optional, direct still works)
2. **ChittyAuth** - Update to call via unified gateway
3. **Desktop Clients** - Update to use `mcp.chitty.cc` and `api.chitty.cc`
4. **MCP Server Config** - Update Claude Desktop config

**Example Update (chittyid/src/integrations/chittyconnect.js)**:

```javascript
// OLD
const response = await fetch('https://connect.chitty.cc/api/context/files', ...)

// NEW (optional - both work, but unified is preferred for consistency)
const response = await fetch('https://api.chitty.cc/api/context/files', ...)
```

### Phase 6: Deploy Services in Order

**Deployment Sequence** (to avoid breaking changes):

1. **ChittyConnect** (main hub - must be first)
   ```bash
   cd chittyconnect
   git push origin main  # Triggers CI/CD
   ```

2. **Wait for ChittyConnect deployment to complete**

3. **Individual Services** (can be deployed in parallel after ChittyConnect is live)
   ```bash
   # Each service
   cd ../chittyid && git push origin main
   cd ../chittyauth && git push origin main
   cd ../chittyregistry && git push origin main
   cd ../chittyverify && git push origin main
   ```

## Verification

### Step 1: Route Assignment Verification

```bash
# Check that routes are correctly assigned
curl https://mcp.chitty.cc/health
# Should return ChittyConnect health

curl https://api.chitty.cc/api/health
# Should return ChittyConnect API health

curl https://id.chitty.cc/health
# Should return ChittyID health
```

### Step 2: Proxy Verification

```bash
# Test service proxy through ChittyConnect
curl https://api.chitty.cc/chittyid/api/health
# Should proxy to ChittyID

curl https://mcp.chitty.cc/chittyid/mcp/tools/list
# Should proxy to ChittyID MCP
```

### Step 3: Discovery Verification

```bash
# Test discovery endpoint
curl https://connect.chitty.cc/.well-known/chitty.json
# Should return full service list

curl https://mcp.chitty.cc/.well-known/chitty.json
# Should return same discovery document

curl https://api.chitty.cc/.well-known/chitty.json
# Should return same discovery document
```

## Rollback Plan

If issues occur:

1. **Immediate**: Keep direct service routes working (`id.chitty.cc`, etc.)
2. **Rollback ChittyConnect**: Use wrangler rollback
   ```bash
   npx wrangler rollback --env production
   ```
3. **Re-assign routes temporarily**: Add routes back to individual services via Cloudflare dashboard

## Monitoring

### Key Metrics to Watch

1. **Request Success Rate**: Should remain > 99.5%
2. **Latency**: Proxying adds ~50-100ms, acceptable
3. **Error Rate**: Should not increase
4. **Discovery Endpoint**: Should respond < 100ms

### Alerts

Set up alerts for:
- 5xx errors from mcp.chitty.cc or api.chitty.cc
- Discovery endpoint returning errors
- Proxy routes timing out

## Timeline

| Phase | Duration | Owner |
|-------|----------|-------|
| 1. Identify routes | 30 min | DevOps |
| 2. Document conflicts | 1 hour | Architecture |
| 3. Unassign routes | 2 hours | DevOps |
| 4. Verify config | 30 min | DevOps |
| 5. Update integrations | 2 hours | Engineering |
| 6. Deploy | 4 hours | DevOps (staged) |
| **Total** | **10 hours** | **Staged over 2 days** |

## Success Criteria

- ✅ All routes correctly assigned (no conflicts)
- ✅ Discovery endpoint working across all domains
- ✅ Service proxies functional
- ✅ Direct service access still works
- ✅ Zero downtime during migration
- ✅ <1% error rate increase
- ✅ All health checks passing

## Notes

- **Backward Compatibility**: Direct service URLs (e.g., `id.chitty.cc`) continue to work
- **Gradual Migration**: Agents can migrate to unified endpoints over time
- **No Breaking Changes**: Existing integrations continue working
- **Optional**: Services can choose to use unified endpoints or direct access

## References

- [Unified Discovery & Routing Plan](/Users/nb/.claude/plans/dreamy-stirring-rose.md)
- [ChittyConnect Architecture](./ARCHITECTURE_ANALYSIS.md)
- [Cloudflare Routes Documentation](https://developers.cloudflare.com/workers/configuration/routing/)
