# ChittyConnect Custom GPT Actions - Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the optimized Custom GPT Actions API for ChittyConnect. The optimizations focus on making the API more intuitive, reliable, and efficient for AI assistants (ChatGPT, Claude) while maintaining backward compatibility.

## What's New in v2.0

### 1. Enhanced OpenAPI Specification
- **Rich descriptions** with context and use cases
- **Comprehensive examples** for every endpoint
- **x-gpt-hints** metadata for improved GPT understanding
- **Detailed error responses** with recovery guidance

### 2. Composite Endpoints
- **All-in-one operations** reduce round trips
- **Atomic transactions** with rollback support
- **Contextual responses** guide next steps
- **Batch processing** for multiple operations

### 3. Improved Error Handling
- **Structured error codes** for consistent handling
- **Recovery suggestions** in every error
- **Development vs production** error detail levels
- **Partial success** handling for batch operations

### 4. Context Preservation
- **Conversation tracking** across requests
- **State management** via KV storage
- **Continuation hints** for multi-turn interactions
- **Suggested next steps** in responses

### 5. Performance Optimizations
- **Response caching** for read operations
- **Request batching** support
- **Streaming responses** for long operations
- **Parallel processing** where applicable

## File Structure

```
chittyconnect/
├── public/
│   ├── openapi.json                    # Current OpenAPI spec
│   └── openapi-optimized.json          # New optimized spec
├── src/
│   ├── api/
│   │   ├── router.js                   # Main API router
│   │   ├── middleware/
│   │   │   ├── auth.js                 # Authentication
│   │   │   ├── context.js              # Context injection (NEW)
│   │   │   ├── validation.js           # Request validation (NEW)
│   │   │   └── cache.js                # Response caching (NEW)
│   │   └── routes/
│   │       ├── composite.js            # Composite endpoints (NEW)
│   │       ├── chittyid.js
│   │       ├── chittycases.js
│   │       └── ...
│   └── lib/
│       ├── responses.js                # Response utilities (NEW)
│       ├── errors.js                   # Error classes (NEW)
│       └── credential-helper.js        # 1Password integration
└── docs/
    ├── GPT_ACTIONS_OPTIMIZATION_RECOMMENDATIONS.md
    └── GPT_ACTIONS_IMPLEMENTATION_GUIDE.md (this file)
```

## Implementation Steps

### Phase 1: Core Infrastructure (Week 1)

#### Step 1.1: Install Dependencies

```bash
cd /Users/nb/Projects/development/chittyconnect
npm install zod@latest          # Validation library
```

#### Step 1.2: Update wrangler.toml

Add new KV namespaces for context storage:

```toml
[[kv_namespaces]]
binding = "CONVERSATIONS"
id = "your_conversations_kv_namespace_id"
preview_id = "your_preview_id"

[[kv_namespaces]]
binding = "CACHE"
id = "your_cache_kv_namespace_id"
preview_id = "your_preview_id"

[[kv_namespaces]]
binding = "CONTEXT_STORE"
id = "your_context_kv_namespace_id"
preview_id = "your_preview_id"
```

Create the namespaces:

```bash
wrangler kv:namespace create "CONVERSATIONS"
wrangler kv:namespace create "CONVERSATIONS" --preview
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "CACHE" --preview
wrangler kv:namespace create "CONTEXT_STORE"
wrangler kv:namespace create "CONTEXT_STORE" --preview
```

#### Step 1.3: Create Context Injection Middleware

Create `/Users/nb/Projects/development/chittyconnect/src/api/middleware/context.js`:

