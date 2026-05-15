![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-2%20platform-4338CA?style=flat-square)

# ChittyConnect - itsChitty™

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/chittyos/chittyconnect/publish.yml?branch=main&label=publish)
![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/chittyos/chittyconnect)
![GitHub Package Version](https://img.shields.io/github/package-json/v/chittyos/chittyconnect?filename=package.json&label=gpr)
![npm](https://img.shields.io/npm/v/%40chittyos%2Fchittyconnect)
![npm downloads](https://img.shields.io/npm/dm/%40chittyos%2Fchittyconnect)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

The AI-intelligent spine with ContextConsciousness™ & MemoryCloude™ for the ChittyOS ecosystem.

ChittyConnect packages an HTTP API server (Cloudflare Workers/Hono) and an MCP server binary (`chittyconnect-mcp`) for model integrations. This package is intended to be used either as a deployed Worker or as a dependency to integrate with ChittyOS services.

## MCP Host Standard

ChittyConnect currently owns the dumb aggregate MCP semantics for `mcp.chitty.cc` and the service catalog that feeds the public Chitty discovery document.

For the canonical external host matrix, alias rules, and Cloudflare-managed OAuth pattern, see [../ch1tty/docs/MCP_HOST_STANDARD.md](../ch1tty/docs/MCP_HOST_STANDARD.md).

## Installation

```bash
npm install @chittyos/chittyconnect
```

If installing from GitHub Packages, configure `.npmrc`:

```
@chittyos:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```
Then install:

```
npm install @chittyos/chittyconnect
```

## Usage

### Programmatic (as a Worker app)

The package exposes a Hono app at `src/index.js` that can be used as your Worker entry. In this repository we deploy using Wrangler.

```bash
wrangler dev
wrangler deploy
```

### CLI (MCP Server)

The package exposes a CLI for the MCP server:

```bash
npx chittyconnect-mcp
```

Use `--help` flags from your MCP client to connect. See `MCP_QUICK_REFERENCE.md` for tool list.

## 📚 Documentation

- **[Quick Start Guide](QUICK_START.md)** - Get up and running in 30 minutes
- **[Architecture Analysis](ARCHITECTURE_ANALYSIS.md)** - Comprehensive architectural review and improvement proposals
- **[Innovation Roadmap](INNOVATION_ROADMAP.md)** - ContextConsciousness™ & MemoryCloude™ vision and implementation
- **[Integrations](docs/integrations/README.md)** - Operational integration notes, including Gmail-to-ChittyRouter intake

## 🌟 Features

### 1. Custom GPT Actions API
REST API with OpenAPI specification for seamless custom GPT integration.

**Capabilities:**
- ChittyID minting and validation
- Legal case management (ChittyCases)
- Evidence ingestion and analysis
- Banking connections (ChittyFinance)
- Contextual analysis (ContextConsciousness™)
- Event logging (ChittyChronicle)
- Data synchronization (ChittySync)
- Service health monitoring

### 2. MCP Server for Claude
Model Context Protocol server providing deep Claude integration.

**Tools:**
- `chittyid_mint` - Mint ChittyIDs with context
- `chitty_contextual_analyze` - ContextConsciousness™ analysis
- `chitty_case_create` - Create legal cases
- `chitty_evidence_ingest` - Ingest evidence
- `chitty_services_status` - Monitor ecosystem health
- `chitty_finance_connect_bank` - Connect banking
- And 5+ more tools...

### 3. Third-Party Integration Proxy
Unified proxy for external services:
- **Notion API** - Database queries, page creation
- **Neon Database** - SQL queries
- **OpenAI** - Chat completions
- **Google Calendar** - Event management
- **Cloudflare AI** - Workers AI models

### 4. GitHub App Integration
Fast-ack webhook processing with MCP normalization.

## 🚀 Quick Start

### Prerequisites

- Cloudflare Workers account
- Wrangler CLI installed
- ChittyOS service tokens
- Third-party API keys (Notion, OpenAI, etc.)

### Installation

```bash
# Clone repository
cd /Users/nb/.claude/projects/-/CHITTYOS/chittyos-apps/chittyconnect

# Install dependencies
npm install

# Create KV namespaces
wrangler kv:namespace create "IDEMP_KV"
wrangler kv:namespace create "TOKEN_KV"
wrangler kv:namespace create "API_KEYS"
wrangler kv:namespace create "RATE_LIMIT"

# Create D1 database
wrangler d1 create chittyconnect

# Create queue
wrangler queues create github-events

# Update wrangler.toml with the created IDs
```

### Configuration

```bash
# Set ChittyOS service tokens
wrangler secret put CHITTYAUTH_ISSUED_ID_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_AUTH_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_CASES_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_FINANCE_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_EVIDENCE_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_SYNC_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_CHRONICLE_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_CONTEXTUAL_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_REGISTRY_TOKEN

# MCP and package auth tokens (VM/runtime)
wrangler secret put CHITTYAUTH_ISSUED_CH1TTY_SMART_MCP_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_CHITTYMCP_TOKEN
wrangler secret put CHITTYAUTH_ISSUED_NPM_TOKEN

# VM runtime injection (non-interactive auth handoff)
bash scripts/inject-runtime-auth.sh

# Set third-party API keys
wrangler secret put NOTION_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_ACCESS_TOKEN
wrangler secret put NEON_DATABASE_URL

# Set GitHub App credentials (optional)
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PK
wrangler secret put GITHUB_WEBHOOK_SECRET
```

### Deployment

```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production
```

## Versioning & Publishing

- Package name: `@chittyos/chittyconnect`
- Follows semantic versioning.
- Published files are restricted via `files` in `package.json` and `.npmignore`.

## License

MIT © ChittyOS

## 🔧 Usage

### Custom GPT Integration

1. **Get the OpenAPI spec:**
   ```
   https://connect.chitty.cc/openapi.json
   ```

2. **Configure Custom GPT:**
   - Go to ChatGPT → Create GPT → Configure → Actions
   - Import schema from `https://connect.chitty.cc/openapi.json`
   - Set authentication type to "API Key"
   - Add header: `X-ChittyOS-API-Key`

3. **Generate API key:**
   ```bash
   node scripts/generate-api-key.js
   ```

4. **Test the integration:**
   ```
   "Check the status of all ChittyOS services"
   "Mint a new ChittyID for a PLACE entity"
   "Create a legal case for an eviction proceeding"
   ```

### Claude Code MCP Integration

1. **Add to Claude Code MCP settings:**
   ```json
   {
     "mcpServers": {
       "chittyconnect": {
         "url": "https://connect.chitty.cc/mcp",
         "transport": "http"
       }
     }
   }
   ```

2. **Available MCP resources:**
   - `chitty://services/status` - Real-time service health
   - `chitty://registry/services` - Service registry
   - `chitty://context/awareness` - ContextConsciousness™ state

3. **Use MCP tools in Claude:**
   ```
   Use chittyid_mint to create a new ChittyID
   Use chitty_contextual_analyze to analyze this legal document
   Use chitty_services_status to check ecosystem health
   ```

### Direct API Usage

```bash
# Health check
curl https://connect.chitty.cc/health

# Mint ChittyID
curl -X POST https://connect.chitty.cc/api/chittyid/mint \
  -H "X-ChittyOS-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"entity": "PLACE"}'

# Check services status
curl https://connect.chitty.cc/api/services/status \
  -H "X-ChittyOS-API-Key: your-api-key"

# Query Notion
curl -X POST https://connect.chitty.cc/api/thirdparty/notion/query \
  -H "X-ChittyOS-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"databaseId": "your-database-id"}'
```

## 📚 API Documentation

### REST API Endpoints

#### ChittyID
- `POST /api/chittyid/mint` - Mint new ChittyID
- `POST /api/chittyid/validate` - Validate ChittyID
- `GET /api/chittyid/:id` - Get ChittyID details

#### ChittyCases
- `POST /api/chittycases/create` - Create legal case
- `GET /api/chittycases/:caseId` - Get case details
- `PUT /api/chittycases/:caseId` - Update case

#### ChittyFinance
- `GET /api/chittyfinance/account/balance` - Get balance
- `POST /api/chittyfinance/banking/connect` - Connect bank
- `GET /api/chittyfinance/accounts` - List accounts
- `POST /api/chittyfinance/transactions` - Get transactions

#### ChittyContextual
- `POST /api/chittycontextual/analyze` - Contextual analysis
- `POST /api/chittycontextual/extract` - Extract entities

#### ChittyChronicle
- `POST /api/chittychronicle/log` - Log event
- `GET /api/chittychronicle/query` - Query events
- `GET /api/chittychronicle/timeline/:entityId` - Get timeline

#### ChittySync
- `POST /api/chittysync/sync` - Trigger sync
- `GET /api/chittysync/status/:syncId` - Get sync status
- `GET /api/chittysync/history` - Get sync history

#### ChittyEvidence
- `POST /api/chittyevidence/ingest` - Ingest evidence
- `GET /api/chittyevidence/:evidenceId` - Get evidence details

#### Services & Registry
- `GET /api/services/status` - All services status
- `GET /api/services/:serviceId/status` - Specific service
- `GET /api/registry/services` - List registry
- `GET /api/registry/services/:serviceId` - Service details

#### Third-Party
- `POST /api/thirdparty/notion/query` - Query Notion
- `POST /api/thirdparty/notion/page/create` - Create page
- `POST /api/thirdparty/neon/query` - SQL query
- `POST /api/thirdparty/openai/chat` - OpenAI chat
- `POST /api/thirdparty/cloudflare/ai/run` - Cloudflare AI
- `GET /api/thirdparty/google/calendar/events` - Calendar events

### MCP Protocol Endpoints

- `GET /mcp/manifest` - Server manifest
- `GET /mcp/tools/list` - Available tools
- `POST /mcp/tools/call` - Execute tool
- `GET /mcp/resources/list` - Available resources
- `GET /mcp/resources/read` - Read resource

## 🔐 Authentication

### API Key Management

Generate API keys:
```bash
node scripts/generate-api-key.js
```

Store in KV:
```bash
wrangler kv:key put --binding=API_KEYS "key:your-api-key" \
  '{"status":"active","rateLimit":1000,"name":"My GPT"}'
```

### Rate Limiting

Default: 1000 requests per minute per API key

Configure per-key limits in KV:
```json
{
  "status": "active",
  "rateLimit": 5000,
  "name": "Premium API Key"
}
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ChittyConnect                        │
│              itsChitty™ - The AI Spine                  │
│      ContextConsciousness & MemoryCloude                │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼────┐      ┌─────▼─────┐     ┌─────▼─────┐
    │  API   │      │    MCP    │     │  GitHub   │
    │ Router │      │  Server   │     │   App     │
    └───┬────┘      └─────┬─────┘     └─────┬─────┘
        │                 │                  │
    ┌───▼─────────────────▼──────────────────▼───┐
    │          ChittyOS Services Layer           │
    ├────────────────────────────────────────────┤
    │ ChittyID │ ChittyCases │ ChittyFinance     │
    │ ChittyAuth │ ChittyEvidence │ ChittySync   │
    │ ChittyChronicle │ ChittyContextual         │
    └────────────────────────────────────────────┘
                           │
    ┌──────────────────────▼────────────────────┐
    │      Third-Party Integration Layer        │
    ├───────────────────────────────────────────┤
    │ Notion │ Neon │ OpenAI │ Google │ CF AI  │
    └───────────────────────────────────────────┘
```

## 🧪 Development

```bash
# Start development server
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## 📊 Monitoring

### Health Checks

```bash
# Main health
curl https://connect.chitty.cc/health

# API health
curl https://connect.chitty.cc/api/health

# MCP manifest
curl https://connect.chitty.cc/mcp/manifest
```

### Observability

Cloudflare Analytics and Workers Observability enabled by default.

Monitor:
- Request rates
- Error rates
- Latency
- Third-party API usage

## 🔄 ContextConsciousness™

The ContextConsciousness™ system provides:

1. **Cross-Service Awareness** - Real-time knowledge of all service states
2. **Contextual Analysis** - Deep understanding of legal, financial, and relational context
3. **Intelligent Routing** - Automatic routing to optimal services
4. **State Persistence** - MemoryCloude maintains conversational context

Query current state:
```bash
curl https://connect.chitty.cc/mcp/resources/read?uri=chitty://context/awareness \
  -H "X-ChittyOS-API-Key: your-api-key"
```

## 🤝 Contributing

This is a core ChittyOS infrastructure component. Changes require review.

## 📝 License

MIT License - ChittyOS

## 🔗 Links

- **ChittyOS Docs**: https://docs.chitty.cc
- **API Documentation**: https://connect.chitty.cc/openapi.json
- **MCP Manifest**: https://connect.chitty.cc/mcp/manifest
- **Support**: support@chitty.cc

---

**itsChitty™** - *Now with ContextConsciousness & MemoryCloude*
