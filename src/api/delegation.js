/**
 * Service Delegation API Handlers
 *
 * Generates delegated credentials for service-to-service communication
 * Endpoints:
 * - POST /v1/delegate - Generate delegated token
 * - POST /v1/delegate/validate - Validate delegated token
 * - DELETE /v1/delegate/{tokenId} - Revoke delegated token
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';

/**
 * Generate delegation token ID
 */
function generateTokenId() {
  return `dgt-${crypto.randomUUID()}`;
}

/**
 * Generate delegation token (JWT-like structure but stored in KV)
 */
function generateDelegationToken() {
  // Simple base64-encoded token
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate delegated credentials
 */
export async function createDelegation(request, env, ctx) {
  try {
    const body = await request.json();
    const {
      target_service,
      scopes,
      expires_in_seconds,
      metadata
    } = body;

    // Validate input
    if (!target_service) {
      return new Response(JSON.stringify({
        error: 'target_service is required'
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

    // Generate token
    const tokenId = generateTokenId();
    const token = generateDelegationToken();

    // Calculate expiration
    const expiresIn = expires_in_seconds || 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Store delegation in TOKEN_KV
    const delegationData = {
      token_id: tokenId,
      delegator_chitty_id: requestingActor.chittyId,
      target_service,
      scopes: scopes || ['read'],
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      metadata: metadata || {},
      revoked: false,
    };

    await env.TOKEN_KV.put(
      `delegation:${tokenId}`,
      JSON.stringify(delegationData),
      {
        expirationTtl: expiresIn,
      }
    );

    // Also store by token value for validation
    await env.TOKEN_KV.put(
      `delegation:token:${token}`,
      tokenId,
      {
        expirationTtl: expiresIn,
      }
    );

    // Log to Chronicle
    await ecosystem.logEvent('delegation.created', requestingActor.chittyId, {
      token_id: tokenId,
      target_service,
      scopes: scopes || ['read'],
      expires_in_seconds: expiresIn,
    });

    return new Response(JSON.stringify({
      success: true,
      delegation: {
        token_id: tokenId,
        token: token,
        target_service,
        scopes: scopes || ['read'],
        expires_at: expiresAt,
        expires_in_seconds: expiresIn,
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Delegation] Create error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Validate delegated token
 */
export async function validateDelegation(request, env, ctx) {
  try {
    const body = await request.json();
    const { token, target_service } = body;

    if (!token) {
      return new Response(JSON.stringify({
        error: 'token is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Look up token
    const tokenId = await env.TOKEN_KV.get(`delegation:token:${token}`);

    if (!tokenId) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Invalid or expired token'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch delegation data
    const delegationData = await env.TOKEN_KV.get(`delegation:${tokenId}`, { type: 'json' });

    if (!delegationData) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Delegation not found'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if revoked
    if (delegationData.revoked) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Token has been revoked'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check expiration
    if (new Date(delegationData.expires_at) < new Date()) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Token has expired'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check target service if specified
    if (target_service && delegationData.target_service !== target_service) {
      return new Response(JSON.stringify({
        valid: false,
        error: 'Token not valid for this service'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      valid: true,
      delegation: {
        token_id: delegationData.token_id,
        delegator_chitty_id: delegationData.delegator_chitty_id,
        target_service: delegationData.target_service,
        scopes: delegationData.scopes,
        expires_at: delegationData.expires_at,
        metadata: delegationData.metadata,
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Delegation] Validate error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Revoke delegated token
 */
export async function revokeDelegation(tokenId, request, env, ctx) {
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

    // Fetch delegation data
    const delegationData = await env.TOKEN_KV.get(`delegation:${tokenId}`, { type: 'json' });

    if (!delegationData) {
      return new Response(JSON.stringify({
        error: 'Delegation not found or already expired'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify the requesting actor is the delegator or has admin capability
    if (delegationData.delegator_chitty_id !== requestingActor.chittyId) {
      const actorData = await env.DB.prepare(
        'SELECT capabilities FROM actors WHERE chitty_id = ?'
      ).bind(requestingActor.chittyId).first();

      const caps = actorData ? JSON.parse(actorData.capabilities) : [];
      if (!caps.includes('admin')) {
        return new Response(JSON.stringify({
          error: 'Forbidden - can only revoke own delegations'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Mark as revoked
    delegationData.revoked = true;
    delegationData.revoked_at = new Date().toISOString();
    delegationData.revoked_by = requestingActor.chittyId;

    // Update in KV
    const remainingTtl = Math.floor(
      (new Date(delegationData.expires_at) - new Date()) / 1000
    );

    if (remainingTtl > 0) {
      await env.TOKEN_KV.put(
        `delegation:${tokenId}`,
        JSON.stringify(delegationData),
        {
          expirationTtl: remainingTtl,
        }
      );
    }

    // Log to Chronicle
    await ecosystem.logEvent('delegation.revoked', requestingActor.chittyId, {
      token_id: tokenId,
      target_service: delegationData.target_service,
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Delegation revoked',
      token_id: tokenId,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Delegation] Revoke error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Route delegation requests
 */
export async function handleDelegation(request, env, ctx, url) {
  const path = url.pathname.replace('/v1/delegate', '');
  const method = request.method;

  // POST /v1/delegate
  if ((path === '' || path === '/') && method === 'POST') {
    return createDelegation(request, env, ctx);
  }

  // POST /v1/delegate/validate
  if (path === '/validate' && method === 'POST') {
    return validateDelegation(request, env, ctx);
  }

  // DELETE /v1/delegate/{tokenId}
  if (path.match(/^\/[^/]+$/) && method === 'DELETE') {
    const tokenId = path.substring(1);
    return revokeDelegation(tokenId, request, env, ctx);
  }

  return new Response(JSON.stringify({
    error: 'Not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
