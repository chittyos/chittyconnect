# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **🎯 Project Orchestration:** This project follows [ChittyCan™ Project Standards](../CHITTYCAN_PROJECT_ORCHESTRATOR.md)

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

## Troubleshooting

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
