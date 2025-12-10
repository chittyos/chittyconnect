# ChittyConnect MCP Quick Reference

**Version:** 2.0.0
**Protocol:** Model Context Protocol (MCP) 2024-11-05
**Platform:** Claude Desktop, Claude Code, claude.ai (future)

## Quick Setup

### One-Line Install (Recommended)

```bash
cd /path/to/chittyconnect && ./scripts/setup-mcp.sh desktop
```

### Manual Setup

1. **Install dependencies:**
   ```bash
   npm install @modelcontextprotocol/sdk
   ```

2. **Configure Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
   ```json
   {
     "mcpServers": {
       "chittyconnect": {
         "command": "node",
         "args": ["/absolute/path/to/chittyconnect/mcp-server.js"],
         "env": {
           "CHITTYCONNECT_URL": "https://connect.chitty.cc",
           "CHITTY_AUTH_TOKEN": "your_token_here"
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop**

## Available Tools

### Identity & Authentication

#### `chittyid_mint`
Create a new ChittyID with context awareness.

```javascript
{
  "entity": "PEO",  // PEO, PLACE, PROP, EVNT, AUTH, INFO, FACT, CONTEXT, ACTOR
  "metadata": {
    "name": "John Doe",
    "description": "Plaintiff in case #123"
  }
}
```

### Intelligence & Analysis

#### `chitty_contextual_analyze`
Deep contextual analysis with ContextConsciousness™.

```javascript
{
  "text": "Contract text to analyze...",
  "analysisType": "comprehensive",  // sentiment, entities, legal, financial, comprehensive
  "context": {}
}
```

#### `consciousness_get_awareness`
Get real-time ecosystem awareness across all ChittyOS services.

```javascript
{}  // No parameters required
```

#### `consciousness_capture_snapshot`
Capture comprehensive ecosystem snapshot with anomaly detection.

```javascript
{}  // No parameters required
```

### Memory & Learning

#### `memory_persist_interaction`
Persist conversation to MemoryCloude™ with 90-day retention.

```javascript
{
  "sessionId": "session-123",
  "interaction": {
    "userId": "user-456",
    "type": "conversation",
    "content": "User query and response...",
    "entities": ["entity1", "entity2"],
    "actions": ["create_case", "mint_id"],
    "decisions": ["approved_case_creation"]
  }
}
```

#### `memory_recall_context`
Semantic search through session history.

```javascript
{
  "sessionId": "session-123",
  "query": "previous case creation",
  "limit": 5
}
```

#### `memory_get_session_summary`
Get AI-generated session summary.

```javascript
{
  "sessionId": "session-123"
}
```

### Legal Case Management

#### `chitty_case_create`
Create a legal case with full integration.

```javascript
{
  "title": "Eviction Case - 123 Main St",
  "description": "Tenant eviction for non-payment",
  "caseType": "eviction",  // eviction, litigation, resolution, general
  "metadata": {
    "property_address": "123 Main St",
    "tenant_id": "chitty-id-here"
  }
}
```

#### `chitty_evidence_ingest`
Ingest evidence with automated analysis.

```javascript
{
  "fileUrl": "https://example.com/document.pdf",
  "caseId": "case-chitty-id",
  "evidenceType": "lease_agreement"
}
```

### Service Operations

#### `chitty_services_status`
Check health of all ChittyOS services.

```javascript
{
  "detailed": false
}
```

#### `chitty_registry_discover`
Discover services with intelligent routing.

```javascript
{
  "serviceType": "identity",
  "capabilities": ["minting", "validation"]
}
```

#### `chitty_sync_trigger`
Trigger data synchronization across services.

```javascript
{
  "source": "chittyid",
  "target": "chittyauth",
  "mode": "incremental"  // incremental, full
}
```

#### `chitty_chronicle_log`
Log events to ChittyChronicle for audit trail.

```javascript
{
  "eventType": "case.created",
  "entityId": "case-chitty-id",
  "data": {
    "title": "Case Title",
    "created_by": "user-id"
  }
}
```

### Cognitive Coordination

#### `coordination_execute_task`
Execute complex tasks with intelligent decomposition.

```javascript
{
  "task": {
    "description": "Set up complete legal case with evidence",
    "type": "case_setup",
    "metadata": {}
  },
  "sessionId": "session-123"
}
```

#### `coordination_analyze_task`
Analyze task complexity without executing.

```javascript
{
  "task": {
    "description": "Analyze and process 50 documents",
    "type": "document_processing"
  }
}
```

### Credential Management (1Password Integration)

#### `chitty_credential_retrieve`
Securely retrieve credentials with context validation.

```javascript
{
  "credential_type": "service_token",  // service_token, api_key, database_connection, deployment_token, webhook_secret
  "target": "chittyid",
  "purpose": "inter-service-call",  // inter-service-call, api-call, deployment, configuration, webhook-validation, database-query
  "environment": "production",  // production, staging, development
  "session_context": {
    "session_id": "session-123",
    "user_id": "user-456"
  }
}
```

#### `chitty_credential_provision`
Provision new scoped credentials.

```javascript
{
  "credential_type": "cloudflare_workers_deploy",
  "context": {
    "service": "chittyconnect",
    "purpose": "deployment",
    "environment": "production",
    "scopes": ["workers:write", "kv:write"]
  },
  "ttl_hours": 24
}
```

#### `chitty_credential_validate`
Validate credential status and permissions.

```javascript
{
  "credential_type": "service_token",
  "token_id": "token-abc123",
  "check_permissions": true
}
```

#### `chitty_credential_revoke`
Revoke previously provisioned credential.

```javascript
{
  "token_id": "token-abc123",
  "reason": "rotation",  // no_longer_needed, security_incident, rotation, service_decommission, manual_request
  "revoke_related": false
}
```

#### `chitty_credential_audit`
Query credential provisioning audit log.

```javascript
{
  "filter": {
    "service": "chittyconnect",
    "credential_type": "service_token",
    "time_range": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-12-31T23:59:59Z"
    },
    "include_revoked": false
  },
  "limit": 50
}
```

#### `chitty_credential_health`
Check credential system health.

```javascript
{
  "detailed": false
}
```

### Third-Party Integrations

#### `notion_query`
Query Notion databases via ChittyConnect proxy.

```javascript
{
  "databaseId": "notion-db-id",
  "filter": {
    "property": "Status",
    "select": {
      "equals": "Active"
    }
  }
}
```

#### `openai_chat`
Access OpenAI models through ChittyConnect.

```javascript
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Analyze this contract..." }
  ],
  "model": "gpt-4"
}
```

## Resources

Resources provide read-only access to ecosystem state.

### Available Resources

- `chitty://services/status` - Real-time service health
- `chitty://registry/services` - Complete service registry
- `chitty://context/awareness` - ContextConsciousness™ state

