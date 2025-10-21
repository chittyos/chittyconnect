/**
 * ChittyOS Ecosystem Integration Module
 *
 * Comprehensive integration with all ChittyOS services:
 * - ChittyRegistry (service discovery)
 * - ChittyID (identity authority)
 * - ChittyDNA (genetic tracking)
 * - ChittyAuth (authentication)
 * - ChittyVerify (verification flows)
 * - ChittyCertify (certification)
 * - ChittyChronicle (event logging)
 *
 * All integrations include:
 * - Caching for performance
 * - Graceful degradation on failure
 * - Comprehensive error handling
 * - Zero ChittyID violations
 */

// Service URLs (from ChittyRegistry or defaults)
const DEFAULT_SERVICES = {
  chittyid: 'https://id.chitty.cc',
  chittyauth: 'https://auth.chitty.cc',
  chittyregistry: 'https://registry.chitty.cc',
  chittydna: 'https://dna.chitty.cc',
  chittyverify: 'https://verify.chitty.cc',
  chittycertify: 'https://certify.chitty.cc',
  chittychronicle: 'https://chronicle.chitty.cc',
};

// Cache TTLs
const CACHE_TTL = {
  REGISTRY: 300, // 5 minutes
  TOKEN: 3600, // 1 hour
  SERVICE_HEALTH: 60, // 1 minute
};

/**
 * ChittyOS Ecosystem Manager
 */
export class ChittyOSEcosystem {
  constructor(env, ctx) {
    this.env = env;
    this.ctx = ctx;
    this.services = { ...DEFAULT_SERVICES };
    this.registry_last_updated = null;
  }

  // ============================================
  // ChittyRegistry - Service Discovery
  // ============================================

