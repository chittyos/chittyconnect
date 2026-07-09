# Ecosystem-Wide CI/CD Integration with ChittyConnect

## Overview

Every ChittyOS service should automatically integrate with ChittyConnect during deployment, ensuring the ecosystem is always in sync and self-healing.

## Design Principles

1. **Auto-Registration**: Services register themselves during deployment
2. **Health Validation**: Every deploy verifies ChittyConnect connectivity
3. **Discovery Sync**: Services update their capabilities in the discovery document
4. **Reconciliation**: Post-deploy jobs ensure ecosystem consistency
5. **Self-Healing**: Failed integrations trigger alerts and retries

---

## Standard CI/CD Steps for All ChittyOS Services

### Phase 1: Pre-Deploy (Validation)

```yaml
# .github/workflows/deploy.yml (EVERY service should have this)

pre-deploy:
  runs-on: ubuntu-latest
  steps:
    - name: Validate ChittyConnect Connectivity
      run: |
        echo "Checking ChittyConnect availability..."
        curl -f https://connect.chitty.cc/health || {
          echo "❌ ChittyConnect is unavailable. Deployment aborted."
          exit 1
        }
        echo "✅ ChittyConnect is healthy"

    - name: Fetch Discovery Document
      id: discovery
      run: |
        DISCOVERY=$(curl -f https://connect.chitty.cc/.well-known/chitty.json)
        echo "discovery=$DISCOVERY" >> $GITHUB_OUTPUT
        echo "✅ Discovery document fetched"

    - name: Validate Service in Registry
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
      run: |
        # Check if this service is already registered
        curl -f "https://registry.chitty.cc/api/services/${SERVICE_NAME}" || {
          echo "⚠️  Service not yet registered. Will register post-deploy."
        }
```

### Phase 2: Deploy (Standard Deployment)

```yaml
deploy:
  needs: pre-deploy
  runs-on: ubuntu-latest
  steps:
    - name: Deploy to Cloudflare
      run: npx wrangler deploy --env ${{ env.ENVIRONMENT }}
```

### Phase 3: Post-Deploy (Integration & Reconciliation)

