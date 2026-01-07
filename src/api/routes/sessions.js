/**
 * Session Management Routes
 *
 * Handles session lifecycle using Durable Objects for ContextConsciousness™
 */

import { SessionStateService } from '../../services/SessionStateService.js';

export function registerSessionRoutes(app) {
  /**
   * Create a new session
   * POST /api/v1/sessions
   */
  app.post('/api/v1/sessions', async (c) => {
    try {
      const { chittyId, sessionId, metadata } = await c.req.json();

      if (!chittyId || !sessionId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'chittyId and sessionId are required'
          }
        }, 400);
      }

      // Initialize session service
      const sessionService = new SessionStateService(c.env);

      // Create session in Durable Object
      const session = await sessionService.createSession(
        chittyId,
        sessionId,
        metadata || {}
      );

      // Log creation in ContextConsciousness™
      if (c.env.CONTEXT_CONSCIOUSNESS) {
        await c.env.CONTEXT_CONSCIOUSNESS.addDecision(chittyId, {
          type: 'session_created',
          sessionId,
          reasoning: 'New session initiated for ContextConsciousness™',
          confidence: 1.0,
          context: { metadata }
        });
      }

      return c.json({
        success: true,
        data: session,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }
      });
    } catch (error) {
      console.error('[Sessions] Create error:', error);
      return c.json({
        success: false,
        error: {
          code: 'SESSION_CREATE_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Get session details
   * GET /api/v1/sessions/:sessionId
   */
  app.get('/api/v1/sessions/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const session = await sessionService.getSession(chittyId, sessionId);

      if (!session) {
        return c.json({
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found'
          }
        }, 404);
      }

      return c.json({
        success: true,
        data: session
      });
    } catch (error) {
      console.error('[Sessions] Get error:', error);
      return c.json({
        success: false,
        error: {
          code: 'SESSION_GET_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Update session state
   * PATCH /api/v1/sessions/:sessionId
   */
  app.patch('/api/v1/sessions/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');
      const updates = await c.req.json();

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const session = await sessionService.updateSession(
        chittyId,
        sessionId,
        updates
      );

      return c.json({
        success: true,
        data: session
      });
    } catch (error) {
      console.error('[Sessions] Update error:', error);
      return c.json({
        success: false,
        error: {
          code: 'SESSION_UPDATE_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * List all sessions for a ChittyID
   * GET /api/v1/sessions
   */
  app.get('/api/v1/sessions', async (c) => {
    try {
      const chittyId = c.req.header('X-ChittyID');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const result = await sessionService.listSessions(chittyId);

      return c.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[Sessions] List error:', error);
      return c.json({
        success: false,
        error: {
          code: 'SESSION_LIST_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Get session context
   * GET /api/v1/sessions/:sessionId/context
   */
  app.get('/api/v1/sessions/:sessionId/context', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');
      const key = c.req.query('key');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const context = await sessionService.getContext(chittyId, key);

      return c.json({
        success: true,
        data: context
      });
    } catch (error) {
      console.error('[Sessions] Get context error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CONTEXT_GET_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Set session context
   * PUT /api/v1/sessions/:sessionId/context
   */
  app.put('/api/v1/sessions/:sessionId/context', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');
      const { key, value } = await c.req.json();

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      if (!key) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_KEY',
            message: 'Context key is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const result = await sessionService.setContext(chittyId, key, value);

      return c.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[Sessions] Set context error:', error);
      return c.json({
        success: false,
        error: {
          code: 'CONTEXT_SET_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Get session metrics
   * GET /api/v1/sessions/:sessionId/metrics
   */
  app.get('/api/v1/sessions/:sessionId/metrics', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const metrics = await sessionService.getMetrics(chittyId);

      return c.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      console.error('[Sessions] Get metrics error:', error);
      return c.json({
        success: false,
        error: {
          code: 'METRICS_GET_FAILED',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Establish WebSocket connection for real-time updates
   * GET /api/v1/sessions/:sessionId/ws
   */
  app.get('/api/v1/sessions/:sessionId/ws', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      // Check for WebSocket upgrade header
      if (c.req.header('Upgrade') !== 'websocket') {
        return c.json({
          success: false,
          error: {
            code: 'WEBSOCKET_REQUIRED',
            message: 'WebSocket upgrade required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const webSocket = await sessionService.connectWebSocket(chittyId, sessionId);

      if (!webSocket) {
        return c.json({
          success: false,
          error: {
            code: 'WEBSOCKET_FAILED',
            message: 'Failed to establish WebSocket connection'
          }
        }, 500);
      }

      return new Response(null, {
        status: 101,
        webSocket
      });
    } catch (error) {
      console.error('[Sessions] WebSocket error:', error);
      return c.json({
        success: false,
        error: {
          code: 'WEBSOCKET_ERROR',
          message: error.message
        }
      }, 500);
    }
  });

  /**
   * Migrate existing KV session to Durable Object
   * POST /api/v1/sessions/:sessionId/migrate
   */
  app.post('/api/v1/sessions/:sessionId/migrate', async (c) => {
    try {
      const sessionId = c.req.param('sessionId');
      const chittyId = c.req.header('X-ChittyID');

      if (!chittyId) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_CHITTYID',
            message: 'X-ChittyID header is required'
          }
        }, 400);
      }

      const sessionService = new SessionStateService(c.env);
      const session = await sessionService.migrateSession(chittyId, sessionId);

      if (!session) {
        return c.json({
          success: false,
          error: {
            code: 'MIGRATION_FAILED',
            message: 'No session found to migrate or migration failed'
          }
        }, 404);
      }

      return c.json({
        success: true,
        data: session,
        message: 'Session successfully migrated to Durable Objects'
      });
    } catch (error) {
      console.error('[Sessions] Migration error:', error);
      return c.json({
        success: false,
        error: {
          code: 'MIGRATION_ERROR',
          message: error.message
        }
      }, 500);
    }
  });
}