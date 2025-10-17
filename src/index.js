/**
 * ChittyConnect - The Alchemist
 *
 * Universal adapter layer that transmutes connections into consciousness.
 * Provides keys, connectors, transport, and bindings for all ChittyOS services.
 *
 * Not an orchestrator. A facilitator. The connective tissue.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        service: 'chittyconnect',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Context operations
    if (url.pathname.startsWith('/v1/contexts')) {
      return handleContexts(request, env, url);
    }

    // Actor operations
    if (url.pathname.startsWith('/v1/actors')) {
      return handleActors(request, env, url);
    }

    // Connection operations
    if (url.pathname.startsWith('/v1/connections')) {
      return handleConnections(request, env, url);
    }

    // Service delegation
    if (url.pathname.startsWith('/v1/delegate')) {
      return handleDelegation(request, env, url);
    }

    return new Response('ChittyConnect - The Alchemist', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

/**
 * Context management - Create, read, update contexts
 */
async function handleContexts(request, env, url) {
  const path = url.pathname.replace('/v1/contexts', '');

  if (path === '/create' && request.method === 'POST') {
    return createContext(request, env);
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
 * Create new context - Validates actor via ChittyAuth, mints ChittyID
 */
async function createContext(request, env) {
  try {
    const body = await request.json();
    const { name, data, systems, tools } = body;

    // Validate input
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

    // Validate actor via ChittyAuth (fixed endpoint)
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

    // Mint ChittyID from id.chitty.cc
    const mintResponse = await fetch('https://id.chitty.cc/v1/mint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.CHITTY_ID_SERVICE_TOKEN}`
      },
      body: JSON.stringify({
        type: 'CONTEXT',
        metadata: {
          name,
          owner: actor.chittyId,
          data: data || [],
          systems: systems || [],
          tools: tools || []
        }
      })
    });

    if (!mintResponse.ok) {
      throw new Error('Failed to mint ChittyID');
    }

    const { chittyId } = await mintResponse.json();

    // Create context record (authority managed separately via ChittyAuth)
    const context = {
      chittyId,
      name,
      owner: actor.chittyId,
      data: data || [],
      systems: systems || [],
      tools: tools || [],
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    // Store in KV
    await env.CHITTYCONNECT_KV.put(
      `context:${chittyId}`,
      JSON.stringify(context)
    );

    // Store by name for easy lookup
    await env.CHITTYCONNECT_KV.put(
      `context:name:${name}`,
      chittyId
    );

    // Send to context ops queue for async processing
    await env.CONTEXT_OPS_QUEUE.send({
      operation: 'context_created',
      contextId: chittyId,
      owner: actor.chittyId,
      timestamp: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      context: {
        chittyId,
        name,
        owner: context.owner,
        created: context.created
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
 * List all contexts - Zero trust: validates actor owns contexts
 */
async function listContexts(request, env) {
  try {
    // Zero trust: Validate actor
    const actor = await validateActor(request, env);
    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contexts = [];
    const list = await env.CHITTYCONNECT_KV.list({ prefix: 'context:name:' });

    for (const key of list.keys) {
      const chittyId = await env.CHITTYCONNECT_KV.get(key.name);
      const contextData = await env.CHITTYCONNECT_KV.get(`context:${chittyId}`);
      if (contextData) {
        const context = JSON.parse(contextData);
        // Zero trust: Only return contexts owned by actor
        if (context.owner === actor.chittyId) {
          contexts.push(context);
        }
      }
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
 * Get context by ID - Zero trust: validates actor owns context
 */
async function getContext(contextId, env, request) {
  try {
    // Zero trust: Validate actor
    const actor = await validateActor(request, env);
    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contextData = await env.CHITTYCONNECT_KV.get(`context:${contextId}`);

    if (!contextData) {
      return new Response(JSON.stringify({
        error: 'Context not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const context = JSON.parse(contextData);

    // Zero trust: Verify actor owns this context
    if (context.owner !== actor.chittyId) {
      return new Response(JSON.stringify({
        error: 'Forbidden'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(contextData, {
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
 * Zero trust actor validation - validates every request via ChittyAuth
 */
async function validateActor(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }

  try {
    const authResponse = await fetch('https://auth.chitty.cc/v1/auth/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      }
    });

    if (!authResponse.ok) {
      return null;
    }

    const { actor } = await authResponse.json();
    return actor;
  } catch (error) {
    return null;
  }
}

/**
 * Actor management - Authenticate actors (human/AI/code)
 */
async function handleActors(request, env, url) {
  // TODO: Implement actor authentication
  return new Response(JSON.stringify({
    message: 'Actor management coming soon'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Connection management - Manage active connections
 */
async function handleConnections(request, env, url) {
  // TODO: Implement connection lifecycle
  return new Response(JSON.stringify({
    message: 'Connection management coming soon'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Service delegation - Provide delegated access to services
 */
async function handleDelegation(request, env, url) {
  // TODO: Implement service delegation
  return new Response(JSON.stringify({
    message: 'Service delegation coming soon'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
