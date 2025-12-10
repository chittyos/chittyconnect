# GitHub CI/CD Setup Guide

Quick reference for configuring GitHub repository for automated CI/CD.

## Prerequisites

- [ ] GitHub repository created
- [ ] Cloudflare account with Workers enabled
- [ ] ChittyOS service tokens obtained
- [ ] Admin access to repository

---

## Step 1: Configure GitHub Environments

### Create Staging Environment

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name: `staging`
4. Click **Configure environment**
5. **Environment protection rules**: None (leave empty for auto-deploy)
6. Click **Add secret** for each:

```bash
CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>
CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
CHITTY_ID_SERVICE_TOKEN=<token>
CHITTY_AUTH_SERVICE_TOKEN=<token>
CHITTY_REGISTRY_SERVICE_TOKEN=<token>
CHITTY_DNA_SERVICE_TOKEN=<token>
CHITTY_VERIFY_SERVICE_TOKEN=<token>
CHITTY_CERTIFY_SERVICE_TOKEN=<token>
CHITTY_CHRONICLE_SERVICE_TOKEN=<token>
```

### Create Production Environment

1. Click **New environment**
2. Name: `production`
3. **Environment protection rules**:
   - ✅ **Required reviewers**: Add 1-2 reviewers
   - ✅ **Deployment branches**: Select "Selected branches" → `main`
   - ✅ (Optional) **Wait timer**: 5 minutes
4. Click **Add secret** for each (same secrets as staging):

```bash
CLOUDFLARE_API_TOKEN=<production-token>
CLOUDFLARE_ACCOUNT_ID=<your-account-id>
# ... all CHITTY_*_SERVICE_TOKEN secrets
```

---

## Step 2: Configure Repository Secrets

These are used across all workflows (not environment-specific).

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** for each:

```bash
# Cloudflare (if not using environment secrets)
CLOUDFLARE_API_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=<account-id>

# ChittyOS Services (if not using environment secrets)
CHITTY_ID_SERVICE_TOKEN=<token>
CHITTY_AUTH_SERVICE_TOKEN=<token>
CHITTY_REGISTRY_SERVICE_TOKEN=<token>
CHITTY_DNA_SERVICE_TOKEN=<token>
CHITTY_VERIFY_SERVICE_TOKEN=<token>
CHITTY_CERTIFY_SERVICE_TOKEN=<token>
CHITTY_CHRONICLE_SERVICE_TOKEN=<token>

# Optional: GitHub App (for future integrations)
GITHUB_APP_ID=<app-id>
GITHUB_APP_PRIVATE_KEY=<private-key-pem>
```

### Getting Cloudflare API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use template: **Edit Cloudflare Workers**
4. Permissions:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit
   - Account → D1 → Edit
   - Account → Workers Queues → Edit
5. Account Resources: **Include** → Your Account
6. **Continue to summary** → **Create Token**
7. Copy token (shown only once!)

### Getting Account ID

1. Go to https://dash.cloudflare.com
2. Select your domain (any domain)
3. Scroll to right sidebar
4. Copy **Account ID**

---

## Step 3: Configure Branch Protection

### Protect Main Branch

1. Go to **Settings** → **Branches**
2. Click **Add rule**
3. **Branch name pattern**: `main`
4. Enable:
   - ✅ **Require a pull request before merging**
     - ✅ Require approvals: **1**
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ **Require status checks to pass before merging**
     - Add required checks:
       - `lint`
       - `test`
       - `validate`
       - `security`
       - `build`
     - ✅ Require branches to be up to date before merging
   - ✅ **Do not allow bypassing the above settings**
5. Click **Create**

### Protect Develop Branch

1. Click **Add rule**
2. **Branch name pattern**: `develop`
3. Enable:
   - ✅ **Require status checks to pass before merging**
     - Add required checks:
       - `lint`
       - `test`
       - `validate`
4. Click **Create**

---

## Step 4: Verify Workflows

### Check Workflows Exist

```bash
ls -la .github/workflows/
# Should see:
# - ci.yml
# - deploy-staging.yml
# - deploy-production.yml
```

### Test CI Workflow

1. Create a test branch:
   ```bash
   git checkout -b test/ci-setup
   echo "# Test" >> README.md
   git add README.md
   git commit -m "test: verify CI"
   git push origin test/ci-setup
   ```

2. Go to **Actions** tab on GitHub
3. Verify **CI - Lint and Test** workflow runs
4. Check all jobs pass (green checkmarks)

### Test Staging Deployment

1. Push to develop branch:
   ```bash
   git checkout develop
   git merge test/ci-setup
   git push origin develop
   ```

