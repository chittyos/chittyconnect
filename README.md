# ChittyConnect

**The AI-intelligent spine with ContextConsciousness™**

ChittyConnect is a universal adapter layer that provides seamless integration across the entire ChittyOS ecosystem. It serves as "The Alchemist" - transmuting connections into consciousness through comprehensive ChittyID tracking, MCP server capabilities, and REST API access.

## Features

### 🎯 Core Capabilities

- **ChittyOS Ecosystem Integration**: Complete integration with all ChittyOS services
- **GitHub App**: Track all GitHub activity with ChittyIDs
- **MCP Server**: 11 tools and 3 resources for AI agent integration
- **REST API**: 32+ endpoints covering ChittyOS and third-party services
- **ContextConsciousness™**: Deep contextual understanding and tracking
- **Fast-Ack Webhooks**: <100ms webhook acknowledgment with async processing

### 🔗 Integrations

#### ChittyOS Services
- **ChittyID**: Central identity authority (zero local generation)
- **ChittyAuth**: API key management and authentication
- **ChittyDNA**: Genetic lifecycle tracking
- **ChittyVerify**: Context verification flows
- **ChittyCertify**: Service certification
- **ChittyChronicle**: Event logging and timeline tracking
- **ChittyRegistry**: Service discovery with caching
- **ChittyContextual**: ContextConsciousness™ analysis
- **ChittyCases**: Legal case management
- **ChittyFinance**: Banking and financial services
- **ChittyEvidence**: Evidence ingestion
- **ChittySync**: Data synchronization

#### Third-Party Services
- **Notion**: Database queries
- **Neon**: PostgreSQL database access
- **OpenAI**: Chat completions
- **Google Calendar**: Event management
- **Cloudflare AI**: Workers AI models

## Architecture

```
┌─────────────────────────────────────────┐
│         ChittyConnect Worker            │
│  (Cloudflare Workers - Edge Runtime)    │
└─────────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌────────┐   ┌──────────┐   ┌──────────┐
│  MCP   │   │ REST API │   │  GitHub  │
│ Server │   │ (32+ EP) │   │   App    │
└────────┘   └──────────┘   └──────────┘
    │              │              │
    └──────────────┼──────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌──────────┐  ┌────────┐   ┌──────────┐
│ ChittyOS │  │   D1   │   │ Queue    │
│ Services │  │Database│   │ (GitHub) │
└──────────┘  └────────┘   └──────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account
- ChittyOS service tokens

### 1. Clone and Install

```bash
git clone https://github.com/chittyos/chittyconnect.git
cd chittyconnect
npm install
```

### 2. Configure Secrets

Set all required secrets in Cloudflare Workers:

```bash
# ChittyOS Services
npx wrangler secret put CHITTY_ID_SERVICE_TOKEN
npx wrangler secret put CHITTY_AUTH_TOKEN
npx wrangler secret put CHITTY_DNA_TOKEN
npx wrangler secret put CHITTY_VERIFY_TOKEN
npx wrangler secret put CHITTY_CERTIFY_TOKEN
npx wrangler secret put CHITTY_CHRONICLE_TOKEN
npx wrangler secret put CHITTY_REGISTRY_TOKEN

# GitHub App
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET

# Third-Party Services (optional)
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_CALENDAR_TOKEN
npx wrangler secret put NEON_API_KEY
```

### 3. Deploy

```bash
# Deploy to staging
npm run deploy

# Or deploy to production
npx wrangler deploy --env production
```

### 4. Verify Deployment

```bash
# Check health
curl https://connect.chitty.cc/health

# Check MCP manifest
curl https://connect.chitty.cc/mcp/manifest

