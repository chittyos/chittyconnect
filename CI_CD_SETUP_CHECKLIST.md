# CI/CD Setup Checklist

Quick checklist for setting up automated CI/CD for ChittyConnect.

## Prerequisites

- [ ] GitHub repository exists and is accessible
- [ ] Cloudflare account with Workers plan
- [ ] Cloudflare API token with Workers permissions
- [ ] All ChittyOS service tokens obtained
- [ ] Admin access to GitHub repository

---

## Setup Steps

### 1. Infrastructure Provisioning

```bash
# Install dependencies
npm ci

# Provision Cloudflare resources
npm run provision

# Configure secrets
npm run secrets
```

**Result**: D1 databases, KV namespaces, and queues created.

---

### 2. GitHub Environments

**Navigate to**: Settings → Environments

#### Staging Environment

- [ ] Create environment named `staging`
- [ ] **No protection rules** (auto-deploy)
- [ ] Add environment secrets:
  - [ ] `CLOUDFLARE_API_TOKEN`
  - [ ] `CLOUDFLARE_ACCOUNT_ID`
  - [ ] `CHITTY_ID_SERVICE_TOKEN`
  - [ ] `CHITTY_AUTH_SERVICE_TOKEN`
  - [ ] `CHITTY_REGISTRY_SERVICE_TOKEN`
  - [ ] `CHITTY_DNA_SERVICE_TOKEN`
  - [ ] `CHITTY_VERIFY_SERVICE_TOKEN`
  - [ ] `CHITTY_CERTIFY_SERVICE_TOKEN`
  - [ ] `CHITTY_CHRONICLE_SERVICE_TOKEN`

#### Production Environment

- [ ] Create environment named `production`
- [ ] Enable **Required reviewers** (1-2 people)
- [ ] Set **Deployment branches** to `main` only
- [ ] Add same environment secrets as staging

**Guide**: [GitHub Setup Guide](./docs/deployment/GITHUB_SETUP.md)

---

### 3. Repository Secrets (Optional)

If not using environment-specific secrets:

**Navigate to**: Settings → Secrets and variables → Actions

- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] All `CHITTY_*_SERVICE_TOKEN` secrets

---

### 4. Branch Protection Rules

**Navigate to**: Settings → Branches → Add rule

#### Main Branch

- [ ] Branch name pattern: `main`
- [ ] ✅ Require pull request before merging
  - [ ] Require approvals: 1
- [ ] ✅ Require status checks before merging
  - [ ] `lint`
  - [ ] `test`
  - [ ] `validate`
  - [ ] `security`
  - [ ] `build`
  - [ ] ✅ Require branches to be up to date
- [ ] ✅ Do not allow bypassing

#### Develop Branch

- [ ] Branch name pattern: `develop`
- [ ] ✅ Require status checks before merging
  - [ ] `lint`
  - [ ] `test`
  - [ ] `validate`

---

### 5. Verify CI/CD Workflows

#### Test CI Workflow

```bash
# Create test branch
git checkout -b test/ci-verification
echo "# CI Test" >> README.md
git add README.md
git commit -m "test: verify CI workflow"
git push origin test/ci-verification
```

- [ ] Go to **Actions** tab on GitHub
- [ ] Verify **CI - Lint and Test** runs
- [ ] Check all jobs pass (✓ green)

#### Test Staging Deployment

```bash
# Push to develop
git checkout develop
git merge test/ci-verification
git push origin develop
```

- [ ] **Actions** → **Deploy to Staging** runs
- [ ] Deployment succeeds
- [ ] Health check at `https://connect-staging.chitty.cc/health` returns 200

#### Test Production Deployment

- [ ] Go to **Actions** → **Deploy to Production**
- [ ] Click **Run workflow**
- [ ] Enter reason and type "DEPLOY" to confirm
- [ ] Approve deployment (if protection enabled)
- [ ] Verify production URL: `https://connect.chitty.cc/health`

---

## Verification

### CI Pipeline Works

- [ ] Lint job passes on every push
- [ ] Test job passes with coverage report
- [ ] Validate job checks wrangler.toml
- [ ] Security scan runs without critical issues
- [ ] Build check (dry-run) succeeds

### Staging Deployment Works

