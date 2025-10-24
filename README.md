# ChittyConnect - The Alchemist

**Version:** 1.0.0-alpha
**Status:** 🚀 Week 3 Complete - CI/CD Ready (40% Complete)
**Last Updated:** October 24, 2025

> Universal adapter layer that transmutes connections into consciousness.
> Provides keys, connectors, transport, and bindings for all ChittyOS services.

**Not an orchestrator. A facilitator. The connective tissue.**

---

## Current Status

ChittyConnect has completed **Week 1-3 implementation**: Core foundation, ChittyOS integration, and CI/CD infrastructure are complete.

### What Works ✅

- **Complete Context Management**
  - `POST /v1/contexts/create` - Create contexts with ChittyID minting
  - `GET /v1/contexts/list` - List contexts with zero-trust validation
  - `GET /v1/contexts/{id}` - Get context by ID
  - `PATCH /v1/contexts/{id}` - Update context (NEW)
  - `DELETE /v1/contexts/{id}` - Soft delete context (NEW)
  - `GET /v1/contexts/search` - Search contexts (NEW)

- **Actor Management** (NEW)
  - Actor registration with ChittyDNA tracking
  - Session management
  - Capability-based authorization

- **Connection Lifecycle** (NEW)
  - Service connection management
  - Health monitoring with circuit breakers
  - API key provisioning

- **Service Delegation** (NEW)
  - Time-limited delegation tokens
  - Service-to-service authentication

- **Full ChittyOS Integration**
  - ChittyID - Identity minting (100% authority compliance)
  - ChittyAuth - Actor validation and API keys
  - ChittyRegistry - Service discovery with caching
  - ChittyDNA - Genetic tracking for all entities
  - ChittyVerify - Identity verification
  - ChittyCertify - Certification management
  - ChittyChronicle - Event logging via queue

- **Production Infrastructure**
  - D1 database (4 tables: contexts, actors, connections, installations)
  - 5 KV namespaces (storage, tokens, rate limiting, idempotency, certs)
  - 2 Queue producers + consumer (async processing)
  - Workers AI binding
  - Staging + Production environments

