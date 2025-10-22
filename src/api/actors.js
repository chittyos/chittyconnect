/**
 * Actor Management API Handlers
 *
 * Handles actor registration, authentication, and capabilities management
 * Endpoints:
 * - POST /v1/actors/register - Register new actor
 * - GET /v1/actors/{chittyId} - Get actor details
 * - GET /v1/actors/me - Get authenticated actor
 * - PATCH /v1/actors/{chittyId} - Update actor
 * - GET /v1/actors/{chittyId}/capabilities - Get actor capabilities
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';

/**
 * Register a new actor
 */
export async function registerActor(request, env, ctx) {
  try {
    const body = await request.json();
    const { actor_type, display_name, email, capabilities } = body;

    // Validate input
    if (!actor_type || !['human', 'ai', 'service', 'system'].includes(actor_type)) {
      return new Response(JSON.stringify({
        error: 'Invalid actor_type. Must be: human, ai, service, or system'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate with ChittyAuth (must provide authorization)
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const validatedActor = await ecosystem.validateActor(authHeader);

    if (!validatedActor) {
      return new Response(JSON.stringify({ error: 'Invalid authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const chittyId = validatedActor.chittyId;

    // Check if actor already exists
    const existing = await env.DB.prepare(
      'SELECT * FROM actors WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (existing) {
      return new Response(JSON.stringify({
        error: 'Actor already registered',
        actor: existing
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Initialize ChittyDNA for actor
    const dnaResult = await ecosystem.initializeDNA(chittyId, 'actor', {
      actor_type,
      display_name,
      email,
      capabilities: capabilities || [],
    });

    // Insert actor into database
    await env.DB.prepare(`
      INSERT INTO actors (
        chitty_id,
        actor_type,
        display_name,
        email,
        capabilities,
        chitty_dna_id,
        chitty_auth_principal_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      chittyId,
      actor_type,
      display_name || null,
      email || null,
      JSON.stringify(capabilities || []),
      dnaResult.success ? dnaResult.dna_id : null,
      validatedActor.principalId || null,
      'active',
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    // Log to Chronicle
    await ecosystem.logEvent('actor.registered', chittyId, {
      actor_type,
      display_name,
      capabilities: capabilities || [],
    });

    // Fetch the created actor
    const actor = await env.DB.prepare(
      'SELECT * FROM actors WHERE chitty_id = ?'
    ).bind(chittyId).first();

    return new Response(JSON.stringify({
      success: true,
      actor: {
        ...actor,
        capabilities: JSON.parse(actor.capabilities),
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Actors] Registration error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get actor details by ChittyID
 */
export async function getActor(chittyId, request, env, ctx) {
  try {
    // Validate requesting actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const requestingActor = await ecosystem.validateActor(authHeader);

    if (!requestingActor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch actor
    const actor = await env.DB.prepare(
      "SELECT * FROM actors WHERE chitty_id = ? AND status != 'deleted'"
    ).bind(chittyId).first();

    if (!actor) {
      return new Response(JSON.stringify({
        error: 'Actor not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update last_seen for the requesting actor
    if (requestingActor.chittyId === chittyId) {
      await env.DB.prepare(
        'UPDATE actors SET last_seen_at = ?, session_count = session_count + 1 WHERE chitty_id = ?'
      ).bind(new Date().toISOString(), chittyId).run();
    }

    return new Response(JSON.stringify({
      actor: {
        ...actor,
        capabilities: JSON.parse(actor.capabilities),
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Actors] Get actor error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get authenticated actor (me)
 */
export async function getMe(request, env, ctx) {
  try {
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const actor = await ecosystem.validateActor(authHeader);

    if (!actor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch from database
    const dbActor = await env.DB.prepare(
      "SELECT * FROM actors WHERE chitty_id = ? AND status = 'active'"
    ).bind(actor.chittyId).first();

    if (!dbActor) {
      // Actor validated by ChittyAuth but not registered locally
      return new Response(JSON.stringify({
        actor: {
          chitty_id: actor.chittyId,
          registered: false,
          message: 'Actor validated but not registered. Call POST /v1/actors/register'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update last_seen
    await env.DB.prepare(
      'UPDATE actors SET last_seen_at = ?, session_count = session_count + 1 WHERE chitty_id = ?'
    ).bind(new Date().toISOString(), actor.chittyId).run();

    return new Response(JSON.stringify({
      actor: {
        ...dbActor,
        capabilities: JSON.parse(dbActor.capabilities),
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Actors] Get me error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Update actor
 */
export async function updateActor(chittyId, request, env, ctx) {
  try {
    const body = await request.json();
    const { display_name, email, avatar_url, capabilities, status } = body;

    // Validate requesting actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const requestingActor = await ecosystem.validateActor(authHeader);

    if (!requestingActor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Only allow updating own actor or if admin capability
    if (requestingActor.chittyId !== chittyId) {
      const actorData = await env.DB.prepare(
        'SELECT capabilities FROM actors WHERE chitty_id = ?'
      ).bind(requestingActor.chittyId).first();

      const caps = actorData ? JSON.parse(actorData.capabilities) : [];
      if (!caps.includes('admin')) {
        return new Response(JSON.stringify({
          error: 'Forbidden - can only update own actor'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (display_name !== undefined) {
      updates.push('display_name = ?');
      values.push(display_name);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
    }
    if (capabilities !== undefined) {
      updates.push('capabilities = ?');
      values.push(JSON.stringify(capabilities));
    }
    if (status !== undefined && ['active', 'suspended', 'deleted'].includes(status)) {
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
      `UPDATE actors SET ${updates.join(', ')} WHERE chitty_id = ?`
    ).bind(...values).run();

    // Track evolution in ChittyDNA
    await ecosystem.trackEvolution(chittyId, 'actor.updated', {
      updated_fields: Object.keys(body),
    });

    // Log to Chronicle
    await ecosystem.logEvent('actor.updated', chittyId, {
      updated_fields: Object.keys(body),
    });

    // Fetch updated actor
    const actor = await env.DB.prepare(
      'SELECT * FROM actors WHERE chitty_id = ?'
    ).bind(chittyId).first();

    return new Response(JSON.stringify({
      success: true,
      actor: {
        ...actor,
        capabilities: JSON.parse(actor.capabilities),
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Actors] Update error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get actor capabilities
 */
export async function getActorCapabilities(chittyId, request, env, ctx) {
  try {
    // Validate requesting actor
    const authHeader = request.headers.get('Authorization');
    const ecosystem = createEcosystem(env, ctx);
    const requestingActor = await ecosystem.validateActor(authHeader);

    if (!requestingActor) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch actor
    const actor = await env.DB.prepare(
      "SELECT capabilities, actor_type, status FROM actors WHERE chitty_id = ? AND status != 'deleted'"
    ).bind(chittyId).first();

    if (!actor) {
      return new Response(JSON.stringify({
        error: 'Actor not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const capabilities = JSON.parse(actor.capabilities);

    return new Response(JSON.stringify({
      chitty_id: chittyId,
      actor_type: actor.actor_type,
      status: actor.status,
      capabilities,
      capability_count: capabilities.length,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Actors] Get capabilities error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Route actor requests
 */
export async function handleActors(request, env, ctx, url) {
  const path = url.pathname.replace('/v1/actors', '');
  const method = request.method;

  // POST /v1/actors/register
  if (path === '/register' && method === 'POST') {
    return registerActor(request, env, ctx);
  }

  // GET /v1/actors/me
  if (path === '/me' && method === 'GET') {
    return getMe(request, env, ctx);
  }

  // GET /v1/actors/{chittyId}/capabilities
  if (path.match(/^\/[^/]+\/capabilities$/) && method === 'GET') {
    const chittyId = path.split('/')[1];
    return getActorCapabilities(chittyId, request, env, ctx);
  }

  // GET /v1/actors/{chittyId}
  if (path.match(/^\/[^/]+$/) && method === 'GET') {
    const chittyId = path.substring(1);
    return getActor(chittyId, request, env, ctx);
  }

  // PATCH /v1/actors/{chittyId}
  if (path.match(/^\/[^/]+$/) && method === 'PATCH') {
    const chittyId = path.substring(1);
    return updateActor(chittyId, request, env, ctx);
  }

  return new Response(JSON.stringify({
    error: 'Not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
