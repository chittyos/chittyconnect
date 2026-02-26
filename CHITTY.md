---
uri: chittycanon://docs/ops/architecture/chittyconnect
namespace: chittycanon://docs/ops
type: architecture
version: 1.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "ChittyConnect"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyConnect

> `chittycanon://core/services/chittyconnect` | Tier 2 (Platform) | connect.chitty.cc

## What It Does

AI-intelligent spine (itsChitty) for the ChittyOS ecosystem with ContextConsciousness and MemoryCloude. Provides three interfaces (REST API, MCP Server, GitHub App) enabling custom GPTs, Claude, and third-party integrations to interact with the entire platform.

## Architecture

Cloudflare Worker deployed at connect.chitty.cc with Neon PostgreSQL, KV, and Durable Objects.

### Stack
- **Runtime**: Cloudflare Workers + Hono
- **Database**: Neon PostgreSQL (context entities, DNA, ledger, sessions)
- **Integrations**: Notion, OpenAI, Google Calendar, Neon, Cloudflare AI

### Three Interfaces
1. **REST API** — Custom GPT Actions with OpenAPI 3.0 spec
2. **MCP Server** — Model Context Protocol for Claude integration
3. **GitHub App** — Fast-ack webhook processing with MCP normalization

### Context Intelligence
- Context taxonomy (20 types, 10 categories)
- Behavioral trait tracking (volatile, compliant, creative, methodical, resilient, trustAligned)
- Alchemist archetypes (Sentinel, Artisan, Sage, Alchemist, Diplomat)

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Answer |
|--------|--------|--------|
| **Identity** | TY | AI-intelligent spine — universal connector for GPTs, Claude, and third-party integrations |
| **Connectivity** | VY | REST API + MCP Server + GitHub App; proxies Notion, OpenAI, Neon, Google Calendar; ContextConsciousness cross-session state |
| **Authority** | RY | Tier 2 Platform — integration hub, not source of truth; delegates identity/auth/registration upstream |

## ChittyOS Ecosystem

### Certification
- **Badge**: ChittyOS Compatible
- **Certifier**: ChittyCertify (`chittycanon://core/services/chittycertify`)
- **Last Certified**: --

### ChittyDNA
- **ChittyID**: --
- **DNA Hash**: --
- **Lineage**: root (platform spine)

### Dependencies
| Service | Purpose |
|---------|---------|
| ChittyID | Identity minting |
| ChittyAuth | Token validation |
| ChittyRegistry | Service discovery |
| ChittyChronicle | Event logging |
| ChittyFinance | Banking integrations |
| ChittyCases | Case management |
| ChittyEvidence | Evidence management |
| ChittyLedger | Transaction recording |

### Endpoints
| Path | Method | Auth | Purpose |
|------|--------|------|---------|
| `/health` | GET | No | Service health |
| `/openapi.json` | GET | No | OpenAPI specification |
| `/api/chittyid/mint` | POST | Yes | Mint ChittyID |
| `/api/chittyid/validate` | POST | Yes | Validate ChittyID |
| `/api/services/status` | GET | Yes | All services status |
| `/api/thirdparty/notion/query` | POST | Yes | Query Notion |
| `/mcp/tools/list` | GET | Yes | MCP tools |
| `/mcp/tools/call` | POST | Yes | Execute MCP tool |

## Document Triad

This badge is part of a synchronized documentation triad. Changes to shared fields must propagate.

| Field | Canonical Source | Also In |
|-------|-----------------|---------|
| Canonical URI | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Tier | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Domain | CHARTER.md (Classification) | CHITTY.md (blockquote), CLAUDE.md (header) |
| Endpoints | CHARTER.md (API Contract) | CHITTY.md (Endpoints table), CLAUDE.md (API section) |
| Dependencies | CHARTER.md (Dependencies) | CHITTY.md (Dependencies table), CLAUDE.md (Architecture) |
| Certification badge | CHITTY.md (Certification) | CHARTER.md frontmatter `status` |

**Related docs**: [CHARTER.md](CHARTER.md) (charter/policy) | [CLAUDE.md](CLAUDE.md) (developer guide)
