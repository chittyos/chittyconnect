# ChittyOntology — Universal Entity Model

ChittyOntology is a universal meta-framework for describing and governing systems across organizations.
ChittyOS uses it via ChittyRegister/ChittyRegistry, but any org can adopt it with different registries and tooling.

Core concepts
- Entity types (schemas): Service, DataLayer, Composite, Domain, Infrastructure, VersionControl, UnstructuredData, Evidence
- Conditional rules: JSON/YAML IF/THEN policies enforced at write time
- Generation mapping: Which artifacts/routes/docs auto-generate from valid entries
- Profiles: Implementation-specific constraints (e.g., *.chitty.cc domain rules)

Recognition (generic)
- “Registered in a canonical service registry” — e.g., ChittyOS Ecosystem Authority, Backstage, Kubernetes Service Catalog, or a custom registry.

Profiles
- etc/profiles/profile.json — active profile
- etc/profiles/<profile>/rules.json — profile-specific validations
- ChittyOS profile adds *.chitty.cc URL patterns and route conventions

Schemas
- See etc/authority/schema/*.schema.json

Rules & generation
- Universal rules: etc/authority/rules.json
- Profile rules: etc/profiles/<profile>/rules.json
- Generation mapping: etc/authority/generation.json

Adoption example
```
ontology: ChittyOntology v2.0
enforcement:
  service_registry: Backstage
  validation: Custom validator
  audit_log: Datadog
entity_types:
  service:
    recognition: Registered in Backstage service catalog
    category_override:
      Foundation: Core Infrastructure
      Core: Platform Services
```

