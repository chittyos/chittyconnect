# Chronicle & Quality Integration Summary

ChittyChronicle (event logging) and ChittyQuality (document validation) have been successfully integrated into ChittyConnect.

## Changes Made

### New Services

**`src/services/chronicle-engine.js`**
- Database operations for event logging using Neon PostgreSQL
- Full-text search with PostgreSQL tsvector
- Timeline analytics and statistics
- Audit trail tracking
- Service health metrics (24-hour window)

**`src/services/quality-engine.js`**
- Stateless document validation engine
- Draft detection patterns
- Junk content identification
- Completeness checks
- Quality gate recommendations (approve/quarantine/reject)

### New/Updated Routes

**`src/api/routes/chittyquality.js`** (NEW)
- Health check endpoint
- Single document validation
- Batch document validation
- Validation rules retrieval
- Rate limiting: 60 requests/minute per IP

**`src/api/routes/chittychronicle.js`** (UPDATED)
- Replaced proxy implementation with direct database operations
- Now uses ChronicleEngine for all operations
- Retrieves database URL from 1Password or environment variable
- Rate limiting: 60 requests/minute per IP

### Configuration Updates

**`src/api/router.js`**
- Added import for `chittyqualityRoutes`
- Registered Quality routes at `/api/chittyquality`
- Updated health endpoint to include Quality
- Both Chronicle and Quality now integrated

**`package.json`**
- Added dependency: `@neondatabase/serverless@^0.10.4`

**`public/openapi.json`**
- Removed old Chronicle proxy endpoints (`/log`, `/query`)
- Added 6 new Chronicle endpoints (health, events, timeline, audit, statistics, service health)
- Added 4 new Quality endpoints (health, validate, batch validate, rules)
- Added 10 new schemas (ChronicleEvent, ValidationResult, etc.)
- Added Chronicle and Quality tags
- Total: 23 paths, 14 schemas

### Scripts

**`scripts/update-openapi.js`**
- Automated OpenAPI spec update script
- Merges new endpoints and schemas
- Removes old endpoints
- Sorts paths alphabetically
- Usage: `node scripts/update-openapi.js`

## API Endpoints

### ChittyChronicle