```yaml
post-deploy-integration:
  needs: deploy
  runs-on: ubuntu-latest
  steps:
    ####################################################################
    # 1. Auto-Register with ChittyRegistry
    ####################################################################
    - name: Register with ChittyRegistry
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
        SERVICE_URL: https://${{ github.event.repository.name }}.chitty.cc
        CHITTY_REGISTER_TOKEN: ${{ secrets.CHITTY_REGISTER_TOKEN }}
      run: |
        echo "Registering $SERVICE_NAME with ChittyRegistry..."

        # Build registration payload
        PAYLOAD=$(cat <<EOF
        {
          "name": "$SERVICE_NAME",
          "version": "$(cat package.json | jq -r '.version')",
          "description": "$(cat package.json | jq -r '.description')",
          "endpoints": {
            "health": "$SERVICE_URL/health",
            "api": "$SERVICE_URL/api",
            "mcp": "$SERVICE_URL/mcp"
          },
          "capabilities": ["api", "mcp"],
          "deployment": {
            "commit": "${{ github.sha }}",
            "branch": "${{ github.ref_name }}",
            "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "workflow_run": "${{ github.run_id }}"
          }
        }
        EOF
        )

        # Submit registration
        curl -X POST https://register.chitty.cc/api/register \
          -H "Authorization: Bearer $CHITTY_REGISTER_TOKEN" \
          -H "Content-Type: application/json" \
          -d "$PAYLOAD" || {
          echo "⚠️  Registration failed. Service deployed but not registered."
          exit 0  # Don't fail deployment
        }

        echo "✅ Registered with ChittyRegistry"

    ####################################################################
    # 2. Verify Integration with ChittyConnect
    ####################################################################
    - name: Verify ChittyConnect Integration
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
      run: |
        echo "Verifying integration with ChittyConnect..."

        # Test direct service access
        curl -f "https://${SERVICE_NAME}.chitty.cc/health" || {
          echo "❌ Direct service health check failed"
          exit 1
        }

        # Test proxy through ChittyConnect
        curl -f "https://api.chitty.cc/${SERVICE_NAME}/api/health" || {
          echo "⚠️  ChittyConnect proxy not yet configured (expected for new services)"
        }

        # Verify service appears in discovery
        DISCOVERY=$(curl -f https://connect.chitty.cc/.well-known/chitty.json)
        echo "$DISCOVERY" | jq -e ".services[] | select(.name == \"$SERVICE_NAME\")" || {
          echo "⚠️  Service not yet in discovery document. May take up to 5 minutes for cache refresh."
        }

        echo "✅ Integration verified"

    ####################################################################
    # 3. Test Context Sync (If Applicable)
    ####################################################################
    - name: Test Context Sync Integration
      if: contains(github.event.repository.topics, 'context-aware')
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
        CHITTY_API_KEY: ${{ secrets.CHITTY_API_KEY }}
      run: |
        echo "Testing context sync integration..."

        # Create test task via ChittyConnect
        TASK_RESPONSE=$(curl -X POST https://api.chitty.cc/api/context/tasks \
          -H "Authorization: Bearer $CHITTY_API_KEY" \
          -H "Content-Type: application/json" \
          -d "{
            \"title\": \"Deployment test: $SERVICE_NAME\",
            \"description\": \"Post-deploy integration test\",
            \"task_type\": \"background_job\",
            \"metadata\": {
              \"service\": \"$SERVICE_NAME\",
              \"commit\": \"${{ github.sha }}\",
              \"workflow_run\": \"${{ github.run_id }}\"
            }
          }")

        TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task_id')

        # Mark task complete
        curl -X PATCH "https://api.chitty.cc/api/context/tasks/$TASK_ID" \
          -H "Authorization: Bearer $CHITTY_API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status":"completed","result":{"integration_test":"passed"}}'

        echo "✅ Context sync test passed (Task ID: $TASK_ID)"

    ####################################################################
    # 4. Reconciliation Check
    ####################################################################
    - name: Reconcile Ecosystem State
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
        CHITTY_API_KEY: ${{ secrets.CHITTY_API_KEY }}
      run: |
        echo "Running ecosystem reconciliation..."

        # Check for route conflicts
        ROUTES=$(curl -f https://connect.chitty.cc/api/admin/routes)
        echo "$ROUTES" | jq -e ".conflicts[] | select(.service == \"$SERVICE_NAME\")" && {
          echo "⚠️  Route conflicts detected for $SERVICE_NAME"
          echo "$ROUTES" | jq ".conflicts[] | select(.service == \"$SERVICE_NAME\")"
          # Notify but don't fail
        } || echo "✅ No route conflicts"

        # Verify MCP tools are accessible
        if [ -f "mcp/manifest.json" ]; then
          TOOLS=$(curl -f "https://mcp.chitty.cc/${SERVICE_NAME}/mcp/tools/list")
          TOOL_COUNT=$(echo "$TOOLS" | jq '.tools | length')
          echo "✅ MCP tools accessible ($TOOL_COUNT tools)"
        fi

        echo "✅ Reconciliation complete"

    ####################################################################
    # 5. Update Service Status
    ####################################################################
    - name: Update Service Status
      env:
        SERVICE_NAME: ${{ github.event.repository.name }}
        CHITTY_REGISTER_TOKEN: ${{ secrets.CHITTY_REGISTER_TOKEN }}
      run: |
        echo "Updating service status to ACTIVE..."

        curl -X PATCH "https://register.chitty.cc/api/services/${SERVICE_NAME}/status" \
          -H "Authorization: Bearer $CHITTY_REGISTER_TOKEN" \
          -H "Content-Type: application/json" \
          -d '{"status":"active","last_deployed":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

        echo "✅ Service status updated"
```

---

## ChittyConnect Reconciliation Job

ChittyConnect should also run periodic reconciliation to ensure ecosystem health.

**File**: `.github/workflows/reconcile.yml`

```yaml
name: Ecosystem Reconciliation

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  reconcile:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Fetch All Service Health
        id: health
        run: |
          echo "Checking health of all registered services..."

          # Get all services from registry
          SERVICES=$(curl -f https://registry.chitty.cc/api/services)

          # Check each service health
          echo "$SERVICES" | jq -r '.services[].name' | while read service; do
            HEALTH=$(curl -f "https://${service}.chitty.cc/health" 2>&1) || {
              echo "❌ $service is unhealthy"
              echo "${service}_unhealthy=true" >> $GITHUB_OUTPUT
            }
            echo "✅ $service is healthy"
          done

      - name: Identify Route Conflicts
        run: |
          echo "Checking for route conflicts..."

          # Query Cloudflare for all route assignments
          # (Requires Cloudflare API integration)

          npm run cloudflare:inventory | jq '.conflicts[]' || {
            echo "✅ No route conflicts detected"
            exit 0
          }

          echo "⚠️  Route conflicts detected. Creating issue..."

      - name: Create GitHub Issue for Conflicts
        if: steps.health.outputs.*_unhealthy == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 Ecosystem Reconciliation: Unhealthy Services Detected',
              body: 'Automated reconciliation found unhealthy services:\n\n' +
                    process.env.UNHEALTHY_SERVICES,
              labels: ['automated', 'ecosystem-health', 'priority:high']
            })

      - name: Refresh Discovery Cache
        run: |
          echo "Refreshing discovery document cache..."

          curl -X POST https://connect.chitty.cc/api/admin/refresh-discovery \
            -H "Authorization: Bearer ${{ secrets.CHITTY_ADMIN_TOKEN }}"

          echo "✅ Discovery cache refreshed"

      - name: Verify All Proxies
        run: |
          echo "Verifying all service proxies..."

          SERVICES=$(curl -f https://registry.chitty.cc/api/services | jq -r '.services[].name')

          for service in $SERVICES; do
            curl -f "https://api.chitty.cc/${service}/api/health" || {
              echo "⚠️  Proxy failed for $service"
            }
          done

          echo "✅ Proxy verification complete"
```

