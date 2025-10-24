/**
 * Mock ChittyOS Services for Testing
 *
 * Provides mock responses for ChittyOS ecosystem services
 */

/**
 * Mock ChittyID service responses
 */
export const mockChittyID = {
  mintSuccess: (type = 'CONTEXT', metadata = {}) => ({
    success: true,
    chittyId: `CHITTY-${type}-${Math.random().toString(36).substring(2, 15)}`,
    type,
    metadata,
    minted_at: new Date().toISOString(),
    authority: 'id.chitty.cc',
  }),

  mintFailure: (error = 'Failed to mint ChittyID') => ({
    success: false,
    error,
  }),

  validateSuccess: (chittyId) => ({
    valid: true,
    chittyId,
    type: chittyId.split('-')[1] || 'UNKNOWN',
    authority: 'id.chitty.cc',
  }),

  validateFailure: (chittyId) => ({
    valid: false,
    chittyId,
    error: 'Invalid ChittyID',
  }),
};

/**
 * Mock ChittyAuth service responses
 */
export const mockChittyAuth = {
  validateActorSuccess: (chittyId = 'CHITTY-ACTOR-test123') => ({
    valid: true,
    chittyId,
    principal_id: `principal-${chittyId}`,
    actor_type: 'human',
    display_name: 'Test Actor',
    scopes: ['contexts:read', 'contexts:write'],
  }),

  validateActorFailure: () => ({
    valid: false,
    error: 'Invalid authorization token',
  }),

  requestAPIKeysSuccess: (chittyId, scopes = []) => ({
    success: true,
    api_key: `chitty_test_${Math.random().toString(36).substring(2, 15)}`,
    secret_key: `secret_${Math.random().toString(36).substring(2, 15)}`,
    chittyId,
    scopes,
    expires_at: new Date(Date.now() + 86400000).toISOString(), // 24 hours
  }),

  requestAPIKeysFailure: () => ({
    success: false,
    error: 'Failed to provision API keys',
  }),
};

/**
 * Mock ChittyRegistry service responses
 */
export const mockChittyRegistry = {
  discoverSuccess: () => ({
    services: {
      chittyid: 'https://id.chitty.cc',
      chittyauth: 'https://auth.chitty.cc',
      chittyregistry: 'https://registry.chitty.cc',
      chittydna: 'https://dna.chitty.cc',
      chittyverify: 'https://verify.chitty.cc',
      chittycertify: 'https://certify.chitty.cc',
      chittychronicle: 'https://chronicle.chitty.cc',
    },
    cached_at: new Date().toISOString(),
    ttl: 300,
  }),

  registerServiceSuccess: (serviceName, metadata = {}) => ({
    success: true,
    service_name: serviceName,
    service_id: `service-${serviceName}-${Math.random().toString(36).substring(2, 10)}`,
    registered_at: new Date().toISOString(),
    metadata,
  }),
};

/**
 * Mock ChittyDNA service responses
 */
export const mockChittyDNA = {
  initializeSuccess: (chittyId, entityType) => ({
    success: true,
    dna_id: `DNA-${Math.random().toString(36).substring(2, 15)}`,
    chittyId,
    entity_type: entityType,
    generation: 0,
    traits: {},
    initialized_at: new Date().toISOString(),
  }),

  trackEvolutionSuccess: (chittyId, event) => ({
    success: true,
    chittyId,
    event,
    generation: 1,
    recorded_at: new Date().toISOString(),
  }),
};

/**
 * Mock ChittyVerify service responses
 */
export const mockChittyVerify = {
  verifySuccess: (chittyId, verificationType = 'identity') => ({
    verified: true,
    chittyId,
    verification_type: verificationType,
    verified_at: new Date().toISOString(),
    confidence: 100,
  }),

  verifyFailure: (chittyId) => ({
    verified: false,
    chittyId,
    error: 'Verification failed',
  }),
};

/**
 * Mock ChittyCertify service responses
 */
export const mockChittyCertify = {
  certifySuccess: (chittyId, certification = 'chittyos_compliance') => ({
    certified: true,
    chittyId,
    certification_type: certification,
    certificate_id: `CERT-${Math.random().toString(36).substring(2, 15)}`,
    certified_at: new Date().toISOString(),
    valid_until: new Date(Date.now() + 31536000000).toISOString(), // 1 year
  }),
};

/**
 * Mock ChittyChronicle service responses
 */
export const mockChittyChronicle = {
  logEventSuccess: (eventType, chittyId, metadata = {}) => ({
    success: true,
    event_id: `EVENT-${Math.random().toString(36).substring(2, 15)}`,
    event_type: eventType,
    chittyId,
    metadata,
    logged_at: new Date().toISOString(),
  }),

  queryEventsSuccess: (chittyId, events = []) => ({
    chittyId,
    events: events.length > 0 ? events : [
      {
        event_id: 'EVENT-test1',
        event_type: 'context.created',
        logged_at: new Date().toISOString(),
      },
    ],
    count: events.length || 1,
  }),
};

