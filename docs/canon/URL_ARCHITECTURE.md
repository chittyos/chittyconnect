# ChittyOS URL Architecture (ChittyCanon Standard)

Purpose: Canonical routing standard for ChittyOS services, enforced by onboarding and gateway policy.

Service-specific domains
- {name}.chitty.cc — Root landing
- {name}.chitty.cc/api — REST or GraphQL API
- {name}.chitty.cc/mcp — MCP protocol server (if provided)
- {name}.chitty.cc/docs — API docs (OpenAPI/Swagger/Redoc)
- Optional: {name}.chitty.cc/health, {name}.chitty.cc/status, and service-specific paths

Aggregated endpoints (cross-service discovery)
- api.chitty.cc/{name} → {name}.chitty.cc/api
- mcp.chitty.cc/{name} → {name}.chitty.cc/mcp
- charter.chitty.cc/{name} → Foundation CHARTER.md
- schema.chitty.cc/{topic} → Schema definitions
- git.chitty.cc/{name} → GitHub repository shortcut
- canon.chitty.cc/{topic} → Canon pages (this spec at canon.chitty.cc/urls)

Governance
- Onboarding pages must list standard routes and health endpoint
- Gateway routing must align to this mapping
- CI can assert presence of /health and /openapi.json (if API is exposed)

References
- docs/onboarding/SERVICE_TEMPLATE.md
- docs/architecture/ARCHITECTURE_MAGNET_BOARD.md

