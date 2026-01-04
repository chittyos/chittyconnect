# ChittySync — Reality Snapshot (Authoritative)

Status: Implemented (TypeScript/Node), not yet deployed; Cloudflare Workers target; blocked on disk space.

What exists
- Core: Notion ↔ Google Sheets bidirectional sync in TypeScript/Node
- Packages: monorepo at /Volumes/thumb/chittysync (to import here later)
- Design: Universal registry sync, schema‑driven; dry‑run and conflict detection primitives

What does not exist (yet)
- Python validators (speculative in docs; not implemented)
- Conflict resolution database/UI
- GitHub Actions automation (lint/test/release/deploy)
- Google Sheets canonical templates checked into source
- Postgres adapter (Neon) as a supported target (planned)

Deployment target
- Cloudflare Workers (scheduled sync + on‑demand), KV/D1 for state
- Not AWS ECS (remove references in docs)

Required secrets (per env)
- NOTION_API_TOKEN — Notion API
- GOOGLE_SERVICE_ACCOUNT_JSON — Google Sheets service account (JSON)
- CHITTY_AUTH_TOKEN — ChittyAuth (for ephemeral CI tokens if needed)
- (Optional) CHITTY_REGISTRY_TOKEN — advertise sync capabilities

High‑level plan to production
- Repo import: migrate monorepo into chittyos org (or submodule)
- CI: add test + build on Node 20; package publish (GPR only)
- Deploy: Worker + wrangler.toml + schedules; environment secrets; health endpoint
- Templates: add Google Sheets templates under docs/templates/sheets
- Docs: get.chitty.cc/service/chittysync based on onboarding template

Scope alignment
- Keep current deliverable: Notion ↔ Google Sheets
- Defer: Neon/Postgres adapter, Python validators, conflict resolution UI, dashboards

Known blockers
- Disk space for initial import/build; allocate or prune artifacts

Links
- Architecture board: docs/architecture/ARCHITECTURE_MAGNET_BOARD.md
- Onboarding template: docs/onboarding/SERVICE_TEMPLATE.md

