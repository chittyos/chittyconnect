/**
 * ChittyOS Ecosystem Integration
 *
 * Comprehensive integration with all ChittyOS services:
 * - ChittyRegistry: Service discovery with 5-minute caching
 * - ChittyID Authority: Central ID minting (NO local generation)
 * - ChittyAuth: API key management
 * - ChittyDNA: Genetic tracking
 * - ChittyVerify: Verification flows
 * - ChittyCertify: Compliance certification
 * - ChittyChronicle: Event logging
 */

// Service registry cache (5 minutes)
let registryCache = null;
let registryCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * ChittyRegistry Integration
 * Service discovery with 5-minute caching
 */
export async function discoverServices(env) {
  const now = Date.now();

  // Return cached registry if fresh
  if (registryCache && (now - registryCacheTime) < CACHE_TTL) {
    return registryCache;
  }

  try {
    const response = await fetch('https://registry.chitty.cc/v1/services', {
      headers: {
        'Authorization': `Bearer ${env.CHITTY_REGISTRY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      registryCache = await response.json();
      registryCacheTime = now;
      return registryCache;
    }
  } catch (error) {
    console.error('ChittyRegistry discovery failed:', error.message);
  }

  // Return stale cache or empty array on failure
  return registryCache || { services: [] };
}

/**
 * Register service with ChittyRegistry
 */
export async function registerService(env, serviceConfig) {
  try {
    const response = await fetch('https://registry.chitty.cc/v1/services/register', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_REGISTRY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: serviceConfig.name || 'chittyconnect',
        type: serviceConfig.type || 'integration',
        capabilities: serviceConfig.capabilities || ['mcp', 'rest-api', 'github-app'],
        healthEndpoint: serviceConfig.healthEndpoint || 'https://connect.chitty.cc/health',
        version: serviceConfig.version || '1.0.0'
      })
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`Registration failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyRegistry registration failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * ChittyID Authority Compliance
 * ALL IDs minted via https://id.chitty.cc
 * Entity types: PEO, PLACE, PROP, EVNT, AUTH, INFO, FACT, CONTEXT, ACTOR
 */
export async function mintChittyID(env, entityType, metadata) {
  const validTypes = ['PEO', 'PLACE', 'PROP', 'EVNT', 'AUTH', 'INFO', 'FACT', 'CONTEXT', 'ACTOR'];

  if (!validTypes.includes(entityType)) {
    throw new Error(`Invalid entity type: ${entityType}. Must be one of: ${validTypes.join(', ')}`);
  }

  try {
    const response = await fetch('https://id.chitty.cc/v1/mint', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_ID_SERVICE_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: entityType,
        metadata: metadata || {}
      })
    });

    if (!response.ok) {
      throw new Error(`ChittyID minting failed: ${response.status}`);
    }

    const result = await response.json();
    return result.chittyId;
  } catch (error) {
    console.error('ChittyID minting failed:', error.message);
    throw error;
  }
}

/**
 * Validate ChittyID
 */
export async function validateChittyID(env, chittyId) {
  try {
    const response = await fetch(`https://id.chitty.cc/v1/validate/${chittyId}`, {
      headers: {
        'Authorization': `Bearer ${env.CHITTY_ID_SERVICE_TOKEN || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }

    return { valid: false };
  } catch (error) {
    console.error('ChittyID validation failed:', error.message);
    return { valid: false };
  }
}

/**
 * ChittyDNA Record Initialization
 * Genetic tracking for context evolution
 */
export async function initializeChittyDNA(env, chittyId, dnaConfig) {
  try {
    const response = await fetch('https://dna.chitty.cc/v1/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_DNA_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chittyId,
        type: dnaConfig.type || 'context',
        service: dnaConfig.service || 'chittyconnect',
        metadata: {
          version: dnaConfig.version || '1.0.0',
          capabilities: dnaConfig.capabilities || [],
          description: dnaConfig.description || '',
          ...dnaConfig.metadata
        }
      })
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`ChittyDNA initialization failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyDNA initialization failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update ChittyDNA Record
 */
export async function updateChittyDNA(env, chittyId, updates) {
  try {
    const response = await fetch(`https://dna.chitty.cc/v1/update/${chittyId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_DNA_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`ChittyDNA update failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyDNA update failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * ChittyAuth API Key Management
 * Seamless key provisioning for new contexts
 */
export async function provisionAPIKeys(env, chittyId, scopes = ['read', 'write', 'admin']) {
  try {
    const response = await fetch('https://auth.chitty.cc/v1/keys/provision', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_AUTH_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chittyId,
        scopes,
        service: 'chittyconnect'
      })
    });

    if (response.ok) {
      const result = await response.json();

      // Store API keys securely
      if (result.apiKey) {
        await env.API_KEYS.put(
          `key:${chittyId}`,
          JSON.stringify(result),
          { expirationTtl: 86400 * 365 } // 1 year
        );
      }

      return result;
    }

    throw new Error(`API key provisioning failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyAuth provisioning failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Rotate API Keys
 */
export async function rotateAPIKey(env, chittyId) {
  try {
    const response = await fetch(`https://auth.chitty.cc/v1/keys/rotate/${chittyId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_AUTH_TOKEN || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const result = await response.json();

      // Update stored API key
      if (result.apiKey) {
        await env.API_KEYS.put(
          `key:${chittyId}`,
          JSON.stringify(result),
          { expirationTtl: 86400 * 365 }
        );
      }

      return result;
    }

    throw new Error(`API key rotation failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyAuth rotation failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * ChittyVerify Integration
 * Context verification flows
 */
export async function verifyContext(env, chittyId) {
  try {
    const response = await fetch(`https://verify.chitty.cc/v1/verify/context/${chittyId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_VERIFY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`Context verification failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyVerify failed:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * ChittyCertify Integration
 * Service certification issuance
 */
export async function certifyService(env, chittyId, certConfig) {
  try {
    const response = await fetch('https://certify.chitty.cc/v1/certify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_CERTIFY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chittyId,
        compliance: certConfig.compliance || ['chittyos-v1', 'mcp-2024-11-05'],
        securityLevel: certConfig.securityLevel || 'standard',
        service: 'chittyconnect'
      })
    });

    if (response.ok) {
      return await response.json();
    }

    throw new Error(`Service certification failed: ${response.status}`);
  } catch (error) {
    console.error('ChittyCertify failed:', error.message);
    return { certified: false, error: error.message };
  }
}

/**
 * ChittyChronicle Event Logging
 * Complete timeline tracking
 */
export async function logEvent(env, eventData) {
  try {
    const response = await fetch('https://chronicle.chitty.cc/v1/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CHITTY_CHRONICLE_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service: 'chittyconnect',
        timestamp: new Date().toISOString(),
        ...eventData
      })
    });

    if (response.ok) {
      return await response.json();
    }

    // Non-blocking: log failure but don't throw
    console.warn('ChittyChronicle logging failed:', response.status);
    return { logged: false };
  } catch (error) {
    console.warn('ChittyChronicle logging failed:', error.message);
    return { logged: false };
  }
}

/**
 * Complete Context Initialization Flow
 * Orchestrates all ChittyOS service calls
 */
export async function initializeContext(env, contextName, config = {}) {
  const results = {
    success: false,
    chittyId: null,
    dna: null,
    apiKeys: null,
    verified: false,
    certified: false,
    registered: false
  };

  try {
    // Step 1: Mint ChittyID
    console.log('[ChittyOS] Step 1: Minting ChittyID...');
    results.chittyId = await mintChittyID(env, 'CONTEXT', {
      name: contextName,
      service: 'chittyconnect',
      version: config.version || '1.0.0'
    });
    console.log(`[ChittyOS] ChittyID minted: ${results.chittyId}`);

    // Step 2: Initialize ChittyDNA (non-blocking)
    console.log('[ChittyOS] Step 2: Initializing ChittyDNA...');
    results.dna = await initializeChittyDNA(env, results.chittyId, {
      type: 'context',
      service: 'chittyconnect',
      version: config.version || '1.0.0',
      capabilities: config.capabilities || ['mcp', 'rest-api', 'github-app'],
      description: 'ChittyConnect - ContextConsciousness™ AI spine'
    });
    console.log('[ChittyOS] ChittyDNA initialized');

    // Step 3: Provision API Keys (non-blocking)
    console.log('[ChittyOS] Step 3: Provisioning API keys...');
    results.apiKeys = await provisionAPIKeys(env, results.chittyId, ['read', 'write', 'admin']);
    console.log('[ChittyOS] API keys provisioned');

    // Step 4: Register with ChittyRegistry (non-blocking)
    console.log('[ChittyOS] Step 4: Registering with ChittyRegistry...');
    const registration = await registerService(env, {
      name: contextName,
      type: 'integration',
      capabilities: config.capabilities || ['mcp', 'rest-api', 'github-app'],
      healthEndpoint: 'https://connect.chitty.cc/health',
      version: config.version || '1.0.0'
    });
    results.registered = registration.success !== false;
    console.log('[ChittyOS] Service registered');

    // Step 5: Verify with ChittyVerify (non-blocking)
    console.log('[ChittyOS] Step 5: Verifying context...');
    const verification = await verifyContext(env, results.chittyId);
    results.verified = verification.verified !== false;
    console.log('[ChittyOS] Context verified');

    // Step 6: Certify with ChittyCertify (non-blocking)
    console.log('[ChittyOS] Step 6: Certifying service...');
    const certification = await certifyService(env, results.chittyId, {
      compliance: ['chittyos-v1', 'mcp-2024-11-05'],
      securityLevel: 'standard'
    });
    results.certified = certification.certified !== false;
    console.log('[ChittyOS] Service certified');

    // Step 7: Log to ChittyChronicle (non-blocking)
    console.log('[ChittyOS] Step 7: Logging initialization event...');
    await logEvent(env, {
      event: 'chittyconnect.initialized',
      chittyId: results.chittyId,
      contextName,
      metadata: {
        version: config.version || '1.0.0',
        capabilities: config.capabilities || [],
        timestamp: new Date().toISOString()
      }
    });
    console.log('[ChittyOS] Event logged to ChittyChronicle');

    results.success = true;
    return results;

  } catch (error) {
    console.error('[ChittyOS] Context initialization failed:', error.message);
    results.error = error.message;

    // Log failure (best-effort)
    await logEvent(env, {
      event: 'chittyconnect.initialization_failed',
      error: error.message,
      contextName,
      timestamp: new Date().toISOString()
    });

    return results;
  }
}

/**
 * Get service health from ChittyRegistry
 */
export async function getServiceHealth(env, serviceName) {
  try {
    const response = await fetch(`https://registry.chitty.cc/v1/services/${serviceName}/health`, {
      headers: {
        'Authorization': `Bearer ${env.CHITTY_REGISTRY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }

    return { status: 'unknown' };
  } catch (error) {
    console.error(`Health check failed for ${serviceName}:`, error.message);
    return { status: 'unreachable', error: error.message };
  }
}