- [ ] Auto-deploys on push to `develop` or `claude/**` branches
- [ ] Health checks pass (15s wait + retries)
- [ ] Smoke tests verify endpoints work
- [ ] Integration tests pass
- [ ] Performance monitoring completes

### Production Deployment Works

- [ ] Requires manual trigger or push to `main`
- [ ] "DEPLOY" confirmation required for manual trigger
- [ ] Environment protection enforced (review required)
- [ ] Pre-deployment validation passes
- [ ] Health checks pass (5 retries)
- [ ] Smoke tests verify ChittyOS compliance
- [ ] 5-minute post-deployment monitoring succeeds
- [ ] Performance baseline established

---

## Common Issues

### ❌ Secrets Not Found

**Error**: `Error: Secret CLOUDFLARE_API_TOKEN not found`

**Solution**:
```bash
# Via GitHub CLI
gh secret set CLOUDFLARE_API_TOKEN
# (paste token, press Ctrl+D)

# Via GitHub UI
# Settings → Secrets → New repository secret
```

### ❌ Required Checks Not Available

**Error**: Status checks not found in branch protection

**Solution**:
1. Run CI workflow at least once
2. Checks will appear in branch protection settings
3. Add them to required checks

### ❌ Deployment Times Out

**Error**: Health check timeout after 15s

**Solution**:
1. Check Cloudflare status: https://www.cloudflarestatus.com/
2. Verify wrangler.toml configuration
3. Check secrets are set correctly
4. Review logs: `npm run tail:staging`

### ❌ Environment Not Found

**Error**: `Error: Environment 'staging' not found`

**Solution**:
1. Verify environment name is exactly `staging` (lowercase)
2. Check environment exists in Settings → Environments
3. Retry workflow

---

## Next Steps After Setup

1. ✅ **Review workflows**: Understand each job in [CI/CD Guide](./docs/deployment/CI_CD_GUIDE.md)
2. ✅ **Test locally**: Run `npm test` and `npm run lint` before pushing
3. ✅ **Monitor deployments**: Check GitHub Actions summaries
4. ✅ **Set up monitoring**: Configure Cloudflare Analytics alerts
5. ✅ **Document custom procedures**: Add project-specific deployment notes

---

## Quick Reference

### Key Files

- `.github/workflows/ci.yml` - CI pipeline
- `.github/workflows/deploy-staging.yml` - Staging deployment
- `.github/workflows/deploy-production.yml` - Production deployment
- `vitest.config.js` - Test configuration
- `wrangler.toml` - Cloudflare Workers configuration

### Key Commands

```bash
# Development
npm run dev                    # Local development
npm test                       # Run all tests
npm run lint                   # Check code quality

# Deployment
npm run deploy:staging         # Manual staging deploy
npm run deploy:production      # Manual production deploy

# Monitoring
npm run tail                   # Watch production logs
npm run tail:staging           # Watch staging logs
npm run db:query "SELECT 1"    # Query production DB

# CI/CD
gh workflow run deploy-staging.yml
gh workflow run deploy-production.yml -f reason="Deploy v1.0.1" -f confirm="DEPLOY"
gh run list
gh run watch
```

### Important URLs

- **Staging**: https://connect-staging.chitty.cc
- **Production**: https://connect.chitty.cc
- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **GitHub Actions**: https://github.com/YOUR-ORG/chittyconnect/actions

---

## Documentation

- 📖 [CI/CD Guide](./docs/deployment/CI_CD_GUIDE.md) - Comprehensive CI/CD documentation
- 📖 [GitHub Setup Guide](./docs/deployment/GITHUB_SETUP.md) - Detailed GitHub configuration
- 📖 [Deployment Guide](./docs/deployment/DEPLOYMENT_GUIDE.md) - Manual deployment procedures
- 📖 [Local Development](./docs/deployment/LOCAL_DEVELOPMENT.md) - Development workflow
- 📖 [Test Suite README](./tests/README.md) - Testing documentation

---

**Estimated Setup Time**: 30-45 minutes
**Difficulty**: Intermediate
**Last Updated**: 2025-10-24

---

## Sign-Off

- [ ] CI/CD setup completed
- [ ] All tests pass
- [ ] Staging deployment verified
- [ ] Production deployment verified
- [ ] Documentation reviewed
- [ ] Team trained on workflow

**Completed by**: ___________________
**Date**: ___________________
**Notes**: ___________________
