# ChittyOS Status Model & Transitions

States
- Planned — documented intent, no implementation
- In Progress — active implementation, not deployable
- Needs Deployment — implementation complete, pending deploy
- Live — deployed and healthy (health endpoint passes)
- Active — optional tag for high usage/adoption (treated as Live for requirements)
- Deprecated — decommission in progress; docs and routes remain until retired

Rules
- Live and Active enforce: /health; docs if exposes.openapi; mcp route if exposes.mcp
- Foundation services require CHARTER.md when Live/Active

Transitions (logical)
- Planned → In Progress → Needs Deployment → Live → (Active optional) → Deprecated
- Skips discouraged; rollbacks allowed with review

Enforcement
- CI enforces requirements per state; transition validation requires prior-state context and is advisory for now.

