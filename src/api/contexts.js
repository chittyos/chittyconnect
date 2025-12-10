/**
 * Enhanced Context Management API Handlers
 *
 * Complete CRUD operations for contexts with ChittyOS integration
 * Endpoints:
 * - POST /v1/contexts/create - Create context (existing)
 * - GET /v1/contexts/list - List contexts (existing)
 * - GET /v1/contexts/{id} - Get context (existing)
 * - PATCH /v1/contexts/{id} - Update context (NEW)
 * - DELETE /v1/contexts/{id} - Delete context (NEW)
 * - GET /v1/contexts/search - Search contexts (NEW)
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';

/**
 * Create new context (enhanced version with D1)
 */
export async function createContext(request, env, ctx) {
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

    // Extract and validate actor authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Invalid authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if context name already exists
    const existing = await env.DB.prepare(
      "SELECT chitty_id FROM contexts WHERE name = ? AND status != 'deleted'"
    ).bind(name).first();

    if (existing) {
      return new Response(JSON.stringify({
        error: 'Context name already exists',
        existing_chitty_id: existing.chitty_id
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Mint ChittyID
    const mintResult = await ecosystem.mintChittyID('CONTEXT', {
      name,
      owner: actor.chittyId,
      data: data || [],
      systems: systems || [],
      tools: tools || []
    });

    if (!mintResult.success) {
      throw new Error('Failed to mint ChittyID');
    }

    const chittyId = mintResult.chittyId;

    // Initialize ChittyDNA
    const dnaResult = await ecosystem.initializeDNA(chittyId, 'context', {
      name,
      owner: actor.chittyId,
      capabilities: [...(systems || []), ...(tools || [])],
    });

    // Store context in D1
    await env.DB.prepare(`
      INSERT INTO contexts (
        chitty_id,
        name,
        owner_chitty_id,
        data,
        systems,
        tools,
        chitty_dna_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      chittyId,
      name,
      actor.chittyId,
      JSON.stringify(data || []),
      JSON.stringify(systems || []),
      JSON.stringify(tools || []),
      dnaResult.success ? dnaResult.dna_id : null,
      'active',
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

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
        owner: actor.chittyId,
        data: data || [],
        systems: systems || [],
        tools: tools || [],
        created: new Date().toISOString()
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] Create error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Update context
 */
export async function updateContext(chittyId, request, env, ctx) {
  try {
    const body = await request.json();
    const { name, data, systems, tools, status } = body;

    // Validate actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch context
    const context = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (!context) {
      return new Response(JSON.stringify({
        error: 'Context not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership
    if (context.owner_chitty_id !== actor.chittyId) {
      return new Response(JSON.stringify({
        error: 'Forbidden - not the owner'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (data !== undefined) {
      updates.push('data = ?');
      values.push(JSON.stringify(data));
    }
    if (systems !== undefined) {
      updates.push('systems = ?');
      values.push(JSON.stringify(systems));
    }
    if (tools !== undefined) {
      updates.push('tools = ?');
      values.push(JSON.stringify(tools));
    }
    if (status !== undefined && ['active', 'inactive', 'deleted'].includes(status)) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({
        error: 'No valid fields to update'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(chittyId);

    await env.DB.prepare(
      `UPDATE contexts SET ${updates.join(', ')} WHERE chitty_id = ?`
    ).bind(...values).run();

    // Track evolution in ChittyDNA
    await ecosystem.trackEvolution(chittyId, 'context.updated', {
      updated_fields: Object.keys(body),
    });

    // Send to queue
    await env.CONTEXT_OPS_QUEUE.send({
      operation: 'context_updated',
      contextId: chittyId,
      changes: Object.keys(body),
      timestamp: new Date().toISOString()
    });

    // Fetch updated context
    const updated = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(chittyId).first();

    return new Response(JSON.stringify({
      success: true,
      context: {
        ...updated,
        data: JSON.parse(updated.data),
        systems: JSON.parse(updated.systems),
        tools: JSON.parse(updated.tools),
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] Update error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Delete context (soft delete)
 */
export async function deleteContext(chittyId, request, env, ctx) {
  try {
    // Validate actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch context
    const context = await env.DB.prepare(
      "SELECT * FROM contexts WHERE chitty_id = ? AND status != 'deleted'"
    ).bind(chittyId).first();

    if (!context) {
      return new Response(JSON.stringify({
        error: 'Context not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership
    if (context.owner_chitty_id !== actor.chittyId) {
      return new Response(JSON.stringify({
        error: 'Forbidden - not the owner'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Soft delete
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE contexts
      SET status = 'deleted',
          deleted_at = ?,
          updated_at = ?
      WHERE chitty_id = ?
    `).bind(now, now, chittyId).run();

    // Track in ChittyDNA
    await ecosystem.trackEvolution(chittyId, 'context.deleted', {
      deleted_by: actor.chittyId,
    });

    // Send to queue
    await env.CONTEXT_OPS_QUEUE.send({
      operation: 'context_deleted',
      contextId: chittyId,
      timestamp: now
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Context deleted',
      chitty_id: chittyId,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] Delete error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Search contexts
 */
export async function searchContexts(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const owner = url.searchParams.get('owner');
    const status = url.searchParams.get('status') || 'active';

    // Validate actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build search query
    let sql = 'SELECT * FROM contexts WHERE 1=1';
    const params = [];

    if (query) {
      sql += ' AND (name LIKE ? OR data LIKE ? OR systems LIKE ? OR tools LIKE ?)';
      const likeQuery = `%${query}%`;
      params.push(likeQuery, likeQuery, likeQuery, likeQuery);
    }

    if (owner) {
      sql += ' AND owner_chitty_id = ?';
      params.push(owner);
    } else {
      // Default: only show contexts owned by requesting actor
      sql += ' AND owner_chitty_id = ?';
      params.push(actor.chittyId);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT 50';

    const stmt = env.DB.prepare(sql).bind(...params);
    const { results } = await stmt.all();

    return new Response(JSON.stringify({
      contexts: results.map(ctx => ({
        ...ctx,
        data: JSON.parse(ctx.data),
        systems: JSON.parse(ctx.systems),
        tools: JSON.parse(ctx.tools),
      })),
      count: results.length,
      query,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] Search error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * List contexts (enhanced with D1)
 */
export async function listContexts(request, env, ctx) {
  try {
    // Validate actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch contexts owned by actor
    const { results } = await env.DB.prepare(
      "SELECT * FROM contexts WHERE owner_chitty_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 100"
    ).bind(actor.chittyId).all();

    return new Response(JSON.stringify({
      contexts: results.map(ctx => ({
        ...ctx,
        data: JSON.parse(ctx.data),
        systems: JSON.parse(ctx.systems),
        tools: JSON.parse(ctx.tools),
      })),
      count: results.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] List error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get context by ID (enhanced with D1)
 */
export async function getContext(chittyId, request, env, ctx) {
  try {
    // Validate actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const context = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (!context) {
      return new Response(JSON.stringify({
        error: 'Context not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership
    if (context.owner_chitty_id !== actor.chittyId) {
      return new Response(JSON.stringify({
        error: 'Forbidden'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      ...context,
      data: JSON.parse(context.data),
      systems: JSON.parse(context.systems),
      tools: JSON.parse(context.tools),
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Contexts] Get error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Route context requests
 */
export async function handleContexts(request, env, ctx, url) {
  const path = url.pathname.replace('/v1/contexts', '');
  const method = request.method;

  // POST /v1/contexts/create
  if (path === '/create' && method === 'POST') {
    return createContext(request, env, ctx);
  }

  // GET /v1/contexts/list
  if (path === '/list' && method === 'GET') {
    return listContexts(request, env, ctx);
  }

  // GET /v1/contexts/search
  if (path === '/search' && method === 'GET') {
    return searchContexts(request, env, ctx);
  }

  // PATCH /v1/contexts/{id}
  if (path.match(/^\/[^/]+$/) && method === 'PATCH') {
    const chittyId = path.substring(1);
    return updateContext(chittyId, request, env, ctx);
  }

  // DELETE /v1/contexts/{id}
  if (path.match(/^\/[^/]+$/) && method === 'DELETE') {
    const chittyId = path.substring(1);
    return deleteContext(chittyId, request, env, ctx);
  }

  // GET /v1/contexts/{id}
  if (path.match(/^\/[^/]+$/) && method === 'GET') {
    const chittyId = path.substring(1);
    return getContext(chittyId, request, env, ctx);
  }

  return new Response(JSON.stringify({
    error: 'Not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