- **CI/CD Pipeline**
  - Automated testing (lint, unit tests, integration tests)
  - Staging deployment (auto-deploy on develop/claude/** branches)
  - Production deployment (manual approval, 5-min monitoring)
  - Security scanning and validation

- **Testing Infrastructure**
  - Vitest test framework
  - 50+ unit and integration tests
  - ChittyOS service mocks
  - 80%+ coverage target

### What's Coming 🚧

- **Week 4-6:** GitHub App integration (webhooks, OAuth, installation management)
- **Week 7:** Performance optimization and monitoring
- **Week 8:** Documentation and production launch

See [ROADMAP.md](ROADMAP.md) for detailed implementation plan.

---

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account
- ChittyOS service tokens (ChittyAuth, ChittyID)

### Installation

```bash
# Clone repository
git clone https://github.com/chittyos/chittyconnect.git
cd chittyconnect

# Install dependencies
npm install

# Configure Cloudflare
npx wrangler login

# Set secrets
npx wrangler secret put CHITTY_ID_SERVICE_TOKEN
# Enter your ChittyID service token when prompted
```

### Local Development

```bash
# Start local dev server
npm run dev

# Test health endpoint
curl http://localhost:8787/health
```

### Create Your First Context

```bash
# First, get a ChittyAuth token for your actor
# (Contact ChittyOS team or use auth.chitty.cc)

# Create context
curl -X POST http://localhost:8787/v1/contexts/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CHITTYAUTH_TOKEN" \
  -d '{
    "name": "my-first-context",
    "data": [],
    "systems": ["chittyid", "chittyauth"],
    "tools": []
  }'

# List your contexts
curl http://localhost:8787/v1/contexts/list \
  -H "Authorization: Bearer YOUR_CHITTYAUTH_TOKEN"

# Get context by ID
curl http://localhost:8787/v1/contexts/{chittyId} \
  -H "Authorization: Bearer YOUR_CHITTYAUTH_TOKEN"
```

---

## Architecture

### Current Implementation

```
┌─────────────────────────────────────┐
│     Cloudflare Workers (Edge)       │
├─────────────────────────────────────┤
│                                     │
│  Health Check                       │
│    └─ GET /health                   │
│                                     │
│  Context Management                 │
│    ├─ POST /v1/contexts/create      │
│    ├─ GET /v1/contexts/list         │
│    └─ GET /v1/contexts/{id}         │
│                                     │
│  ChittyOS Integration               │
│    ├─ ChittyAuth (auth.chitty.cc)   │
│    │   └─ Actor validation          │
│    └─ ChittyID (id.chitty.cc)       │
│        └─ ID minting                │
│                                     │
├─────────────────────────────────────┤
│         Storage Layer               │
├─────────────────────────────────────┤
│                                     │
│  KV Namespace: CHITTYCONNECT_KV     │
│    ├─ context:{chittyId}            │
│    └─ context:name:{name}           │
│                                     │
│  Queue: CONTEXT_OPS_QUEUE           │
│    └─ Async context operations      │
│                                     │
└─────────────────────────────────────┘
```

### Target Architecture (Future)

See [ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md) for full system design.

---

## API Reference

### Health Check

**GET** `/health`

Returns service health status.

**Response:**
```json
{
  "service": "chittyconnect",
  "status": "healthy",
  "timestamp": "2025-10-21T10:30:00.000Z",
  "version": "1.0.0"
}
```

### Create Context

**POST** `/v1/contexts/create`

Creates a new context with ChittyID minting.

**Headers:**
```
Authorization: Bearer {chittyauth_token}
Content-Type: application/json
```

**Request:**
```json
{
  "name": "my-context",
  "data": [],
  "systems": ["chittyid", "chittyauth"],
  "tools": []
}
```

**Response:**
```json
{
  "success": true,
  "context": {
    "chittyId": "CHITTY-CONTEXT-...",
    "name": "my-context",
    "owner": "CHITTY-PEO-...",
    "created": "2025-10-21T10:30:00.000Z"
  }
}
```

### List Contexts

**GET** `/v1/contexts/list`

Lists all contexts owned by the authenticated actor.

**Headers:**
```
Authorization: Bearer {chittyauth_token}
```

**Response:**
```json
{
  "contexts": [
    {
      "chittyId": "CHITTY-CONTEXT-...",
      "name": "my-context",
      "owner": "CHITTY-PEO-...",
      "created": "2025-10-21T10:30:00.000Z",
      "updated": "2025-10-21T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

### Get Context

**GET** `/v1/contexts/{chittyId}`

Retrieves a specific context by ChittyID.

**Headers:**
```
Authorization: Bearer {chittyauth_token}
```

**Response:**
```json
{
  "chittyId": "CHITTY-CONTEXT-...",
  "name": "my-context",
  "owner": "CHITTY-PEO-...",
  "data": [],
  "systems": ["chittyid", "chittyauth"],
  "tools": [],
  "created": "2025-10-21T10:30:00.000Z",
  "updated": "2025-10-21T10:30:00.000Z"
}
```

---

## Security

### Zero-Trust Architecture

Every API request validates the actor via ChittyAuth:

1. Extract `Authorization` header
2. Validate token with `auth.chitty.cc/v1/auth/validate`
3. Retrieve actor ChittyID
4. Verify actor owns requested resources
5. Reject unauthorized requests

### ChittyID Authority Compliance

All ChittyIDs are minted via the central authority (`id.chitty.cc`):

- **No local ID generation**
- **No ID format violations**
- **Full audit trail**

### Future Security Enhancements

- Input validation with Zod schemas
- Rate limiting per actor
- Request signing
- Audit logging
- Secrets rotation

---

## Development

### Project Structure

```
chittyconnect/
├── src/
│   └── index.js              # Main worker entry point
├── wrangler.toml             # Cloudflare Workers config
├── package.json              # Node.js dependencies
├── README.md                 # This file
├── ROADMAP.md                # Implementation roadmap
└── ANALYSIS_AND_RECOMMENDATIONS.md  # Gap analysis
```

### Code Style

- ES6 modules
- Async/await for asynchronous operations
- Functional programming where possible
- Clear error handling
- Comprehensive comments

### TODOs in Code

Current implementation has planned features:

```javascript
// Line 327: TODO: Implement actor authentication
// Line 339: TODO: Implement connection lifecycle
// Line 351: TODO: Implement service delegation
```

These will be addressed in upcoming sprints (see ROADMAP.md).

---

## Deployment

### Current Status

- ✅ Infrastructure provisioned (D1, KV, Queues)
- ✅ CI/CD pipeline configured
- 🚀 Ready for staging deployment
- 📋 Production deployment pending GitHub configuration

### Automated Deployment

**Staging**: Auto-deploys on push to `develop` or `claude/**` branches
```bash
git push origin develop
# Triggers staging deployment workflow
```

**Production**: Manual approval or version tags
```bash
# Via GitHub UI: Actions → Deploy to Production → Run workflow
# Or via CLI:
gh workflow run deploy-production.yml -f reason="Deploy v1.0.1" -f confirm="DEPLOY"
```

### Setup CI/CD

See [CI/CD Setup Checklist](./CI_CD_SETUP_CHECKLIST.md) for step-by-step guide.

**Quick setup:**
1. Create GitHub environments (staging, production)
2. Configure secrets (CLOUDFLARE_API_TOKEN, etc.)
3. Set up branch protection rules
4. Run test deployment

**Documentation:**
- [CI/CD Guide](./docs/deployment/CI_CD_GUIDE.md) - Complete CI/CD documentation
- [GitHub Setup](./docs/deployment/GITHUB_SETUP.md) - GitHub configuration
- [Deployment Guide](./docs/deployment/DEPLOYMENT_GUIDE.md) - Manual deployment
- [Local Development](./docs/deployment/LOCAL_DEVELOPMENT.md) - Dev workflow

---

## Testing

### Current Status

- ✅ Vitest test framework configured
- ✅ 50+ unit and integration tests
- ✅ ChittyOS service mocks
- ✅ CI integration with coverage reporting
- ✅ 80%+ coverage target

### Running Tests

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode (TDD)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

```
tests/
├── unit/               # Fast unit tests with mocks
│   ├── ecosystem.test.js
│   └── contexts.test.js
├── integration/        # Full worker environment tests
│   └── worker.test.js
└── helpers/            # Test utilities and mocks
    └── mock-chittyos.js
```

### Documentation

See [Test Suite README](./tests/README.md) for complete testing documentation.

---

## Contributing

ChittyConnect is currently in early development. Contributions welcome once MVP is deployed.

### Development Workflow

1. Create feature branch from `main`
2. Implement feature with tests
3. Update documentation
4. Submit pull request
5. Code review
6. Merge to main

### Commit Message Format

```
<type>: <description>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for detailed implementation timeline.

**High-level milestones:**

- ✅ **Week 1:** Assessment & Planning - COMPLETE
- ✅ **Week 2:** Core foundation (ChittyOS integration, database, API endpoints) - COMPLETE
- ✅ **Week 3:** Infrastructure & CI/CD (deployment automation, testing) - COMPLETE
- 🚧 **Weeks 4-6:** Priority integration (GitHub App / MCP Server) - NEXT
- 📋 **Week 7:** Performance optimization & monitoring
- 📋 **Week 8:** Documentation & production launch

---

## License

MIT License - See LICENSE file for details

---

## Contact

- **Project:** ChittyConnect
- **Organization:** ChittyOS
- **Repository:** https://github.com/chittyos/chittyconnect

---

## Acknowledgments

**ChittyOS Ecosystem Services:**
- ChittyID - Identity authority
- ChittyAuth - Authentication & authorization
- ChittyRegistry - Service discovery
- ChittyDNA - Genetic tracking
- ChittyChronicle - Event logging

**Powered by:**
- Cloudflare Workers (Edge compute)
- Cloudflare KV (Key-value storage)
- Cloudflare Queues (Async processing)

---

**Status:** Week 3 Complete - CI/CD Ready (40% Complete)
**Next Milestone:** GitHub App Integration (Weeks 4-6)
**Target MVP:** Week 8 (On Track)
