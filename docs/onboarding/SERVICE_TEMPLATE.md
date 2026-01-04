# Service Onboarding — <service_name>

Summary
- Service ID: <service_name>
- Owner(s): <team/owners>
- Tier: <tier1|tier2|tier3>
- Ontology classification: <domain>:<capability> (see docs/ontology/CLASSIFICATIONS.md)
- Scopes: see etc/chittyos/scopes.yml → <service_name>

Endpoints
Required standard routes (see docs/canon/URL_ARCHITECTURE.md)
- Root: https://<service>.chitty.cc/
- API: https://<service>.chitty.cc/api
- Docs: https://<service>.chitty.cc/docs (or /openapi.json)
- Health: https://<service>.chitty.cc/health
Optional
- MCP: https://<service>.chitty.cc/mcp
- Status: https://<service>.chitty.cc/status
Webhooks: <list>

Secrets & Provisioning
- Long‑lived service tokens: managed in 1Password; synced to Wrangler secrets
- Ephemeral CI tokens: provisioned via ChittyAuth/ChittyConnect
- Required env:
  - CHITTY_AUTH_TOKEN (auth.chitty.cc)
  - CHITTY_REGISTRY_TOKEN (registry.chitty.cc)
  - Optional: CHITTY_DNA_TOKEN, VERIFY/CERTIFY tokens as needed

Access Control
- Roles: service-owner, security, data, platform
- Reviews: security-approved, docs-approved, access-reviewed before deploy
- Rotation: every 90 days or on incident

Runbooks
- Deploy: .github/workflows/deploy.yml
- Incident: contact <oncall>
- Rollback: documented commands + criteria

Change Management
- Scope changes must update etc/chittyos/scopes.yml
- Secrets changes must update docs/governance/SECRETS_MODEL.md
