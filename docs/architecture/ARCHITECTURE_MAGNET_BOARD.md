# ChittyOS Architecture — Current State, Gaps, and Actions

Source: Imported from Notion export in `docs/architecture/notion-magnet-board/`
Primary page: “ChittyOS Architecture Magnet Board — Current State & Gaps”.

This file curates the Notion content into a concise, actionable roadmap aligned with onboarding (get.chitty.cc), governance checks, and ontology/scopes.

## Summary
- Governance (Layer 0): Canon (docs exist), Schema (code complete; endpoint deploy issue), Charter (planned; not rolled out)
- Foundation (L1): ChittyID live and healthy; others planned
- Core (L2): ChittyAuth active; Schema active but endpoint needs fix; Gateway active
- Data (L3): Ledger exists as Notion DB; service API not yet
- Registry (L4): Authority in Notion; Register/Registry not implemented
- Platform (L5): Monitor active; MCP complete and ready
- Domain (L6): Certify planned; Evidence active
- Sync (L7): Sync complete; not deployed
- Apps (L8): Gov active; Auth app active; others planned

## Gaps → Actions (Top 10)
1) Schema endpoint reliability (schema.chitty.cc)
   - Gap: Endpoint returns crawl/deploy error
   - Action: Add deploy workflow; healthcheck; alerting; ownership in onboarding

2) Registry write path (ChittyRegister)
   - Gap: Submission webhook not implemented
   - Action: Build minimal Worker with Canon validation; publish /registry/submit; add to get.chitty.cc/service/chittyregister

3) Registry read API (ChittyRegistry)
   - Gap: CQRS read API not implemented
   - Action: Stand up read-only API backed by Authority; /api/services; add to onboarding

4) Onboarding authority (get.chitty.cc)
   - Gap: Disparate docs across Notion/GitHub
   - Action: Use docs/onboarding/* and service templates; publish via Pages; enforce governance checks

5) Secrets model consolidation
   - Gap: Mixed naming/flows; ad‑hoc provisioning
   - Action: Standardize env names (CHITTY_AUTH_TOKEN, CHITTY_REGISTRY_TOKEN, CHITTY_ID_TOKEN, …); codify in docs/governance/SECRETS_MODEL.md; enforce via CI

6) CI ephemeral credentials
   - Gap: Brittle local actions
   - Action: Use inline curl via ChittyConnect `/credentials/deploy`; clear failure messages; optional pre‑provision step

7) MCP and OpenAPI validations
   - Gap: Workflows check files that may not exist per repo
   - Action: Scope validations to repos where artifacts exist; add conditional checks

8) Authority registry automation
   - Gap: Manual updates
   - Action: Add Writer job that writes approved services to Authority; audit trail in ChittyConnect

9) Charter rollout (CHARTER.md)
   - Gap: Not rolled out to Foundation services
   - Action: Generate SERVICE_TEMPLATE.md + CHARTER.md per service; add CODEOWNERS

10) Sync deployment (sync.chitty.cc)
   - Gap: Ready but not deployed
   - Action: Address disk space; create deploy worker; health + alerts

## Governance alignment (get.chitty.cc)
- /service/<name>: Use docs/onboarding/SERVICE_TEMPLATE.md
- /ontology: docs/ontology/CLASSIFICATIONS.md
- /scopes: etc/chittyos/scopes.yml
- /secrets: docs/governance/SECRETS_MODEL.md
- /access: docs/governance/ACCESS_CONTROL.md

## Secrets & Provisioning (cross‑service)
- Long‑lived: 1Password → Wrangler secrets per env
- Ephemeral (CI): ChittyConnect `/credentials/deploy` with `CHITTYCONNECT_API_KEY`
- Standard env:
  - CHITTY_AUTH_TOKEN (auth.chitty.cc)
  - CHITTY_REGISTRY_TOKEN (registry.chitty.cc)
  - CHITTY_ID_TOKEN (id.chitty.cc)
  - Optional: CHITTY_DNA_TOKEN, VERIFY, CERTIFY

## Immediate Next Steps
- Fix schema endpoint deploy; add workflows/alerts
- Implement minimal ChittyRegister (write) + ChittyRegistry (read)
- Publish onboarding site (get.chitty.cc) from docs/
- Normalize secrets across repos; enable governance checks
- Update deploy workflows to only validate available artifacts

