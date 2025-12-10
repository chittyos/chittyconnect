# ChittyConnect Local Development Guide

**Version:** 1.0.0
**Last Updated:** October 21, 2025

---

## Overview

This guide explains how to set up and run ChittyConnect locally for development and testing.

---

## Prerequisites

- Node.js 18+
- npm or yarn
- wrangler CLI (`npm install -g wrangler`)
- Git

---

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/chittyos/chittyconnect.git
cd chittyconnect
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Local Development Configuration

Wrangler supports local development with `wrangler dev`. This runs your Worker locally with:
- Local KV storage (ephemeral)
- Local D1 database (SQLite file)
- Local queue processing
- Hot reload on file changes

---

## Running Locally

### Standard Local Mode

```bash
npm run dev

# Or with wrangler directly
npx wrangler dev
```

This starts a local server at: **http://localhost:8787**

### Completely Local Mode (no remote resources)

```bash
npm run dev:local

# Or
npx wrangler dev --local
```

This mode doesn't require Cloudflare authentication and runs completely offline.

---

## Local Database Setup

### Create Local D1 Database

```bash
# Create local database
npx wrangler d1 create chittyconnect --local

# Run migrations
cat migrations/*.sql | npx wrangler d1 execute chittyconnect --local --command=-
```

### Query Local Database

```bash
# Interactive SQL shell
npx wrangler d1 execute chittyconnect --local --command="SELECT * FROM contexts"

# Check tables
npx wrangler d1 execute chittyconnect --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

---

## Testing Locally

### Health Check

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "chittyconnect",
  "brand": "itsChitty™",
  "version": "1.0.0",
  ...
}
```

### Test with Mock ChittyOS Services

Since ChittyOS services may not be available locally, you have options:

#### Option 1: Mock Mode (Recommended for Local Dev)

Create a `.dev.vars` file (gitignored) with mock tokens:

```bash
cat > .dev.vars <<EOF
CHITTY_ID_SERVICE_TOKEN=mock-chittyid-token-local-dev
CHITTY_AUTH_SERVICE_TOKEN=mock-chittyauth-token-local-dev
CHITTY_REGISTRY_TOKEN=mock-registry-token-local-dev
CHITTY_DNA_TOKEN=mock-dna-token-local-dev
CHITTY_CHRONICLE_TOKEN=mock-chronicle-token-local-dev
CHITTY_VERIFY_TOKEN=mock-verify-token-local-dev
CHITTY_CERTIFY_TOKEN=mock-certify-token-local-dev

# Environment
ENVIRONMENT=development
SERVICE_VERSION=1.0.0-dev
LOG_LEVEL=debug
EOF
```

**Note:** With mock tokens, ChittyOS integration calls will fail gracefully. The service will still work, but without external ChittyOS features.

#### Option 2: Use Staging ChittyOS Services

Use actual staging tokens in `.dev.vars`:

```bash
# Get these from ChittyOS team
CHITTY_ID_SERVICE_TOKEN=actual-staging-token
CHITTY_AUTH_SERVICE_TOKEN=actual-staging-token
# ... etc
```

---

## Local Testing Workflow

### 1. Start Dev Server

```bash
# Terminal 1
npm run dev
```

### 2. Test Endpoints

```bash
# Terminal 2

# Health check
curl http://localhost:8787/health

# Test actor registration (requires ChittyAuth token)
curl -X POST http://localhost:8787/v1/actors/register \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "actor_type": "human",
    "display_name": "Local Dev User",
    "capabilities": ["developer"]
  }'

# Create context
curl -X POST http://localhost:8787/v1/contexts/create \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "local-test-context",
    "systems": ["chittyid"],
    "tools": []
  }'

# List contexts
curl http://localhost:8787/v1/contexts/list \
  -H "Authorization: Bearer your-token"
```

### 3. Watch Logs

Wrangler dev outputs logs directly to the console. Watch for:

```
[Init] Starting ChittyConnect initialization...
[DB] Initializing database schema...
[DB] Database schema initialized successfully
[Ecosystem] Initializing ChittyConnect context...
[Init] ChittyConnect initialization complete
```

---

## Hot Reload

Wrangler dev supports hot reload. Any changes to files in `src/` will automatically reload the worker.

```bash
# Make changes to src/api/actors.js
# Save file
# Wrangler automatically reloads
# Test immediately: curl http://localhost:8787/v1/actors/me
```

---

## Debugging

### Enable Verbose Logging

Set `LOG_LEVEL=debug` in `.dev.vars`:

```
LOG_LEVEL=debug
```

### Use console.log

Add debug logs throughout code:

```javascript
console.log('[Debug] Actor:', actor);
console.log('[Debug] Context:', context);
```

Logs appear in wrangler dev terminal.

