/**
 * ChittyConnect - The Alchemist
 *
 * Universal adapter layer that transmutes connections into consciousness.
 * Provides keys, connectors, transport, and bindings for all ChittyOS services.
 *
 * Features:
 * - ChittyOS Ecosystem Integration
 * - GitHub App with webhook processing
 * - MCP Server (11 tools, 3 resources)
 * - REST API (32+ endpoints)
 * - ContextConsciousness™ tracking
 *
 * Version: 1.0.0
 */

import { initializeSchema, contextExists, createContext, getContextByName } from './database/schema.js';
import { initializeContext } from './integrations/chittyos-ecosystem.js';
import { handleWebhook } from './integrations/github/webhook.js';
import { handleOAuthCallback, renderInstallationSuccess } from './integrations/github/oauth.js';
import { handleQueueBatch } from './integrations/github/consumer.js';
import { routeAPI } from './api/router.js';
import { MCP_MANIFEST, MCP_TOOLS, MCP_RESOURCES, executeTool, getResource } from './mcp/server.js';

/**
 * Main Worker Fetch Handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Initialize database schema on first request
    await initializeDatabaseSchema(env);

    // Initialize ChittyConnect context (non-blocking)
    ctx.waitUntil(initializeChittyConnectContext(env));

    // Root health check
    if (pathname === '/' || pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'chittyconnect',
        brand: 'itsChitty™',
        tagline: 'The AI-intelligent spine with ContextConsciousness™',
        version: '1.0.0',
        environment: env.ENVIRONMENT || 'production',
        endpoints: {
          api: '/api/*',
          mcp: '/mcp/*',
          github: '/integrations/github/*',
          openapi: '/openapi.json'
        },
        timestamp: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-ChittyConnect-Version': '1.0.0'
        }
      });
    }

    // GitHub App webhook endpoint
    if (pathname === '/integrations/github/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // GitHub App OAuth callback
    if (pathname === '/integrations/github/callback' && request.method === 'GET') {
      return handleOAuthCallback(request, env);
    }

    // GitHub App installation success page
    if (pathname === '/github/installed' && request.method === 'GET') {
      return renderInstallationSuccess(request, env);
    }

    // MCP Server manifest
    if (pathname === '/mcp/manifest' && request.method === 'GET') {
      return new Response(JSON.stringify(MCP_MANIFEST), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MCP Server tools list
    if (pathname === '/mcp/tools/list' && request.method === 'GET') {
      return new Response(JSON.stringify({
        tools: MCP_TOOLS
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MCP Server tools call
    if (pathname === '/mcp/tools/call' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await executeTool(body.name, body.arguments || {}, env);

        return new Response(JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // MCP Server resources list
    if (pathname === '/mcp/resources/list' && request.method === 'GET') {
      return new Response(JSON.stringify({
        resources: MCP_RESOURCES
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MCP Server resources read
    if (pathname === '/mcp/resources/read' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await getResource(body.uri, env);

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // REST API router
    if (pathname.startsWith('/api/')) {
      return routeAPI(request, env, pathname);
    }

    // Legacy context endpoints (v1)
    if (pathname.startsWith('/v1/contexts')) {
      return handleContexts(request, env, url);
    }

    // OpenAPI specification
    if (pathname === '/openapi.json') {
      return new Response(JSON.stringify({
        openapi: '3.0.0',
        info: {
          title: 'ChittyConnect API',
          version: '1.0.0',
          description: 'ChittyConnect - The AI-intelligent spine with ContextConsciousness™'
        },
        servers: [
          { url: 'https://connect.chitty.cc', description: 'Production' },
          { url: 'https://chittyconnect-staging.ccorp.workers.dev', description: 'Staging' }
        ],
        paths: {
          '/health': {
            get: {
              summary: 'Health check',
              responses: {
                '200': { description: 'Service is healthy' }
              }
            }
          },
          '/api/health': {
            get: {
              summary: 'API health check',
              responses: {
                '200': { description: 'API is healthy' }
              }
            }
          },
          '/mcp/manifest': {
            get: {
              summary: 'MCP server manifest',
              responses: {
                '200': { description: 'MCP manifest' }
              }
            }
          }
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('ChittyConnect - The Alchemist', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  /**
   * Queue Consumer Handler
   * Processes GitHub webhook events asynchronously
   */
  async queue(batch, env) {
    return handleQueueBatch(batch, env);
  }
};

/**
 * Initialize database schema (blocking)
 */