```javascript
/**
 * Context Injection Middleware
 * Automatically injects contextual information into requests
 */

export async function injectContext(c, next) {
  const startTime = Date.now();
  c.set('startTime', startTime);

  const auth = c.get('auth');
  const conversationId = c.req.header('X-Conversation-ID');

  // Build context object
  const context = {
    user: {
      id: auth?.userId,
      scopes: auth?.scopes
    },
    session: {
      conversationId: conversationId || crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    },
    environment: {
      source: detectSource(c.req.header('User-Agent')),
      clientIp: c.req.header('CF-Connecting-IP'),
      country: c.req.header('CF-IPCountry')
    }
  };

  // Retrieve historical context if available
  if (conversationId) {
    try {
      const history = await c.env.CONTEXT_STORE.get(
        `context:${conversationId}`,
        { type: 'json' }
      );
      if (history) {
        context.history = history;
      }
    } catch (error) {
      console.warn('Failed to retrieve context history:', error);
    }
  }

  // Inject context into request
  c.set('context', context);

  // Process request
  await next();

  // Store updated context if conversation ID is present
  if (conversationId && c.res.status < 400) {
    try {
      const responseBody = await c.res.clone().json();

      // Update context with response information
      context.lastRequest = {
        path: c.req.path,
        method: c.req.method,
        timestamp: new Date().toISOString(),
        responseStatus: c.res.status
      };

      if (responseBody.data) {
        context.lastResult = {
          type: extractResultType(c.req.path),
          id: extractEntityId(responseBody.data)
        };
      }

      await c.env.CONTEXT_STORE.put(
        `context:${conversationId}`,
        JSON.stringify(context),
        { expirationTtl: 86400 } // 24 hours
      );
    } catch (error) {
      console.warn('Failed to store context:', error);
    }
  }
}

function detectSource(userAgent) {
  if (!userAgent) return 'unknown';
  if (userAgent.includes('OpenAI')) return 'openai-gpt';
  if (userAgent.includes('Anthropic')) return 'anthropic-claude';
  return 'generic';
}

function extractResultType(path) {
  if (path.includes('/chittyid/')) return 'chittyid';
  if (path.includes('/cases/')) return 'case';
  if (path.includes('/evidence/')) return 'evidence';
  return 'unknown';
}

function extractEntityId(data) {
  return data?.chittyid || data?.id || data?.caseId || null;
}
```

#### Step 1.4: Create Caching Middleware

Create `/Users/nb/Projects/development/chittyconnect/src/api/middleware/cache.js`:

```javascript
/**
 * Response Caching Middleware
 * Caches GET request responses
 */

export function cacheResponse(ttl = 300) {
  return async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      return next();
    }

    const cacheKey = `cache:${c.req.url}`;

    // Check cache
    try {
      const cached = await c.env.CACHE.get(cacheKey, { type: 'json' });
      if (cached) {
        c.header('X-Cache-Status', 'HIT');
        c.header('X-Cache-Key', cacheKey);
        return c.json(cached);
      }
    } catch (error) {
      console.warn('Cache read error:', error);
    }

    // Process request
    await next();

    // Cache successful responses
    if (c.res.status === 200) {
      try {
        const response = await c.res.clone().json();
        await c.env.CACHE.put(
          cacheKey,
          JSON.stringify(response),
          { expirationTtl: ttl }
        );
        c.header('X-Cache-Status', 'MISS');
      } catch (error) {
        console.warn('Cache write error:', error);
      }
    }
  };
}

export function invalidateCache(c, pattern) {
  // Implementation for cache invalidation
  // This would use KV list() to find matching keys and delete them
}
```

#### Step 1.5: Update Router

Update `/Users/nb/Projects/development/chittyconnect/src/api/router.js`:

```javascript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Import routes
import { chittyidRoutes } from "./routes/chittyid.js";
import { chittycasesRoutes } from "./routes/chittycases.js";
import { compositeRoutes } from "./routes/composite.js"; // NEW

// Import middleware
import { authenticate } from "./middleware/auth.js";
import { injectContext } from "./middleware/context.js"; // NEW
import { errorHandler } from "../lib/errors.js"; // NEW

const api = new Hono();

// Global middleware
api.use("*", logger());
api.use("*", cors({
  origin: ["https://chat.openai.com", "https://chatgpt.com", "https://claude.ai"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "X-ChittyOS-API-Key",
    "X-Conversation-ID",
    "X-Request-ID"
  ],
  exposeHeaders: [
    "Content-Length",
    "X-Request-ID",
    "X-Cache-Status",
    "X-Conversation-ID"
  ],
  maxAge: 86400,
  credentials: true,
}));

// Health check (no auth required)
api.get("/api/health", (c) => {
  return c.json({
    status: "healthy",
    service: "chittyconnect-gpt-api",
    version: "2.0.0",
    timestamp: new Date().toISOString()
  });
});

// OpenAPI spec endpoints
api.get("/openapi.json", async (c) => {
  const spec = await c.env.ASSETS.fetch(
    new Request("https://connect.chitty.cc/openapi.json")
  );
  return spec;
});

api.get("/openapi-v2.json", async (c) => {
  const spec = await c.env.ASSETS.fetch(
    new Request("https://connect.chitty.cc/openapi-optimized.json")
  );
  return spec;
});

// Authentication and context for all API routes
api.use("/api/*", authenticate);
api.use("/api/*", injectContext);

// Route handlers
api.route("/api/composite", compositeRoutes); // NEW - Composite endpoints
api.route("/api/chittyid", chittyidRoutes);
api.route("/api/chittycases", chittycasesRoutes);
// ... other routes

// Global error handler
api.onError(errorHandler);

export { api };
```

### Phase 2: Composite Endpoints (Week 2)

The composite routes have already been created in `/Users/nb/Projects/development/chittyconnect/src/api/routes/composite.js`. No additional work needed.

### Phase 3: Enhanced Error Handling (Week 2)

The error utilities have been created in `/Users/nb/Projects/development/chittyconnect/src/lib/errors.js` and `/Users/nb/Projects/development/chittyconnect/src/lib/responses.js`.

Update existing routes to use the new error handling:

```javascript
// Example: Update chittyid.js
import { errorResponse } from '../../lib/responses.js';
import { APIError, ServiceUnavailableError } from '../../lib/errors.js';

chittyidRoutes.post("/mint", async (c) => {
  try {
    const { entity, metadata } = await c.req.json();

    if (!entity) {
      throw new APIError('VALIDATION_ERROR', 'entity is required', null, 400);
    }

    // ... rest of logic

  } catch (error) {
    if (error instanceof APIError) {
      return errorResponse(c, error);
    }
    return errorResponse(c, new ServiceUnavailableError('chittyid', error.message));
  }
});
```

### Phase 4: Testing & Validation (Week 3)

#### Step 4.1: Create Test Suite

Create `/Users/nb/Projects/development/chittyconnect/tests/api/composite.test.js`:

```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { api } from '../../src/api/router.js';

describe('Composite API Endpoints', () => {
  let env;

  beforeAll(() => {
    env = {
      CONVERSATIONS: mockKVNamespace(),
      CACHE: mockKVNamespace(),
      CONTEXT_STORE: mockKVNamespace(),
      // ... other bindings
    };
  });

  it('should create complete case with parties', async () => {
    const request = new Request('https://connect.chitty.cc/api/composite/case-with-parties', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
        'X-Conversation-ID': 'test-conv-123'
      },
      body: JSON.stringify({
        caseDetails: {
          title: 'Test Case',
          type: 'eviction'
        },
        parties: [
          {
            role: 'plaintiff',
            name: 'John Doe',
            type: 'individual'
          }
        ]
      })
    });

    const response = await api.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.case).toBeDefined();
    expect(data.data.parties).toHaveLength(1);
    expect(data.context.conversationId).toBe('test-conv-123');
  });

  it('should handle batch operations', async () => {
    const request = new Request('https://connect.chitty.cc/api/composite/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        requests: [
          {
            id: 'req1',
            method: 'POST',
            endpoint: '/api/chittyid/mint',
            body: { entity: 'PEO' }
          },
          {
            id: 'req2',
            method: 'POST',
            endpoint: '/api/chittyid/mint',
            body: { entity: 'PLACE' }
          }
        ],
        sequential: false
      })
    });

    const response = await api.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.total).toBe(2);
    expect(data.results).toHaveLength(2);
  });
});

function mockKVNamespace() {
  const store = new Map();
  return {
    get: async (key) => store.get(key),
    put: async (key, value) => store.set(key, value),
    delete: async (key) => store.delete(key)
  };
}
```

