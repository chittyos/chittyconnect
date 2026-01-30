# CLAUDE.md (Pointer)

Canonical CLAUDE guidance has moved to `development/docs/architecture/CLAUDE.md`.

Update architecture guidance there; link here is maintained for navigation.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **🎯 Project Orchestration:** This project follows [ChittyCan™ Project Standards](../chittycan/CHITTYCAN_PROJECT_ORCHESTRATOR.md) <!-- was: ../CHITTYCAN_PROJECT_ORCHESTRATOR.md -->

## Project Overview

**ChittyConnect** is the AI-intelligent spine with ContextConsciousness™ & MemoryCloude™. It's the comprehensive connector enabling custom GPTs and Claude to interact with the entire ChittyOS ecosystem and third-party integrations.

**Key Characteristics:**
- Three primary interfaces: REST API, MCP Server, GitHub App
- ContextConsciousness™ - Maintains context across sessions
- MemoryCloude™ - Persistent memory for Claude interactions
- OpenAPI specification for Custom GPT Actions
- Third-party integration proxy (Notion, OpenAI, Google Calendar, Neon)
- Cloudflare Workers architecture

## Architecture

### Three Interfaces

1. **Custom GPT Actions API**
   - REST API with OpenAPI specification
   - ChittyID minting and validation
   - Legal case management (ChittyCases)
   - Evidence ingestion and analysis
   - Banking connections (ChittyFinance)
   - Contextual analysis (ContextConsciousness™)
   - Event logging (ChittyChronicle)
   - Data synchronization (ChittySync)
   - Service health monitoring

2. **MCP Server for Claude**
   - Model Context Protocol server
   - Deep Claude integration
   - Tools: chittyid_mint, contextual_analyze, case_create, evidence_ingest, services_status, finance_connect_bank, and more
   - ContextConsciousness™ and MemoryCloude™ capabilities

3. **GitHub App Integration**
   - Fast-ack webhook processing
   - MCP normalization
   - Issue and PR automation

### Third-Party Integration Proxy

Unified proxy for external services:
- **Notion API** - Database queries, page creation
- **Neon Database** - SQL queries
- **OpenAI** - Chat completions
- **Google Calendar** - Event management
- **Cloudflare AI** - Workers AI models

### Context Intelligence Layer

The intelligence layer provides decision-making capabilities based on accumulated context DNA:

#### Modules (`src/intelligence/`)

| Module | Purpose |
|--------|---------|
| `context-resolver.js` | Resolves session hints to context entities |
| `context-intelligence.js` | Decision engine - coherence, autonomy, guardrails |
| `context-behavior.js` | Behavioral tracking - traits, trends, red flags |
| `context-taxonomy.js` | Context type classification (20 types, 10 categories) |
| `alchemist-daemon.js` | Capability assessment, experiments, evolution observation |
| `context-alchemy.js` | Chemistry-inspired naming for lifecycle operations |
| `context-periodic-table.js` | Extended taxonomy (deprecated, use taxonomy.js) |

#### Key Concepts

**Context Taxonomy** - 20 predefined context types:
- Technical: Developer, Frontend, Backend
- Operations: DevOps, SRE
- Data: Analyst, Engineer, Scientist
- AI/ML: AI Engineer, ML Engineer
- Design: UX, UI
- Management: PM, PO, Tech Lead
- Security: Security, Compliance
- Business: Legal, Finance
- Synthetic: Supernova, Fission, Derivative, Suspension

**Behavioral Traits** (0.0-1.0 scores):
- `volatile` - Tendency toward erratic behavior (lower is better)
- `compliant` - Adherence to rules/guidelines
- `creative` - Novel solution exploration
- `methodical` - Systematic approach
- `resilient` - Recovery from failures
- `trustAligned` - Alignment with safety guidelines

**Source Influence Profiles**:
- High stability (0.9): docs.github.com, developer.mozilla.org
- Medium stability (0.7): github.com, openai.com
- Low stability (0.3-0.4): x.com, reddit.com

**Alchemist Archetypes** (stability vs capability tradeoff):
- **Sentinel** (0.9 stability) - Routine tasks, monitoring
- **Artisan** (0.6 stability) - Balanced, general development
- **Sage** (0.4 stability) - Complex problems, architecture
- **Alchemist** (0.3 stability) - Innovation, prototyping
- **Diplomat** (0.7 stability) - Orchestration, collaboration

