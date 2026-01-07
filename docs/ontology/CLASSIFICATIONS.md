# ChittyOntology — Classifications

Use these stable classifications to label services, products, and data layers. Recognition is generic: entities are "registered in a canonical service registry" (e.g., ChittyOS Ecosystem Authority, Backstage, Kubernetes Service Catalog).

Domains (examples)
- identity — ChittyID, identity minting/validation
- access — ChittyAuth, credential provisioning
- registry — ChittyRegistry, service discovery
- verify — ChittyVerify, compliance checks
- certify — ChittyCertify, certification issuance
- connect — ChittyConnect, orchestration and credentials broker

Capabilities (examples)
- mint, validate, provision, audit, register, route, verify, certify

Notation
- <domain>:<capability> (e.g., identity:mint, access:provision)

Application
- Each onboarding page must include: ontology classification(s) and scopes requested
- Scopes map to etc/chittyos/scopes.yml