async function initializeDatabaseSchema(env) {
  try {
    await initializeSchema(env.DB);
  } catch (error) {
    console.error('[ChittyConnect] Database initialization failed:', error.message);
    // Continue anyway - graceful degradation
  }
}

/**
 * Initialize ChittyConnect context (non-blocking)
 * Checks if context exists, creates if not
 */
async function initializeChittyConnectContext(env) {
  try {
    const contextName = 'chittyconnect';

    // Check if context already exists
    const exists = await contextExists(env.DB, contextName);

    if (exists) {
      console.log('[ChittyConnect] Context already initialized');
      const context = await getContextByName(env.DB, contextName);
      console.log(`[ChittyConnect] Using ChittyID: ${context.chitty_id}`);
      return context;
    }

    console.log('[ChittyConnect] Initializing new context...');

    // Initialize context with ChittyOS ecosystem
    const result = await initializeContext(env, contextName, {
      version: '1.0.0',
      capabilities: ['mcp', 'rest-api', 'github-app']
    });

    if (!result.success) {
      console.error('[ChittyConnect] Context initialization failed:', result.error);
      return null;
    }

    // Store in database
    await createContext(env.DB, {
      chittyId: result.chittyId,
      name: contextName,
      dnaRecord: result.dna,
      apiKeyId: result.apiKeys?.apiKey,
      verified: result.verified,
      certified: result.certified,
      metadata: {
        version: '1.0.0',
        capabilities: ['mcp', 'rest-api', 'github-app'],
        registered: result.registered
      }
    });

    console.log('[ChittyConnect] Context initialized successfully');
    console.log(`[ChittyConnect] ChittyID: ${result.chittyId}`);

    return result;

  } catch (error) {
    console.error('[ChittyConnect] Context initialization error:', error.message);
    // Non-blocking - continue anyway
    return null;
  }
}

/**
 * Legacy context management endpoints
 */
async function handleContexts(request, env, url) {
  const path = url.pathname.replace('/v1/contexts', '');

  if (path === '/create' && request.method === 'POST') {
    return createContextLegacy(request, env);
  }

  if (path === '/list' && request.method === 'GET') {
    return listContexts(request, env);
  }

  if (path.startsWith('/') && request.method === 'GET') {
    const contextId = path.slice(1);
    return getContext(contextId, env, request);
  }

  return new Response('Not found', { status: 404 });
}

/**
 * Create new context (legacy v1 endpoint)
 */
async function createContextLegacy(request, env) {
  try {
    const body = await request.json();
    const { name, data, systems, tools } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Name required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract actor authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate actor via ChittyAuth
    const authResponse = await fetch('https://auth.chitty.cc/v1/auth/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      }
    });

    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Invalid authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { actor } = await authResponse.json();

    // Initialize context with full ChittyOS ecosystem
    const result = await initializeContext(env, name, {
      ownerId: actor.chittyId,
      data: data || [],
      systems: systems || [],
      tools: tools || []
    });

    if (!result.success) {
      throw new Error(result.error || 'Context initialization failed');
    }

    // Store in database
    await createContext(env.DB, {
      chittyId: result.chittyId,
      name,
      ownerId: actor.chittyId,
      dnaRecord: result.dna,
      apiKeyId: result.apiKeys?.apiKey,
      verified: result.verified,
      certified: result.certified,
      metadata: {
        data: data || [],
        systems: systems || [],
        tools: tools || []
      }
    });

    return new Response(JSON.stringify({
      success: true,
      context: {
        chittyId: result.chittyId,
        name,
        owner: actor.chittyId,
        created: new Date().toISOString()
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * List all contexts
 */
async function listContexts(request, env) {
  try {
    const contexts = [];
    const results = await env.DB.prepare('SELECT * FROM contexts ORDER BY created_at DESC').all();

    for (const row of results.results || []) {
      contexts.push({
        chittyId: row.chitty_id,
        name: row.name,
        ownerId: row.owner_id,
        verified: row.verified === 1,
        certified: row.certified === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }

    return new Response(JSON.stringify({
      contexts,
      count: contexts.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get context by ID
 */
async function getContext(contextId, env, request) {
  try {
    const context = await getContextByName(env.DB, contextId);

    if (!context) {
      return new Response(JSON.stringify({
        error: 'Context not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      chittyId: context.chitty_id,
      name: context.name,
      ownerId: context.owner_id,
      verified: context.verified === 1,
      certified: context.certified === 1,
      metadata: context.metadata,
      createdAt: context.created_at,
      updatedAt: context.updated_at
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
