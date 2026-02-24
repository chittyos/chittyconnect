/**
 * Integration Tests for ExperienceAnchor
 *
 * Tests session-to-ChittyID binding, trust evolution, and experience accumulation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExperienceAnchor } from '../../src/intelligence/experience-anchor.js';

// Mock environment
const createMockEnv = () => ({
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true })
    }))
  },
  MEMORY_KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  TOKEN_KV: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
  CHITTY_ID_SERVICE_TOKEN: 'test-token'
});

describe('ExperienceAnchor', () => {
  let anchor;
  let mockEnv;

  beforeEach(() => {
    mockEnv = createMockEnv();
    anchor = new ExperienceAnchor(mockEnv);
  });

  describe('Constructor', () => {
    it('should initialize with correct trust weights', () => {
      expect(anchor.trustWeights).toEqual({
        experienceVolume: 0.20,
        successRate: 0.30,
        anomalyPenalty: 0.20,
        sessionQuality: 0.15,
        recency: 0.15
      });
    });

    it('should initialize with correct trust thresholds', () => {
      expect(anchor.trustThresholds).toHaveLength(6);
      expect(anchor.trustThresholds[0]).toEqual({
        level: 5,
        minScore: 90,
        name: 'Exemplary'
      });
    });

    it('should fallback to TOKEN_KV when MEMORY_KV is not available', () => {
      const envWithoutMemoryKV = { ...mockEnv, MEMORY_KV: null };
      const anchorWithFallback = new ExperienceAnchor(envWithoutMemoryKV);
      expect(anchorWithFallback.kv).toBe(envWithoutMemoryKV.TOKEN_KV);
    });
  });

  describe('initialize()', () => {
    it('should complete initialization without errors', async () => {
      await expect(anchor.initialize()).resolves.not.toThrow();
    });
  });

  describe('generateLocalChittyId()', () => {
    it('should generate valid canonical ChittyID format with type P', () => {
      const context = { platform: 'TEST' };
      const chittyId = anchor.generateLocalChittyId(context);

      // Canonical format: VV-G-LLL-SSSS-P-YYMM-C-X
      // @canon: chittycanon://gov/governance#core-types
      expect(chittyId).toMatch(/^03-1-USA-[A-Z0-9]{4}-P-\d{4}-0-[A-Z0-9]$/);
    });

    it('should use USA as location segment regardless of platform', () => {
      const context = {};
      const chittyId = anchor.generateLocalChittyId(context);

      expect(chittyId).toContain('-USA-');
    });
  });

  describe('buildFingerprint()', () => {
    it('should build fingerprint from context components', () => {
      const context = {
        userId: 'user123',
        platform: 'claude',
        fingerprint: 'fp_abc',
        ipHash: 'hash_xyz'
      };

      const fingerprint = anchor.buildFingerprint(context);

      expect(fingerprint).toBe('user:user123|platform:claude|fp:fp_abc|ip:hash_xyz');
    });

    it('should return unknown for empty context', () => {
      expect(anchor.buildFingerprint({})).toBe('unknown');
    });
  });

  describe('trustScoreToLevel()', () => {
    it('should map score 95 to level 5 (Exemplary)', () => {
      expect(anchor.trustScoreToLevel(95)).toBe(5);
    });

    it('should map score 80 to level 4 (Established)', () => {
      expect(anchor.trustScoreToLevel(80)).toBe(4);
    });

    it('should map score 60 to level 3 (Standard)', () => {
      expect(anchor.trustScoreToLevel(60)).toBe(3);
    });

    it('should map score 30 to level 2 (Probationary)', () => {
      expect(anchor.trustScoreToLevel(30)).toBe(2);
    });

    it('should map score 15 to level 1 (Limited)', () => {
      expect(anchor.trustScoreToLevel(15)).toBe(1);
    });

    it('should map score 5 to level 0 (Restricted)', () => {
      expect(anchor.trustScoreToLevel(5)).toBe(0);
    });
  });

  describe('getTrustLevelName()', () => {
    it('should return correct names for all levels', () => {
      expect(anchor.getTrustLevelName(5)).toBe('Exemplary');
      expect(anchor.getTrustLevelName(4)).toBe('Established');
      expect(anchor.getTrustLevelName(3)).toBe('Standard');
      expect(anchor.getTrustLevelName(2)).toBe('Probationary');
      expect(anchor.getTrustLevelName(1)).toBe('Limited');
      expect(anchor.getTrustLevelName(0)).toBe('Restricted');
    });

    it('should return Unknown for invalid level', () => {
      expect(anchor.getTrustLevelName(99)).toBe('Unknown');
    });
  });

  describe('calculateTrustScore()', () => {
    it('should calculate score for new profile', () => {
      const profile = {
        total_interactions: 0,
        total_decisions: 0,
        total_entities: 0,
        success_rate: 0,
        anomaly_count: 0,
        risk_score: 0
      };

      const score = anchor.calculateTrustScore(profile);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should increase score with more interactions', () => {
      const baseProfile = {
        total_interactions: 10,
        total_decisions: 5,
        total_entities: 3,
        success_rate: 0.8,
        anomaly_count: 0,
        risk_score: 0
      };

      const highVolumeProfile = {
        ...baseProfile,
        total_interactions: 1000,
        total_decisions: 500,
        total_entities: 200
      };

      const baseScore = anchor.calculateTrustScore(baseProfile);
      const highVolumeScore = anchor.calculateTrustScore(highVolumeProfile);

      expect(highVolumeScore).toBeGreaterThan(baseScore);
    });

    it('should penalize for anomalies', () => {
      const cleanProfile = {
        total_interactions: 100,
        total_decisions: 50,
        total_entities: 20,
        success_rate: 0.9,
        anomaly_count: 0,
        risk_score: 0
      };

      const anomalyProfile = {
        ...cleanProfile,
        anomaly_count: 5
      };

      const cleanScore = anchor.calculateTrustScore(cleanProfile);
      const anomalyScore = anchor.calculateTrustScore(anomalyProfile);

      expect(anomalyScore).toBeLessThan(cleanScore);
    });

    it('should reward high success rate', () => {
      const lowSuccessProfile = {
        total_interactions: 100,
        total_decisions: 50,
        total_entities: 20,
        success_rate: 0.3,
        anomaly_count: 0,
        risk_score: 0
      };

      const highSuccessProfile = {
        ...lowSuccessProfile,
        success_rate: 0.95
      };

      const lowScore = anchor.calculateTrustScore(lowSuccessProfile);
      const highScore = anchor.calculateTrustScore(highSuccessProfile);

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('extractUniqueEntities()', () => {
    it('should extract unique entities from interactions', () => {
      const interactions = [
        { entities: [{ type: 'user', id: '1' }, { type: 'repo', id: 'a' }] },
        { entities: [{ type: 'user', id: '1' }, { type: 'repo', id: 'b' }] },
        { entities: [{ type: 'issue', id: '10' }] }
      ];

      const entities = anchor.extractUniqueEntities(interactions);

      expect(entities).toHaveLength(4);
      expect(entities).toContain('user:1');
      expect(entities).toContain('repo:a');
      expect(entities).toContain('repo:b');
      expect(entities).toContain('issue:10');
    });

    it('should return empty array for no entities', () => {
      const interactions = [
        { type: 'query' },
        { type: 'decision' }
      ];

      const entities = anchor.extractUniqueEntities(interactions);
      expect(entities).toHaveLength(0);
    });
  });

  describe('calculateSessionSuccess()', () => {
    it('should calculate success rate correctly', () => {
      const interactions = [
        { success: true },
        { success: true },
        { result: 'success' },
        { success: false },
        { completed: true }
      ];

      const rate = anchor.calculateSessionSuccess(interactions);
      expect(rate).toBe(0.8); // 4/5
    });

    it('should return 0 for empty interactions', () => {
      expect(anchor.calculateSessionSuccess([])).toBe(0);
    });
  });

  describe('hashContent()', () => {
    it('should produce consistent SHA-256 hash', async () => {
      const content = 'test content';
      const hash1 = await anchor.hashContent(content);
      const hash2 = await anchor.hashContent(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different content', async () => {
      const hash1 = await anchor.hashContent('content1');
      const hash2 = await anchor.hashContent('content2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Session Binding', () => {
    describe('getSessionBinding()', () => {
      it('should return cached binding if available', async () => {
        const cachedBinding = {
          session_id: 'session-123',
          chitty_id: 'AA-C-CTX-TEST-I-2601-3-A'
        };
        mockEnv.MEMORY_KV.get.mockResolvedValueOnce(cachedBinding);

        const result = await anchor.getSessionBinding('session-123');

        expect(result).toEqual(cachedBinding);
        expect(mockEnv.MEMORY_KV.get).toHaveBeenCalledWith('binding:session-123', 'json');
      });

      it('should query database if not cached', async () => {
        const dbBinding = {
          session_id: 'session-456',
          chitty_id: 'AA-C-CTX-DB01-I-2601-3-B'
        };

        mockEnv.DB.prepare.mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(dbBinding)
        });

        const result = await anchor.getSessionBinding('session-456');

        expect(result).toEqual(dbBinding);
      });

      it('should return null when not found', async () => {
        const result = await anchor.getSessionBinding('nonexistent');
        expect(result).toBeNull();
      });
    });

    describe('bindSession()', () => {
      it('should store binding in database and cache', async () => {
        const sessionId = 'new-session';
        const chittyId = 'AA-C-CTX-NEW1-I-2601-3-X';
        const context = { platform: 'test' };

        await anchor.bindSession(sessionId, chittyId, context);

        expect(mockEnv.DB.prepare).toHaveBeenCalled();
        expect(mockEnv.MEMORY_KV.put).toHaveBeenCalled();
      });
    });
  });

  describe('Experience Profile', () => {
    describe('createExperienceProfile()', () => {
      it('should create profile with default values', async () => {
        const chittyId = 'AA-C-CTX-PROF-I-2601-3-Y';
        const result = await anchor.createExperienceProfile(chittyId);

        expect(result.chitty_id).toBe(chittyId);
        expect(result.current_trust_level).toBe(3);
        expect(result.trust_score).toBe(50.00);
        expect(result.total_interactions).toBe(0);
      });
    });

    describe('loadExperienceProfile()', () => {
      it('should return cached profile if available', async () => {
        const cachedProfile = {
          chitty_id: 'AA-C-CTX-CACH-I-2601-3-Z',
          trust_score: 75,
          current_trust_level: 4
        };
        mockEnv.MEMORY_KV.get.mockResolvedValueOnce(cachedProfile);

        const result = await anchor.loadExperienceProfile('AA-C-CTX-CACH-I-2601-3-Z');

        expect(result).toEqual(cachedProfile);
      });

      it('should query database if not cached', async () => {
        const dbProfile = {
          chitty_id: 'AA-C-CTX-DBPR-I-2601-3-W',
          trust_score: 60,
          expertise_domains: '["coding", "analysis"]'
        };

        mockEnv.DB.prepare.mockReturnValueOnce({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(dbProfile)
        });

        const result = await anchor.loadExperienceProfile('AA-C-CTX-DBPR-I-2601-3-W');

        expect(result).toBeDefined();
        expect(result.expertise_domains).toEqual(['coding', 'analysis']);
      });
    });
  });
});
