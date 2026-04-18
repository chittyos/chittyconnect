---
uri: chittycanon://docs/ops/policy/chittyconnect-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.1.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "ChittyConnect Charter"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyConnect Charter

## Classification
- **Canonical URI**: `chittycanon://core/services/chittyconnect`
- **Tier**: 2 (Platform)
- **Organization**: CHITTYOS
- **Domain**: connect.chitty.cc

## Mission

ChittyConnect is the **AI-intelligent spine** (itsChitty™) for the ChittyOS ecosystem with ContextConsciousness™ and MemoryCloude™. It provides the comprehensive connector enabling custom GPTs, Claude, and third-party integrations to interact with the entire ChittyOS ecosystem.

## Scope

### IS Responsible For
- Custom GPT Actions API with OpenAPI specification
- MCP (Model Context Protocol) server for Claude integration
- GitHub App integration with fast-ack webhook processing
- Third-party integration proxy (Notion, OpenAI, Neon, Google Calendar, Cloudflare AI)
- ContextConsciousness™ - Cross-session context maintenance
- MemoryCloude™ - Persistent memory for Claude interactions
- Service health monitoring across ChittyOS ecosystem
- API key management and rate limiting
- ChittyID minting coordination
- Legal case management via ChittyCases
- Evidence ingestion via ChittyEvidence
- User identity and profile management via `neon_auth.user` and `neon_auth.account` on ChittyOS-Core
- User session management via `neon_auth.session` (when stateful sessions required)
- Organization/membership management via `neon_auth.organization`, `neon_auth.member`

### IS NOT Responsible For
- Direct identity generation (ChittyID)
- Token provisioning (ChittyAuth)
- Service registration (ChittyRegister)
- Certificate authority (ChittyTrust)
- Evidence verification (ChittyVerify)
- Event storage (ChittyChronicle)

## Three Interfaces

### 1. REST API (Custom GPT Actions)
- OpenAPI 3.0 specification at `/openapi.json`
- ChittyOS service proxying
- Third-party API unification

### 2. MCP Server (Claude Integration)
- Model Context Protocol tools
- Real-time resource access
- ContextConsciousness™ state

### 3. GitHub App
- Fast-ack webhook processing
- MCP normalization
- Issue/PR automation

## Dependencies

| Type | Service | Purpose |
|------|---------|---------|
| Upstream | ChittyID | Identity minting |
| Upstream | ChittyAuth | Token validation |
| Upstream | ChittyRegistry | Service discovery |
| Peer | ChittyChronicle | Event logging |
| Peer | ChittyFinance | Banking integrations |
| Peer | ChittyCases | Case management |
| Peer | ChittyEvidence | Evidence management |
| Peer | ChittyLedger | Transaction recording |
| External | Notion API | Database operations |
| External | OpenAI API | Chat completions |
| External | Google Calendar | Event management |
| External | Neon Database | SQL queries |

## Neon Auth Ownership

ChittyConnect is the **canonical owner of user identity and session data** within the Neon Auth schema on ChittyOS-Core (`neon_auth` schema, Neon project `restless-grass-40598426`).

### Schema Ownership Split

| `neon_auth` Table | Owner | Rationale |
|-------------------|-------|-----------|
| `user`, `account`, `verification` | **ChittyConnect** | User profiles and credentials — per this charter's scope |
| `session` | **ChittyConnect** | User session management |
| `organization`, `member`, `invitation` | **ChittyConnect** | Multi-tenant org membership |
| `jwks` | **ChittyAuth** | JWT signing keys — per ChittyAuth charter scope |
| `project_config` | **ChittyAuth** | JWKS URL, issuer configuration |

### User Identity Flow

1. **ChittyID** mints the canonical identity (DID format `VV-G-LLL-SSSS-T-YM-C-X`)
2. **ChittyConnect** writes the user profile to `neon_auth.user` (linked via ChittyID)
3. **ChittyAuth** signs JWTs with keys from `neon_auth.jwks`, embedding the ChittyID as a claim
4. **Downstream services** validate JWTs against ChittyAuth's JWKS and use RLS policies referencing `auth.jwt() ->> 'chitty_id'` for per-user data scoping

