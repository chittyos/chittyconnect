# ChittyConnect Data Ingestion & Processing Analysis

**Generated:** 2025-10-22
**Version:** 1.0.0

---

## Executive Summary

ChittyConnect serves as the **"AI-intelligent spine with ContextConsciousness™, MemoryCloude™, and Cognitive-Coordination™"** for the ChittyOS ecosystem. It ingests data from multiple sources, processes it through intelligent pipelines, and distributes it across ChittyOS services and third-party platforms.

### Key Statistics
- **37 JavaScript files** across 13 directories
- **16 API routes** with data processing capabilities
- **3 intelligence modules** for context awareness and memory
- **2 queue/webhook handlers** for async processing
- **7 third-party integrations** (Notion, Google, OpenAI, Neon, Cloudflare AI)

---

## 1. File Upload & Multipart Data

### ChittyEvidence File Ingestion

**Endpoint:** `POST /api/chittyevidence/ingest`

**Accepts:**
```javascript
FormData {
  file: File,                    // Evidence file
  caseId: string (required),     // Associated case
  evidenceType: string,          // Classification
  metadata: object               // Additional context
}
```

**Processing Flow:**
```
1. Receive multipart FormData
2. Validate required fields (file, caseId)
3. Forward to ChittyEvidence service
   → POST https://evidence.chitty.cc/api/ingest
4. Return evidence ID + storage location
```

**Storage:** Remote at `evidence.chitty.cc`, indexed by `caseId`

---

## 2. Case Data Ingestion

### ChittyCases API

**File:** `src/api/routes/chittycases.js`

#### Create Case
```http
POST /api/chittycases/create
Content-Type: application/json

{
  "title": "Case Name",
  "description": "Full description",
  "caseType": "eviction|litigation|resolution|general",
  "metadata": { /* custom fields */ }
}
```

**Processing:**
1. Validate `title` and `caseType` (required)
2. Validate `caseType` against whitelist
3. POST to ChittyCases service
4. Return created case with ID

#### Update Case
```http
PUT /api/chittycases/:caseId
```
- Merges updates with existing data
- Maintains audit trail

---

## 3. Financial Data Integration

### ChittyFinance Banking

**File:** `src/api/routes/chittyfinance.js`

#### Connect Bank Account
```http
POST /api/chittyfinance/banking/connect
Content-Type: application/json

{
  "provider": "plaid|stripe|direct",
  "publicToken": "token_from_provider",
  "accountDetails": { /* account info */ }
}
```

**Supported Providers:**
- **Plaid** - ACH, bank account linking
- **Stripe** - Payment method integration
- **Direct** - Manual account setup

#### Ingest Transactions
```http
POST /api/chittyfinance/transactions

{
  "accountId": "account-123",
  "startDate": "2025-01-01",
  "endDate": "2025-01-31",
  "limit": 100
}
```

**Returns:** Paginated transaction list filtered by date range

---

## 4. GitHub Webhook Processing

### Webhook Handler

**File:** `src/handlers/webhook.js`

**Endpoint:** `POST /integrations/github/webhook`

**Headers:**
- `X-GitHub-Delivery` - Unique delivery ID
- `X-GitHub-Event` - Event type
- `X-Hub-Signature-256` - HMAC signature

**Events Processed:**
- `push` - Code commits
- `pull_request` - PR creation/updates
- `issue_comment` - Comments
- `check_run` / `check_suite` - Status checks
- `workflow_run` - GitHub Actions
- `status` - Commit status
- `issues` - Issue management
- `installation` - App installation

**Security:** HMAC-SHA256 signature verification

**Flow:**
```
GitHub Webhook
  → Signature Verification
  → Queue Message (EVENT_Q)
  → Queue Consumer
  → Event Normalization (MCP schema)
  → Parallel Automations
```

---

## 5. Async Queue Processing

### Queue Consumer

**File:** `src/handlers/queue.js`

**Queue:** Cloudflare Queue `EVENT_Q`

**Message Structure:**
```javascript
{
  delivery: "github-delivery-id",
  event: "push|pull_request|etc",
  payload: { /* GitHub webhook payload */ },
  timestamp: 1729544896912
}
```

**Processing Pipeline:**

```
Queue Message
  ↓
[1] Extract Installation ID
  ↓
[2] Lookup Tenant Mapping (D1 Database)
  → SELECT tenant_id WHERE installation_id = ?
  ↓
[3] Normalize Event
  → Convert to ChittyOS MCP schema
  ↓
[4] Execute Automations (Parallel)
  ├─ createComplianceCheck()
  ├─ autoLabelPullRequest()
  ├─ summarizePullRequest()
  └─ requestReviewers()
  ↓
[5] Idempotency Tracking
  → Store delivery ID in KV (24hr TTL)
  ↓
[6] Acknowledgment
  → msg.ack()
```