/**
 * Create mock fetch function for ChittyOS services
 */
export function createMockFetch(responses = {}) {
  return async (url, options = {}) => {
    const urlStr = url.toString();

    // ChittyID
    if (urlStr.includes('id.chitty')) {
      if (urlStr.includes('/v1/mint')) {
        return new Response(JSON.stringify(responses.mintChittyID || mockChittyID.mintSuccess()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/v1/validate')) {
        return new Response(JSON.stringify(responses.validateChittyID || mockChittyID.validateSuccess('CHITTY-TEST-123')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ChittyAuth
    if (urlStr.includes('auth.chitty')) {
      if (urlStr.includes('/v1/validate')) {
        return new Response(JSON.stringify(responses.validateActor || mockChittyAuth.validateActorSuccess()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/v1/keys/request')) {
        return new Response(JSON.stringify(responses.requestAPIKeys || mockChittyAuth.requestAPIKeysSuccess('CHITTY-TEST-123')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ChittyRegistry
    if (urlStr.includes('registry.chitty')) {
      if (urlStr.includes('/v1/discover')) {
        return new Response(JSON.stringify(responses.discoverServices || mockChittyRegistry.discoverSuccess()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/v1/register')) {
        return new Response(JSON.stringify(responses.registerService || mockChittyRegistry.registerServiceSuccess('chittyconnect')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ChittyDNA
    if (urlStr.includes('dna.chitty')) {
      if (urlStr.includes('/v1/initialize')) {
        return new Response(JSON.stringify(responses.initializeDNA || mockChittyDNA.initializeSuccess('CHITTY-TEST-123', 'context')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/v1/evolve')) {
        return new Response(JSON.stringify(responses.trackEvolution || mockChittyDNA.trackEvolutionSuccess('CHITTY-TEST-123', 'test.event')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ChittyChronicle
    if (urlStr.includes('chronicle.chitty')) {
      if (urlStr.includes('/v1/log')) {
        return new Response(JSON.stringify(responses.logEvent || mockChittyChronicle.logEventSuccess('test.event', 'CHITTY-TEST-123')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Default: not found
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Create mock environment for tests
 */
export function createMockEnv(overrides = {}) {
  return {
    // Environment variables
    ENVIRONMENT: 'test',
    SERVICE_VERSION: '1.0.0-test',

    // ChittyOS service URLs
    CHITTY_ID_SERVICE: 'https://id.chitty.test',
    CHITTY_AUTH_SERVICE: 'https://auth.chitty.test',
    CHITTY_REGISTRY_SERVICE: 'https://registry.chitty.test',
    CHITTY_DNA_SERVICE: 'https://dna.chitty.test',
    CHITTY_VERIFY_SERVICE: 'https://verify.chitty.test',
    CHITTY_CERTIFY_SERVICE: 'https://certify.chitty.test',
    CHITTY_CHRONICLE_SERVICE: 'https://chronicle.chitty.test',

    // Mock tokens
    CHITTY_ID_SERVICE_TOKEN: 'test-token-id',
    CHITTY_AUTH_SERVICE_TOKEN: 'test-token-auth',
    CHITTY_REGISTRY_SERVICE_TOKEN: 'test-token-registry',
    CHITTY_DNA_SERVICE_TOKEN: 'test-token-dna',
    CHITTY_VERIFY_SERVICE_TOKEN: 'test-token-verify',
    CHITTY_CERTIFY_SERVICE_TOKEN: 'test-token-certify',
    CHITTY_CHRONICLE_SERVICE_TOKEN: 'test-token-chronicle',

    // Mock bindings
    DB: createMockDB(),
    CHITTYCONNECT_KV: createMockKV(),
    TOKEN_KV: createMockKV(),
    CONTEXT_OPS_QUEUE: createMockQueue(),

    ...overrides,
  };
}

/**
 * Create mock D1 database
 */
export function createMockDB() {
  const data = new Map();

  return {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  };
}

/**
 * Create mock KV namespace
 */
export function createMockKV() {
  const store = new Map();

  return {
    get: async (key, options) => {
      const value = store.get(key);
      if (!value) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key, value, options) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async (options) => ({
      keys: Array.from(store.keys()).map(name => ({ name })),
    }),
  };
}

/**
 * Create mock Queue
 */
export function createMockQueue() {
  const messages = [];

  return {
    send: async (body) => {
      messages.push({ body, timestamp: new Date().toISOString() });
    },
    getMessages: () => messages,
    clear: () => messages.splice(0, messages.length),
  };
}

/**
 * Create mock execution context
 */
export function createMockContext() {
  const promises = [];

  return {
    waitUntil: (promise) => {
      promises.push(promise);
    },
    passThroughOnException: () => {},
    getPromises: () => promises,
  };
}
