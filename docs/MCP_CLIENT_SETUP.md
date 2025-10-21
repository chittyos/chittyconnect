# ChittyConnect MCP Client Setup

## Overview

ChittyConnect provides a comprehensive MCP server that can be used by Claude Desktop, Claude Code, or any MCP-compatible client. This guide shows how to configure different MCP clients to connect to ChittyConnect.

---

## Claude Desktop Configuration

### Location

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Configuration

```json
{
  "mcpServers": {
    "chittyconnect": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://connect.chitty.cc/mcp"
      ],
      "env": {
        "CHITTYCONNECT_API_KEY": "your-api-key-from-chittyauth"
      }
    }
  }
}
```

### Staging Environment

```json
{
  "mcpServers": {
    "chittyconnect-staging": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://chittyconnect-staging.ccorp.workers.dev/mcp"
      ],
      "env": {
        "CHITTYCONNECT_API_KEY": "staging-api-key"
      }
    }
  }
}
```

---

## Multiple MCP Servers

You can run ChittyConnect alongside other MCP servers:

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["mcp-remote", "https://docs.mcp.cloudflare.com/mcp"]
    },
    "chittyconnect": {
      "command": "npx",
      "args": ["mcp-remote", "https://connect.chitty.cc/mcp"],
      "env": {
        "CHITTYCONNECT_API_KEY": "your-api-key"
      }
    },
    "chittyconnect-external": {
      "command": "node",
      "args": [
        "/Users/nb/.claude/projects/-/CHITTYOS/chittyos-services/chittyconnect/chittyconnect.js"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_...",
        "SENDGRID_API_KEY": "SG...",
        "HUBSPOT_API_KEY": "pat-...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

---

## Available Tools

### ChittyConnect MCP Server (Cloudflare Workers)

**11 Tools**:

1. **chittyid_mint** - Mint ChittyID with context
2. **chitty_contextual_analyze** - ContextConsciousness™ analysis
3. **chitty_case_create** - Create legal cases
4. **chitty_chronicle_log** - Log events to timeline
5. **chitty_evidence_ingest** - Ingest evidence files
6. **chitty_sync_trigger** - Trigger data synchronization
7. **chitty_services_status** - Get all ChittyOS services status
8. **chitty_registry_discover** - Discover services in registry
9. **chitty_finance_connect_bank** - Connect banking accounts
10. **notion_query** - Query Notion databases
11. **openai_chat** - Access OpenAI models

**3 Resources**:

1. **chitty://services/status** - Real-time service health
2. **chitty://registry/services** - Complete service registry
3. **chitty://context/awareness** - ContextConsciousness™ state

### ChittyConnect External Services (Local MCP Server)

**Tools** (from `chittyos-services/chittyconnect`):

- **github_create_issue** - Create GitHub issues
- **github_list_repos** - List GitHub repositories
- **sendgrid_send_email** - Send emails via SendGrid
- **hubspot_create_contact** - Create HubSpot contacts
- **hubspot_search_contacts** - Search HubSpot
- **twilio_send_sms** - Send SMS messages
- **openai_chat_completion** - OpenAI chat
- **anthropic_message** - Anthropic Claude messages

---

## Testing Your Configuration

### 1. Verify Configuration

```bash
# Check if mcp-remote is installed
npx mcp-remote --version

# Test connection to ChittyConnect
curl https://connect.chitty.cc/mcp/manifest

# Expected response:
{
  "schema_version": "2024-11-05",
  "name": "chittyconnect",
  "version": "1.0.0",
  "description": "ChittyConnect MCP Server - ContextConsciousness™ AI spine for ChittyOS ecosystem",
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": true
  }
}
```

### 2. Restart Claude Desktop

After updating the configuration:
1. Quit Claude Desktop completely
2. Relaunch Claude Desktop
3. MCP servers will initialize on startup

### 3. Verify Tools Are Available

In Claude Desktop, you should see new tools available:
- ChittyID minting
- ChittyOS service integrations
- ContextConsciousness™ analysis
- GitHub operations (if using external services)

---

## Authentication

### Getting Your API Key

ChittyConnect uses **ChittyAuth** for API key management:

```bash
# Request API key from ChittyAuth
curl -X POST https://auth.chitty.cc/api/keys/provision \
  -H "Content-Type: application/json" \
  -H "X-ChittyID: YOUR_CHITTYID" \
  -d '{
    "service": "chittyconnect",
    "context": "claude-desktop",
    "scopes": ["read", "write"]
  }'

# Response:
{
  "keyId": "key_...",
  "apiKey": "cc_live_...",
  "scopes": ["read", "write"],
  "expiresAt": "2026-10-20T..."
}
```

Use the `apiKey` value in your MCP configuration:

```json
{
  "env": {
    "CHITTYCONNECT_API_KEY": "cc_live_..."
  }
}
```

---

## Advanced Configuration

### Custom MCP Endpoint

If you're running ChittyConnect locally:

```json
{
  "mcpServers": {
    "chittyconnect-dev": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/mcp"
      ],
      "env": {
        "CHITTYCONNECT_API_KEY": "dev-key"
      }
    }
  }
}
```

### Environment-Specific Configuration

```json
{
  "mcpServers": {
    "chittyconnect-prod": {
      "command": "npx",
      "args": ["mcp-remote", "https://connect.chitty.cc/mcp"],
      "env": {
        "CHITTYCONNECT_API_KEY": "prod_key_...",
        "ENVIRONMENT": "production"
      }
    },
    "chittyconnect-staging": {
      "command": "npx",
      "args": ["mcp-remote", "https://chittyconnect-staging.ccorp.workers.dev/mcp"],
      "env": {
        "CHITTYCONNECT_API_KEY": "staging_key_...",
        "ENVIRONMENT": "staging"
      }
    }
  }
}
```

---

## Troubleshooting

### "Failed to connect to MCP server"

**Check**:
1. MCP endpoint is reachable: `curl https://connect.chitty.cc/mcp/manifest`
2. API key is valid and not expired
3. `mcp-remote` is installed: `npx mcp-remote --version`

### "Tool not available"

**Check**:
1. Claude Desktop was restarted after config change
2. No JSON syntax errors in config file
3. MCP server shows in Claude Desktop logs

### "Authentication failed"

**Check**:
1. `CHITTYCONNECT_API_KEY` is set correctly
2. API key has required scopes
3. ChittyAuth service is healthy: `curl https://auth.chitty.cc/health`

---

## MCP Protocol Endpoints

ChittyConnect implements the full MCP specification (2024-11-05):

```
GET  /mcp/manifest           - Server manifest
GET  /mcp/tools/list         - List available tools
POST /mcp/tools/call         - Execute tool
GET  /mcp/resources/list     - List resources
GET  /mcp/resources/read     - Read resource content
GET  /mcp/prompts/list       - List prompts (future)
POST /mcp/prompts/get        - Get prompt (future)
POST /mcp/sampling/createMessage - LLM sampling (future)
```

---

## Integration Examples

### Example 1: Mint ChittyID from Claude Desktop

In Claude Desktop chat:

```
User: "Create a new ChittyID for a person named John Smith"

Claude: I'll mint a new ChittyID for John Smith using ChittyConnect.
[Uses chittyid_mint tool]

Result: CHITTY-PEO-00123-A5F7
```

### Example 2: Check ChittyOS Service Health

```
User: "What's the status of all ChittyOS services?"

Claude: Let me check the comprehensive status of all ChittyOS services.
[Uses chitty_services_status tool]

Result: All 11 services are healthy (100% uptime)
- id.chitty.cc: ✅ healthy
- auth.chitty.cc: ✅ healthy
- registry.chitty.cc: ✅ healthy
...
```

### Example 3: Create Legal Case

```
User: "Create a new eviction case for 123 Main St"

Claude: I'll create a new eviction case with ChittyCases.
[Uses chitty_case_create tool]

Result: Case created with ChittyID: CHITTY-CONTEXT-00456-B9E2
```

---

## Security Best Practices

1. **Store API Keys Securely**
   - Use environment variables
   - Never commit keys to version control
   - Rotate keys regularly

2. **Use Scoped Keys**
   - Request minimum required scopes
   - Use read-only keys when possible
   - Monitor key usage via ChittyChronicle

3. **Production vs Development**
   - Use separate keys for each environment
   - Test with staging first
   - Monitor production usage

---

## MCP Server Comparison

| Feature | ChittyConnect (Workers) | ChittyConnect (External) | Cloudflare MCP |
|---------|------------------------|-------------------------|----------------|
| **ChittyOS Integration** | ✅ Full | ❌ None | ❌ None |
| **ChittyID Minting** | ✅ Yes | ❌ No | ❌ No |
| **ContextConsciousness™** | ✅ Yes | ❌ No | ❌ No |
| **GitHub Integration** | ✅ App + API | ✅ API only | ❌ No |
| **Third-Party Services** | ✅ 5+ services | ✅ 5+ services | ✅ CF-specific |
| **Authentication** | ChittyAuth | Env vars | CF API token |
| **Deployment** | Cloudflare Workers | Local process | Remote |

---

## Support

- **Documentation**: https://docs.chitty.cc/chittyconnect/mcp
- **MCP Spec**: https://spec.modelcontextprotocol.io
- **Issues**: https://github.com/chittyos/chittyconnect/issues
- **ChittyAuth**: https://auth.chitty.cc

---

**Last Updated**: October 20, 2025
**ChittyConnect Version**: 1.0.0
**MCP Protocol**: 2024-11-05