**Database:** D1 table `gh_installations`
- Maps `installation_id` → `tenant_id`
- Stores account metadata

---

## 6. Third-Party Data Ingestion

### Notion Integration

**File:** `src/api/routes/thirdparty.js`

#### Query Database
```http
POST /api/thirdparty/notion/query

{
  "databaseId": "notion-db-id",
  "filter": { /* Notion filter */ },
  "sorts": [ /* sort specs */ ]
}
```

#### Create Page
```http
POST /api/thirdparty/notion/page/create

{
  "parent": { "database_id": "..." },
  "properties": { /* page properties */ }
}
```

### Neon Database

```http
POST /api/thirdparty/neon/query

{
  "query": "SELECT * FROM table WHERE id = ?",
  "params": [123]
}
```

### OpenAI Chat

```http
POST /api/thirdparty/openai/chat

{
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "model": "gpt-4",
  "temperature": 0.7
}
```

### Google Calendar

```http
GET /api/thirdparty/google/calendar/events
  ?calendarId=primary
  &timeMin=2025-01-01T00:00:00Z
  &timeMax=2025-02-01T00:00:00Z
```

### Cloudflare Workers AI

```http
POST /api/thirdparty/cloudflare/ai/run

{
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "inputs": { /* model-specific */ }
}
```

---

## 7. Event Normalization

### GitHub → MCP Schema Transform

**File:** `src/mcp/normalize.js`

**Function:** `normalizeGitHubEvent(params)`

**Example - Push Event:**

**Input (GitHub):**
```javascript
{
  delivery: "12345-uuid",
  event: "push",
  payload: {
    repository: { owner: {}, name: "repo" },
    ref: "refs/heads/main",
    commits: [...]
  }
}
```

**Output (MCP):**
```javascript
{
  source: "github",
  event: "push",
  installation_id: 12345,
  tenant_id: "tenant-uuid",
  delivery_id: "12345-uuid",
  ts: "2025-01-22T10:30:00Z",
  repo: {
    owner: "user",
    name: "repo",
    full_name: "user/repo"
  },
  refs: {
    branch: "main",
    sha: "abc123..."
  },
  actor: { login: "username" },
  commits: [...]
}
```

---

## 8. Intelligence Modules

### MemoryCloude™ - Semantic Memory

**File:** `src/intelligence/memory-cloude.js`

**Method:** `persistInteraction(sessionId, interaction)`

**Interaction Structure:**
```javascript
{
  sessionId: "session-123",
  interaction: {
    userId: "user-456",
    type: "query|action|decision",
    content: "User input",
    entities: [
      { type: "case", id: "case-789" }
    ],
    actions: [...],
    decisions: [...]
  }
}
```

**Processing:**
```
1. Store Raw Interaction (KV)
   → Key: session:{sessionId}:{timestamp}
   → TTL: 90 days

2. Generate Vector Embedding
   → Model: @cf/baai/bge-base-en-v1.5
   → Store in Vectorize

3. Extract & Persist Entities
   → Key: entity:{type}:{id}
   → TTL: Forever

4. Persist Decisions
   → TTL: 365 days

5. Update Session Index
```

**Storage:**
- **Conversations:** 90 days
- **Decisions:** 365 days
- **Entities:** Infinite

#### Semantic Recall

```http
POST /api/intelligence/memory/recall

{
  "sessionId": "session-123",
  "query": "What is my case status?",
  "limit": 5,
  "semantic": true
}
```

**Process:**
1. Generate query embedding
2. Query Vectorize for top-K matches
3. Re-rank by recency (30%) + relevance (70%)
4. Return ranked context

### ContextConsciousness™ - Ecosystem Monitoring

**File:** `src/intelligence/context-consciousness.js`

**Method:** `captureEcosystemSnapshot()`

**Snapshot Structure:**
```javascript
{
  timestamp: Date.now(),
  services: [
    {
      name: "chittyid",
      status: "healthy|degraded|down",
      latency: 150,
      lastCheck: timestamp
    }
  ],
  overall: {
    healthy: 10,
    degraded: 1,
    down: 1
  }
}
```

**Health Thresholds:**
- Latency > 1000ms → degraded
- Status 500+ → down
- Status != 200 → degraded

**Capabilities:**
- Anomaly detection
- Latency failure prediction
- Availability monitoring
- Cascading failure detection

---

## 9. Data Synchronization

### ChittySync

**File:** `src/api/routes/chittysync.js`

#### Trigger Sync
```http
POST /api/chittysync/sync

{
  "source": "chittyevidence",
  "target": "chittyfinance",
  "entities": ["entity-id-1"],
  "mode": "incremental|full"
}
```

#### Check Status
```http
GET /api/chittysync/status/:syncId
```

#### View History
```http
GET /api/chittysync/history?source=service&limit=50
```

---

## 10. Canonical Validation

### ChittyCanon

**File:** `src/integrations/chittycanon-client.js`