# Check API
curl https://connect.chitty.cc/api/health
```

## Usage

### MCP Server

ChittyConnect implements the Model Context Protocol (MCP) 2024-11-05 specification.

#### Available Tools (11)

1. **chittyid_mint** - Mint new ChittyID with context
2. **chitty_contextual_analyze** - ContextConsciousness™ analysis
3. **chitty_case_create** - Create legal cases
4. **chitty_chronicle_log** - Log events to timeline
5. **chitty_evidence_ingest** - Ingest evidence files
6. **chitty_sync_trigger** - Trigger data sync
7. **chitty_services_status** - Get all services health
8. **chitty_registry_discover** - Discover services
9. **chitty_finance_connect_bank** - Connect bank accounts
10. **notion_query** - Query Notion databases
11. **openai_chat** - OpenAI chat completions

#### Available Resources (3)

1. **chitty://services/status** - Real-time service health
2. **chitty://registry/services** - Complete service registry
3. **chitty://context/awareness** - ContextConsciousness™ state

#### Example: Call MCP Tool

```bash
curl -X POST https://connect.chitty.cc/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "chittyid_mint",
    "arguments": {
      "entityType": "CONTEXT",
      "metadata": {
        "name": "my-context",
        "description": "Test context"
      }
    }
  }'
```

### REST API

#### ChittyID Endpoints

```bash
# Mint ChittyID
curl -X POST https://connect.chitty.cc/api/chittyid/mint \
  -H "Content-Type: application/json" \
  -d '{"entityType": "CONTEXT", "metadata": {"name": "test"}}'

# Validate ChittyID
curl https://connect.chitty.cc/api/chittyid/validate/CHITTY-CONTEXT-...
```

#### ChittyChronicle Endpoints

```bash
# Log event
curl -X POST https://connect.chitty.cc/api/chittychronicle/log \
  -H "Content-Type: application/json" \
  -d '{"event": "test.event", "metadata": {"key": "value"}}'

# Get events
curl https://connect.chitty.cc/api/chittychronicle/events
```

#### Services Status

```bash
# Get all ChittyOS services status
curl https://connect.chitty.cc/api/services/status
```

#### Third-Party Integrations

```bash
# Query Notion
curl -X POST https://connect.chitty.cc/api/thirdparty/notion/query \
  -H "Content-Type: application/json" \
  -d '{"databaseId": "...", "filter": {}}'

# OpenAI Chat
curl -X POST https://connect.chitty.cc/api/thirdparty/openai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

### GitHub App

Complete setup guide: [docs/GITHUB_APP_SETUP.md](docs/GITHUB_APP_SETUP.md)

#### Features

- **Fast-Ack Webhooks**: <100ms acknowledgment
- **ChittyID Tracking**: Unique IDs for installations, events, commits, PRs
- **Async Processing**: Queue-based event processing
- **Installation Flow**: Complete OAuth with ChittyDNA initialization

#### Webhook Events Tracked

- installation, installation_repositories
- push, pull_request, pull_request_review
- issues, issue_comment, commit_comment
- create, delete, fork, release, star, watch

## Development

### Project Structure

```
chittyconnect/
├── src/
│   ├── index.js                          # Main worker entry point
│   ├── api/
│   │   └── router.js                     # REST API router (32+ endpoints)
│   ├── mcp/
│   │   └── server.js                     # MCP server (11 tools, 3 resources)
│   ├── integrations/
│   │   ├── chittyos-ecosystem.js         # ChittyOS service integration
│   │   └── github/
│   │       ├── webhook.js                # GitHub webhook handler
│   │       ├── oauth.js                  # GitHub OAuth callback
│   │       ├── utils.js                  # JWT, signatures, tokens
│   │       └── consumer.js               # Queue consumer
│   └── database/
│       └── schema.js                     # D1 database schema
├── docs/
│   └── GITHUB_APP_SETUP.md               # GitHub App guide
├── wrangler.toml                         # Cloudflare Workers config
├── github-app-manifest.json              # GitHub App manifest
├── package.json
└── README.md
```

### Local Development

```bash
# Start local dev server
npm run dev

# Tail production logs
npm run tail

# Test locally
curl http://localhost:8787/health
```

### Database Schema

ChittyConnect uses Cloudflare D1 (SQLite):

**contexts table:**
- Stores ChittyConnect service contexts
- Tracks ChittyID, DNA records, verification, certification

**installations table:**
- Stores GitHub App installations
- Links installation to ChittyID
- Tracks account, repositories, permissions

### Queue Processing

GitHub webhook events are processed asynchronously:

1. Webhook receives event → Verify signature
2. Check idempotency (IDEMP_KV)
3. Queue event (EVENT_Q)
4. Return 200 OK immediately (<100ms)
5. Queue consumer processes event
6. Mint ChittyIDs, log to Chronicle, execute actions

## Testing

### Health Checks

