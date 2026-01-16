/**
 * Test Helpers and Mock Factories
 *
 * Common mocks for testing ChittyConnect components.
 */

import { vi } from 'vitest';

/**
 * Create a mock Cloudflare environment
 */
export const createMockEnv = (overrides = {}) => ({
  DB: createMockD1(),
  MEMORY_KV: createMockKV(),
  TOKEN_KV: createMockKV(),
  IDEMP_KV: createMockKV(),
  API_KEYS: createMockKV(),
  CREDENTIAL_CACHE: createMockKV(),
  MEMORY_VECTORIZE: createMockVectorize(),
  CONTEXT_VECTORIZE: createMockVectorize(),
  AI: createMockAI(),
  FILES: createMockR2(),
  EVENT_Q: createMockQueue(),
  MCP_SESSIONS: createMockDurableObject(),
  CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
  CHITTY_ID_SERVICE_TOKEN: 'test-token',
  REGISTRY_SERVICE_URL: 'https://registry.chitty.cc',
  CHITTYOS_ACCOUNT_ID: 'test-account-id',
  CHITTYOS_DOMAIN: 'chitty.cc',
  ...overrides
});

/**
 * Create mock D1 database
 */
export const createMockD1 = () => ({
  prepare: vi.fn(() => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  })),
  batch: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue({ success: true })
});

/**
 * Create mock KV namespace
 */
export const createMockKV = () => ({
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ keys: [], cursor: null, list_complete: true }),
  getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null })
});

/**
 * Create mock Vectorize index
 */
export const createMockVectorize = () => ({
  query: vi.fn().mockResolvedValue({ matches: [] }),
  insert: vi.fn().mockResolvedValue({ count: 1 }),
  upsert: vi.fn().mockResolvedValue({ count: 1 }),
  delete: vi.fn().mockResolvedValue({ count: 1 }),
  getByIds: vi.fn().mockResolvedValue({ vectors: [] })
});

/**
 * Create mock Workers AI
 */
export const createMockAI = () => ({
  run: vi.fn().mockResolvedValue({
    response: 'AI response',
    data: [Array(768).fill(0)] // Mock embedding
  })
});

/**
 * Create mock R2 bucket
 */
export const createMockR2 = () => ({
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
  head: vi.fn().mockResolvedValue(null)
});

/**
 * Create mock Queue
 */
export const createMockQueue = () => ({
  send: vi.fn().mockResolvedValue(undefined),
  sendBatch: vi.fn().mockResolvedValue(undefined)
});

/**
 * Create mock Durable Object
 */
export const createMockDurableObject = () => ({
  idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
  idFromString: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
  get: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response('{}'))
  })
});

/**
 * Create mock ExperienceAnchor
 */
export const createMockExperienceAnchor = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  resolveAnchor: vi.fn().mockResolvedValue('AA-C-CTX-TEST-I-2601-3-A'),
  getSessionBinding: vi.fn().mockResolvedValue(null),
  bindSession: vi.fn().mockResolvedValue({}),
  loadExperienceProfile: vi.fn().mockResolvedValue(null),
  createExperienceProfile: vi.fn().mockResolvedValue({}),
  updateExperienceProfile: vi.fn().mockResolvedValue(undefined),
  commitExperience: vi.fn().mockResolvedValue(null),
  evolveTrust: vi.fn().mockResolvedValue(null),
  calculateTrustScore: vi.fn().mockReturnValue(50),
  trustScoreToLevel: vi.fn().mockReturnValue(3),
  getTrustLevelName: vi.fn().mockReturnValue('Standard'),
  getChittyIdForSession: vi.fn().mockResolvedValue(null),
  getActiveSessionsForChittyId: vi.fn().mockResolvedValue([])
});

/**
 * Create mock MemoryCloude
 */
export const createMockMemoryCloude = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  persistInteraction: vi.fn().mockResolvedValue('interaction-id'),
  persistInteractionWithAnchor: vi.fn().mockResolvedValue('interaction-id'),
  recallContext: vi.fn().mockResolvedValue({ interactions: [], summary: '' }),
  recallContextByChittyId: vi.fn().mockResolvedValue({ interactions: [], summary: '' }),
  getStats: vi.fn().mockResolvedValue({ count: 0 }),
  getChittyIdStats: vi.fn().mockResolvedValue({ count: 0 }),
  getSessionInteractions: vi.fn().mockResolvedValue([]),
  migrateSessionToChittyId: vi.fn().mockResolvedValue({ migrated: 0 })
});

/**
 * Create mock ContextConsciousness
 */
export const createMockContextConsciousness = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  monitorEcosystem: vi.fn().mockResolvedValue({ status: 'healthy' }),
  analyzeAnomalies: vi.fn().mockResolvedValue([]),
  getReputationSummary: vi.fn().mockResolvedValue(null),
  analyzeIdentityBehavior: vi.fn().mockResolvedValue({}),
  monitorReputation: vi.fn().mockResolvedValue({ monitored: true })
});

/**
 * Create mock CognitiveCoordinator
 */
export const createMockCognitiveCoordinator = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  coordinate: vi.fn().mockResolvedValue({ result: 'success' }),
  getStatus: vi.fn().mockResolvedValue({ active: 0, pending: 0 })
});

/**
 * Create mock Hono context
 */
export const createMockContext = (overrides = {}) => {
  const store = new Map();
  return {
    req: {
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(''),
      param: vi.fn().mockReturnValue(''),
      query: vi.fn().mockReturnValue(null),
      header: vi.fn().mockReturnValue(null),
      raw: new Request('http://localhost'),
      ...overrides.req
    },
    json: vi.fn().mockImplementation((data, status) => new Response(JSON.stringify(data), { status: status || 200 })),
    text: vi.fn().mockImplementation((text, status) => new Response(text, { status: status || 200 })),
    set: vi.fn().mockImplementation((key, value) => store.set(key, value)),
    get: vi.fn().mockImplementation((key) => store.get(key)),
    env: createMockEnv(),
    ...overrides
  };
};

/**
 * Create a sample ChittyID for testing
 */
export const createSampleChittyId = (overrides = {}) => ({
  technicalId: 'AA-C-CTX-TEST-I-2601-3-A',
  type: 'context_identity',
  trustLevel: 3,
  ...overrides
});

/**
 * Create a sample experience profile for testing
 */
export const createSampleProfile = (overrides = {}) => ({
  id: 'profile-uuid',
  chitty_id: 'AA-C-CTX-TEST-I-2601-3-A',
  total_interactions: 100,
  total_decisions: 50,
  total_entities: 25,
  current_trust_level: 3,
  trust_score: 65.5,
  expertise_domains: ['coding', 'analysis'],
  success_rate: 0.85,
  confidence_score: 70.0,
  risk_score: 10.0,
  anomaly_count: 1,
  first_seen: new Date('2025-01-01').toISOString(),
  oldest_interaction: new Date('2025-06-01').toISOString(),
  newest_interaction: new Date().toISOString(),
  trust_last_calculated: new Date().toISOString(),
  created_at: new Date('2025-01-01').toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
});

/**
 * Create a sample session binding for testing
 */
export const createSampleBinding = (overrides = {}) => ({
  session_id: 'test-session-123',
  chitty_id: 'AA-C-CTX-TEST-I-2601-3-A',
  platform: 'test',
  client_fingerprint: 'user:test|platform:test',
  bound_at: new Date().toISOString(),
  last_activity: new Date().toISOString(),
  interactions_count: 10,
  decisions_count: 5,
  entities_discovered: 3,
  session_risk_score: 5.0,
  unbound_at: null,
  unbind_reason: null,
  ...overrides
});