  /**
   * Discover services from ChittyRegistry
   * Cached for 5 minutes to reduce load
   */
  async discoverServices() {
    try {
      // Check cache
      if (this.registry_last_updated && Date.now() - this.registry_last_updated < CACHE_TTL.REGISTRY * 1000) {
        return this.services;
      }

      const response = await fetch(`${DEFAULT_SERVICES.chittyregistry}/v1/services/discover`, {
        headers: {
          'Authorization': `Bearer ${this.env.CHITTY_REGISTRY_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Update service URLs from registry
        if (data.services) {
          for (const service of data.services) {
            this.services[service.name] = service.url;
          }
        }
        this.registry_last_updated = Date.now();
      } else {
        console.warn('[ChittyRegistry] Discovery failed, using default URLs');
      }
    } catch (error) {
      console.error('[ChittyRegistry] Discovery error:', error.message);
      // Fall back to default URLs
    }

    return this.services;
  }

  /**
   * Get service health status
   */
  async getServiceHealth(serviceName) {
    try {
      const url = this.services[serviceName] || DEFAULT_SERVICES[serviceName];
      if (!url) {
        return { status: 'unknown', error: 'Service not found' };
      }

      const response = await fetch(`${url}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return { status: 'healthy', ...data };
      } else {
        return { status: 'unhealthy', http_status: response.status };
      }
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Get all services health
   */
  async getAllServicesHealth() {
    const services = Object.keys(this.services);
    const healthChecks = await Promise.all(
      services.map(async (name) => ({
        name,
        ...await this.getServiceHealth(name),
      }))
    );

    return {
      timestamp: new Date().toISOString(),
      services: healthChecks,
      overall: healthChecks.every(s => s.status === 'healthy') ? 'healthy' : 'degraded',
    };
  }

  // ============================================
  // ChittyID - Identity Authority
  // ============================================

  /**
   * Mint a new ChittyID from the central authority
   * CRITICAL: All ChittyIDs MUST be minted via id.chitty.cc
   * NO local generation allowed (zero violations)
   */
  async mintChittyID(type, metadata = {}) {
    try {
      const url = this.services.chittyid || DEFAULT_SERVICES.chittyid;
      const response = await fetch(`${url}/v1/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_ID_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          type, // PEO, PLACE, PROP, EVNT, AUTH, INFO, FACT, CONTEXT, ACTOR
          metadata,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`ChittyID minting failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        chittyId: data.chittyId,
        type: data.type,
        minted_at: data.minted_at || new Date().toISOString(),
      };
    } catch (error) {
      console.error('[ChittyID] Minting error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate a ChittyID
   */
  async validateChittyID(chittyId) {
    try {
      const url = this.services.chittyid || DEFAULT_SERVICES.chittyid;
      const response = await fetch(`${url}/v1/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_ID_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({ chittyId }),
      });

      if (response.ok) {
        const data = await response.json();
        return { valid: true, ...data };
      } else {
        return { valid: false };
      }
    } catch (error) {
      console.error('[ChittyID] Validation error:', error.message);
      return { valid: false, error: error.message };
    }
  }

  // ============================================
  // ChittyDNA - Genetic Tracking
  // ============================================

  /**
   * Initialize ChittyDNA record for entity
   */
  async initializeDNA(chittyId, entityType, metadata = {}) {
    try {
      const url = this.services.chittydna || DEFAULT_SERVICES.chittydna;
      const response = await fetch(`${url}/v1/dna/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_DNA_TOKEN}`,
        },
        body: JSON.stringify({
          chittyId,
          entityType, // context, installation, actor, connection
          genesis: {
            timestamp: new Date().toISOString(),
            service: 'chittyconnect',
            version: this.env.SERVICE_VERSION || '1.0.0',
            ...metadata,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          dna_id: data.dna_id || data.chittyDnaId,
          genesis: data.genesis,
        };
      } else {
        throw new Error(`DNA initialization failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[ChittyDNA] Initialization error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Track evolution/mutation in ChittyDNA
   */
  async trackEvolution(chittyId, event, changes = {}) {
    try {
      const url = this.services.chittydna || DEFAULT_SERVICES.chittydna;
      const response = await fetch(`${url}/v1/dna/evolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_DNA_TOKEN}`,
        },
        body: JSON.stringify({
          chittyId,
          event, // created, updated, connected, disconnected, certified, etc.
          changes,
          timestamp: new Date().toISOString(),
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('[ChittyDNA] Evolution tracking error:', error.message);
      return false;
    }
  }

  // ============================================
  // ChittyAuth - Authentication
  // ============================================

  /**
   * Validate actor via ChittyAuth
   */
  async validateActor(authHeader) {
    if (!authHeader) {
      return null;
    }

    try {
      const url = this.services.chittyauth || DEFAULT_SERVICES.chittyauth;
      const response = await fetch(`${url}/v1/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.actor;
      } else {
        return null;
      }
    } catch (error) {
      console.error('[ChittyAuth] Validation error:', error.message);
      return null;
    }
  }

  /**
   * Request API keys from ChittyAuth for a new context
   */
  async requestAPIKeys(chittyId, scopes = ['read', 'write']) {
    try {
      const url = this.services.chittyauth || DEFAULT_SERVICES.chittyauth;
      const response = await fetch(`${url}/v1/keys/provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_AUTH_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          chittyId,
          scopes,
          service: 'chittyconnect',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          api_key: data.api_key,
          scopes: data.scopes,
        };
      } else {
        throw new Error(`API key provisioning failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[ChittyAuth] API key provisioning error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============================================
  // ChittyVerify - Verification Flows
  // ============================================

  /**
   * Verify context integrity
   */
  async verifyContext(chittyId, dnaId, apiKey) {
    try {
      const url = this.services.chittyverify || DEFAULT_SERVICES.chittyverify;
      const response = await fetch(`${url}/v1/verify/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_VERIFY_TOKEN}`,
        },
        body: JSON.stringify({
          chittyId,
          dnaId,
          apiKey,
          service: 'chittyconnect',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          verified: true,
          ...data,
        };
      } else {
        return { verified: false };
      }
    } catch (error) {
      console.error('[ChittyVerify] Verification error:', error.message);
      return { verified: false, error: error.message };
    }
  }

  // ============================================
  // ChittyCertify - Certification
  // ============================================

  /**
   * Request service certification
   */
  async requestCertification(chittyId, compliance = ['chittyos-v1', 'mcp-2024-11-05']) {
    try {
      const url = this.services.chittycertify || DEFAULT_SERVICES.chittycertify;
      const response = await fetch(`${url}/v1/certify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_CERTIFY_TOKEN}`,
        },
        body: JSON.stringify({
          chittyId,
          service: 'chittyconnect',
          compliance,
          security_level: 'standard',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          certified: true,
          certificate_id: data.certificate_id,
          compliance: data.compliance,
          issued_at: data.issued_at,
        };
      } else {
        throw new Error(`Certification failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[ChittyCertify] Certification error:', error.message);
      return {
        certified: false,
        error: error.message,
      };
    }
  }

  // ============================================
  // ChittyChronicle - Event Logging
  // ============================================

  /**
   * Log event to ChittyChronicle
   */
  async logEvent(event, entityId, metadata = {}) {
    try {
      const url = this.services.chittychronicle || DEFAULT_SERVICES.chittychronicle;
      const response = await fetch(`${url}/v1/events/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_CHRONICLE_TOKEN}`,
        },
        body: JSON.stringify({
          event, // e.g., 'context.created', 'github.push', 'actor.registered'
          entityId,
          service: 'chittyconnect',
          timestamp: new Date().toISOString(),
          metadata,
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('[ChittyChronicle] Event logging error:', error.message);
      return false;
    }
  }

  /**
   * Batch log multiple events
   */
  async logEventsBatch(events) {
    try {
      const url = this.services.chittychronicle || DEFAULT_SERVICES.chittychronicle;
      const response = await fetch(`${url}/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_CHRONICLE_TOKEN}`,
        },
        body: JSON.stringify({
          events: events.map(e => ({
            ...e,
            service: 'chittyconnect',
            timestamp: e.timestamp || new Date().toISOString(),
          })),
        }),
      });

      return response.ok;
    } catch (error) {
      console.error('[ChittyChronicle] Batch event logging error:', error.message);
      return false;
    }
  }

  /**
   * Query timeline for an entity
   */
  async getTimeline(entityId, limit = 50) {
    try {
      const url = this.services.chittychronicle || DEFAULT_SERVICES.chittychronicle;
      const response = await fetch(`${url}/v1/timeline/${entityId}?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${this.env.CHITTY_CHRONICLE_TOKEN}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.events || [];
      } else {
        return [];
      }
    } catch (error) {
      console.error('[ChittyChronicle] Timeline query error:', error.message);
      return [];
    }
  }

  // ============================================
  // Complete Context Initialization Flow
  // ============================================

  /**
   * Full context initialization with ChittyOS ecosystem
   * This is called once when ChittyConnect starts for the first time
   *
   * Steps:
   * 1. Check if context already exists
   * 2. Mint ChittyID
   * 3. Initialize ChittyDNA
   * 4. Request API keys
   * 5. Register with ChittyRegistry (optional)
   * 6. Verify with ChittyVerify
   * 7. Certify with ChittyCertify
   * 8. Log to ChittyChronicle
   *
   * All steps are non-blocking and gracefully degrade on failure
   */
  async initializeServiceContext(serviceName, serviceMetadata = {}) {
    const results = {
      service: serviceName,
      timestamp: new Date().toISOString(),
      steps: {},
    };

    try {
      // Step 1: Mint ChittyID
      console.log(`[ChittyOS] Initializing ${serviceName}...`);
      const mintResult = await this.mintChittyID('CONTEXT', {
        name: serviceName,
        type: 'service',
        ...serviceMetadata,
      });

      if (!mintResult.success) {
        throw new Error('ChittyID minting failed');
      }

      const chittyId = mintResult.chittyId;
      results.chittyId = chittyId;
      results.steps.mint = { success: true, chittyId };

      // Step 2: Initialize ChittyDNA
      const dnaResult = await this.initializeDNA(chittyId, 'context', {
        service: serviceName,
        capabilities: serviceMetadata.capabilities || [],
      });

      results.steps.dna = dnaResult;

      // Step 3: Request API Keys
      const keysResult = await this.requestAPIKeys(chittyId, ['read', 'write', 'admin']);
      results.steps.api_keys = keysResult;

      // Store API key in KV if successful
      if (keysResult.success && this.env.API_KEYS) {
        await this.env.API_KEYS.put(`service:${serviceName}`, keysResult.api_key, {
          metadata: {
            chittyId,
            scopes: keysResult.scopes,
            created: new Date().toISOString(),
          },
        });
      }

      // Step 4: Verify
      if (dnaResult.success && keysResult.success) {
        const verifyResult = await this.verifyContext(
          chittyId,
          dnaResult.dna_id,
          keysResult.api_key
        );
        results.steps.verify = verifyResult;
      }

      // Step 5: Certify
      const certifyResult = await this.requestCertification(chittyId);
      results.steps.certify = certifyResult;

      // Step 6: Log to Chronicle
      await this.logEvent('service.initialized', chittyId, {
        service: serviceName,
        initialization_results: results,
      });

      results.success = true;
      console.log(`[ChittyOS] ${serviceName} initialized successfully with ChittyID: ${chittyId}`);

    } catch (error) {
      results.success = false;
      results.error = error.message;
      console.error(`[ChittyOS] Initialization failed:`, error.message);
    }

    return results;
  }
}

/**
 * Create a ChittyOS ecosystem instance
 */
export function createEcosystem(env, ctx) {
  return new ChittyOSEcosystem(env, ctx);
}
