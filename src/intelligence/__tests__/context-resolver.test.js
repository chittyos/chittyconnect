/**
 * Context Resolver Tests - Entity Type Canonical Compliance
 *
 * Verifies that mintChittyId uses canonical Person (P) entity type,
 * not invalid types like 'CONTEXT' or 'T' for context entities.
 *
 * @canon chittycanon://gov/governance#core-types
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextResolver } from '../context-resolver.js';

describe('ContextResolver', () => {
  let resolver;
  let mockEnv;

  beforeEach(() => {
    mockEnv = {
      DB: {},
      CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
      CHITTY_ID_TOKEN: 'test-token',
    };
    resolver = new ContextResolver(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mintChittyId - canonical entity type compliance', () => {
    it('should send entity_type "P" (Person) to ChittyID service, not "CONTEXT"', async () => {
      // Track what fetch receives
      let capturedBody = null;

      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ chitty_id: '03-1-USA-0001-P-2602-0-42' }),
        };
      }));

      await resolver.mintChittyId({
        projectPath: '/test/project',
        workspace: 'dev',
        supportType: 'development',
        organization: 'test-org',
      });

      expect(capturedBody).not.toBeNull();
      // @canon: chittycanon://gov/governance#core-types
      // Context entities are synthetic Persons (P) - never 'CONTEXT'
      expect(capturedBody.entity_type).toBe('P');
      expect(capturedBody.entity_type).not.toBe('CONTEXT');
    });

    it('should include characterization "Synthetic" in mint request', async () => {
      let capturedBody = null;

      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ chitty_id: '03-1-USA-0001-P-2602-0-42' }),
        };
      }));

      await resolver.mintChittyId({
        projectPath: '/test/project',
        workspace: 'dev',
        supportType: 'development',
        organization: 'test-org',
      });

      expect(capturedBody).not.toBeNull();
      // Claude/AI contexts are synthetic Persons
      expect(capturedBody.characterization).toBe('Synthetic');
    });

    it('should use type "P" (Person) in fallback local ID generation, not "T" (Thing)', async () => {
      // Make fetch fail so fallback is used
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('Service unavailable');
      }));

      const chittyId = await resolver.mintChittyId({
        projectPath: '/test/project',
        workspace: 'dev',
        supportType: 'development',
        organization: 'test-org',
      });

      // ChittyID format: VV-G-LLL-SSSS-T-YYMM-C-XX
      // The type position (5th segment) must be 'P', not 'T'
      const segments = chittyId.split('-');
      // segments: ['03', '1', 'USA', 'SSSS', 'P', 'YYMM', '0', 'XX']
      expect(segments[4]).toBe('P');
      expect(segments[4]).not.toBe('T');
    });
  });
});