### Reading Resources

In Claude Desktop/Code, resources are automatically available. To read:

```javascript
// In conversation with Claude:
"Can you check the current status of ChittyOS services?"
// Claude will automatically read chitty://services/status
```

## Prompts

Pre-defined prompt templates for common workflows.

### `chitty_analyze`
Deep content analysis workflow.

**Arguments:**
- `content` (required): Content to analyze
- `depth` (optional): quick, standard, deep

**Example:**
```
Use the chitty_analyze prompt with this contract: [contract text]
```

### `chitty_case_setup`
Complete legal case setup workflow.

**Arguments:**
- `case_type` (required): Type of legal case
- `parties` (required): Parties involved

**Example:**
```
Use chitty_case_setup for an eviction case with plaintiff John Doe and tenant Jane Smith
```

### `chitty_credential_workflow`
Secure credential provisioning workflow.

**Arguments:**
- `service` (required): Target service
- `purpose` (required): Credential purpose

**Example:**
```
Use chitty_credential_workflow to get deployment credentials for chittyconnect
```

## Session Management

ChittyConnect automatically manages sessions with:
- **Persistent State**: Context preserved across tool calls
- **Automatic Saving**: Sessions saved every 5 tool executions
- **Memory Integration**: Auto-persist to MemoryCloude™ every 10 interactions
- **Context Propagation**: Previous tool outputs available to subsequent tools

### Session Context

Every tool call includes:
```javascript
{
  "sessionId": "auto-generated",
  "toolHistory": [...],  // Previous 5 tools
  "entities": [...],     // Extracted entities
  "variables": {...},    // Session variables
  "previousOutputs": [...] // Last 3 tool outputs
}
```

## Streaming Updates (SSE)

Enable real-time updates via Server-Sent Events:

```bash
ENABLE_STREAMING=true node mcp-server.js
```

**Event Types:**
- `connected` - Initial connection
- `heartbeat` - Connection keepalive (every 30s)
- `consciousness_update` - Ecosystem anomalies/predictions
- `ecosystem_health` - Overall health (every 5 min)
- `tool_progress` - Tool execution progress
- `tool_complete` - Tool completion
- `memory_persist` - Memory saved to MemoryCloude™

## Configuration Options

### Environment Variables

```bash
# Required
CHITTYCONNECT_URL=https://connect.chitty.cc
CHITTY_AUTH_TOKEN=your_token_here

# Optional
ENABLE_STREAMING=true              # Enable SSE streaming
SESSION_PERSISTENCE=true           # Save sessions to MemoryCloude™
PLATFORM=desktop                   # desktop, code, web
DEBUG=false                        # Enable debug logging
```

### Advanced Configuration

**Session Auto-Save Interval:**
```javascript
{
  "settings": {
    "autoSave": true,
    "saveInterval": 10  // Save every 10 interactions
  }
}
```