#### Intelligence API Endpoints

```bash
# Taxonomy
GET  /api/v1/intelligence/taxonomy                    # Get all context types
GET  /api/v1/intelligence/taxonomy/classify/:chittyId # Classify a context
GET  /api/v1/intelligence/taxonomy/discovery          # User's discovery status
GET  /api/v1/intelligence/taxonomy/collaborators/:id  # Find collaborators

# Behavioral Analysis
GET  /api/v1/intelligence/behavior/:chittyId          # Behavioral summary
GET  /api/v1/intelligence/behavior/concerns           # Contexts with red flags
POST /api/v1/intelligence/behavior/exposure           # Log source exposure
POST /api/v1/intelligence/behavior/assess/:chittyId   # Assess traits

# Alchemist Daemon
GET  /api/v1/intelligence/alchemist/reference         # Capability dimensions & archetypes
GET  /api/v1/intelligence/alchemist/capabilities/:id  # Assess context capabilities
GET  /api/v1/intelligence/alchemist/observe           # Observe evolution (field mode)
POST /api/v1/intelligence/alchemist/experiment        # Run experiment (lab mode)

# Decisions & Operations
GET  /api/v1/intelligence/decisions/:chittyId         # Full session decisions
POST /api/v1/intelligence/coherence                   # Analyze context drift
POST /api/v1/intelligence/supernova/analyze           # Analyze merge potential
POST /api/v1/intelligence/supernova/execute           # Execute merge
POST /api/v1/intelligence/fission/analyze             # Analyze split potential
POST /api/v1/intelligence/fission/execute             # Execute split
POST /api/v1/intelligence/derivative                  # Fork a context
POST /api/v1/intelligence/suspension                  # Temporary blend
POST /api/v1/intelligence/solution                    # Team of contexts
POST /api/v1/intelligence/combination                 # Soft merge
```

#### Database Tables

```sql
-- Core (migration 009)
context_entities          -- Context with ChittyID
context_dna               -- Accumulated patterns, traits, competencies
context_ledger            -- Immutable event chain
context_session_bindings  -- Session-to-context bindings
context_trust_log         -- Trust change audit trail

-- Lifecycle (migration 010)
context_collaborations    -- Parent-child delegation
context_pairs             -- Complementary relationships
context_lifecycle_events  -- Supernova, fission, etc.

-- Behavioral (migration 011)
context_exposure_log      -- Source interaction history
context_behavioral_events -- Trait shifts, red flags, trends
```

## Essential Commands

### Development
```bash
npm install              # Install dependencies
npm run dev              # Start Wrangler dev server (localhost:8787)
npm test                 # Run all tests
npm run typecheck        # TypeScript type checking
```

### Deployment
```bash
npm run deploy:staging       # Deploy to staging
npm run deploy:production    # Deploy to production
npm run tail                 # Stream live logs
```

### Secrets Management
```bash
wrangler secret put NEON_DATABASE_URL
wrangler secret put JWT_SECRET
wrangler secret put CHITTY_ID_SERVICE_TOKEN
wrangler secret put CHITTY_AUTH_SERVICE_TOKEN
wrangler secret put NOTION_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_CALENDAR_CLIENT_ID
wrangler secret put GOOGLE_CALENDAR_CLIENT_SECRET
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_PRIVATE_KEY
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret list  # Verify all secrets
```

## API Endpoints

### Custom GPT Actions

```bash
# OpenAPI Specification
GET /openapi.json

# ChittyID Operations
POST /api/v1/chittyid/mint
GET /api/v1/chittyid/validate/:id

# Case Management
POST /api/v1/cases/create
GET /api/v1/cases/:id

# Evidence Operations
POST /api/v1/evidence/ingest
GET /api/v1/evidence/:id

# Contextual Analysis (ContextConsciousness™)
POST /api/v1/contextual/analyze

# Service Health
GET /api/v1/services/status

# Finance Operations
POST /api/v1/finance/connect-bank
```

### MCP Tools

Available via Model Context Protocol:
- `chittyid_mint` - Mint ChittyIDs with context
- `chitty_contextual_analyze` - ContextConsciousness™ analysis
- `chitty_case_create` - Create legal cases
- `chitty_evidence_ingest` - Ingest evidence
- `chitty_services_status` - Monitor ecosystem health
- `chitty_finance_connect_bank` - Connect banking
- Additional tools for ChittyChronicle, ChittySync, etc.