### Inspect Database State

```bash
# See all tables
npx wrangler d1 execute chittyconnect --local --command="SELECT name FROM sqlite_master WHERE type='table'"

# Query specific table
npx wrangler d1 execute chittyconnect --local --command="SELECT * FROM actors"

# Count records
npx wrangler d1 execute chittyconnect --local --command="SELECT COUNT(*) FROM contexts"
```

---

## Local Queue Testing

### Producer (sending messages)

Messages sent to queues during local dev are batched and processed by the queue consumer:

```javascript
// In your code
await env.CONTEXT_OPS_QUEUE.send({
  operation: 'context_created',
  contextId: 'test-id',
  timestamp: new Date().toISOString()
});
```

### Consumer (receiving messages)

The queue consumer in `src/queue/consumer.js` processes messages automatically.

Watch logs for:
```
[Queue] Processing batch of 1 messages
[Queue] Processing context.created: test-id
[Queue] Context created event processed: test-id
```

---

## Local Testing Best Practices

### 1. Use .dev.vars for Local Secrets

**Never** commit `.dev.vars` to git (already in `.gitignore`).

```bash
# .dev.vars structure
CHITTY_ID_SERVICE_TOKEN=local-dev-token
ENVIRONMENT=development
SERVICE_VERSION=1.0.0-dev
LOG_LEVEL=debug
```

### 2. Reset Local Database

If database gets corrupted or you want fresh start:

```bash
# Delete local database
rm -f .wrangler/state/d1/chittyconnect.sqlite

# Re-run migrations
cat migrations/*.sql | npx wrangler d1 execute chittyconnect --local --command=-
```

### 3. Test with cURL Scripts

Create a `test.sh` script:

```bash
#!/bin/bash

BASE_URL="http://localhost:8787"
TOKEN="your-token"

# Health check
curl "$BASE_URL/health"

# Register actor
curl -X POST "$BASE_URL/v1/actors/register" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actor_type":"human","display_name":"Test"}'

# Create context
curl -X POST "$BASE_URL/v1/contexts/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-ctx","systems":[],"tools":[]}'
```

Run with: `./test.sh`

---

## IDE Setup

### VS Code

Install extensions:
- **ES Lint** - Code linting
- **Prettier** - Code formatting
- **Cloudflare Workers** - Syntax highlighting

### Recommended settings.json

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## Common Issues

### Issue: "Database not found"

**Solution:**
```bash
# Ensure local database is created
npx wrangler d1 create chittyconnect --local

# Run migrations
cat migrations/*.sql | npx wrangler d1 execute chittyconnect --local --command=-
```

### Issue: "Cannot find module"

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Issue: ChittyOS service errors

**Solution:**
- Check `.dev.vars` has valid tokens
- Or use mock tokens and expect failures (graceful degradation)
- Check ChittyOS service availability

### Issue: Port 8787 already in use

**Solution:**
```bash
# Use different port
npx wrangler dev --port 8788

# Or kill process on 8787
lsof -ti:8787 | xargs kill
```

---

## Testing Workflow

### Unit Tests (Coming Soon)

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Integration Tests (Coming Soon)

```bash
# Run integration tests
npm run test:integration
```

---

## Environment Variables

### Available in .dev.vars

```bash
# Required
CHITTY_ID_SERVICE_TOKEN=your-token
CHITTY_AUTH_SERVICE_TOKEN=your-token
CHITTY_REGISTRY_TOKEN=your-token
CHITTY_DNA_TOKEN=your-token
CHITTY_CHRONICLE_TOKEN=your-token
CHITTY_VERIFY_TOKEN=your-token
CHITTY_CERTIFY_TOKEN=your-token

# Optional
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."
GITHUB_WEBHOOK_SECRET=your-secret

# Configuration
ENVIRONMENT=development
SERVICE_VERSION=1.0.0-dev
LOG_LEVEL=debug  # debug, info, warn, error
```

---

## Next Steps

1. **Set up .dev.vars** with your tokens
2. **Run `npm run dev`** to start local server
3. **Test endpoints** with cURL or Postman
4. **Make changes** to code (hot reload enabled)
5. **Check logs** for errors
6. **Query local DB** to verify data
7. **Deploy to staging** when ready: `npm run deploy:staging`

---

## Resources

- **Wrangler Docs:** https://developers.cloudflare.com/workers/wrangler/
- **Workers Docs:** https://developers.cloudflare.com/workers/
- **D1 Docs:** https://developers.cloudflare.com/d1/
- **KV Docs:** https://developers.cloudflare.com/kv/
- **Queues Docs:** https://developers.cloudflare.com/queues/

---

**Local Development Guide Version:** 1.0.0
**Last Updated:** October 21, 2025
