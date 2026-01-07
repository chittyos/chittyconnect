# Service Onboarding — ChittySync

Summary
- Service ID: chittysync
- Owner(s): <team/owners>
- Tier: Platform/Sync
- Ontology classification: connect:orchestrate, access:broker
- Scopes: see etc/chittyos/scopes.yml → chittyconnect (broker) and chittysync (to add on import)

Endpoints
- Health: https://sync.chitty.cc/health (planned)
- OpenAPI: n/a initially; basic health and job status endpoints first

Secrets & Provisioning
- NOTION_API_TOKEN (Notion)
- GOOGLE_SERVICE_ACCOUNT_JSON (Sheets)
- CHITTY_AUTH_TOKEN (for CI ephemeral creds if needed)

Access Control
- Roles: service-owner, security, platform
- Reviews: security-approved, docs-approved, access-reviewed before deploy
- Rotation: 90 days for long‑lived credentials

Runbooks
- Deploy: Cloudflare Worker via wrangler; scheduled syncs
- Incident: disable schedules; roll back Worker; notify owners
- Rollback: redeploy last known good

Change Management
- Scopes updated in etc/chittyos/scopes.yml
- Secrets model documented in docs/governance/SECRETS_MODEL.md

Current status
- Implemented (TypeScript/Node) but not deployed; see docs/services/chittysync.md