### GitHub Webhooks

```bash
POST /webhooks/github
X-Hub-Signature-256: {signature}
```

## Integration with ChittyOS

### Service Dependencies
- **ChittyID** (id.chitty.cc) - Identity generation
- **ChittyAuth** (auth.chitty.cc) - Authentication
- **ChittyRegistry** (registry.chitty.cc) - Service discovery
- **ChittyChronicle** - Event logging
- **ChittyFinance** - Banking integrations
- **ChittyCases** - Case management
- **ChittyVerify** - Evidence verification
- **ChittyEvidence** (evidence.chitty.cc) - Evidence management (v2.0 with ChittyLedger integration)
- **ChittyLedger** - Universal ledger with things/evidence/cases tables

### Authentication
All API endpoints require ChittyAuth tokens:
```
Authorization: Bearer {token}
```

## ContextConsciousness™

**Purpose**: Maintain context across sessions and interactions

**Features**:
- Session tracking
- Context preservation
- Cross-service state management
- Intelligent routing based on context

## MemoryCloude™

**Purpose**: Persistent memory for Claude interactions

**Features**:
- Long-term memory storage
- Context retrieval
- Pattern recognition
- Personalized interactions

## Third-Party Integrations

### Notion
```bash
POST /api/v1/proxy/notion/query
POST /api/v1/proxy/notion/create-page
```

### Neon Database
```bash
POST /api/v1/proxy/neon/query
```

### OpenAI
```bash
POST /api/v1/proxy/openai/chat
```

### Google Calendar
```bash
POST /api/v1/proxy/google-calendar/create-event
GET /api/v1/proxy/google-calendar/list-events
```

## MCP Server Setup

**For Claude Desktop:**
```json
{
  "mcpServers": {
    "chittyconnect": {
      "command": "node",
      "args": ["path/to/chittyconnect/mcp-server.js"],
      "env": {
        "CHITTYCONNECT_URL": "https://connect.chitty.cc",
        "CHITTY_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

## GitHub App Setup

1. Create GitHub App in organization settings
2. Set webhook URL: `https://connect.chitty.cc/webhooks/github`
3. Subscribe to events: issues, pull_requests, push
4. Generate private key
5. Set secrets: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`

## Documentation

- **[Quick Start Guide](QUICK_START.md)** - Get up and running in 30 minutes
- **[Architecture Analysis](ARCHITECTURE_ANALYSIS.md)** - Comprehensive architectural review
- **[Innovation Roadmap](INNOVATION_ROADMAP.md)** - ContextConsciousness™ & MemoryCloude™ vision

## ChittyEvidence v2.0 Integration (IMPORTANT)

As of ChittyEvidence v2.0, evidence management has been integrated with ChittyLedger:

### Breaking Changes
- **No more evidence_registry table** - Evidence now uses ChittyLedger `things` and `evidence` tables
- **UUID-based IDs** - `evidence_id`, `thing_id`, `case_id` are all UUIDs, not integers
- **New field names** - `evidence_number` (not `exhibit_id`), `document_type` (not `category`)
- **Platform sync tracking** - New `chittyevidence_platform_sync` table for integration status

### ChittyConnect Compatibility

ChittyConnect maintains **full backward compatibility** while supporting the new schema:

**Evidence Lookup:**
- **UUID (recommended):** `GET /api/chittyevidence/{evidence_id}` - Uses evidence UUID
- **file_hash (deprecated):** `GET /api/chittyevidence/{file_hash}` - Legacy SHA256 lookup
- Auto-detection based on identifier format

**Legacy Format Support:**
- Add `?legacy=true` query parameter to get v1.0 response format
- Requires `EVIDENCE_LEGACY_MODE=true` environment variable
- Response transformer maps ChittyLedger fields to old schema

**New Endpoints:**
- `GET /api/chittyevidence/case/:caseId` - List all evidence for a case
- `GET /api/chittyevidence/:evidenceId/sync-status` - Platform sync status
- `POST /api/chittyevidence/:evidenceId/verify` - Trigger verification

**MCP Tools Updated:**
- `chitty_evidence_ingest` - Now returns UUIDs (evidence_id, thing_id, case_id)
- `chitty_evidence_get` - Supports both UUID and file_hash with optional legacy format
- `chitty_evidence_list_by_case` - New tool for case-based listing
- `chitty_evidence_verify` - New tool for triggering verification
- `chitty_evidence_sync_status` - New tool for sync status

### Migration Guide for Developers

**If your code uses ChittyEvidence:**

1. **Update to use evidence_id (UUID) instead of file_hash**
   ```javascript
   // Old (deprecated)
   const evidence = await fetch(`/api/chittyevidence/${fileHash}`);

   // New (recommended)
   const evidence = await fetch(`/api/chittyevidence/${evidenceId}`);
   ```

2. **Update field references**
   ```javascript
   // Old field names
   evidence.exhibit_id
   evidence.category
   evidence.chitty_id

   // New field names
   evidence.evidence_number
   evidence.document_type
   evidence.case_id
   ```

3. **Use new response structure**
   ```javascript
   // v2.0 response includes
   {
     evidence_id: "uuid",
     thing_id: "uuid",
     case_id: "uuid",
     evidence_tier: "L1",
     chain_of_custody_verified: true,
     ...
   }
   ```

4. **Optional: Enable legacy mode during transition**
   - Set `EVIDENCE_LEGACY_MODE=true` in environment
   - Use `?legacy=true` query parameter
   - Gradually migrate to new format

### Database Integration

ChittyConnect's `EvidenceCompatibilityLayer` provides:
- File hash to UUID lookups via shared database
- Legacy format transformation
- Reference migration utilities
- Backward compatible queries

**Example Usage:**
```javascript
import { EvidenceCompatibilityLayer } from './lib/evidence-compatibility.js';

