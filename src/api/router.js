/**
 * ChittyConnect REST API Router
 *
 * 32+ Endpoints covering:
 * - ChittyOS Services (9 categories)
 * - Third-Party Integrations (5 services)
 */

import { mintChittyID, validateChittyID, logEvent, discoverServices } from '../integrations/chittyos-ecosystem.js';

/**
 * Route API request
 */
export async function routeAPI(request, env, pathname) {
  const url = new URL(request.url);

  // Health check
  if (pathname === '/api/health') {
    return new Response(JSON.stringify({
      status: 'healthy',
      service: 'chittyconnect-api',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ChittyID endpoints
  if (pathname.startsWith('/api/chittyid/')) {
    return handleChittyID(request, env, pathname);
  }

  // ChittyCases endpoints
  if (pathname.startsWith('/api/chittycases/')) {
    return handleChittyCases(request, env, pathname);
  }

  // ChittyFinance endpoints
  if (pathname.startsWith('/api/chittyfinance/')) {
    return handleChittyFinance(request, env, pathname);
  }

  // ChittyContextual endpoints
  if (pathname.startsWith('/api/chittycontextual/')) {
    return handleChittyContextual(request, env, pathname);
  }

  // ChittyChronicle endpoints
  if (pathname.startsWith('/api/chittychronicle/')) {
    return handleChittyChronicle(request, env, pathname);
  }

  // ChittySync endpoints
  if (pathname.startsWith('/api/chittysync/')) {
    return handleChittySync(request, env, pathname);
  }

  // ChittyEvidence endpoints
  if (pathname.startsWith('/api/chittyevidence/')) {
    return handleChittyEvidence(request, env, pathname);
  }

  // Registry endpoints
  if (pathname.startsWith('/api/registry/')) {
    return handleRegistry(request, env, pathname);
  }

  // Services status endpoints
  if (pathname.startsWith('/api/services/')) {
    return handleServices(request, env, pathname);
  }

  // Third-party integrations
  if (pathname.startsWith('/api/thirdparty/')) {
    return handleThirdParty(request, env, pathname);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// ChittyOS Service Handlers
// ============================================================================

/**
 * ChittyID API
 */
async function handleChittyID(request, env, pathname) {
  // POST /api/chittyid/mint
  if (pathname === '/api/chittyid/mint' && request.method === 'POST') {
    const body = await request.json();
    const chittyId = await mintChittyID(env, body.entityType, body.metadata || {});

    return new Response(JSON.stringify({
      success: true,
      chittyId,
      entityType: body.entityType
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/chittyid/validate/:id
  if (pathname.startsWith('/api/chittyid/validate/') && request.method === 'GET') {
    const chittyId = pathname.split('/').pop();
    const result = await validateChittyID(env, chittyId);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittyCases API
 */
async function handleChittyCases(request, env, pathname) {
  const token = env.CHITTY_CASES_TOKEN || '';

  // POST /api/chittycases/create
  if (pathname === '/api/chittycases/create' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://cases.chitty.cc/v1/cases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/chittycases/list
  if (pathname === '/api/chittycases/list' && request.method === 'GET') {
    const response = await fetch('https://cases.chitty.cc/v1/cases', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittyFinance API
 */
async function handleChittyFinance(request, env, pathname) {
  const token = env.CHITTY_FINANCE_TOKEN || '';

  // POST /api/chittyfinance/bank/connect
  if (pathname === '/api/chittyfinance/bank/connect' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://finance.chitty.cc/v1/bank/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/chittyfinance/accounts
  if (pathname === '/api/chittyfinance/accounts' && request.method === 'GET') {
    const response = await fetch('https://finance.chitty.cc/v1/accounts', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittyContextual API (ContextConsciousness™)
 */
async function handleChittyContextual(request, env, pathname) {
  const token = env.CHITTY_CONTEXTUAL_TOKEN || '';

  // POST /api/chittycontextual/analyze
  if (pathname === '/api/chittycontextual/analyze' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://contextual.chitty.cc/v1/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittyChronicle API
 */
async function handleChittyChronicle(request, env, pathname) {
  // POST /api/chittychronicle/log
  if (pathname === '/api/chittychronicle/log' && request.method === 'POST') {
    const body = await request.json();
    const result = await logEvent(env, body);

    return new Response(JSON.stringify({
      success: result.logged !== false,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // GET /api/chittychronicle/events
  if (pathname === '/api/chittychronicle/events' && request.method === 'GET') {
    const token = env.CHITTY_CHRONICLE_TOKEN || '';

    const response = await fetch('https://chronicle.chitty.cc/v1/events', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittySync API
 */
async function handleChittySync(request, env, pathname) {
  const token = env.CHITTY_SYNC_TOKEN || '';

  // POST /api/chittysync/trigger
  if (pathname === '/api/chittysync/trigger' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://sync.chitty.cc/v1/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ChittyEvidence API
 */
async function handleChittyEvidence(request, env, pathname) {
  const token = env.CHITTY_EVIDENCE_TOKEN || '';

  // POST /api/chittyevidence/ingest
  if (pathname === '/api/chittyevidence/ingest' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://evidence.chitty.cc/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Registry API
 */
async function handleRegistry(request, env, pathname) {
  // GET /api/registry/services
  if (pathname === '/api/registry/services' && request.method === 'GET') {
    const registry = await discoverServices(env);

    return new Response(JSON.stringify(registry), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Services Status API
 */
async function handleServices(request, env, pathname) {
  // GET /api/services/status
  if (pathname === '/api/services/status' && request.method === 'GET') {
    const services = ['id', 'auth', 'dna', 'verify', 'certify', 'chronicle', 'registry'];
    const statuses = {};

    for (const service of services) {
      try {
        const response = await fetch(`https://${service}.chitty.cc/health`, {
          method: 'GET'
        });

        statuses[service] = {
          status: response.ok ? 'healthy' : 'unhealthy',
          statusCode: response.status
        };
      } catch (error) {
        statuses[service] = {
          status: 'unreachable',
          error: error.message
        };
      }
    }

    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      services: statuses
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// Third-Party Integration Handlers
// ============================================================================

/**
 * Third-Party Integrations Router
 */
async function handleThirdParty(request, env, pathname) {
  if (pathname.startsWith('/api/thirdparty/notion/')) {
    return handleNotion(request, env, pathname);
  }

  if (pathname.startsWith('/api/thirdparty/neon/')) {
    return handleNeon(request, env, pathname);
  }

  if (pathname.startsWith('/api/thirdparty/openai/')) {
    return handleOpenAI(request, env, pathname);
  }

  if (pathname.startsWith('/api/thirdparty/google/')) {
    return handleGoogle(request, env, pathname);
  }

  if (pathname.startsWith('/api/thirdparty/cloudflare/')) {
    return handleCloudflare(request, env, pathname);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Notion Integration
 */
async function handleNotion(request, env, pathname) {
  const token = env.NOTION_TOKEN || '';

  // POST /api/thirdparty/notion/query
  if (pathname === '/api/thirdparty/notion/query' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch(`https://api.notion.com/v1/databases/${body.databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: body.filter || {}
      })
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Neon Database Integration
 */
async function handleNeon(request, env, pathname) {
  const apiKey = env.NEON_API_KEY || '';

  // POST /api/thirdparty/neon/query
  if (pathname === '/api/thirdparty/neon/query' && request.method === 'POST') {
    const body = await request.json();

    // Execute SQL query via Neon API
    const response = await fetch(`https://console.neon.tech/api/v2/projects/${body.projectId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: body.sql
      })
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * OpenAI Integration
 */
async function handleOpenAI(request, env, pathname) {
  const apiKey = env.OPENAI_API_KEY || '';

  // POST /api/thirdparty/openai/chat
  if (pathname === '/api/thirdparty/openai/chat' && request.method === 'POST') {
    const body = await request.json();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: body.model || 'gpt-4',
        messages: body.messages
      })
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Google Calendar Integration
 */
async function handleGoogle(request, env, pathname) {
  const token = env.GOOGLE_CALENDAR_TOKEN || '';

  // GET /api/thirdparty/google/calendar/events
  if (pathname === '/api/thirdparty/google/calendar/events' && request.method === 'GET') {
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Cloudflare AI Integration
 */
async function handleCloudflare(request, env, pathname) {
  // POST /api/thirdparty/cloudflare/ai/run
  if (pathname === '/api/thirdparty/cloudflare/ai/run' && request.method === 'POST') {
    const body = await request.json();

    const response = await env.AI.run(body.model, body.input);

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
