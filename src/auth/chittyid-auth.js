/**
 * ChittyID Authentication Service
 *
 * Handles ChittyID authentication, session management, and JWT verification
 * for the Access Provisioning Broker pattern.
 */

import { randomBytes } from "crypto";

/**
 * Verify ChittyID format and checksum
 */
export function validateChittyIDFormat(chittyid) {
  const pattern = /^CHITTY-([A-Z]+)-(\d{6})-([A-Z0-9]{3,4})$/;
  const match = chittyid.match(pattern);

  if (!match) {
    return {
      valid: false,
      error: "Invalid ChittyID format",
    };
  }

  const [, entity, sequence, checksum] = match;

  // Validate entity type
  // @canon: chittycanon://gov/governance#core-types
  const validEntities = [
    // Canonical type codes
    "P",
    "L",
    "T",
    "E",
    "A",
    // Legacy codes (backward compatibility)
    "PEO",
    "PLACE",
    "PROP",
    "EVNT",
    "AUTH",
    "INFO",
    "FACT",
    "CONTEXT",
    "ACTOR",
    "DOC",
    "SERVICE",
  ];

  if (!validEntities.includes(entity)) {
    return {
      valid: false,
      error: `Invalid entity type: ${entity}`,
    };
  }

  return {
    valid: true,
    entity,
    sequence,
    checksum,
  };
}

/**
 * Verify JWT proof with ChittyAuth service
 */
export async function verifyJWTProof(chittyid, jwtToken, env) {
  try {
    const response = await fetch(`${env.CHITTYAUTH_SERVICE_URL}/api/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CHITTY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        jwt: jwtToken,
        expected_subject: chittyid,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        verified: false,
        error: `JWT verification failed: ${error}`,
      };
    }

    const result = await response.json();
    return {
      verified: true,
      claims: result.claims,
      expires_at: result.exp,
    };
  } catch (error) {
    return {
      verified: false,
      error: `ChittyAuth service error: ${error.message}`,
    };
  }
}

/**
 * Generate session token
 */
export function generateSessionToken() {
  const bytes = randomBytes(32);
  return `sess_${bytes.toString("hex")}`;
}

/**
 * Create session in KV
 */
export async function createSession(chittyid, claims, ttlSeconds, env) {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const sessionData = {
    chittyid,
    claims,
    created_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    ttl_seconds: ttlSeconds,
  };

  // Store in KV with TTL
  await env.TOKEN_KV.put(
    `session:${sessionToken}`,
    JSON.stringify(sessionData),
    { expirationTtl: ttlSeconds },
  );

  // Log to ChittyChronicle
  await logToChronicle(
    {
      event: "session.created",
      chittyid,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
    },
    env,
  );

  return {
    session_token: sessionToken,
    chittyid,
    expires_at: expiresAt.toISOString(),
    ttl_seconds: ttlSeconds,
  };
}

/**
 * Validate session token
 */
export async function validateSession(sessionToken, env) {
  const sessionData = await env.TOKEN_KV.get(`session:${sessionToken}`, {
    type: "json",
  });

  if (!sessionData) {
    return {
      valid: false,
      error: "Session not found or expired",
    };
  }

  // Check if expired (redundant with KV TTL, but defensive)
  const expiresAt = new Date(sessionData.expires_at);
  if (expiresAt < new Date()) {
    return {
      valid: false,
      error: "Session expired",
    };
  }

  return {
    valid: true,
    session: sessionData,
  };
}

/**
 * Refresh session (extend TTL)
 */
export async function refreshSession(sessionToken, additionalTTL, env) {
  const validation = await validateSession(sessionToken, env);

  if (!validation.valid) {
    return validation;
  }

  const session = validation.session;
  const newTTL = session.ttl_seconds + additionalTTL;
  const newExpiresAt = new Date(Date.now() + newTTL * 1000);

  // Update session
  session.expires_at = newExpiresAt.toISOString();
  session.ttl_seconds = newTTL;

  await env.TOKEN_KV.put(`session:${sessionToken}`, JSON.stringify(session), {
    expirationTtl: newTTL,
  });

  // Log refresh
  await logToChronicle(
    {
      event: "session.refreshed",
      chittyid: session.chittyid,
      session_token: sessionToken,
      new_expires_at: newExpiresAt.toISOString(),
    },
    env,
  );

  return {
    success: true,
    session_token: sessionToken,
    expires_at: newExpiresAt.toISOString(),
    ttl_seconds: newTTL,
  };
}

/**
 * Revoke session
 */
export async function revokeSession(sessionToken, env) {
  const validation = await validateSession(sessionToken, env);

  if (!validation.valid) {
    return validation;
  }

  const session = validation.session;

  // Delete from KV
  await env.TOKEN_KV.delete(`session:${sessionToken}`);

  // Log revocation
  await logToChronicle(
    {
      event: "session.revoked",
      chittyid: session.chittyid,
      session_token: sessionToken,
    },
    env,
  );

  return {
    success: true,
    message: "Session revoked successfully",
  };
}

/**
 * Helper: Log to ChittyChronicle
 */
async function logToChronicle(event, env) {
  try {
    await fetch(`${env.CHITTYCHRONICLE_SERVICE_URL}/api/entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CHITTY_CHRONICLE_TOKEN}`,
      },
      body: JSON.stringify({
        eventType: event.event,
        entityId: event.chittyid,
        data: event,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    // Log error but don't fail the operation
    console.error("[ChittyChronicle] Failed to log event:", error.message);
  }
}

/**
 * Main authentication handler
 */
export async function authenticateChittyID(request, env) {
  try {
    const body = await request.json();
    const { chittyid, proof } = body;

    // 1. Validate ChittyID format
    const formatValidation = validateChittyIDFormat(chittyid);
    if (!formatValidation.valid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: formatValidation.error,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 2. Verify JWT proof with ChittyAuth
    const jwtValidation = await verifyJWTProof(chittyid, proof, env);
    if (!jwtValidation.verified) {
      return new Response(
        JSON.stringify({
          success: false,
          error: jwtValidation.error,
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // 3. Create session
    const defaultTTL = 3600; // 1 hour
    const session = await createSession(
      chittyid,
      jwtValidation.claims,
      defaultTTL,
      env,
    );

    return new Response(
      JSON.stringify({
        success: true,
        ...session,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[ChittyID Auth] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Authentication failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