All endpoints at `/api/chittychronicle/*` (requires authentication):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/events` | Log new event |
| GET | `/events` | Search events (with filters: service, action, userId, dates, status, query, limit) |
| GET | `/timeline` | Get activity timeline (grouped by hour/day/week/month) |
| GET | `/audit/:entityId` | Get audit trail for entity (requires entityType param) |
| GET | `/statistics` | Get event statistics summary |
| GET | `/health` | Get service health metrics (24-hour window) |

### ChittyQuality

All endpoints at `/api/chittyquality/*` (requires authentication):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/validate` | Validate single document (requires filename, content) |
| POST | `/validate/batch` | Validate multiple documents (requires files array) |
| GET | `/rules` | Get validation rules configuration |

## Authentication

All endpoints require ChittyConnect API authentication:
- Header: `X-ChittyOS-API-Key: <your-api-key>`
- Alternatively, ChatGPT Custom GPTs handle authentication automatically

## 1Password Integration

### Chronicle Database Connection

Chronicle retrieves the Neon database URL using the credential helper:

**1Password Path:** `database/neon/chittyos_core`
**Fallback:** `NEON_DATABASE_URL` environment variable

```javascript
const databaseUrl = await getCredential(
  env,
  'database/neon/chittyos_core',
  'NEON_DATABASE_URL',
  'ChittyChronicle'
);
```

### Quality (No Credentials Required)

Quality is stateless and performs pure validation logic - no database or external credentials needed.

## Database Schema

Chronicle uses the `chronicle_events` table in the shared `chittyos-core` database:

```sql
CREATE TABLE chronicle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  service VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  metadata JSONB,
  related_events UUID[],
  triggered_by VARCHAR(50),
  integrations TEXT[],
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      service || ' ' ||
      action || ' ' ||
      COALESCE(metadata::text, '')
    )
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chronicle_service ON chronicle_events(service, timestamp DESC);
CREATE INDEX idx_chronicle_search ON chronicle_events USING GIN(search_vector);
CREATE INDEX idx_chronicle_timestamp ON chronicle_events(timestamp DESC);
```

## Quality Validation Rules

**Draft Indicators:**
- Patterns: draft, temp, test, wip, version numbers (v1.2), "Copy of", etc.
- Severity: Critical or Warning

**Junk Content:**
- Lorem ipsum, test patterns, placeholders ([INSERT], [TODO], [TK])
- Severity: Critical

**Incomplete Patterns:**
- [REDACTED], [CLIENT NAME], [DATE], {{variables}}
- Severity: Critical

**Size Limits:**
- Minimum: 1KB (1024 bytes)
- Maximum: 50MB (50,000,000 bytes)

**Content Requirements:**
- Minimum: 100 characters, 20 words
- Repetition ratio threshold: < 5.0

## ChatGPT Custom GPT Integration

### Setup

1. Create/Edit your Custom GPT at [ChatGPT](https://chat.openai.com/gpts/editor)
2. Navigate to "Configure" → "Actions"
3. Remove old Chronicle/Quality action schemas (if any)
4. Click "Import from URL"
5. Enter: `https://connect.chitty.cc/openapi.json`
6. Review and confirm the imported actions
7. Configure authentication (API key will be provided)
8. Save and test

### Available Actions

ChatGPT can now:
- Log events to Chronicle
- Search Chronicle event history
- Get activity timelines and statistics
- Retrieve audit trails
- Check service health
- Validate document quality
- Batch validate documents
- Get validation rules

## Local Development

### Start Server

```bash
cd chittyconnect
npm install  # Install dependencies including @neondatabase/serverless
npm run dev  # Start at http://localhost:8787
```

### Test Chronicle Endpoints

```bash
# Log event (requires API key)
curl -X POST http://localhost:8787/api/chittychronicle/events \
  -H "X-ChittyOS-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "ChittyCases",
    "action": "case_created",
    "userId": "user123",
    "metadata": {"caseId": "case-456"}
  }'

# Search events
curl http://localhost:8787/api/chittychronicle/events?service=ChittyCases \
  -H "X-ChittyOS-API-Key: YOUR_KEY"
```

### Test Quality Endpoints

```bash
# Validate document (requires API key)
curl -X POST http://localhost:8787/api/chittyquality/validate \
  -H "X-ChittyOS-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "legal-brief.pdf",
    "content": "Complete document content with sufficient words and characters to pass minimum validation requirements..."
  }'

# Get validation rules
curl http://localhost:8787/api/chittyquality/rules \
  -H "X-ChittyOS-API-Key: YOUR_KEY"
```

## Deployment

### Prerequisites

1. **1Password Setup**
   - Add `database/neon/chittyos_core` with Neon database URL
   - Ensure 1Password Connect is configured for ChittyConnect

2. **Environment Variables** (fallback if 1Password unavailable)
   - `NEON_DATABASE_URL` - Neon PostgreSQL connection string

### Deploy to Staging

```bash
npm run deploy:staging
```

### Deploy to Production

```bash
npm run deploy:production
```

### Verify Deployment

```bash
# Check health
curl https://connect.chitty.cc/api/health

# Check Chronicle
curl https://connect.chitty.cc/api/chittychronicle \
  -H "X-ChittyOS-API-Key: YOUR_KEY"

# Check Quality
curl https://connect.chitty.cc/api/chittyquality \
  -H "X-ChittyOS-API-Key: YOUR_KEY"

# Get OpenAPI spec
curl https://connect.chitty.cc/openapi.json | jq '.tags'
```

## Migration from chittymcp

The separate Chronicle and Quality services from `chittymcp` have been consolidated into ChittyConnect:

**Before:**
- `chronicle.chitty.cc` - Separate Worker
- `quality.chitty.cc` - Separate Worker
- Each had own OpenAPI spec
- Direct service calls required service tokens

**After:**
- `connect.chitty.cc/api/chittychronicle/*` - Integrated
- `connect.chitty.cc/api/chittyquality/*` - Integrated
- Unified OpenAPI spec
- Single authentication via ChittyConnect API keys
- 1Password integration for credentials
- Shared CORS, rate limiting, error handling

### Benefits

1. **Unified Authentication** - One API key for all ChittyConnect services
2. **1Password Integration** - Centralized credential management
3. **Simplified Architecture** - Fewer services to manage
4. **Consistent Patterns** - Same middleware, error handling, CORS
5. **Single OpenAPI Spec** - Easier for ChatGPT Custom GPT setup
6. **Better Monitoring** - All logs in one place

## Future Enhancements

Potential improvements:
- Add Chronicle event streaming/webhooks
- Implement ML-based quality detection
- Add Chronicle analytics dashboard
- Integrate ChittyScore for trust-weighted events
- Add persistent rate limiting (KV or D1)
- Add event retention policies
- Add quality rule customization API

## Support

For issues or questions:
- Check deployment logs: `npm run tail`
- Review OpenAPI spec: `https://connect.chitty.cc/openapi.json`
- Test endpoints locally: `npm run dev`
- Verify 1Password credentials are configured
- Check database connectivity if Chronicle fails

---

**Integration Date:** 2025-11-09
**ChittyConnect Version:** 2.0.0
**Status:** ✓ Complete and Ready for Deployment
