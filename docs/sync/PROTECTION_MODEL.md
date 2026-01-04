# ChittySync Protection Model (Immutable Core)

Core risks
- Sheets treated as equal write source can bypass validation and corrupt Foundation/data artifacts.

Protections (policy & enforcement)
- Field-level write permissions (policy): etc/sync/policy.json
  - Foundation: service_name, category immutable; github_repo only via ChittyRegister with security-approved label
  - Evidence: submitted_date, evidence_id, chain_hash are WORM
  - Schema: schema_topics only via ChittySchema
  - Deletes: Sheets cannot delete; deprecate via workflow
- Validation CLI: scripts/validate-mutation.js
  - Input: { entity_type, category, field, operation, source, labels[] }
  - Output: ALLOWED or DENIED with reasons
- Source-of-truth routing
  - Authority/Registry is the write path; Sheets/Notion treated as read-only for Foundation
  - Sheets edits go to a proposal pipeline, then ChittyRegister applies after validation
- Soft-delete & lifecycle
  - No hard deletes from Sheets; deprecate with state transitions (see docs/canon/STATUS_MODEL.md)
- Schema drift protection
  - OpenAPI/Schema changes only via schema.chitty.cc; CI enforces docs presence or local fallback during bootstrap

Adoption in ChittySync
- Run validate-mutation.js before applying any change from Sheets/Notion to Authority/DB
- Maintain a change queue with approvals; apply via ChittyRegister to preserve audit
- Expose a “dry-run” preview and explicit “apply” phase to reduce blast radius

