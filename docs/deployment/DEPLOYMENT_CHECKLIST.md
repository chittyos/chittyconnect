# ChittyConnect Deployment Checklist

**Version:** 1.0.0
**Use this checklist for each deployment**

---

## Pre-Deployment Checklist

### Week 3: Infrastructure & Staging

#### Prerequisites
- [ ] Cloudflare account active
- [ ] wrangler CLI installed (`wrangler --version`)
- [ ] Authenticated with Cloudflare (`wrangler whoami`)
- [ ] Node.js 18+ installed (`node --version`)
- [ ] Git repository access
- [ ] ChittyOS service tokens obtained (all 7 services)

#### Infrastructure Provisioning
- [ ] Run `npm run provision` or provision manually
- [ ] Verify all KV namespaces created (10 total: 5 prod + 5 staging)
- [ ] Verify D1 databases created (2: prod + staging)
- [ ] Verify queues created (3 total)
- [ ] Update `wrangler.toml` with actual resource IDs
- [ ] Save `.env.infrastructure` file for records

#### Database Setup
- [ ] Run production migrations (`npm run db:migrate`)
- [ ] Run staging migrations (`npm run db:migrate:staging`)
- [ ] Verify tables exist (contexts, installations, actors, connections)
- [ ] Verify indexes created

#### Secrets Configuration
- [ ] Set ChittyID service token (`CHITTY_ID_SERVICE_TOKEN`)
- [ ] Set ChittyAuth service token (`CHITTY_AUTH_SERVICE_TOKEN`)
- [ ] Set ChittyRegistry token (`CHITTY_REGISTRY_TOKEN`)
- [ ] Set ChittyDNA token (`CHITTY_DNA_TOKEN`)
- [ ] Set ChittyChronicle token (`CHITTY_CHRONICLE_TOKEN`)
- [ ] Set ChittyVerify token (`CHITTY_VERIFY_TOKEN`)
- [ ] Set ChittyCertify token (`CHITTY_CERTIFY_TOKEN`)
- [ ] Verify secrets set (`wrangler secret list`)
- [ ] Repeat for staging environment

---

## Staging Deployment

### Deploy to Staging
- [ ] Review code changes (`git diff`)
- [ ] All tests passing locally (when available)
- [ ] Deploy: `npm run deploy:staging`
- [ ] Deployment successful (no errors)
- [ ] Note deployment ID/version

### Staging Verification
- [ ] Health check passing: `curl https://connect-staging.chitty.cc/health`
- [ ] Full health check: `curl "https://connect-staging.chitty.cc/health?full=true"`
- [ ] ChittyOS compliance metrics showing (0 violations, 100% authority)
- [ ] All 7 ChittyOS services reachable
- [ ] Database initialized (check logs)
- [ ] Ecosystem context created (check logs)

### Staging Testing
- [ ] Actor registration works
- [ ] Context creation works
- [ ] Context listing works
- [ ] Connection creation works
- [ ] Delegation token creation works
- [ ] Queue processing works (check logs)
- [ ] ChittyDNA tracking confirmed (check ChittyDNA service)
- [ ] ChittyChronicle events logged (check Chronicle service)
- [ ] No errors in logs (`npm run tail:staging`)

### Performance Testing
- [ ] Health endpoint < 200ms response time
- [ ] API endpoints < 500ms response time
- [ ] No timeout errors
- [ ] Memory usage acceptable
- [ ] CPU time within limits

---

## Production Deployment

### Pre-Production
- [ ] Staging fully tested and validated
- [ ] No critical bugs in staging
- [ ] Performance benchmarks met
- [ ] Stakeholders notified of deployment
- [ ] Rollback plan documented
- [ ] Maintenance window scheduled (if needed)

### DNS Configuration
- [ ] `connect.chitty.cc` CNAME configured
- [ ] DNS propagated (check with `dig connect.chitty.cc`)
- [ ] SSL/TLS certificate active

### Deploy to Production
- [ ] Final code review complete
- [ ] Deploy: `npm run deploy:production`
- [ ] Deployment successful
- [ ] Note deployment ID/timestamp

