#!/usr/bin/env node

/**
 * ChittyConnect MCP Server
 *
 * Standalone Model Context Protocol server for Claude Desktop/Code integration.
 * Provides ContextConsciousness™ and MemoryCloude™ capabilities through
 * a comprehensive set of tools for the ChittyOS ecosystem.
 *
 * Usage:
 *   node mcp-server.js
 *
 * Environment Variables:
 *   CHITTYCONNECT_URL - ChittyConnect API URL (default: https://connect.chitty.cc)
 *   CHITTY_AUTH_TOKEN - Authentication token for ChittyConnect
 *   ENABLE_STREAMING - Enable SSE streaming (default: true)
 *   SESSION_PERSISTENCE - Enable session persistence (default: true)
 *   PLATFORM - Platform type: desktop, code, web (default: desktop)
 *   DEBUG - Enable debug logging (default: false)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fetch from 'node-fetch';

// Configuration from environment
const config = {
  chittyconnectUrl: process.env.CHITTYCONNECT_URL || 'https://connect.chitty.cc',
  authToken: process.env.CHITTY_AUTH_TOKEN,
  enableStreaming: process.env.ENABLE_STREAMING !== 'false',
  sessionPersistence: process.env.SESSION_PERSISTENCE !== 'false',
  platform: process.env.PLATFORM || 'desktop',
  debug: process.env.DEBUG === 'true'
};

// Validate configuration
if (!config.authToken) {
  console.error('[ChittyConnect MCP] Error: CHITTY_AUTH_TOKEN is required');
  console.error('Please set the CHITTY_AUTH_TOKEN environment variable');
  process.exit(1);
}

// Debug logging
function debug(...args) {
  if (config.debug) {
    console.error('[ChittyConnect MCP Debug]', ...args);
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'chittyconnect',
    version: '2.0.0',
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      sampling: {} // Enable for advanced features
    }
  },
  {
    onError: (error) => console.error('[ChittyConnect MCP Error]', error),
  }
);

// Session management
const sessions = new Map();
let currentSessionId = null;

function getOrCreateSession() {
  if (!currentSessionId) {
    currentSessionId = `mcp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    sessions.set(currentSessionId, {
      id: currentSessionId,
      created: Date.now(),
      toolHistory: [],
      context: {}
    });
  }
  return currentSessionId;
}

// Helper function to call ChittyConnect API
async function callChittyConnect(endpoint, method = 'GET', body = null) {
  const url = `${config.chittyconnectUrl}${endpoint}`;

  debug(`Calling ChittyConnect: ${method} ${url}`);

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${config.authToken}`,
      'Content-Type': 'application/json',
      'X-MCP-Platform': config.platform,
      'X-MCP-Session': getOrCreateSession()
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ChittyConnect API error (${response.status}): ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[ChittyConnect MCP] API call failed: ${error.message}`);
    throw error;
  }
}

// Tool registration
server.setRequestHandler('tools/list', async () => {
  debug('Listing tools');

  try {
    const response = await callChittyConnect('/mcp/tools/list');
    return response;
  } catch (error) {
    console.error('[ChittyConnect MCP] Failed to list tools:', error);
    return {
      tools: [
        {
          name: 'chittyconnect_status',
          description: 'Check ChittyConnect connection status',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    };
  }
});

// Tool execution
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  debug(`Executing tool: ${name}`);

  // Track tool usage in session
  const sessionId = getOrCreateSession();
  const session = sessions.get(sessionId);
  session.toolHistory.push({
    tool: name,
    timestamp: Date.now(),
    args: args
  });

  // Special handling for status check
  if (name === 'chittyconnect_status') {
    try {
      const health = await callChittyConnect('/health');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'connected',
            health: health,
            session: sessionId,
            platform: config.platform
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            error: error.message,
            session: sessionId,
            platform: config.platform
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Forward tool execution to ChittyConnect
  try {
    const response = await callChittyConnect('/mcp/tools/call', 'POST', {
      name,
      arguments: args,
      context: {
        sessionId,
        platform: config.platform,
        timestamp: Date.now()
      }
    });

    // Persist session if enabled
    if (config.sessionPersistence && session.toolHistory.length % 5 === 0) {
      await persistSession(session);
    }

    return response;
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing tool ${name}: ${error.message}`
      }],
      isError: true
    };
  }
});

// Resource listing
server.setRequestHandler('resources/list', async () => {
  debug('Listing resources');

  try {
    const response = await callChittyConnect('/mcp/resources/list');
    return response;
  } catch (error) {
    console.error('[ChittyConnect MCP] Failed to list resources:', error);
    return { resources: [] };
  }
});

// Resource reading
server.setRequestHandler('resources/read', async (request) => {
  const { uri } = request.params;

  debug(`Reading resource: ${uri}`);

  try {
    const response = await callChittyConnect(`/mcp/resources/read?uri=${encodeURIComponent(uri)}`);
    return response;
  } catch (error) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `Error reading resource: ${error.message}`
      }]
    };
  }
});

// Prompt listing
server.setRequestHandler('prompts/list', async () => {
  debug('Listing prompts');

  return {
    prompts: [
      {
        name: 'chitty_analyze',
        description: 'Analyze content with ContextConsciousness™',
        arguments: [
          {
            name: 'content',
            description: 'Content to analyze',
            required: true
          },
          {
            name: 'depth',
            description: 'Analysis depth (quick, standard, deep)',
            required: false
          }
        ]
      },
      {
        name: 'chitty_case_setup',
        description: 'Set up a complete legal case with all entities',
        arguments: [
          {
            name: 'case_type',
            description: 'Type of legal case',
            required: true
          },
          {
            name: 'parties',
            description: 'Parties involved in the case',
            required: true
          }
        ]
      },
      {
        name: 'chitty_credential_workflow',
        description: 'Secure credential provisioning workflow',
        arguments: [
          {
            name: 'service',
            description: 'Target service for credentials',
            required: true
          },
          {
            name: 'purpose',
            description: 'Purpose of credential usage',
            required: true
          }
        ]
      }
    ]
  };
});

// Prompt execution
server.setRequestHandler('prompts/get', async (request) => {
  const { name, arguments: args } = request.params;

  debug(`Getting prompt: ${name}`);

  const prompts = {
    chitty_analyze: {
      messages: [
        {
          role: 'system',
          content: `You are using ChittyConnect's ContextConsciousness™ to analyze content.
Use the chitty_intelligence_analyze tool to perform deep analysis with entity extraction,
sentiment analysis, and contextual understanding. The analysis should consider the
broader ChittyOS ecosystem context and any relevant session history.`
        },
        {
          role: 'user',
          content: `Please analyze the following content with ${args.depth || 'standard'} depth:

${args.content}

Use ContextConsciousness™ to provide insights about entities, relationships, sentiment,
and any legal or financial implications.`
        }
      ]
    },
    chitty_case_setup: {
      messages: [
        {
          role: 'system',
          content: `You are setting up a complete legal case in the ChittyOS ecosystem.
This involves creating ChittyIDs for all entities, establishing the case structure,
and preparing for evidence ingestion. Use the appropriate ChittyConnect tools in sequence.`
        },
        {
          role: 'user',
          content: `Please set up a ${args.case_type} case with the following parties:

${args.parties}

Steps to complete:
1. Mint ChittyIDs for all parties and entities
2. Create the case with chitty_case_create
3. Set up chronicle logging for audit trail
4. Prepare evidence ingestion structure
5. Provide a summary of the created case structure`
        }
      ]
    },
    chitty_credential_workflow: {
      messages: [
        {
          role: 'system',
          content: `You are managing secure credential provisioning through ChittyConnect's
1Password integration. Follow security best practices and validate all requests through
ContextConsciousness™ before retrieving or provisioning credentials.`
        },
        {
          role: 'user',
          content: `Please handle credential provisioning for:

Service: ${args.service}
Purpose: ${args.purpose}

Workflow:
1. Validate the request context using ContextConsciousness™
2. Check if credentials already exist using chitty_credential_audit
3. If needed, provision new credentials with appropriate scopes
4. Store audit trail in ChittyChronicle
5. Provide usage instructions for the credentials`
        }
      ]
    }
  };

  const prompt = prompts[name];
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  return prompt;
});

// Session persistence
async function persistSession(session) {
  if (!config.sessionPersistence) return;

  debug(`Persisting session: ${session.id}`);

  try {
    await callChittyConnect('/mcp/session/persist', 'POST', {
      sessionId: session.id,
      toolHistory: session.toolHistory,
      context: session.context,
      platform: config.platform
    });
  } catch (error) {
    console.error('[ChittyConnect MCP] Failed to persist session:', error);
  }
}

// Streaming support (if enabled)
if (config.enableStreaming) {
  server.setRequestHandler('streaming/start', async (request) => {
    const { sessionId } = request.params;

    debug(`Starting stream for session: ${sessionId}`);

    // This would establish SSE connection to ChittyConnect
    // Implementation depends on MCP SDK streaming support
    return {
      streamId: `stream-${sessionId}`,
      url: `${config.chittyconnectUrl}/mcp/stream/${sessionId}`
    };
  });
}

// Sampling support (for advanced features)
server.setRequestHandler('sampling/sample', async (request) => {
  const { messages, maxTokens = 1000 } = request.params;

  debug('Sampling request received');

  // Forward to ChittyConnect's AI endpoint
  try {
    const response = await callChittyConnect('/mcp/sampling/sample', 'POST', {
      messages,
      maxTokens,
      sessionId: getOrCreateSession()
    });

    return response;
  } catch (error) {
    throw new Error(`Sampling failed: ${error.message}`);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('[ChittyConnect MCP] Shutting down...');

  // Persist all active sessions
  for (const [sessionId, session] of sessions) {
    await persistSession(session);
  }

  process.exit(0);
});

// Start server
async function main() {
  console.error('[ChittyConnect MCP] Starting server...');
  console.error(`[ChittyConnect MCP] Platform: ${config.platform}`);
  console.error(`[ChittyConnect MCP] API URL: ${config.chittyconnectUrl}`);
  console.error(`[ChittyConnect MCP] Streaming: ${config.enableStreaming ? 'enabled' : 'disabled'}`);
  console.error(`[ChittyConnect MCP] Session Persistence: ${config.sessionPersistence ? 'enabled' : 'disabled'}`);

  // Test connection to ChittyConnect
  try {
    await callChittyConnect('/health');
    console.error('[ChittyConnect MCP] Successfully connected to ChittyConnect API');
  } catch (error) {
    console.error('[ChittyConnect MCP] Warning: Could not connect to ChittyConnect API');
    console.error('[ChittyConnect MCP] The server will start but may have limited functionality');
  }

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[ChittyConnect MCP] Server ready for connections');
}

// Run the server
main().catch((error) => {
  console.error('[ChittyConnect MCP] Fatal error:', error);
  process.exit(1);
});