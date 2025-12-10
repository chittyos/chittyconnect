/**
 * Unit Tests for Contexts API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContext, updateContext, deleteContext, listContexts, getContext } from '../../src/api/contexts.js';
import {
  createMockEnv,
  createMockContext,
  createMockFetch,
  mockChittyAuth,
  mockChittyID,
  mockChittyDNA,
} from '../helpers/mock-chittyos.js';

describe('Contexts API', () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
    global.fetch = createMockFetch();
  });

  describe('POST /v1/contexts/create', () => {
    it('should create context with valid input', async () => {
      const request = new Request('https://test.com/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
          data: ['item1', 'item2'],
          systems: ['system1'],
          tools: ['tool1'],
        }),
      });

      const response = await createContext(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.context.name).toBe('Test Context');
      expect(data.context.chittyId).toMatch(/^CHITTY-CONTEXT-/);
    });

    it('should require name field', async () => {
      const request = new Request('https://test.com/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: ['item1'],
        }),
      });

      const response = await createContext(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Name required');
    });

    it('should require authorization', async () => {
      const request = new Request('https://test.com/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
        }),
      });

      const response = await createContext(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authorization required');
    });

    it('should prevent duplicate context names', async () => {
      // Mock DB to return existing context
      env.DB.prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            chitty_id: 'CHITTY-CONTEXT-existing',
            name: 'Test Context',
          })),
        })),
      }));

      const request = new Request('https://test.com/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
        }),
      });

      const response = await createContext(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe('Context name already exists');
      expect(data.existing_chitty_id).toBe('CHITTY-CONTEXT-existing');
    });

    it('should send message to queue', async () => {
      const request = new Request('https://test.com/v1/contexts/create', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Context',
        }),
      });

      await createContext(request, env, ctx);

      const messages = env.CONTEXT_OPS_QUEUE.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].body.operation).toBe('context_created');
    });
  });

  describe('PATCH /v1/contexts/{id}', () => {
    beforeEach(() => {
      // Mock DB to return existing context
      env.DB.prepare = vi.fn((sql) => {
        if (sql.includes('SELECT')) {
          return {
            bind: vi.fn(() => ({
              first: vi.fn(async () => ({
                chitty_id: 'CHITTY-CONTEXT-123',
                name: 'Test Context',
                owner_chitty_id: 'CHITTY-ACTOR-test123',
                data: '[]',
                systems: '[]',
                tools: '[]',
                status: 'active',
              })),
            })),
          };
        }
        // UPDATE query
        return {
          bind: vi.fn(() => ({
            run: vi.fn(async () => ({ success: true })),
          })),
        };
      });
    });

    it('should update context fields', async () => {
      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Context',
          data: ['new-item'],
        }),
      });

      const response = await updateContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should require ownership', async () => {
      global.fetch = createMockFetch({
        validateActor: mockChittyAuth.validateActorSuccess('CHITTY-ACTOR-different'),
      });

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Context',
        }),
      });

      const response = await updateContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden - not the owner');
    });

    it('should return 404 for non-existent context', async () => {
      env.DB.prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
        })),
      }));

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-999', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Context',
        }),
      });

      const response = await updateContext('CHITTY-CONTEXT-999', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Context not found');
    });

    it('should track evolution in ChittyDNA', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Context',
        }),
      });

      await updateContext('CHITTY-CONTEXT-123', request, env, ctx);

      // Verify ChittyDNA evolve call
      const dnaCalls = fetchSpy.mock.calls.filter(call =>
        call[0].includes('dna.chitty') && call[0].includes('/v1/evolve')
      );

      expect(dnaCalls.length).toBeGreaterThan(0);
    });
  });

  describe('DELETE /v1/contexts/{id}', () => {
    beforeEach(() => {
      env.DB.prepare = vi.fn((sql) => {
        if (sql.includes('SELECT')) {
          return {
            bind: vi.fn(() => ({
              first: vi.fn(async () => ({
                chitty_id: 'CHITTY-CONTEXT-123',
                name: 'Test Context',
                owner_chitty_id: 'CHITTY-ACTOR-test123',
                status: 'active',
              })),
            })),
          };
        }
        // UPDATE query (soft delete)
        return {
          bind: vi.fn(() => ({
            run: vi.fn(async () => ({ success: true })),
          })),
        };
      });
    });

    it('should soft delete context', async () => {
      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await deleteContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Context deleted');
    });

    it('should require ownership for deletion', async () => {
      global.fetch = createMockFetch({
        validateActor: mockChittyAuth.validateActorSuccess('CHITTY-ACTOR-different'),
      });

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await deleteContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden - not the owner');
    });

    it('should send delete event to queue', async () => {
      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      await deleteContext('CHITTY-CONTEXT-123', request, env, ctx);

      const messages = env.CONTEXT_OPS_QUEUE.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].body.operation).toBe('context_deleted');
    });
  });

  describe('GET /v1/contexts/list', () => {
    it('should list contexts for authenticated actor', async () => {
      env.DB.prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({
            results: [
              {
                chitty_id: 'CHITTY-CONTEXT-1',
                name: 'Context 1',
                data: '[]',
                systems: '[]',
                tools: '[]',
              },
              {
                chitty_id: 'CHITTY-CONTEXT-2',
                name: 'Context 2',
                data: '[]',
                systems: '[]',
                tools: '[]',
              },
            ],
          })),
        })),
      }));

      const request = new Request('https://test.com/v1/contexts/list', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await listContexts(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.contexts.length).toBe(2);
      expect(data.count).toBe(2);
    });

    it('should require authorization', async () => {
      const request = new Request('https://test.com/v1/contexts/list', {
        method: 'GET',
      });

      const response = await listContexts(request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('GET /v1/contexts/{id}', () => {
    it('should get context by ID', async () => {
      env.DB.prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            chitty_id: 'CHITTY-CONTEXT-123',
            name: 'Test Context',
            owner_chitty_id: 'CHITTY-ACTOR-test123',
            data: '["item1"]',
            systems: '["system1"]',
            tools: '["tool1"]',
          })),
        })),
      }));

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await getContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.chitty_id).toBe('CHITTY-CONTEXT-123');
      expect(data.name).toBe('Test Context');
      expect(data.data).toEqual(['item1']);
    });

    it('should require ownership to view', async () => {
      env.DB.prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            chitty_id: 'CHITTY-CONTEXT-123',
            owner_chitty_id: 'CHITTY-ACTOR-different',
            data: '[]',
            systems: '[]',
            tools: '[]',
          })),
        })),
      }));

      const request = new Request('https://test.com/v1/contexts/CHITTY-CONTEXT-123', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-token',
        },
      });

      const response = await getContext('CHITTY-CONTEXT-123', request, env, ctx);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
    });
  });
});
