# ChittyEvidence AI Search

Semantic search over the legal evidence corpus using Cloudflare AI Search (AutoRAG). Indexes all documents in the `legal-evidence-signed` R2 bucket and provides both RAG-powered answers and vector retrieval.

## Architecture

```
Claude Code / Desktop / Cowork
  |
  +-- MCP Gateway (mcp.chitty.cc) -----> Cloudflare AI Search REST API
  |     chitty_evidence_search              POST /ai-search/{instance}/search
  |     chitty_evidence_retrieve            POST /ai-search/{instance}/search
  |
  +-- AutoRAG MCP Server (direct) -----> autorag.mcp.cloudflare.com/mcp
  |     ai_search, search, list_rags        OAuth-authenticated
  |
  +-- Worker REST API -----------------> evidence.chitty.cc
        /search/ai                          RAG (AI-generated answer + sources)
        /search/ai/retrieve                 Retrieval only (ranked chunks)
```

## Configuration

| Setting | Value |
|---------|-------|
| AI Search Instance | `chittyevidence-search` |
| R2 Bucket | `legal-evidence-signed` |
| Account ID | `0bc21e3a5a9de1a4cc843be9c3e98121` |
| Worker | `evidence.chitty.cc` |

### Secrets

Set via `wrangler secret put`:

| Secret | Purpose |
|--------|---------|
| `AI_SEARCH_TOKEN` | Cloudflare API token with AI Search Read/Write/Run + R2 Write |

## MCP Tools

### Via ChittyConnect Gateway (`mcp.chitty.cc`)

These tools are available to all MCP clients connected to the consolidated gateway.

#### `chitty_evidence_search`

AI-powered semantic search with RAG. Returns an AI-generated answer grounded in matched document chunks.

```json
{
  "name": "chitty_evidence_search",
  "arguments": {
    "query": "closing disclosure for 550 W Surf",
    "max_results": 5
  }
}
```

**Response**: AI-generated answer + ranked source documents with relevance scores.

#### `chitty_evidence_retrieve`

Vector retrieval without AI generation. Returns raw document chunks ranked by semantic similarity.

```json
{
  "name": "chitty_evidence_retrieve",
  "arguments": {
    "query": "ALTA settlement statement",
    "max_results": 10
  }
}
```

**Response**: Ranked document chunks with scores (threshold: 0.4).

### Via AutoRAG MCP Server (direct)

Available in Claude Code and Claude Desktop via `mcp-remote`.

| Tool | Description |
|------|-------------|
| `list_rags` | List AI Search instances |
| `search` | Semantic document search (retrieval only) |
| `ai_search` | RAG-powered search with AI-generated answers |

## Client Configuration

### Claude Code (`~/.claude/.mcp.json`)

```json
{
  "chittyevidence-search": {
    "type": "stdio",
    "command": "npx",
    "args": ["mcp-remote", "https://autorag.mcp.cloudflare.com/mcp"],
    "description": "ChittyEvidence AI Search - semantic search over legal-evidence-signed R2 bucket"
  }
}
```

Requires Cloudflare OAuth on first connection (opens browser).

### Claude Desktop / Cowork (`claude_desktop_config.json`)

```json
{
  "chittyevidence-search": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://autorag.mcp.cloudflare.com/mcp"]
  }
}
```

**Note**: Run `npx -y mcp-remote https://autorag.mcp.cloudflare.com/mcp` in a terminal first to complete the OAuth flow. The token is cached for subsequent launches.

### Via ChittyConnect Gateway (no extra config)

If you already have `chittyconnect` or `chittymcp` configured, the `chitty_evidence_search` and `chitty_evidence_retrieve` tools are available automatically through the consolidated MCP gateway at `mcp.chitty.cc`.

## REST API

### RAG Search

```bash
curl -X POST https://evidence.chitty.cc/search/ai \
  -H 'Content-Type: application/json' \
  -d '{"query": "closing disclosure SoFi mortgage"}'
```

### Retrieval Only

```bash
curl -X POST https://evidence.chitty.cc/search/ai/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"query": "wire transfer receipt USAA", "max_results": 10}'
```

## Indexing

Documents are indexed automatically from the `legal-evidence-signed` R2 bucket by Cloudflare AI Search.

### Supported Formats

Text-extractable documents: PDF, DOCX, TXT, HTML, CSV, JSON, XML, RTF, and others with text content.

### Known Limitations

- **Oversized files** (>50): Files exceeding AI Search size limits are skipped
- **Image-only files** (~69): Scanned PDFs, photos, and other image formats without embedded text cannot be indexed. These require OCR preprocessing before indexing.
- **Indexing lag**: Newly uploaded documents may take a few minutes to appear in search results

### Monitoring

Check indexing status via the Cloudflare dashboard:
- AI Search > `chittyevidence-search` > Indexing Status

Or via MCP:
```
list_rags  →  shows instance status and document count
```

## Relevance Scoring

Results are ranked by semantic similarity score (0.0 - 1.0). The default threshold is **0.4** — documents scoring below this are excluded from results.

For high-precision queries (specific document titles, exhibit numbers), scores typically range 0.7-0.95. For broader topical queries, expect 0.4-0.7.
