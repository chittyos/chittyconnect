/**
 * Connection Lifecycle API Handlers
 *
 * Manages connections between contexts/actors and ChittyOS services
 * Endpoints:
 * - POST /v1/connections - Create connection
 * - GET /v1/connections/list - List connections
 * - GET /v1/connections/{id} - Get connection details
 * - DELETE /v1/connections/{id} - Disconnect
 * - GET /v1/connections/{id}/status - Connection health status
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';

/**
 * Generate connection ID
 */
function generateConnectionId() {
  return `conn-${crypto.randomUUID()}`;
}

/**
 * Create a new connection
 */
export async function createConnection(request, env, ctx) {
  try {
    const body = await request.json();
    const {
      source_chitty_id,
      source_type,
      target_service,
      target_endpoint,
      connection_type,
      config
    } = body;

    // Validate input
    if (!source_chitty_id || !target_service) {
      return new Response(JSON.stringify({
        error: 'source_chitty_id and target_service are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!['context', 'actor'].includes(source_type)) {
      return new Response(JSON.stringify({
        error: 'source_type must be "context" or "actor"'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

    // Verify source exists
    const sourceTable = source_type === 'context' ? 'contexts' : 'actors';
    const sourceExists = await env.DB.prepare(
      `SELECT chitty_id FROM ${sourceTable} WHERE chitty_id = ?`
    ).bind(source_chitty_id).first();

    if (!sourceExists) {
      return new Response(JSON.stringify({
        error: `Source ${source_type} not found`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check for existing active connection
    const existing = await env.DB.prepare(`
      SELECT * FROM connections
      WHERE source_chitty_id = ?
      AND target_service = ?
      AND status = 'active'
      LIMIT 1
    `).bind(source_chitty_id, target_service).first();

    if (existing) {
      return new Response(JSON.stringify({
        error: 'Active connection already exists',
        connection: existing
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate connection ID
    const connectionId = generateConnectionId();

    // Request API keys from ChittyAuth for this connection
    const keysResult = await ecosystem.requestAPIKeys(source_chitty_id, ['read', 'write']);
    const credentialsKey = keysResult.success ? `connection:${connectionId}` : null;

    // Store credentials in API_KEYS KV if successful
    if (keysResult.success && env.API_KEYS) {
      await env.API_KEYS.put(credentialsKey, keysResult.api_key, {
        metadata: {
          connection_id: connectionId,
          source_chitty_id,
          target_service,
          scopes: keysResult.scopes,
          created: new Date().toISOString(),
        },
      });
    }

    // Insert connection
    await env.DB.prepare(`
      INSERT INTO connections (
        connection_id,
        source_chitty_id,
        source_type,
        target_service,
        target_endpoint,
        connection_type,
        credentials_kv_key,
        status,
        config,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      connectionId,
      source_chitty_id,
      source_type,
      target_service,
      target_endpoint || null,
      connection_type || 'api',
      credentialsKey,
      'active',
      JSON.stringify(config || {}),
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    // Log to Chronicle
    await ecosystem.logEvent('connection.created', source_chitty_id, {
      connection_id: connectionId,
      target_service,
      connection_type: connection_type || 'api',
    });

    // Fetch created connection
    const connection = await env.DB.prepare(
      'SELECT * FROM connections WHERE connection_id = ?'
    ).bind(connectionId).first();

    return new Response(JSON.stringify({
      success: true,
      connection: {
        ...connection,
        config: JSON.parse(connection.config),
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Connections] Create error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * List connections
 */
export async function listConnections(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const source_chitty_id = url.searchParams.get('source');
    const target_service = url.searchParams.get('target');
    const status = url.searchParams.get('status') || 'active';

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

    // Build query
    let query = 'SELECT * FROM connections WHERE 1=1';
    const params = [];

    if (source_chitty_id) {
      query += ' AND source_chitty_id = ?';
      params.push(source_chitty_id);
    }

    if (target_service) {
      query += ' AND target_service = ?';
      params.push(target_service);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const stmt = env.DB.prepare(query).bind(...params);
    const { results } = await stmt.all();

    return new Response(JSON.stringify({
      connections: results.map(conn => ({
        ...conn,
        config: JSON.parse(conn.config),
      })),
      count: results.length,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Connections] List error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get connection details
 */
export async function getConnection(connectionId, request, env, ctx) {
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

    // Fetch connection
    const connection = await env.DB.prepare(
      'SELECT * FROM connections WHERE connection_id = ?'
    ).bind(connectionId).first();

    if (!connection) {
      return new Response(JSON.stringify({
        error: 'Connection not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update last_used_at
    await env.DB.prepare(
      'UPDATE connections SET last_used_at = ? WHERE connection_id = ?'
    ).bind(new Date().toISOString(), connectionId).run();

    return new Response(JSON.stringify({
      connection: {
        ...connection,
        config: JSON.parse(connection.config),
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Connections] Get error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Disconnect (delete connection)
 */
export async function disconnectConnection(connectionId, request, env, ctx) {
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

    // Fetch connection
    const connection = await env.DB.prepare(
      'SELECT * FROM connections WHERE connection_id = ?'
    ).bind(connectionId).first();

    if (!connection) {
      return new Response(JSON.stringify({
        error: 'Connection not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update connection status to disconnected
    await env.DB.prepare(`
      UPDATE connections
      SET status = 'disconnected',
          disconnected_at = ?,
          updated_at = ?
      WHERE connection_id = ?
    `).bind(
      new Date().toISOString(),
      new Date().toISOString(),
      connectionId
    ).run();

    // Delete credentials from API_KEYS KV
    if (connection.credentials_kv_key && env.API_KEYS) {
      await env.API_KEYS.delete(connection.credentials_kv_key);
    }

    // Log to Chronicle
    await ecosystem.logEvent('connection.disconnected', connection.source_chitty_id, {
      connection_id: connectionId,
      target_service: connection.target_service,
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Connection disconnected',
      connection_id: connectionId,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Connections] Disconnect error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get connection health status
 */
export async function getConnectionStatus(connectionId, request, env, ctx) {
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

    // Fetch connection
    const connection = await env.DB.prepare(
      'SELECT * FROM connections WHERE connection_id = ?'
    ).bind(connectionId).first();

    if (!connection) {
      return new Response(JSON.stringify({
        error: 'Connection not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Perform health check on target service
    const serviceHealth = await ecosystem.getServiceHealth(connection.target_service);

    // Update connection health status
    const now = new Date().toISOString();
    const isHealthy = serviceHealth.status === 'healthy';

    await env.DB.prepare(`
      UPDATE connections
      SET last_health_check = ?,
          error_count = ?,
          last_error = ?,
          status = ?,
          updated_at = ?
      WHERE connection_id = ?
    `).bind(
      now,
      isHealthy ? 0 : connection.error_count + 1,
      isHealthy ? null : serviceHealth.error || 'Service unhealthy',
      isHealthy ? 'active' : (connection.error_count >= 5 ? 'failed' : connection.status),
      now,
      connectionId
    ).run();

    return new Response(JSON.stringify({
      connection_id: connectionId,
      status: isHealthy ? 'active' : connection.status,
      service_health: serviceHealth,
      last_health_check: now,
      error_count: isHealthy ? 0 : connection.error_count + 1,
      request_count: connection.request_count,
      last_used_at: connection.last_used_at,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Connections] Status check error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Route connection requests
 */
export async function handleConnections(request, env, ctx, url) {
  const path = url.pathname.replace('/v1/connections', '');
  const method = request.method;

  // POST /v1/connections
  if (path === '' || path === '/') {
    if (method === 'POST') {
      return createConnection(request, env, ctx);
    }
  }

  // GET /v1/connections/list
  if (path === '/list' && method === 'GET') {
    return listConnections(request, env, ctx);
  }

  // GET /v1/connections/{id}/status
  if (path.match(/^\/[^/]+\/status$/) && method === 'GET') {
    const connectionId = path.split('/')[1];
    return getConnectionStatus(connectionId, request, env, ctx);
  }

  // GET /v1/connections/{id}
  if (path.match(/^\/[^/]+$/) && method === 'GET') {
    const connectionId = path.substring(1);
    return getConnection(connectionId, request, env, ctx);
  }

  // DELETE /v1/connections/{id}
  if (path.match(/^\/[^/]+$/) && method === 'DELETE') {
    const connectionId = path.substring(1);
    return disconnectConnection(connectionId, request, env, ctx);
  }

  return new Response(JSON.stringify({
    error: 'Not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