### Migration Note (2026-04)
The `neon_auth.user` table on ChittyOS-Core currently has 0 rows. ChittyAuth's existing user data lives in `public.users` (2 rows) and `public.identities` (73 rows). ChittyConnect will migrate user profile data to `neon_auth.user` as part of the Neon Auth unification initiative. See companion amendment: [chittyfoundation/chittyauth#4](https://github.com/chittyfoundation/chittyauth/pull/4).

## API Contract

**Base URL**: https://connect.chitty.cc

### Core Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Service health |
| `/openapi.json` | GET | OpenAPI specification |
| `/api/chittyid/mint` | POST | Mint ChittyID |
| `/api/chittyid/validate` | POST | Validate ChittyID |
| `/api/services/status` | GET | All services status |
| `/api/thirdparty/notion/query` | POST | Query Notion |
| `/api/thirdparty/openai/chat` | POST | OpenAI proxy |

### MCP Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp/manifest` | GET | Server manifest |
| `/mcp/tools/list` | GET | Available tools |
| `/mcp/tools/call` | POST | Execute tool |
| `/mcp/resources/list` | GET | Available resources |
| `/mcp/resources/read` | GET | Read resource |

### MCP Tools Available
- `chittyid_mint` - Mint ChittyIDs with context
- `chitty_contextual_analyze` - ContextConsciousness™ analysis
- `chitty_case_create` - Create legal cases
- `chitty_evidence_ingest` - Ingest evidence
- `chitty_services_status` - Monitor ecosystem health
- `chitty_finance_connect_bank` - Connect banking

### Authentication
```
X-ChittyOS-API-Key: {api_key}
```
Or:
```
Authorization: Bearer {token}
```

## ContextConsciousness™

Cross-service awareness system providing:
- Real-time knowledge of all service states
- Contextual analysis (legal, financial, relational)
- Intelligent routing to optimal services
- State persistence via MemoryCloude™

### ChittyContext (Edge Cache Capability)

ChittyContext is a local edge cache at `~/.claude/chittycontext/` that provides
offline-resilient session state for Claude Code sessions. It is a **capability of
ChittyConnect**, not a standalone service.

**Responsibilities:**
- Auto-resolve session context via MCP bridge on session start
- Cache last-known state locally for offline resilience
- Queue session metrics for async commit to ChittyConnect backend
- Maintain project-scoped state files per entity

**Not a standalone service:** ChittyContext has no charter, no deployment, no health
endpoint. It is a client-side cache governed by ChittyConnect's ContextConsciousness™.

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |
| Technical Lead | @chittyos-infrastructure |
| Security Contact | security@chitty.cc |

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Question | ChittyConnect Answer |
|--------|--------|----------|--------------------|
| **Identity** | TY | What IS it? | AI-intelligent spine — the universal connector enabling GPTs, Claude, and third-party integrations to interact with the ChittyOS ecosystem |
| **Connectivity** | VY | How does it ACT? | Three interfaces: REST API (Custom GPT Actions), MCP Server (Claude), GitHub App (webhooks); proxies Notion, OpenAI, Neon, Google Calendar; ContextConsciousness™ cross-session state |
| **Authority** | RY | Where does it SIT? | Tier 2 Platform — integration hub, not source of truth; delegates identity to ChittyID, auth to ChittyAuth, registration to ChittyRegister |

## Document Triad

This charter is part of a synchronized documentation triad. Changes to shared fields must propagate.

| Field | Canonical Source | Also In |
|-------|-----------------|---------|
| Canonical URI | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Tier | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Domain | CHARTER.md (Classification) | CHITTY.md (blockquote), CLAUDE.md (header) |
| Endpoints | CHARTER.md (API Contract) | CHITTY.md (Endpoints table), CLAUDE.md (API section) |
| Dependencies | CHARTER.md (Dependencies) | CHITTY.md (Dependencies table), CLAUDE.md (Architecture) |
| Certification badge | CHITTY.md (Certification) | CHARTER.md frontmatter `status` |

**Related docs**: [CHITTY.md](CHITTY.md) (badge/one-pager) | [CLAUDE.md](CLAUDE.md) (developer guide)

## Compliance

- [x] Service registered in ChittyRegistry
- [x] Health endpoint operational at /health
- [x] OpenAPI specification published
- [x] CLAUDE.md development guide present
- [x] MCP manifest published
- [x] GitHub App webhook verified

---
*Charter Version: 1.1.0 | Last Updated: 2026-04-13*
