---
name: chitty-deploy
description: Deploy ChittyConnect to Cloudflare Workers with proper environment handling. Triggers on "/deploy", "deploy to production", "deploy to staging".
user_invocable: true
triggers:
  - /deploy
  - deploy to production
  - deploy to staging
---

# ChittyOS Deploy Skill

## Overview
Deploy ChittyConnect to Cloudflare Workers with proper environment handling.

## Usage
```
/deploy [environment]
```

## Parameters
| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| environment | No | production | Target environment (production, staging, dev) |

## Workflow

### 1. Pre-Deploy Checks
```bash
# Verify wrangler config exists
ls -la wrangler.jsonc

# Check for uncommitted changes
git status

# Run tests
npm test
```

### 2. Deploy
```bash
# Production deploy (default)
npx wrangler deploy --env production

# Staging deploy
npx wrangler deploy --env staging

# Dev deploy
npx wrangler deploy --env dev
```

### 3. Post-Deploy Verification
```bash
# Check service health
curl -s https://connect.chitty.cc/health | jq .

# Check status endpoint
curl -s https://connect.chitty.cc/api/v1/status | jq .
```

## Important
`npm run deploy` runs bare `wrangler deploy` without `--env`, which deploys the top-level config (not production routes). Always use `npx wrangler deploy --env production` for production deploys.

## Environment Variables
Secrets are managed via wrangler secrets:
```bash
wrangler secret list
```

## Error Handling
- Build failures: Check TypeScript errors, missing dependencies
- Auth failures: Verify wrangler authentication (`wrangler whoami`)
- DNS issues: Verify custom domain in Cloudflare dashboard
- Queue errors: Ensure `documint-proofs` and `documint-proofs-dlq` queues exist