### Production Verification
- [ ] Health check passing: `curl https://connect.chitty.cc/health`
- [ ] Full health check passing
- [ ] All endpoints accessible
- [ ] ChittyOS services connected
- [ ] Database initialized
- [ ] No errors in logs (`npm run tail`)

### Production Smoke Tests
- [ ] Register test actor
- [ ] Create test context
- [ ] List contexts
- [ ] Update context
- [ ] Create connection
- [ ] Create delegation
- [ ] Delete test context
- [ ] All operations successful

### Monitoring Setup
- [ ] Cloudflare Analytics dashboard reviewed
- [ ] ChittyChronicle timeline accessible
- [ ] Error rate monitoring active
- [ ] Latency monitoring active
- [ ] Alert thresholds configured

---

## Post-Deployment

### Immediate (0-1 hours)
- [ ] Monitor error rates (< 1%)
- [ ] Monitor latency (p95 < 500ms)
- [ ] Check logs for errors
- [ ] Verify request volume normal
- [ ] No 5xx errors

### Short-term (1-24 hours)
- [ ] Error rate stable
- [ ] Performance stable
- [ ] No customer complaints
- [ ] Queue processing healthy
- [ ] Database performance good

### Long-term (1-7 days)
- [ ] Weekly metrics review
- [ ] Cost tracking
- [ ] Performance optimization opportunities identified
- [ ] User feedback collected

---

## Rollback Checklist

### Immediate Rollback (if critical issues)
- [ ] Stop incoming traffic (optional)
- [ ] Deploy previous version: `git checkout <commit> && npm run deploy:production`
- [ ] Verify rollback successful
- [ ] Health check passing
- [ ] Monitor error rates
- [ ] Notify stakeholders

### Post-Rollback
- [ ] Document issue that caused rollback
- [ ] Create incident report
- [ ] Fix issue in code
- [ ] Test fix in staging
- [ ] Plan re-deployment

---

## Deployment Sign-Off

### Staging
- **Deployed by:** ___________________
- **Date/Time:** ___________________
- **Version:** ___________________
- **Deployment ID:** ___________________
- **Tests Passed:** [ ] Yes [ ] No
- **Sign-off:** ___________________

### Production
- **Deployed by:** ___________________
- **Date/Time:** ___________________
- **Version:** ___________________
- **Deployment ID:** ___________________
- **Tests Passed:** [ ] Yes [ ] No
- **Stakeholder Approval:** ___________________
- **Sign-off:** ___________________

---

## Environment-Specific Notes

### Staging Environment
- URL: https://connect-staging.chitty.cc
- Purpose: Pre-production testing
- Data: Test data, can be reset
- Secrets: Staging tokens
- Risk: Low (isolated environment)

### Production Environment
- URL: https://connect.chitty.cc
- Purpose: Live service
- Data: Real data, permanent
- Secrets: Production tokens
- Risk: High (customer-facing)

---

## Quick Reference Commands

```bash
# Provision infrastructure
npm run provision

# Configure secrets
npm run secrets

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production

# Watch logs
npm run tail          # Production
npm run tail:staging  # Staging

# Database migrations
npm run db:migrate          # Production
npm run db:migrate:staging  # Staging

# Health checks
curl https://connect.chitty.cc/health
curl https://connect-staging.chitty.cc/health
```

---

## Success Criteria

### Staging Deployment Success
- ✅ Health endpoint returns 200
- ✅ All ChittyOS services connected
- ✅ Database initialized
- ✅ Manual tests pass
- ✅ No critical errors in logs
- ✅ Performance metrics acceptable

### Production Deployment Success
- ✅ Health endpoint returns 200
- ✅ Staging fully validated
- ✅ DNS configured correctly
- ✅ All smoke tests pass
- ✅ Error rate < 1%
- ✅ Latency < 500ms (p95)
- ✅ Monitoring active

---

## Contact Information

**Deployment Issues:**
- ChittyOS Team: [contact info]
- Cloudflare Support: support.cloudflare.com
- GitHub Issues: https://github.com/chittyos/chittyconnect/issues

**Emergency Rollback:**
- Primary: [name] - [contact]
- Secondary: [name] - [contact]

---

**Checklist Version:** 1.0.0
**Last Updated:** October 21, 2025
**Next Review:** After first production deployment