**Validation Categories:**
- Workflow statuses (pending, in_progress, completed, etc.)
- Health statuses (healthy, degraded, unhealthy)
- Case types (eviction, litigation, resolution)
- Currency codes (USD, EUR, BTC, ETH, USDC)
- Payment rails (mercury-ach, circle-usdc, stripe)
- Contract statuses
- System roles
- Evidence types
- Document types

**Method:** `validate(type, value)`

```javascript
validate("workflowStatus", "pending")
// Returns: { valid: true, message: "Valid workflow status" }
```

**Caching:** 5-minute TTL

---

## 11. Complete Data Flow Architecture

```
┌─────────────────────────────────────────┐
│        DATA SOURCES                     │
├─────────────────────────────────────────┤
│  GitHub | Notion | OpenAI | Google     │
│  Webhooks| Database| Chat  | Calendar  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  CHITTYCONNECT INGESTION LAYER          │
├─────────────────────────────────────────┤
│  • HTTP Endpoints (16 routes)           │
│  • Webhook Handler (signature verify)   │
│  • MCP Server (tools/resources)         │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  CLOUDFLARE INFRASTRUCTURE              │
├─────────────────────────────────────────┤
│  D1 Database | KV Store | Vectorize    │
│  EVENT_Q Queue | Workers AI             │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  INTELLIGENCE PROCESSING                │
├─────────────────────────────────────────┤
│  • MemoryCloude™ (semantic memory)      │
│  • ContextConsciousness™ (monitoring)   │
│  • Cognitive-Coordination™ (tasks)      │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  TRANSFORMATION & NORMALIZATION         │
├─────────────────────────────────────────┤
│  • GitHub → MCP schema                  │
│  • Canonical validation                 │
│  • Metadata enrichment                  │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  CHITTYOS ECOSYSTEM SERVICES            │
├─────────────────────────────────────────┤
│  ChittyID | ChittyCases | ChittyEvidence│
│  ChittyFinance | ChittySync | ChittyDNA │
└─────────────────────────────────────────┘
```

---

## 12. Capabilities Matrix

| Capability | Status | Retention | Details |
|-----------|--------|-----------|---------|
| **File Upload** | ✅ | Permanent | Evidence, case-scoped |
| **Case Management** | ✅ | Permanent | CRUD with validation |
| **Finance Integration** | ✅ | Permanent | Plaid/Stripe/Direct |
| **GitHub Webhooks** | ✅ | 24hr (dedup) | 8+ event types |
| **Async Processing** | ✅ | N/A | Queue-based, idempotent |
| **Semantic Memory** | ✅ | 90 days | Vector search enabled |
| **Entity Tracking** | ✅ | Infinite | Cross-session |
| **Health Monitoring** | ✅ | In-memory | Real-time |
| **Task Orchestration** | ✅ | N/A | Parallel execution |
| **Third-Party APIs** | ✅ | N/A | 6 integrations |
| **Data Validation** | ✅ | 5min (cache) | 20+ types |
| **Data Sync** | ✅ | Permanent | Inc/full modes |

---

## 13. Example End-to-End Flow

**Scenario:** GitHub PR → Case Update

```
1. GitHub PR Created
   POST /integrations/github/webhook
   ├─ Signature verified (HMAC-SHA256)
   └─ Event: "pull_request"

2. Queue Message
   EVENT_Q.send({
     delivery: "abc-123",
     event: "pull_request",
     payload: {...}
   })

3. Queue Consumer
   ├─ Extract installation_id
   ├─ Lookup tenant_id (D1)
   ├─ Normalize to MCP schema
   └─ Execute 4 parallel automations

4. Automations
   ├─ createComplianceCheck()
   ├─ autoLabelPullRequest()
   ├─ summarizePullRequest()
   └─ requestReviewers()

5. Store Context
   MemoryCloude™.persistInteraction()
   ├─ Store in KV (90 days)
   ├─ Generate embedding
   ├─ Track entities
   └─ Update index

6. Monitor
   ContextConsciousness™
   ├─ Track latency
   ├─ Monitor health
   └─ Flag anomalies

7. Optional Link
   POST /api/chittycases/update
   ├─ Link PR to case
   └─ Sync data
```

---

## Conclusion

ChittyConnect implements a **comprehensive, multi-layered data ingestion system** that:

1. **Accepts diverse data** - Files, JSON, webhooks, third-party APIs
2. **Processes intelligently** - Normalization, semantic understanding, memory
3. **Stores strategically** - D1 (structure), KV (state), Vectorize (semantics)
4. **Routes efficiently** - Queue-based async, parallel execution
5. **Integrates deeply** - 11 ChittyOS services + 6 external platforms

Built on **Cloudflare Workers** for global edge deployment, native security, and unlimited scalability.

---

**itsChitty™** - *ContextConsciousness & MemoryCloude*