const compat = new EvidenceCompatibilityLayer(env);

// Look up by file_hash
const evidence = await compat.getEvidenceByFileHash(fileHash);

// Transform to legacy format
const legacy = compat.transformToLegacyFormat(evidence);

// Migrate references
const uuids = await compat.migrateReferences([fileHash1, fileHash2]);
```

## Troubleshooting

### ChittyEvidence Integration Issues
1. **UUID vs file_hash confusion:** Evidence IDs are now UUIDs - use `evidence_id` not `file_hash`
2. **Field name errors:** Update to new field names (evidence_number, document_type, case_id)
3. **Legacy format not working:** Ensure `EVIDENCE_LEGACY_MODE=true` environment variable is set
4. **Database query failures:** ChittyConnect needs access to shared Neon database for compatibility layer

### Authentication Failures
1. Verify token is valid and not expired
2. Check `JWT_SECRET` matches ChittyAuth
3. Ensure token has required scopes

### Third-Party Proxy Failures
1. Verify API keys are set correctly
2. Check rate limits for external services
3. Review proxy logs: `npm run tail`

### MCP Connection Issues
1. Verify MCP server configuration in Claude Desktop
2. Check server logs for errors
3. Ensure CHITTYCONNECT_URL is correct

### GitHub Webhook Failures
1. Check webhook signature verification
2. Verify `GITHUB_WEBHOOK_SECRET` matches GitHub App settings
3. Review webhook delivery logs in GitHub

## Key Files

- `src/index.ts` - Main entry point
- `src/routes/` - API route handlers
- `src/mcp/` - MCP server implementation
- `src/proxy/` - Third-party integration proxies
- `src/lib/` - Utilities (auth, context, memory)
- `src/types/` - TypeScript type definitions
- `openapi.json` - OpenAPI specification for Custom GPT Actions
- `wrangler.toml` - Cloudflare configuration
- `QUICK_START.md` - Quick start guide
- `ARCHITECTURE_ANALYSIS.md` - Architecture documentation
- `INNOVATION_ROADMAP.md` - Innovation roadmap

## Deployment URLs

- **Staging**: https://connect-staging.chitty.cc
- **Production**: https://connect.chitty.cc
- **Cloudflare Account**: 0bc21e3a5a9de1a4cc843be9c3e98121

## Development Guidelines

1. All database changes must be coordinated with other ChittyOS services
2. Service tokens are required for inter-service calls
3. Test locally with `npm run dev` before deploying
4. Deploy to staging first, then production
5. Follow OpenAPI specification for Custom GPT Actions
6. Maintain MCP protocol compatibility for Claude integration
7. Follow ChittyOS development guidelines in root `CLAUDE.md`