#### Step 4.2: Run Tests

```bash
npm test
```

### Phase 5: Documentation & Deployment (Week 4)

#### Step 5.1: Update Documentation

Update `CLAUDE.md` and `README.md` with new endpoints and features.

#### Step 5.2: Deploy to Staging

```bash
# Deploy optimized OpenAPI spec
wrangler publish --env staging

# Test with staging URL
curl https://connect-staging.chitty.cc/openapi-v2.json
```

#### Step 5.3: Configure Custom GPT

1. Go to ChatGPT → Create GPT
2. Configure Actions:
   - Schema: Import from `https://connect.chitty.cc/openapi-v2.json`
   - Authentication: API Key (Custom header `X-ChittyOS-API-Key`)
3. Test the GPT with various prompts

#### Step 5.4: Deploy to Production

```bash
wrangler publish --env production
```

## Usage Examples

### Example 1: Create Complete Case (Custom GPT)

**User Prompt to GPT:**
```
Create an eviction case for John Smith (landlord) vs Jane Johnson (tenant).
The lease was signed on Jan 15, 2023 and there are 3 months of missed payments
totaling $4,500.
```

**GPT Action Call:**
```http
POST /api/composite/case-with-parties
Content-Type: application/json
X-Conversation-ID: conv_abc123

{
  "caseDetails": {
    "title": "Smith vs. Johnson - Eviction Proceeding",
    "type": "eviction",
    "description": "Non-payment of rent for 3 months"
  },
  "parties": [
    {
      "role": "plaintiff",
      "name": "John Smith",
      "type": "individual"
    },
    {
      "role": "defendant",
      "name": "Jane Johnson",
      "type": "individual"
    }
  ],
  "initialEvidence": {
    "leaseAgreement": {
      "type": "document",
      "description": "Original lease agreement signed 2023-01-15"
    },
    "paymentHistory": {
      "type": "financial",
      "description": "Payment records showing missed payments",
      "data": {
        "missedPayments": 3,
        "totalOwed": 4500
      }
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "case": {
      "id": "01-C-CTX-A7B2-C-2411-3-X",
      "title": "Smith vs. Johnson - Eviction Proceeding",
      "status": "active"
    },
    "parties": [
      {
        "chittyId": "01-C-PEO-A7B3-P-2411-4-X",
        "role": "plaintiff",
        "name": "John Smith"
      },
      {
        "chittyId": "01-C-PEO-A7B4-P-2411-5-X",
        "role": "defendant",
        "name": "Jane Johnson"
      }
    ],
    "evidence": [
      {
        "id": "01-C-INFO-A7B5-I-2411-6-X",
        "type": "document",
        "status": "verified"
      }
    ]
  },
  "context": {
    "conversationId": "conv_abc123",
    "continuationHint": "Case created successfully. You can now add more evidence, schedule hearings, or generate legal documents.",
    "suggestedNextSteps": [
      {
        "action": "Generate eviction notice",
        "endpoint": "/api/documents/generate",
        "reason": "Create formal eviction notice"
      }
    ]
  }
}
```

### Example 2: Batch Operations

