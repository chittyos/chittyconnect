# ChittyConnect Credential Bootstrap

## Overview

ChittyConnect needs service tokens to authenticate with other ChittyOS services (ChittyID, ChittyAuth, ChittyChronicle, etc.). This document explains how to bootstrap these credentials.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   1Password     │ ──► │  Cloudflare     │
│   (source)      │sync │  Secrets        │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ ChittyConnect   │
                        │ Worker (env)    │
                        └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ ChittyID │ │ChittyAuth│ │Chronicle │
              └──────────┘ └──────────┘ └──────────┘
```

**Key insight:** Credentials are synced at deploy time, NOT fetched at runtime. The 1Password Connect server is optional for hot-reload scenarios.

## Required Secrets

| Secret Name | Purpose | Source |
|-------------|---------|--------|
| `CHITTY_ID_TOKEN` | Authenticate to ChittyID | ChittyAuth |
| `CHITTY_AUTH_TOKEN` | Authenticate to ChittyAuth | ChittyAuth |
| `CHITTY_CHRONICLE_TOKEN` | Log to ChittyChronicle | ChittyAuth |
| `CHITTY_REGISTRY_TOKEN` | Query ChittyRegistry | ChittyAuth |
| `NEON_DATABASE_URL` | Database connection | Neon Console |
| `GITHUB_APP_ID` | GitHub App integration | GitHub |
| `GITHUB_APP_PK` | GitHub App private key | GitHub |
| `GITHUB_WEBHOOK_SECRET` | Verify GitHub webhooks | GitHub |
| `NOTION_TOKEN` | Notion integration | Notion |

## Bootstrap Process

### Option 1: Bootstrap Script (Recommended)

1. **Get the JWT_SECRET** from ChittyAuth:
   ```bash
   # In 1Password, find "ChittyAuth JWT Secret" in the Services vault
   # Or ask an admin who has access to Cloudflare secrets
   ```

2. **Run the bootstrap script**:
   ```bash
   cd /Volumes/chitty/github.com/CHITTYOS/chittyconnect
   JWT_SECRET="your-secret-here" node scripts/bootstrap-service-tokens.mjs
   ```

3. **Follow the output** to set Cloudflare secrets:
   ```bash
   echo "generated-token" | wrangler secret put CHITTY_ID_TOKEN --env production
   ```

4. **Insert token records** into the ChittyOS-Core database (SQL provided by script)

### Option 2: Manual via Wrangler

```bash
# Set each secret manually
wrangler secret put CHITTY_ID_TOKEN --env production
# Enter token when prompted

wrangler secret put CHITTY_AUTH_TOKEN --env production
# ...
```

### Option 3: CI/CD Pipeline (Future)

```yaml
# GitHub Actions example
- name: Sync secrets from 1Password
  env:
    OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
  run: |
    CHITTY_ID_TOKEN=$(op read "op://Services/ChittyConnect-Tokens/chitty-id-token")
    echo "$CHITTY_ID_TOKEN" | wrangler secret put CHITTY_ID_TOKEN --env production
```

## Credential Flow at Runtime

```
1. ChittyConnect receives request
2. Needs to call ChittyID service
3. Reads CHITTY_ID_TOKEN from env (Cloudflare Worker binding)
4. Calls id.chitty.cc with Authorization: Bearer <token>
5. ChittyID validates token against api_tokens table
6. Request proceeds
```

## Failover Mechanism

ChittyConnect has a built-in failover in `1password-connect-client.js`:

1. **Primary**: Try 1Password Connect API (if configured)
2. **Fallback**: Use environment variable (Cloudflare secret)

This means even if 1Password Connect is unavailable, ChittyConnect will use the Cloudflare secrets.

## Token Lifecycle

| Phase | Action | Who |
|-------|--------|-----|
| Creation | Bootstrap script generates tokens | DevOps |
| Storage | Tokens stored in Cloudflare + DB | Bootstrap script |
| Usage | ChittyConnect uses tokens | Runtime |
| Rotation | Re-run bootstrap script | DevOps (annually) |
| Revocation | Update DB status to 'revoked' | Security team |

## Security Considerations

1. **JWT_SECRET** is the master secret - never expose it
2. **Service tokens** are long-lived (1 year) - secure them
3. **Rotation** should happen before expiry
4. **Audit logs** track all token usage

## Troubleshooting

### "ChittyID service token not configured"

The token isn't set as a Cloudflare secret. Run:
```bash
wrangler secret list --env production | grep CHITTY_ID_TOKEN
```

If missing, run the bootstrap script.

### "Token validation failed"

The token may be:
- Expired (check `exp` claim)
- Revoked (check DB status)
- Wrong secret (JWT_SECRET mismatch)

### "Session UNBOUND"

The `can chitty authenticate-context` command fails because:
1. CHITTYCANON_DB_URL not set locally (expected for local dev)
2. ChittyConnect can't mint IDs (needs CHITTY_ID_TOKEN)

Fix: Run the bootstrap script to provision tokens.

## Related Files

- `/scripts/bootstrap-service-tokens.mjs` - Token generation script
- `/src/services/1password-connect-client.js` - Credential fetching
- `/src/lib/credential-helper.js` - Helper functions
- `/wrangler.toml` - Secret documentation
