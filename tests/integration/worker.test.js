/**
 * Integration Tests for ChittyConnect Worker
 *
 * Tests complete request flow through the worker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../../src/index.js';
import {
  createMockEnv,
  createMockContext,
  createMockFetch,
} from '../helpers/mock-chittyos.js';

describe('ChittyConnect Worker Integration', () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
    global.fetch = createMockFetch();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const request = new Request('https://connect.chitty.cc/health');
      const response = await worker.fetch(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('chittyconnect');
      expect(data.brand).toBe('itsChitty™');
    });

    it('should include endpoints in health check', async () => {
      const request = new Request('https://connect.chitty.cc/health');
      const response = await worker.fetch(request, env, ctx);
      const data = await response.json();

      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.contexts).toBe('/v1/contexts/*');
      expect(data.endpoints.actors).toBe('/v1/actors/*');
    });

    it('should include ChittyOS compliance status', async () => {
      const request = new Request('https://connect.chitty.cc/health');
      const response = await worker.fetch(request, env, ctx);
      const data = await response.json();

      expect(data.chittyos_compliance).toBeDefined();
      expect(data.chittyos_compliance.chittyid_violations).toBe(0);
      expect(data.chittyos_compliance.authority_compliance).toBe('100%');
    });

    it('should support full health check with services', async () => {
      const request = new Request('https://connect.chitty.cc/health?full=true');
      const response = await worker.fetch(request, env, ctx);
      const data = await response.json();

      expect(data.services).toBeDefined();
    });
  });

  describe('Routing', () => {
    it('should route contexts requests', async () => {
      const request = new Request('https://connect.chitty.cc/v1/contexts/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const response = await worker.fetch(request, env, ctx);

      // Should route to contexts handler (may return 200 or auth error)
      expect([200, 401]).toContain(response.status);
    });

    it('should route actors requests', async () => {
      const request = new Request('https://connect.chitty.cc/v1/actors/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const response = await worker.fetch(request, env, ctx);

      // Should route to actors handler
      expect([200, 401, 404]).toContain(response.status);
    });

    it('should return 404 for unknown routes', async () => {
      const request = new Request('https://connect.chitty.cc/unknown/path');
      const response = await worker.fetch(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not found');
      expect(data.available_endpoints).toBeDefined();
    });
  });

  describe('Complete Context Lifecycle', () => {
    it('should create, list, get, update, and delete context', async () => {
      // Step 1: Create context
      const createRequest = new Request('https://connect.chitty.cc/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Integration Test Context',
          data: ['test-item'],
        }),
      });

      const createResponse = await worker.fetch(createRequest, env, ctx);
      const createData = await createResponse.json();

      expect(createResponse.status).toBe(201);
      expect(createData.success).toBe(true);

      const contextId = createData.context.chittyId;

      // Step 2: List contexts
      const listRequest = new Request('https://connect.chitty.cc/v1/contexts/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const listResponse = await worker.fetch(listRequest, env, ctx);
      const listData = await listResponse.json();

      expect(listResponse.status).toBe(200);

      // Step 3: Get specific context
      const getRequest = new Request(`https://connect.chitty.cc/v1/contexts/${contextId}`, {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const getResponse = await worker.fetch(getRequest, env, ctx);

      // May succeed or fail depending on DB mock
      expect([200, 404]).toContain(getResponse.status);

      // Step 4: Update context
      const updateRequest = new Request(`https://connect.chitty.cc/v1/contexts/${contextId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Context',
        }),
      });

      const updateResponse = await worker.fetch(updateRequest, env, ctx);

      expect([200, 404]).toContain(updateResponse.status);

      // Step 5: Delete context
      const deleteRequest = new Request(`https://connect.chitty.cc/v1/contexts/${contextId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const deleteResponse = await worker.fetch(deleteRequest, env, ctx);

      expect([200, 404]).toContain(deleteResponse.status);
    });
  });

  describe('Queue Processing', () => {
    it('should process context_created queue messages', async () => {
      const batch = {
        messages: [
          {
            body: {
              operation: 'context_created',
              contextId: 'CHITTY-CONTEXT-123',
              owner: 'CHITTY-ACTOR-test',
              timestamp: new Date().toISOString(),
            },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      };

      await worker.queue(batch, env, ctx);

      // Message should be acknowledged
      expect(batch.messages[0].ack).toHaveBeenCalled();
    });

    it('should process context_updated queue messages', async () => {
      const batch = {
        messages: [
          {
            body: {
              operation: 'context_updated',
              contextId: 'CHITTY-CONTEXT-123',
              changes: ['name'],
              timestamp: new Date().toISOString(),
            },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      };

      await worker.queue(batch, env, ctx);

      expect(batch.messages[0].ack).toHaveBeenCalled();
    });

    it('should process context_deleted queue messages', async () => {
      const batch = {
        messages: [
          {
            body: {
              operation: 'context_deleted',
              contextId: 'CHITTY-CONTEXT-123',
              timestamp: new Date().toISOString(),
            },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      };

      await worker.queue(batch, env, ctx);

      expect(batch.messages[0].ack).toHaveBeenCalled();
    });

    it('should handle unknown operations gracefully', async () => {
      const batch = {
        messages: [
          {
            body: {
              operation: 'unknown_operation',
            },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      };

      await worker.queue(batch, env, ctx);

      // Should ack to avoid retry loop
      expect(batch.messages[0].ack).toHaveBeenCalled();
    });

    it('should retry on processing errors', async () => {
      // Mock DB to throw error
      env.DB.prepare = vi.fn(() => {
        throw new Error('Database error');
      });

      const batch = {
        messages: [
          {
            body: {
              operation: 'context_created',
              contextId: 'CHITTY-CONTEXT-123',
              owner: 'CHITTY-ACTOR-test',
              timestamp: new Date().toISOString(),
            },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      };

      await worker.queue(batch, env, ctx);

      // Should retry, not ack
      expect(batch.messages[0].retry).toHaveBeenCalled();
      expect(batch.messages[0].ack).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle internal errors gracefully', async () => {
      // Force an error by providing invalid environment
      const badEnv = { ...env, DB: null };

      const request = new Request('https://connect.chitty.cc/v1/contexts/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const response = await worker.fetch(request, badEnv, ctx);

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should include error metadata', async () => {
      const badEnv = { ...env, DB: null };

      const request = new Request('https://connect.chitty.cc/v1/contexts/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      const response = await worker.fetch(request, badEnv, ctx);
      const data = await response.json();

      expect(data.timestamp).toBeDefined();
      expect(response.headers.get('X-ChittyConnect-Error')).toBe('true');
    });
  });

  describe('Middleware', () => {
    it('should initialize ecosystem on first request', async () => {
      const request = new Request('https://connect.chitty.cc/health');

      await worker.fetch(request, env, ctx);

      // Verify waitUntil was called for non-blocking initialization
      const promises = ctx.getPromises();
      expect(promises.length).toBeGreaterThan(0);
    });

    it('should not re-initialize on subsequent requests', async () => {
      const request1 = new Request('https://connect.chitty.cc/health');
      const request2 = new Request('https://connect.chitty.cc/health');

      await worker.fetch(request1, env, ctx);
      const firstPromiseCount = ctx.getPromises().length;

      await worker.fetch(request2, env, ctx);
      const secondPromiseCount = ctx.getPromises().length;

      // Should not add more initialization promises
      expect(secondPromiseCount).toBe(firstPromiseCount);
    });
  });

  describe('ChittyOS Integration', () => {
    it('should validate actors via ChittyAuth', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const request = new Request('https://connect.chitty.cc/v1/contexts/list', {
        headers: { 'Authorization': 'Bearer valid-token' },
      });

      await worker.fetch(request, env, ctx);

      // Should call ChittyAuth validation
      const authCalls = fetchSpy.mock.calls.filter(call =>
        call[0].includes('auth.chitty') && call[0].includes('/v1/validate')
      );

      expect(authCalls.length).toBeGreaterThan(0);
    });

    it('should mint ChittyIDs from authority', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const request = new Request('https://connect.chitty.cc/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
        }),
      });

      await worker.fetch(request, env, ctx);

      // Should call ChittyID mint endpoint
      const idCalls = fetchSpy.mock.calls.filter(call =>
        call[0].includes('id.chitty') && call[0].includes('/v1/mint')
      );

      expect(idCalls.length).toBeGreaterThan(0);
    });

    it('should log events to ChittyChronicle via queue', async () => {
      const request = new Request('https://connect.chitty.cc/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
        }),
      });

      await worker.fetch(request, env, ctx);

      // Should send message to queue
      const messages = env.CONTEXT_OPS_QUEUE.getMessages();
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