**Streaming Filters:**
```javascript
{
  "filters": ["consciousness_update", "tool_complete"]  // Only these event types
}
```

## Troubleshooting

### Connection Issues

```bash
# Test connection manually
curl -H "Authorization: Bearer $CHITTY_AUTH_TOKEN" \
  https://connect.chitty.cc/health
```

### Debug Mode

```bash
DEBUG=true node mcp-server.js
```

### Tool Execution Errors

Common issues:
1. **Authentication Failed**: Check `CHITTY_AUTH_TOKEN`
2. **Timeout**: Tool took > 30s (normal for complex operations)
3. **Rate Limit**: Too many requests, wait 60s
4. **Service Down**: Check `chitty_services_status` tool

### Session Not Persisting

Check:
1. `SESSION_PERSISTENCE=true` is set
2. `MEMORY_KV` namespace configured in wrangler.toml
3. MemoryCloude™ service is healthy

## Performance Tips

### Batching Tools

Use `coordination_execute_task` for multiple related operations:

```javascript
{
  "task": {
    "description": "Create case, mint IDs for all parties, ingest evidence",
    "type": "workflow"
  }
}
```

### Caching

ChittyConnect automatically caches:
- Service registry (1 hour)
- Credentials (5 minutes)
- Session context (in-memory)

### Parallel Execution

Multiple independent tools execute in parallel automatically.

## Best Practices

### 1. Use ContextConsciousness™

Always check ecosystem health before bulk operations:
```javascript
// Check health first
consciousness_get_awareness()

// Then proceed with operations if healthy
```

### 2. Leverage Memory

Persist important interactions for future recall:
```javascript
memory_persist_interaction({
  sessionId: "current-session",
  interaction: {
    type: "case_decision",
    content: "Approved case creation for eviction",
    decisions: ["approved"]
  }
})
```

### 3. Monitor Credentials

Regularly audit credential usage:
```javascript
chitty_credential_audit({
  filter: {
    service: "chittyconnect",
    time_range: { start: "2024-01-01T00:00:00Z" }
  }
})
```

### 4. Use Streaming for Long Operations

Enable streaming to get real-time progress updates:
```bash
ENABLE_STREAMING=true
```

## Integration Examples

### Complete Case Creation Workflow

```javascript
// 1. Mint ChittyIDs for all entities
const plaintiffId = await chittyid_mint({ entity: "PEO", metadata: { name: "John Doe" } });
const propertyId = await chittyid_mint({ entity: "PROP", metadata: { address: "123 Main St" } });

// 2. Create case
const case = await chitty_case_create({
  title: "Eviction - 123 Main St",
  caseType: "eviction",
  metadata: {
    plaintiff_id: plaintiffId,
    property_id: propertyId
  }
});

// 3. Ingest evidence
await chitty_evidence_ingest({
  fileUrl: "https://example.com/lease.pdf",
  caseId: case.id,
  evidenceType: "lease_agreement"
});

// 4. Log to chronicle
await chitty_chronicle_log({
  eventType: "case.created",
  entityId: case.id,
  data: { title: case.title }
});

// 5. Persist to memory
await memory_persist_interaction({
  sessionId: "current",
  interaction: {
    type: "case_creation",
    entities: [plaintiffId, propertyId, case.id],
    decisions: ["created_eviction_case"]
  }
});
```

### Credential Provisioning Workflow

```javascript
// 1. Check system health
const health = await chitty_credential_health({ detailed: true });

// 2. Provision deployment credential
const cred = await chitty_credential_provision({
  credential_type: "cloudflare_workers_deploy",
  context: {
    service: "chittyconnect",
    purpose: "deployment",
    environment: "production",
    scopes: ["workers:write"]
  },
  ttl_hours: 24
});

// 3. Use credential (shown in response)
// ... deploy operation ...

// 4. Revoke after use
await chitty_credential_revoke({
  token_id: cred.credential.token_id,
  reason: "rotation"
});
```

## Support & Documentation

- **Full Architecture Review**: `MCP_ARCHITECTURE_REVIEW.md`
- **Project Documentation**: `CLAUDE.md`
- **Quick Start Guide**: `QUICK_START.md`
- **ChittyOS Docs**: https://chitty.cc/docs
- **MCP Specification**: https://modelcontextprotocol.io/

## Changelog

### Version 2.0.0 (Current)
- Enhanced MCP server with session management
- Durable Objects for persistent state
- Streaming support via SSE
- 1Password credential integration
- Tool composition and chaining
- Advanced error handling with recovery
- Multi-platform support (Desktop, Code)

### Version 1.0.0
- Initial MCP server implementation
- Basic tool support
- REST API integration

---

**Need Help?**
Create an issue at https://github.com/chittyos/chittyconnect/issues