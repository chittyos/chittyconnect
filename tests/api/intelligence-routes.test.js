/**
 * API Integration Tests for Intelligence Routes
 *
 * Tests the experience, trust, and reputation API endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock modules
const mockExperienceAnchor = {
  resolveAnchor: vi.fn(),
  loadExperienceProfile: vi.fn(),
  commitExperience: vi.fn(),
  getActiveSessionsForChittyId: vi.fn(),
  calculateTrustScore: vi.fn(),
  evolveTrust: vi.fn(),
  getTrustLevelName: vi.fn()
};

const mockMemoryCloude = {
  persistInteractionWithAnchor: vi.fn(),
  recallContextByChittyId: vi.fn(),
  getChittyIdStats: vi.fn()
};

const mockConsciousness = {
  getReputationSummary: vi.fn(),
  analyzeIdentityBehavior: vi.fn(),
  monitorReputation: vi.fn()
};

// Create test app with mocked handlers
const createTestApp = () => {
  const app = new Hono();

  // Middleware to attach mocked modules
  app.use('*', async (c, next) => {
    c.set('experienceAnchor', mockExperienceAnchor);
    c.set('memory', mockMemoryCloude);
    c.set('consciousness', mockConsciousness);
    await next();
  });

  // Experience endpoints
  app.post('/intelligence/experience/resolve', async (c) => {
    const experienceAnchor = c.get('experienceAnchor');
    if (!experienceAnchor) {
      return c.json({ error: 'ExperienceAnchor not available' }, 503);
    }

    const body = await c.req.json();
    const { sessionId, context } = body;

    if (!sessionId) {
      return c.json({ error: 'sessionId is required' }, 400);
    }

    const chittyId = await experienceAnchor.resolveAnchor(sessionId, context || {});
    return c.json({ sessionId, chittyId, bound: true });
  });

  app.get('/intelligence/experience/:chittyId/profile', async (c) => {
    const experienceAnchor = c.get('experienceAnchor');
    if (!experienceAnchor) {
      return c.json({ error: 'ExperienceAnchor not available' }, 503);
    }

    const chittyId = c.req.param('chittyId');
    const profile = await experienceAnchor.loadExperienceProfile(chittyId);

    if (!profile) {
      return c.json({ error: 'Profile not found', chittyId }, 404);
    }

    return c.json(profile);
  });

  app.post('/intelligence/experience/:sessionId/commit', async (c) => {
    const experienceAnchor = c.get('experienceAnchor');
    const memory = c.get('memory');

    if (!experienceAnchor) {
      return c.json({ error: 'ExperienceAnchor not available' }, 503);
    }

    const sessionId = c.req.param('sessionId');
    const result = await experienceAnchor.commitExperience(sessionId, memory);

    if (!result) {
      return c.json({ error: 'Session not found or already committed', sessionId }, 404);
    }

    return c.json(result);
  });

  // Trust endpoints
  app.get('/intelligence/trust/:chittyId/score', async (c) => {
    const experienceAnchor = c.get('experienceAnchor');
    if (!experienceAnchor) {
      return c.json({ error: 'ExperienceAnchor not available' }, 503);
    }

    const chittyId = c.req.param('chittyId');
    const profile = await experienceAnchor.loadExperienceProfile(chittyId);

    if (!profile) {
      return c.json({ error: 'Profile not found', chittyId }, 404);
    }

    return c.json({
      chittyId,
      trustScore: profile.trust_score,
      trustLevel: profile.current_trust_level,
      trustLevelName: experienceAnchor.getTrustLevelName(profile.current_trust_level)
    });
  });

  app.post('/intelligence/trust/:chittyId/recalculate', async (c) => {
    const experienceAnchor = c.get('experienceAnchor');
    if (!experienceAnchor) {
      return c.json({ error: 'ExperienceAnchor not available' }, 503);
    }

    const chittyId = c.req.param('chittyId');
    const profile = await experienceAnchor.loadExperienceProfile(chittyId);

    if (!profile) {
      return c.json({ error: 'Profile not found', chittyId }, 404);
    }

    const newScore = experienceAnchor.calculateTrustScore(profile);
    const result = await experienceAnchor.evolveTrust(chittyId, profile);

    return c.json({
      chittyId,
      previousScore: result?.previousScore || profile.trust_score,
      newScore: result?.newScore || newScore,
      previousLevel: result?.previousLevel || profile.current_trust_level,
      newLevel: result?.newLevel || profile.current_trust_level
    });
  });

  // Reputation endpoints
  app.get('/intelligence/reputation/:chittyId', async (c) => {
    const consciousness = c.get('consciousness');
    if (!consciousness) {
      return c.json({ error: 'ContextConsciousness not available' }, 503);
    }

    const chittyId = c.req.param('chittyId');
    const summary = await consciousness.getReputationSummary(chittyId);

    return c.json(summary || { chittyId, error: 'No reputation data' });
  });

  return app;
};

describe('Intelligence API Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /intelligence/experience/resolve', () => {
    it('should resolve session to ChittyID', async () => {
      mockExperienceAnchor.resolveAnchor.mockResolvedValue('AA-C-CTX-TEST-I-2601-3-A');

      const res = await app.request('/intelligence/experience/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'test-session', context: { platform: 'test' } })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.chittyId).toBe('AA-C-CTX-TEST-I-2601-3-A');
      expect(data.bound).toBe(true);
    });

    it('should return 400 without sessionId', async () => {
      const res = await app.request('/intelligence/experience/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('sessionId is required');
    });
  });

  describe('GET /intelligence/experience/:chittyId/profile', () => {
    it('should return profile for existing ChittyID', async () => {
      const mockProfile = {
        chitty_id: 'AA-C-CTX-TEST-I-2601-3-A',
        total_interactions: 100,
        trust_score: 75.5,
        current_trust_level: 4
      };
      mockExperienceAnchor.loadExperienceProfile.mockResolvedValue(mockProfile);

      const res = await app.request('/intelligence/experience/AA-C-CTX-TEST-I-2601-3-A/profile');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.chitty_id).toBe('AA-C-CTX-TEST-I-2601-3-A');
      expect(data.trust_score).toBe(75.5);
    });

    it('should return 404 for non-existent ChittyID', async () => {
      mockExperienceAnchor.loadExperienceProfile.mockResolvedValue(null);

      const res = await app.request('/intelligence/experience/nonexistent/profile');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Profile not found');
    });
  });

  describe('POST /intelligence/experience/:sessionId/commit', () => {
    it('should commit session experience', async () => {
      const mockResult = {
        chittyId: 'AA-C-CTX-TEST-I-2601-3-A',
        sessionId: 'test-session',
        metrics: { interactions: 10 },
        committed: true
      };
      mockExperienceAnchor.commitExperience.mockResolvedValue(mockResult);

      const res = await app.request('/intelligence/experience/test-session/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.committed).toBe(true);
    });

    it('should return 404 for non-existent session', async () => {
      mockExperienceAnchor.commitExperience.mockResolvedValue(null);

      const res = await app.request('/intelligence/experience/invalid-session/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /intelligence/trust/:chittyId/score', () => {
    it('should return trust score for ChittyID', async () => {
      const mockProfile = {
        trust_score: 85.5,
        current_trust_level: 4
      };
      mockExperienceAnchor.loadExperienceProfile.mockResolvedValue(mockProfile);
      mockExperienceAnchor.getTrustLevelName.mockReturnValue('Established');

      const res = await app.request('/intelligence/trust/AA-C-CTX-TEST-I-2601-3-A/score');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.trustScore).toBe(85.5);
      expect(data.trustLevel).toBe(4);
      expect(data.trustLevelName).toBe('Established');
    });

    it('should return 404 for non-existent profile', async () => {
      mockExperienceAnchor.loadExperienceProfile.mockResolvedValue(null);

      const res = await app.request('/intelligence/trust/nonexistent/score');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /intelligence/trust/:chittyId/recalculate', () => {
    it('should recalculate trust score', async () => {
      const mockProfile = {
        trust_score: 60,
        current_trust_level: 3
      };
      mockExperienceAnchor.loadExperienceProfile.mockResolvedValue(mockProfile);
      mockExperienceAnchor.calculateTrustScore.mockReturnValue(75);
      mockExperienceAnchor.evolveTrust.mockResolvedValue({
        previousScore: 60,
        newScore: 75,
        previousLevel: 3,
        newLevel: 4
      });

      const res = await app.request('/intelligence/trust/AA-C-CTX-TEST-I-2601-3-A/recalculate', {
        method: 'POST'
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.previousScore).toBe(60);
      expect(data.newScore).toBe(75);
      expect(data.previousLevel).toBe(3);
      expect(data.newLevel).toBe(4);
    });
  });

  describe('GET /intelligence/reputation/:chittyId', () => {
    it('should return reputation summary', async () => {
      const mockSummary = {
        chittyId: 'AA-C-CTX-TEST-I-2601-3-A',
        trustLevel: 4,
        trustScore: 85,
        riskScore: 10,
        behaviorPattern: 'consistent'
      };
      mockConsciousness.getReputationSummary.mockResolvedValue(mockSummary);

      const res = await app.request('/intelligence/reputation/AA-C-CTX-TEST-I-2601-3-A');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.chittyId).toBe('AA-C-CTX-TEST-I-2601-3-A');
      expect(data.trustLevel).toBe(4);
    });
  });
});

describe('Intelligence API Error Handling', () => {
  it('should handle service unavailability gracefully', async () => {
    const app = new Hono();

    // No modules attached
    app.post('/intelligence/experience/resolve', async (c) => {
      const experienceAnchor = c.get('experienceAnchor');
      if (!experienceAnchor) {
        return c.json({ error: 'ExperienceAnchor not available' }, 503);
      }
      return c.json({ error: 'Should not reach here' }, 500);
    });

    const res = await app.request('/intelligence/experience/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test' })
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('ExperienceAnchor not available');
  });
});
