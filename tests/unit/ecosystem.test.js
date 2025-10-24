/**
 * Unit Tests for ChittyOS Ecosystem Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChittyOSEcosystem } from '../../src/integrations/chittyos-ecosystem.js';
import {
  createMockEnv,
  createMockContext,
  createMockFetch,
  mockChittyID,
  mockChittyAuth,
  mockChittyRegistry,
  mockChittyDNA,
} from '../helpers/mock-chittyos.js';

describe('ChittyOSEcosystem', () => {
  let env;
  let ctx;
  let ecosystem;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();

    // Mock global fetch
    global.fetch = createMockFetch();

    ecosystem = new ChittyOSEcosystem(env, ctx);
  });

  describe('Service Discovery', () => {
    it('should discover ChittyOS services', async () => {
      const services = await ecosystem.discoverServices();

      expect(services).toBeDefined();
      expect(services.chittyid).toBe('https://id.chitty.cc');
      expect(services.chittyauth).toBe('https://auth.chitty.cc');
      expect(services.chittyregistry).toBe('https://registry.chitty.cc');
    });

    it('should cache service discovery results', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      // First call
      await ecosystem.discoverServices();
      const firstCallCount = fetchSpy.mock.calls.length;

      // Second call (should use cache)
      await ecosystem.discoverServices();
      const secondCallCount = fetchSpy.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount); // No additional calls
    });

    it('should fallback to environment URLs on discovery failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const services = await ecosystem.discoverServices();

      expect(services.chittyid).toBe(env.CHITTY_ID_SERVICE);
      expect(services.chittyauth).toBe(env.CHITTY_AUTH_SERVICE);
    });
  });

  describe('ChittyID Integration', () => {
    it('should mint ChittyID successfully', async () => {
      const result = await ecosystem.mintChittyID('CONTEXT', {
        name: 'Test Context',
      });

      expect(result.success).toBe(true);
      expect(result.chittyId).toMatch(/^CHITTY-CONTEXT-/);
      expect(result.authority).toBe('id.chitty.cc');
    });

    it('should include metadata when minting', async () => {
      const metadata = { name: 'Test', owner: 'CHITTY-ACTOR-123' };

      const result = await ecosystem.mintChittyID('CONTEXT', metadata);

      expect(result.metadata).toEqual(metadata);
    });

    it('should handle minting failures', async () => {
      global.fetch = createMockFetch({
        mintChittyID: mockChittyID.mintFailure('Service unavailable'),
      });

      const result = await ecosystem.mintChittyID('CONTEXT', {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate ChittyID format', async () => {
      const validId = 'CHITTY-CONTEXT-abc123';
      const result = await ecosystem.validateChittyID(validId);

      expect(result.valid).toBe(true);
      expect(result.chittyId).toBe(validId);
    });
  });

  describe('ChittyAuth Integration', () => {
    it('should validate actor with valid token', async () => {
      const actor = await ecosystem.validateActor('Bearer valid-token');

      expect(actor).toBeDefined();
      expect(actor.chittyId).toMatch(/^CHITTY-ACTOR-/);
      expect(actor.valid).toBe(true);
    });

    it('should reject invalid authorization', async () => {
      global.fetch = createMockFetch({
        validateActor: mockChittyAuth.validateActorFailure(),
      });

      const actor = await ecosystem.validateActor('Bearer invalid-token');

      expect(actor).toBeNull();
    });

    it('should handle missing authorization header', async () => {
      const actor = await ecosystem.validateActor(null);

      expect(actor).toBeNull();
    });

    it('should request API keys for actor', async () => {
      const result = await ecosystem.requestAPIKeys('CHITTY-ACTOR-123', ['contexts:read']);

      expect(result.success).toBe(true);
      expect(result.api_key).toMatch(/^chitty_test_/);
      expect(result.scopes).toContain('contexts:read');
    });
  });

  describe('ChittyDNA Integration', () => {
    it('should initialize DNA for new entity', async () => {
      const result = await ecosystem.initializeDNA('CHITTY-CONTEXT-123', 'context', {
        name: 'Test Context',
      });

      expect(result.success).toBe(true);
      expect(result.dna_id).toMatch(/^DNA-/);
      expect(result.entity_type).toBe('context');
    });

    it('should track evolution events', async () => {
      const result = await ecosystem.trackEvolution('CHITTY-CONTEXT-123', 'context.updated', {
        field: 'name',
      });

      expect(result.success).toBe(true);
      expect(result.event).toBe('context.updated');
    });

    it('should handle DNA initialization failures gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('DNA service down'));

      const result = await ecosystem.initializeDNA('CHITTY-CONTEXT-123', 'context', {});

      // Should not throw, but return failure
      expect(result.success).toBe(false);
    });
  });

  describe('Service Context Initialization', () => {
    it('should initialize service context with all steps', async () => {
      const result = await ecosystem.initializeServiceContext('chittyconnect', {
        version: '1.0.0',
      });

      expect(result.success).toBe(true);
      expect(result.steps_completed).toBeGreaterThan(0);
    });

    it('should register with ChittyRegistry', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      await ecosystem.initializeServiceContext('chittyconnect', {});

      // Should call registry.chitty.cc/v1/register
      const registryCalls = fetchSpy.mock.calls.filter(call =>
        call[0].includes('registry.chitty') && call[0].includes('/v1/register')
      );

      expect(registryCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Health Checks', () => {
    it('should check health of all services', async () => {
      const health = await ecosystem.getAllServicesHealth();

      expect(health).toBeDefined();
      expect(health.chittyid).toBeDefined();
      expect(health.chittyauth).toBeDefined();
    });

    it('should report unhealthy services', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'healthy' })))
        .mockRejectedValueOnce(new Error('Service down'));

      const health = await ecosystem.getAllServicesHealth();

      const unhealthyServices = Object.values(health).filter(s => s.status === 'unhealthy');
      expect(unhealthyServices.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      // Should not throw
      const result = await ecosystem.mintChittyID('CONTEXT', {});
      expect(result.success).toBe(false);
    });

    it('should handle timeout errors', async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 10000))
      );

      // Should timeout and handle gracefully
      const result = await ecosystem.discoverServices();
      expect(result).toBeDefined();
    });

    it('should handle invalid JSON responses', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response('invalid json', {
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await ecosystem.mintChittyID('CONTEXT', {});
      expect(result.success).toBe(false);
    });
  });

  describe('ChittyID Authority Compliance', () => {
    it('should never generate ChittyIDs locally', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      await ecosystem.mintChittyID('CONTEXT', {});

      // Verify fetch was called to id.chitty.cc
      const idServiceCalls = fetchSpy.mock.calls.filter(call =>
        call[0].includes('id.chitty')
      );

      expect(idServiceCalls.length).toBeGreaterThan(0);
    });

    it('should use authority-minted IDs only', async () => {
      const result = await ecosystem.mintChittyID('CONTEXT', {});

      expect(result.authority).toBe('id.chitty.cc');
      expect(result.chittyId).not.toMatch(/^local-/); // No local prefix
      expect(result.chittyId).not.toMatch(/^temp-/); // No temp prefix
    });
  });
});