```bash
# Root health
curl https://connect.chitty.cc/health

# API health
curl https://connect.chitty.cc/api/health

# MCP manifest
curl https://connect.chitty.cc/mcp/manifest
```

### MCP Tools

```bash
# List all tools
curl https://connect.chitty.cc/mcp/tools/list

# List all resources
curl https://connect.chitty.cc/mcp/resources/list

# Call tool
curl -X POST https://connect.chitty.cc/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name": "chitty_services_status", "arguments": {}}'
```

### GitHub Webhooks

1. Install GitHub App on a repository
2. Create an issue
3. Check Cloudflare logs: `npx wrangler tail`
4. Verify ChittyID minted and event logged

## Security

### Implemented

- ✅ **Webhook Signature Verification**: HMAC-SHA256 constant-time comparison
- ✅ **Idempotency**: 24-hour duplicate prevention (IDEMP_KV)
- ✅ **Token Management**: Automatic refresh, 55-minute cache
- ✅ **Database Security**: Parameterized queries, foreign keys
- ✅ **ChittyOS Authority**: All ChittyIDs from central authority

### Recommended

- Input validation with Zod schemas
- Rate limiting (per-tool, adaptive)
- Audit logging (sensitive operations)
- Secrets rotation

## Performance

### Benchmarks

- Health endpoint: ~350ms
- MCP manifest: ~300ms
- Webhook ack: <100ms target
- Database init: ~50ms
- Worker startup: ~18ms

### Optimization

- 5-minute service registry cache
- 55-minute GitHub token cache
- Non-blocking ChittyOS initialization
- Queue-based async processing

## Monitoring

### Cloudflare Analytics

Access via Cloudflare dashboard:
- Request rate and latency
- Error rates
- Cache hit rates
- Worker CPU time

### ChittyChronicle

All events logged to ChittyChronicle:
- Service initialization
- GitHub events
- API calls
- Errors and failures

### Health Endpoints

```bash
# Overall health
curl https://connect.chitty.cc/health

# ChittyOS services health
curl https://connect.chitty.cc/api/services/status
```

## Deployment

### Staging

```bash
npx wrangler deploy --env staging
```

URL: https://chittyconnect-staging.ccorp.workers.dev

### Production

```bash
npx wrangler deploy --env production
```

URL: https://connect.chitty.cc

### Secrets Management

All secrets stored in Cloudflare Workers:

```bash
# Set secret
npx wrangler secret put SECRET_NAME

# List secrets
npx wrangler secret list

# Delete secret
npx wrangler secret delete SECRET_NAME
```

## Cost Analysis

### Cloudflare Workers (Current Usage)

- **Workers Requests**: Free tier (100K/day)
- **KV Operations**: Free tier (sufficient)
- **D1 Database**: Free tier (5GB, 5M reads/day)
- **Queue Messages**: Free tier (10K/day)
- **Workers AI**: $0.01 per 1000 neurons

**Estimated Monthly Cost**: $0-5 (within free tier)

### At Scale (100K requests/day)

- **Workers Requests**: Free (within 100K/day)
- **KV Operations**: ~$1/month
- **D1 Database**: ~$5/month
- **Queue Messages**: ~$2/month
- **Workers AI**: ~$10/month

**Total Estimated**: $18-25/month

## Troubleshooting

### Common Issues

**Problem**: Webhook signature verification fails

**Solution**: Verify `GITHUB_WEBHOOK_SECRET` matches GitHub App settings

**Problem**: ChittyID minting fails

**Solution**: Check `CHITTY_ID_SERVICE_TOKEN` is set and valid

**Problem**: Database initialization fails

**Solution**: Verify D1 database exists and binding is correct

**Problem**: Queue processing stalls

**Solution**: Check queue consumer logs and retry configuration

### Debug Mode

Enable verbose logging:

```bash
# Tail logs in real-time
npx wrangler tail

# Filter for errors
npx wrangler tail --format json | grep -i error
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- **Documentation**: https://docs.chitty.cc
- **GitHub Issues**: https://github.com/chittyos/chittyconnect/issues
- **ChittyOS Community**: https://community.chitty.cc

---

**ChittyConnect™** - The AI-intelligent spine with ContextConsciousness™

Part of the ChittyOS ecosystem

Version 1.0.0 | Built with Cloudflare Workers