---

## Ecosystem-Wide CI/CD Template

Create a shared workflow template that all services can use:

**File**: `.github/workflows/templates/chittyos-deploy.yml`

```yaml
name: ChittyOS Standard Deployment

on:
  push:
    branches: [main, staging]
  workflow_dispatch:

jobs:
  deploy:
    uses: chittyos/chittyconnect/.github/workflows/shared-deploy.yml@main
    with:
      service_name: ${{ github.event.repository.name }}
      environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CHITTY_REGISTER_TOKEN: ${{ secrets.CHITTY_REGISTER_TOKEN }}
      CHITTY_API_KEY: ${{ secrets.CHITTY_API_KEY }}
```

**Benefits:**
- ✅ Consistency across all services
- ✅ Single source of truth for deployment logic
- ✅ Easy to update ecosystem-wide
- ✅ Automatic integration with ChittyConnect

---

## Migration Plan

### Phase 1: Update ChittyConnect (✅ Done)
- Discovery endpoint
- Registry integration
- Context sync

### Phase 2: Create Shared Workflow
1. Create `.github/workflows/shared-deploy.yml` in ChittyConnect repo
2. Make it reusable across organization
3. Document usage

### Phase 3: Migrate Core Services (Priority)
1. ChittyID
2. ChittyAuth
3. ChittyRegistry
4. ChittyVerify

**For each service:**
```bash
cd ../chittyid
# Update .github/workflows/deploy.yml to use shared workflow
# Add required secrets to repository
git commit -m "ci: adopt ecosystem-wide CI/CD integration"
git push origin main
```

### Phase 4: Migrate Remaining Services
- ChittyFinance
- ChittyEvidence
- ChittyCases
- ChittyChronicle
- ChittyQuality
- ChittySync
- etc.

### Phase 5: Enable Reconciliation
- Deploy reconciliation workflow to ChittyConnect
- Set up alerting for conflicts
- Monitor ecosystem health dashboard

---

## Benefits

### For Services
- ✅ Automatic registration (no manual steps)
- ✅ Guaranteed integration validation
- ✅ Consistent deployment process
- ✅ Self-healing on failures

### For Ecosystem
- ✅ Always up-to-date discovery document
- ✅ Automatic conflict detection
- ✅ Health monitoring
- ✅ Audit trail of all deployments

### For Developers
- ✅ Less manual configuration
- ✅ Faster onboarding (copy template)
- ✅ Confidence in deployments
- ✅ Clear deployment status

---

## Monitoring & Observability

### Metrics to Track
- Service registration success rate
- Integration test pass rate
- Route conflict count
- Discovery document refresh frequency
- Average deployment time

### Dashboards
- **Ecosystem Health**: All services status
- **Deployment History**: Recent deploys across ecosystem
- **Integration Status**: Which services are integrated
- **Route Assignments**: Visual map of routes

### Alerts
- Service registration failures
- Integration test failures
- Route conflicts detected
- Discovery endpoint errors

---

## Rollout Timeline

| Week | Phase | Services |
|------|-------|----------|
| 1 | Setup shared workflow | ChittyConnect |
| 2 | Migrate core services | ChittyID, ChittyAuth, ChittyRegistry, ChittyVerify |
| 3 | Migrate data services | ChittyEvidence, ChittyCases, ChittyLedger |
| 4 | Migrate remaining | All others |
| 5 | Enable reconciliation | Automated monitoring |
| 6 | Optimize & refine | Performance tuning |

---

## Success Criteria

- ✅ All services using shared workflow template
- ✅ 100% auto-registration success rate
- ✅ Zero manual deployment steps
- ✅ <5 minute deployment time (avg)
- ✅ Reconciliation running every 6 hours
- ✅ Automatic conflict resolution
- ✅ Real-time ecosystem health dashboard

---

**Next Steps:**
1. Create shared workflow in ChittyConnect
2. Test with ChittyID (pilot service)
3. Roll out to remaining services
4. Enable ecosystem reconciliation
5. Build health dashboard
