---
name: chittyos-compliance
description: "This skill should be used when building, auditing, deploying, or certifying any ChittyOS service or artifact. It covers compliance auditing ('check compliance', 'audit this service', 'is this compliant?'), scaffolding new services ('scaffold new service', 'generate CHARTER.md/CHITTY.md/CLAUDE.md'), monitoring deployed health endpoints ('monitor services', 'service status'), and certification ('certify', 'ChittyCertify', 'what badge level?'). Also trigger proactively when creating new ChittyOS services, modifying wrangler configs, writing CHARTER/CHITTY/CLAUDE docs, checking canonical compliance, registration readiness, or preparing for deployment."
user_invocable: true
triggers:
  - /compliance
  - check compliance
  - audit this service
  - is this compliant
  - scaffold new service
  - monitor services
  - certify
---

# ChittyOS Compatibility & Compliance

Full lifecycle compliance management for the ChittyOS ecosystem: audit existing services, scaffold new ones, monitor deployed services, and certify artifacts.

## Modes

| Mode | Trigger | Purpose |
|------|---------|---------|
| **Audit** | "audit", "check compliance", "is this compliant?" | Full compliance check against ChittyOS standards |
| **Scaffold** | "scaffold", "new service", "generate templates" | Generate compliant CHARTER.md, CHITTY.md, health endpoint, wrangler config |
| **Monitor** | "monitor", "check health", "service status" | Hit deployed `*.chitty.cc/health` endpoints, verify live compliance |
| **Certify** | "certify", "certification", "ChittyCertify" | Evaluate artifacts against certification criteria, assign badge level |

## Step 0: Ecosystem Discovery (ALL Modes)

Before any mode, discover context:
1. Query `https://registry.chitty.cc/api/services`
2. Read CHARTER.md/CHITTY.md/CLAUDE.md of related services
3. Check repos: `/home/ubuntu/projects/github.com/CHITTYFOUNDATION/` and `/home/ubuntu/projects/github.com/CHITTYOS/`
4. Fallback: `/home/ubuntu/projects/temp/systems-registry-import-v3.csv`

## Core Standards

### Required Files
- `CHARTER.md` — Service charter (type: policy, frontmatter required)
- `CHITTY.md` — Service badge (type: architecture, frontmatter required)
- `CLAUDE.md` — Developer guide (no frontmatter required)

**Cross-doc consistency**: Tier, canonical URI, domain, service name, dependencies, API endpoints, certification badge, and tech stack must align across all three.

### Canonical Frontmatter

```yaml
---
uri: chittycanon://docs/{domain}/{type}/{identifier}
namespace: chittycanon://docs/{domain}
type: policy|spec|procedure|registry|architecture|catalog|summary
version: semver
status: DRAFT|PENDING|CERTIFIED|CANONICAL|DEPRECATED|ARCHIVED
registered_with: chittycanon://core/services/canon
title: string
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC|INTERNAL|CONFIDENTIAL|RESTRICTED
---
```

### Infrastructure Requirements
- `GET /health` or `GET /api/v1/status` returning `{"status":"ok","service":"<name>"}`
- Auth: `CHITTY_AUTH_SERVICE_TOKEN` pattern (not variants), `jose` for JWT (not `jsonwebtoken`)
- CORS: `*.chitty.cc` + localhost
- Worker name: `chitty*`, compat date within 6 months, `tail_consumers` with `chittytrack`
- Entity types: All 5 (P/L/T/E/A) required. Claude = Person (P, Synthetic), never Thing.

## Audit Mode

1. Check required files exist
2. Validate frontmatter on chartered docs
3. Verify cross-doc consistency (tier, URI, domain, endpoints)
4. Check canonical URI format
5. Verify health endpoint implementation
6. Scan for entity type violations
7. Check auth patterns and env var naming
8. Audit wrangler config
9. Verify package.json name

**Deep audit**: Dispatch `chittycanon-code-cardinal`, `chittyagent-neon-schema`, `chittyregister-compliance-sergeant`, `chittyconnect-concierge` agents in parallel. Aggregate into unified report per `references/compliance-checklist.md`.

## Scaffold Mode

Ask for: service name (kebab), tier (0-5), description, domain, stack. Generate from `references/templates.md`. Populate deps from ecosystem discovery. Run audit after.

## Monitor Mode

```bash
for svc in id auth connect api registry schema mcp finance command; do
  echo -n "$svc: "; curl -s "https://$svc.chitty.cc/health" --max-time 5 | jq -r '.status // "DOWN"'
done
```

## Certify Mode (ChittyCertify)

Badge progression: `[None] → Compatible → Compliant → Certified → Canonical`. Each level cumulative. Full criteria in `references/certification-criteria.md`.

## Authority Model

| Service | Role |
|---------|------|
| **ChittyGov** | Business governance — defines "compliant" |
| **ChittyCertify** | Compliance auditing — awards certification badges (NOT certificates) |
| **ChittyCert** | Certificate Authority — PKI, X.509, JWKS (NOT certifications) |
| **ChittyRegister** | Registration authority — onboarding gatekeeper |
| **ChittyRegistry** | Service catalog — discovery |
| **ChittyCanon** | Canonical authority — ontology, URI namespace, patterns |

## Reference Files

- `references/compliance-checklist.md` — Detailed pass/fail criteria
- `references/certification-criteria.md` — Badge award criteria and report format
- `references/templates.md` — Scaffold templates
