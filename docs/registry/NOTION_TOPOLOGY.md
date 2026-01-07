# ChittyOS Registry Topology (Notion Implementation)

This document maps validated ChittyOntology entities to Notion databases (registries) for the ChittyOS implementation profile. Other orgs can replace these with their own registries.

Registries (Notion databases)
- Service Registry (Authority primary)
  - Pages: one per Service entity
  - Fields: service_name, category, status, owners, github_repo, primary_domain, routes, ontology, scopes
- Domain Registry
  - Pages: one per {service_name}.chitty.cc (when status = Live/Active)
  - Fields: domain_name, owner_entity, ssl, dns_provider, aliases
- Infrastructure Registry
  - Pages: one per deployed compute (e.g., Cloudflare Worker), plus DNS entries
  - Fields: provider, resource_type, resource_id, region, account, tags
- Version Control Registry
  - Pages: one per repo
  - Fields: repo_url, provider, owners, default_branch, visibility, license
- Legal Registry (Ownership)
  - Pages: one per legal owner entity (LLC/Corp/etc.)
  - Links: Service.owner_entity → Legal Registry
- Evidence Index
  - Pages: one per Evidence artifact (evidence_id)
  - Fields: evidence_type, source, classification, received_at, case link
- Case Registry
  - Pages: one per case (e.g., 2024D007847)
  - Links: Evidence → Case; Case → Evidence

Auto‑creation (on validation pass)
- Service (always): create/update Service Registry entry
- Service (Live/Active): create Domain Registry entry for {service_name}.chitty.cc; create Infra entries for compute/DNS when deployed
- Service (any): create Version Control entry when github_repo present; link Legal owner
- Evidence (always): create Evidence Index entry; link to Case Registry; write to Ledger; write Chain provenance

Config
- etc/registries/notion.json stores Notion database IDs and integration details.
- etc/authority/auto-registry.json defines which registries to create per entity type (and conditions).

Execution
- ChittyRegister should apply these mappings after validation; for preview use scripts/plan-auto-registry.js.

