# ChittyOS Onboarding Index (get.chitty.cc)

Purpose: Authoritative, reviewed onboarding for services, products, data layers, and implementations. This mirrors the intended information architecture at `get.chitty.cc`.

Proposed IA (URLs are canonical slugs to be hosted at get.chitty.cc):
- / (Landing) — Overview, ecosystem map, roles, review gates
- /service/<name> — Service onboarding (see SERVICE_TEMPLATE.md)
- /product/<name> — Product onboarding and surface areas
- /datalayer/<name> — Data layer contracts, retention, sensitivity, lineage
- /implementation/<name> — Implementation guides, runbooks, rollout plans
- /ontology — ChittyOntology definitions and classifications
- /scopes — Ecosystem scopes and enforcement policy (maps to etc/chittyos/scopes.yml)
- /access — Access control model, review cadence, break‑glass
- /secrets — Secrets model, provisioning, rotation, audit

Review gates and ownership:
- Security review: required for any change to secrets, scopes, or auth paths
- Data review: required for any new/changed data layers
- Service owner: owns the service onboarding page and runtime runbooks

Authoritative sources in-repo:
- docs/onboarding/SERVICE_TEMPLATE.md
- docs/governance/ACCESS_CONTROL.md
- docs/governance/SECRETS_MODEL.md
- docs/ontology/CLASSIFICATIONS.md
- etc/chittyos/scopes.yml

Process summary:
1) Draft onboarding page (service/product/datalayer/implementation)
2) Classify via ontology and request scopes
3) Provision secrets via ChittyAuth (or 1Password → Wrangler secrets)
4) Submit PR with labels: security-approved, docs-approved, access-reviewed
5) CI governance checks enforce presence, labels, and scope compliance