2. Go to **Actions** → **Deploy to Staging**
3. Verify deployment completes
4. Check staging URL: https://connect-staging.chitty.cc/health

### Test Production Deployment (Manual)

1. Go to **Actions** → **Deploy to Production**
2. Click **Run workflow**
3. Fill in:
   - **reason**: "Initial deployment test"
   - **confirm**: `DEPLOY`
4. Click **Run workflow**
5. If environment protection enabled, approve deployment
6. Verify production URL: https://connect.chitty.cc/health

---

## Step 5: Configure Cloudflare Workers

### Verify Infrastructure

```bash
# Install dependencies
npm ci

# Provision infrastructure (if not done)
npm run provision

# Configure secrets
npm run secrets

# Test deployment
npx wrangler deploy --dry-run
```

### Update wrangler.toml

Ensure `wrangler.toml` has correct IDs:

```toml
[env.staging]
name = "chittyconnect-staging"
route = "connect-staging.chitty.cc/*"
# ... bindings with staging IDs

[env.production]
name = "chittyconnect"
route = "connect.chitty.cc/*"
# ... bindings with production IDs
```

---

## Verification Checklist

After setup, verify:

- [ ] **Environments created**
  - [ ] `staging` environment configured
  - [ ] `production` environment configured with protection
- [ ] **Secrets configured**
  - [ ] CLOUDFLARE_API_TOKEN
  - [ ] CLOUDFLARE_ACCOUNT_ID
  - [ ] All CHITTY_*_SERVICE_TOKEN secrets
- [ ] **Branch protection enabled**
  - [ ] main branch requires PR + reviews + status checks
  - [ ] develop branch requires status checks
- [ ] **CI workflow runs**
  - [ ] Lint job passes
  - [ ] Test job passes
  - [ ] Validate job passes
  - [ ] Security job passes
  - [ ] Build job passes
- [ ] **Staging deployment works**
  - [ ] Deploys on push to develop
  - [ ] Health checks pass
  - [ ] Smoke tests pass
- [ ] **Production deployment configured**
  - [ ] Manual trigger works
  - [ ] Requires "DEPLOY" confirmation
  - [ ] Environment approval required

---

## Troubleshooting

### Secrets Not Found

**Error**: `Error: Secret CLOUDFLARE_API_TOKEN not found`

**Solution**:
```bash
# List secrets
gh secret list

# Set missing secret
gh secret set CLOUDFLARE_API_TOKEN
# (paste token, press Ctrl+D)
```

### Workflow Not Running

**Error**: Workflow doesn't trigger on push

**Solution**:
1. Check `.github/workflows/` files exist
2. Verify branch name matches trigger pattern
3. Check GitHub Actions enabled: **Settings** → **Actions** → **General**
4. Verify workflows have correct permissions

### Deployment Fails with 401

**Error**: `Error: Authentication failed`

**Solution**:
1. Regenerate Cloudflare API token
2. Verify token has correct permissions (Edit Workers)
3. Update secret in GitHub
4. Retry deployment

### Environment Not Found

**Error**: `Error: Environment 'staging' not found`

**Solution**:
1. Go to **Settings** → **Environments**
2. Create environment with exact name: `staging`
3. Add required secrets
4. Retry workflow

### Required Checks Not Found

**Warning**: "Required status checks are not found"

**Solution**:
1. Run workflow at least once to register checks
2. Go to **Settings** → **Branches** → Edit rule
3. Search for check names (they should now appear)
4. Add to required checks

---

## Quick Commands

```bash
# View workflows
gh workflow list

# Run staging deployment
gh workflow run deploy-staging.yml

# Run production deployment (with confirmation)
gh workflow run deploy-production.yml \
  -f reason="Deploy v1.0.1" \
  -f confirm="DEPLOY"

# View workflow runs
gh run list

# View specific run
gh run view <run-id>

# Watch live logs
gh run watch

# List secrets
gh secret list

# Set secret
gh secret set SECRET_NAME

# Delete secret
gh secret delete SECRET_NAME
```

---

## Next Steps

After completing this setup:

1. ✅ Read [CI/CD Guide](./CI_CD_GUIDE.md) for detailed workflow information
2. ✅ Review [Deployment Guide](./DEPLOYMENT_GUIDE.md) for manual deployment
3. ✅ Check [Local Development Guide](./LOCAL_DEVELOPMENT.md) for dev workflow
4. ✅ Set up monitoring and alerting
5. ✅ Document your custom deployment procedures

---

**Setup Time**: ~30 minutes
**Difficulty**: Intermediate
**Last Updated**: 2025-10-24