**Request:**
```http
POST /api/composite/batch
Content-Type: application/json

{
  "requests": [
    {
      "id": "create_plaintiff",
      "method": "POST",
      "endpoint": "/api/chittyid/mint",
      "body": { "entity": "PEO", "metadata": { "name": "John Doe" } }
    },
    {
      "id": "create_defendant",
      "method": "POST",
      "endpoint": "/api/chittyid/mint",
      "body": { "entity": "PEO", "metadata": { "name": "Jane Doe" } }
    }
  ],
  "sequential": false
}
```

## Monitoring & Analytics

### Key Metrics to Track

1. **API Performance**
   - Response times per endpoint
   - Cache hit rates
   - Error rates by error code

2. **GPT Usage Patterns**
   - Most used endpoints
   - Conversation lengths
   - Success vs failure rates

3. **Context Preservation**
   - Context retrieval success rate
   - Average conversation duration
   - Context size statistics

### Cloudflare Analytics Queries

```sql
-- Response time by endpoint
SELECT
  clientRequestPath as endpoint,
  AVG(edgeResponseTime) as avg_response_time,
  COUNT(*) as request_count
FROM httpRequests
WHERE datetime > NOW() - INTERVAL '24' HOUR
GROUP BY endpoint
ORDER BY request_count DESC

-- Error rate by code
SELECT
  responseHeaders['x-error-code'] as error_code,
  COUNT(*) as error_count
FROM httpRequests
WHERE edgeResponseStatus >= 400
  AND datetime > NOW() - INTERVAL '24' HOUR
GROUP BY error_code
ORDER BY error_count DESC

-- Cache effectiveness
SELECT
  responseHeaders['x-cache-status'] as cache_status,
  COUNT(*) as count,
  AVG(edgeResponseTime) as avg_time
FROM httpRequests
WHERE datetime > NOW() - INTERVAL '1' HOUR
GROUP BY cache_status
```

## Troubleshooting

### Issue: Context Not Persisting

**Symptoms:** Conversation context is lost between requests

**Solution:**
1. Verify KV namespace binding in wrangler.toml
2. Check X-Conversation-ID header is being sent
3. Verify CONTEXT_STORE KV namespace has data:
   ```bash
   wrangler kv:key list --namespace-id=<your-namespace-id>
   ```

### Issue: Composite Operations Failing Partially

**Symptoms:** Some operations succeed, others fail

**Solution:**
1. Check individual service health
2. Review error details in response
3. Implement retry logic for failed operations
4. Check rollback was executed properly

### Issue: High Response Times

**Symptoms:** API responses taking > 2 seconds

**Solution:**
1. Enable caching for GET requests
2. Use batch operations instead of sequential calls
3. Check upstream service health
4. Review Cloudflare Worker CPU time metrics

## Best Practices

### For Custom GPT Integration

1. **Always use composite endpoints** when creating related entities
2. **Include X-Conversation-ID** header for context preservation
3. **Use batch operations** for multiple independent requests
4. **Handle partial success** gracefully in GPT instructions
5. **Follow suggested next steps** in responses

### For Error Handling

1. **Never expose sensitive details** in error messages
2. **Always provide recovery suggestions**
3. **Use appropriate HTTP status codes**
4. **Log detailed errors** server-side for debugging

### For Performance

1. **Cache read operations** with appropriate TTLs
2. **Use parallel processing** for independent operations
3. **Implement request timeouts** (max 30 seconds for Workers)
4. **Monitor cache hit rates** and adjust TTLs

## Next Steps

After implementing these optimizations:

1. **OAuth 2.0 Support** - Implement full OAuth flow for GPTs
2. **Webhook Callbacks** - Add async operation support
3. **Advanced Context** - ML-based context understanding
4. **Multi-Modal** - Support image/file uploads in evidence
5. **Real-time Updates** - SSE for live case updates

## Support

For questions or issues:
- Documentation: `/Users/nb/Projects/development/chittyconnect/CLAUDE.md`
- API Reference: `https://connect.chitty.cc/openapi-v2.json`
- Service Status: `https://connect.chitty.cc/api/services/status`