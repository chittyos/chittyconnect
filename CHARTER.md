---
uri: chittycanon://docs/ops/policy/chittyconnect-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.0.0
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

## Compliance

- [ ] Service registered in ChittyRegistry
- [ ] Health endpoint operational at /health
- [ ] OpenAPI specification published
- [ ] CLAUDE.md development guide present
- [ ] MCP manifest published
- [ ] GitHub App webhook verified

---
*Charter Version: 1.0.0 | Last Updated: 2026-01-12*
