# CI/CD Pipeline Guide

Complete guide to ChittyConnect's automated CI/CD pipeline using GitHub Actions.

## Table of Contents

- [Overview](#overview)
- [Pipeline Architecture](#pipeline-architecture)
- [GitHub Configuration](#github-configuration)
- [CI Workflow](#ci-workflow)
- [Staging Deployment](#staging-deployment)
- [Production Deployment](#production-deployment)
- [Testing Strategy](#testing-strategy)
- [Troubleshooting](#troubleshooting)

---

## Overview

ChittyConnect uses GitHub Actions for automated testing and deployment:

- **CI (Continuous Integration)**: Automated testing on all branches and PRs
- **Staging Deployment**: Automatic deployment to staging on develop/claude/** branches
- **Production Deployment**: Manual/tagged deployment to production with safeguards

### Key Features

✅ Automated linting, testing, and security scanning
✅ Infrastructure validation (wrangler.toml, SQL migrations)
✅ Staging environment with health checks and smoke tests
✅ Production deployment with manual approval and monitoring
✅ Post-deployment health checks and performance baselines

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CODE PUSH/PR                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    CI WORKFLOW                               │
│  - Lint (ESLint, Prettier)                                  │
│  - Test (Vitest unit + integration)                         │
│  - Validate (wrangler.toml, secrets scan, SQL)              │
│  - Security (npm audit)                                     │
│  - Build (dry-run deployment)                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ├─────────────────┬─────────────────────────┐
                   ▼                 ▼                         ▼
          ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
          │  develop/      │  │     main       │  │    v*.*.* tag  │
          │  claude/**     │  │                │  │                │
          └────────┬───────┘  └───────┬────────┘  └───────┬────────┘
                   │                  │                    │
                   ▼                  ▼                    ▼
          ┌────────────────┐  ┌────────────────────────────────────┐
          │    STAGING     │  │         PRODUCTION                 │
          │   DEPLOYMENT   │  │  (Manual approval required)        │
          │  - Deploy      │  │  - Validation                      │
          │  - Health      │  │  - Deploy                          │
          │  - Smoke tests │  │  - Health checks                   │
          │  - Integration │  │  - Smoke tests                     │
          │  - Performance │  │  - 5-min monitoring                │
          └────────────────┘  └────────────────────────────────────┘
```

---

## GitHub Configuration

### Step 1: Create GitHub Environments

1. Navigate to your repository on GitHub
2. Go to **Settings** → **Environments**
3. Create two environments:

#### Staging Environment

```yaml
Name: staging
Protection rules: None (auto-deploy from develop)
Environment secrets:
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID
  - (All CHITTY_*_SERVICE_TOKEN secrets)
```

#### Production Environment

```yaml
Name: production
Protection rules:
  ✓ Required reviewers: 1-2 reviewers
  ✓ Wait timer: 5 minutes (optional)
  ✓ Deployment branches: main only
Environment secrets:
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID
  - (All CHITTY_*_SERVICE_TOKEN secrets)
```

### Step 2: Configure Repository Secrets

Navigate to **Settings** → **Secrets and variables** → **Actions**

#### Required Secrets

```bash
# Cloudflare credentials
CLOUDFLARE_API_TOKEN=<your-api-token>
CLOUDFLARE_ACCOUNT_ID=<your-account-id>

# ChittyOS service tokens
CHITTY_ID_SERVICE_TOKEN=<token>
CHITTY_AUTH_SERVICE_TOKEN=<token>
CHITTY_REGISTRY_SERVICE_TOKEN=<token>
CHITTY_DNA_SERVICE_TOKEN=<token>
CHITTY_VERIFY_SERVICE_TOKEN=<token>
CHITTY_CERTIFY_SERVICE_TOKEN=<token>
CHITTY_CHRONICLE_SERVICE_TOKEN=<token>

# Optional: GitHub App credentials (for future use)
GITHUB_APP_ID=<app-id>
GITHUB_APP_PRIVATE_KEY=<private-key>
```

**How to get Cloudflare API Token:**

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Scope to your account
5. Save and copy the token

**How to get Account ID:**

1. Go to https://dash.cloudflare.com
2. Select your domain
3. Copy Account ID from the right sidebar

### Step 3: Configure Branch Protection Rules

Navigate to **Settings** → **Branches** → **Add rule**

#### Main Branch Protection

```yaml
Branch name pattern: main

Protection rules:
  ✓ Require a pull request before merging
  ✓ Require approvals: 1
  ✓ Require status checks to pass before merging
    - lint
    - test
    - validate
    - security
    - build
  ✓ Require branches to be up to date before merging
  ✓ Do not allow bypassing the above settings
```

#### Develop Branch Protection

```yaml
Branch name pattern: develop

Protection rules:
  ✓ Require status checks to pass before merging
    - lint
    - test
    - validate
```

---

## CI Workflow

**File**: `.github/workflows/ci.yml`

### Triggers

- Push to `main`, `develop`, or `claude/**` branches
- Pull requests to `main` or `develop`

### Jobs

#### 1. Lint

```yaml
- ESLint code quality check
- Prettier formatting check
- Runs on all JS files in src/
```

#### 2. Test

```yaml
- Unit tests (Vitest)
- Integration tests (Cloudflare Workers environment)
- Code coverage upload to Codecov
```

#### 3. Validate

```yaml
- wrangler.toml validation (dry-run)
- Secrets scan (ensure no tokens in code)
- SQL migration validation (IF NOT EXISTS checks)
```

#### 4. Security

```yaml
- npm audit (moderate level)
- Vulnerability scanning with audit-ci
```

#### 5. Build

```yaml
- Test deployment with wrangler --dry-run
- Verify worker builds successfully
```

### Running CI Locally

```bash
# Lint
npm run lint

# Format check
npm run format:check

# Run tests
npm test

# Run with coverage
npm run test:coverage

# Validate deployment
npx wrangler deploy --dry-run

# Check for secrets
grep -r "CHITTY.*TOKEN.*=" src/ --include="*.js" | grep -v "env\."
```

---

## Staging Deployment

**File**: `.github/workflows/deploy-staging.yml`

### Triggers

- Push to `develop` branch
- Push to `claude/**` branches (AI assistant development)

### Deployment Flow

```
1. Run CI checks (prerequisite)
   └─ Must pass: lint, test, validate, security, build

2. Pre-deployment validation
   └─ Dry-run deployment
   └─ Infrastructure validation

3. Deploy to Cloudflare Workers (staging)
   └─ Environment: staging
   └─ URL: https://connect-staging.chitty.cc

4. Health checks (15s wait + 5 retries)
   └─ GET /health
   └─ Verify status: healthy

5. Smoke tests
   └─ Basic endpoint tests
   └─ Full health check (ChittyOS compliance)
   └─ Integration validation

6. Post-deployment monitoring
   └─ 2-minute health monitoring (every 30s)
   └─ Performance check (10 requests)
   └─ Response time baseline

7. Deployment report
   └─ GitHub Actions summary
   └─ Deployment details and metrics
```

### Accessing Staging

```bash
# Health check
curl https://connect-staging.chitty.cc/health

# Full health with services
curl "https://connect-staging.chitty.cc/health?full=true"

# Tail logs
npm run tail:staging

# Query database
npm run db:query:staging "SELECT * FROM contexts LIMIT 5"
```

---

## Production Deployment

**File**: `.github/workflows/deploy-production.yml`

### Triggers

1. **Automatic**: Push to `main` branch or version tags (`v*.*.*`)
2. **Manual**: workflow_dispatch with confirmation

### Manual Deployment

```bash
# Via GitHub UI:
1. Go to Actions → Deploy to Production
2. Click "Run workflow"
3. Enter reason: "Deploy feature X"
4. Type "DEPLOY" to confirm
5. Click "Run workflow"

# Via GitHub CLI:
gh workflow run deploy-production.yml \
  -f reason="Deploy v1.0.1" \
  -f confirm="DEPLOY"
```

### Deployment Flow

```
1. Validation
   ├─ Verify "DEPLOY" confirmation (if manual)
   ├─ Check branch is main or version tag
   └─ Create deployment record

2. Pre-deployment checks
   ├─ Run CI checks (prerequisite)
   ├─ Dry-run deployment
   ├─ Secrets scan
   └─ Approval summary

3. Manual approval (if environment protected)
   └─ Required reviewer must approve

4. Deploy to Cloudflare Workers (production)
   ├─ Environment: production
   └─ URL: https://connect.chitty.cc

5. Wait for propagation (15s)

6. Production health checks (5 retries)
   └─ GET /health
   └─ Verify status: healthy
   └─ HTTP 200 required

7. Production smoke tests
   ├─ Health endpoint test
   ├─ Full health check with ChittyOS compliance
   ├─ Verify ChittyID violations = 0
   └─ Verify authority compliance = 100%

8. Post-deployment monitoring (5 minutes)
   ├─ Health check every 30 seconds
   ├─ Alert on any failures
   └─ Auto-rollback trigger ready

9. Performance baseline
   ├─ 10 requests to /health
   ├─ Calculate average response time
   └─ Performance classification:
       • Excellent: <500ms
       • Acceptable: <1s
       • Degraded: >1s (warning)

10. Deployment success notification
    └─ GitHub summary with metrics
```

### Production Rollback

If deployment fails or monitoring detects issues:

```bash
# Option 1: Revert commit and push
git revert <failed-commit-sha>
git push origin main

# Option 2: Deploy previous version tag
git tag v1.0.0-rollback <previous-good-commit>
git push origin v1.0.0-rollback

# Option 3: Manual Cloudflare rollback
wrangler rollback --name chittyconnect

# Option 4: Restore from previous deployment
wrangler deployments list
wrangler rollback <deployment-id>
```

**Rollback checklist:**

- [ ] Identify root cause
- [ ] Execute rollback
- [ ] Verify health checks pass
- [ ] Monitor for 10 minutes
- [ ] Update incident log
- [ ] Create post-mortem

---

## Testing Strategy

### Test Types

#### Unit Tests

**Location**: `tests/unit/**/*.test.js`
**Config**: `vitest.config.unit.js`
**Coverage**: 80%+ target

```bash
npm run test:unit
```

Tests individual functions and modules in isolation with mocked dependencies.

#### Integration Tests

**Location**: `tests/integration/**/*.test.js`
**Config**: `vitest.config.integration.js`
**Environment**: Cloudflare Workers (Miniflare)

```bash
npm run test:integration
```

Tests complete request flows through the worker with full Cloudflare environment.

### Test Helpers

**Location**: `tests/helpers/mock-chittyos.js`

Provides mocks for:
- ChittyID service
- ChittyAuth service
- ChittyRegistry service
- ChittyDNA service
- ChittyVerify, ChittyCertify, ChittyChronicle
- D1 database
- KV namespaces
- Queues

### Writing Tests

Example unit test:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { createContext } from '../../src/api/contexts.js';
import { createMockEnv, createMockContext } from '../helpers/mock-chittyos.js';

describe('createContext', () => {
  let env, ctx;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
  });

  it('should create context with valid input', async () => {
    const request = new Request('https://test.com/v1/contexts/create', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer token' },
      body: JSON.stringify({ name: 'Test Context' }),
    });

    const response = await createContext(request, env, ctx);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
  });
});
```

### Coverage Requirements

```yaml
Lines: 80%
Functions: 80%
Branches: 75%
Statements: 80%
```

View coverage report:

```bash
npm run test:coverage
open coverage/index.html
```

---

## Troubleshooting

### CI Failures

#### Lint Errors

```bash
# Fix automatically
npm run lint:fix
npm run format

# Check what will change
npm run format:check
```

#### Test Failures

```bash
# Run tests locally
npm test

# Run specific test file
npm test tests/unit/ecosystem.test.js

# Watch mode
npm run test:watch

# Verbose output
npm test -- --reporter=verbose
```

#### Build Failures

```bash
# Test wrangler config
npx wrangler deploy --dry-run

# Check syntax
node --check src/index.js

# Validate all imports
npm run validate:imports  # (if configured)
```

### Deployment Failures

#### Staging Deploy Fails

```bash
# Check Cloudflare status
curl https://www.cloudflarestatus.com/api/v2/status.json

# Verify secrets
wrangler secret list --env staging

# Check logs
npm run tail:staging

# Manual deploy
npm run deploy:staging
```

#### Health Check Fails

```bash
# Check endpoint directly
curl -v https://connect-staging.chitty.cc/health

# Check with full details
curl "https://connect-staging.chitty.cc/health?full=true" | jq .

# Verify database
npm run db:query:staging "SELECT 1"

# Check ChittyOS services
curl https://id.chitty.cc/health
curl https://auth.chitty.cc/health
```

#### Production Deploy Blocked

**Environment protection:**
- Check required reviewers approved
- Verify branch is `main`
- Ensure "DEPLOY" confirmation (if manual)

**Validation failure:**
- Review CI checks passed
- Verify pre-deployment checks
- Check secrets configured

### Common Issues

#### Issue: "CLOUDFLARE_API_TOKEN not found"

**Solution:**
```bash
# Check secret exists
gh secret list

# Set secret
gh secret set CLOUDFLARE_API_TOKEN
# (paste token, press Ctrl+D)

# Or via GitHub UI:
# Settings → Secrets → Actions → New repository secret
```

#### Issue: "wrangler: command not found"

**Solution:**
```bash
# Install dependencies
npm ci

# Verify wrangler installed
npx wrangler --version
```

#### Issue: "Database not initialized"

**Solution:**
```bash
# Run migrations
npm run db:migrate

# Or let ecosystem-init middleware handle it
# (runs automatically on first request)
```

#### Issue: "Queue messages not processing"

**Solution:**
```bash
# Check queue consumer configured in wrangler.toml
cat wrangler.toml | grep -A 5 "queues.consumers"

# Verify queue exists
wrangler queues list

# Create queue if missing
wrangler queues create chittyconnect-context-ops
```

---

## Best Practices

### Development Workflow

1. **Create feature branch from develop**
   ```bash
   git checkout develop
   git pull
   git checkout -b feature/my-feature
   ```

2. **Write code + tests**
   ```bash
   # Test locally
   npm test
   npm run lint
   ```

3. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: add my feature"
   git push origin feature/my-feature
   ```

4. **CI runs automatically**
   - Lint, test, validate, security, build
   - Fix any failures

5. **Create PR to develop**
   - CI runs again on PR
   - Request review
   - Merge when approved

6. **Auto-deploy to staging**
   - Triggers on merge to develop
   - Verify in staging environment

7. **Promote to production**
   - Create PR from develop to main
   - CI + review + merge
   - Auto-deploy to production

### Security Best Practices

- ✅ Never commit secrets to code
- ✅ Use GitHub secrets for tokens
- ✅ Rotate API tokens quarterly
- ✅ Enable 2FA on GitHub account
- ✅ Review security audit reports
- ✅ Keep dependencies updated

### Monitoring Best Practices

- ✅ Check deployment summaries in GitHub Actions
- ✅ Monitor Cloudflare Analytics dashboard
- ✅ Review ChittyChronicle event logs
- ✅ Set up alerts for error rates
- ✅ Track performance metrics

---

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
- [Vitest Documentation](https://vitest.dev/)
- [ChittyConnect Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [ChittyConnect Local Development](./LOCAL_DEVELOPMENT.md)

---

**Last Updated**: 2025-10-24
**Version**: 1.0.0
**ChittyOS Compliance**: 100%
