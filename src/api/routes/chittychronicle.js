/**
 * ChittyChronicle API Routes
 * Event logging and audit trails with 1Password Connect integration
 *
 * Database connection retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";
import { ChronicleEngine } from "../../services/chronicle-engine.js";

const chittychronicleRoutes = new Hono();

// Rate limiting helper
let requestCounts = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const limit = requestCounts.get(ip);

  if (!limit || now > limit.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return true;
  }

  if (limit.count >= 60) { // 60 requests per minute
    return false;
  }

  limit.count++;
  return true;
}

/**
 * GET /api/chittychronicle
 * Health check
 */
chittychronicleRoutes.get("/", (c) => {
  return c.json({
    service: 'ChittyChronicle',
    version: '1.0.0',
    status: 'healthy',
    description: 'Event logging and audit trail system'
  });
});

/**
 * POST /api/chittychronicle/events
 * Log new event
 */
chittychronicleRoutes.post("/events", async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  if (!rateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({
        error: 'Database connection not configured',
        details: 'Neither 1Password Connect nor environment variable available'
      }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const body = await c.req.json();
    const result = await chronicle.logEvent(body);

    return c.json(result);
  } catch (error) {
    console.error('Error logging event:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/events
 * Search events
 */
chittychronicleRoutes.get("/events", async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  if (!rateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({ error: 'Database connection not configured' }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const params = {
      service: c.req.query('service'),
      action: c.req.query('action'),
      userId: c.req.query('userId'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      status: c.req.query('status'),
      query: c.req.query('query'),
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')) : 100
    };

    const results = await chronicle.searchEvents(params);
    return c.json(results);
  } catch (error) {
    console.error('Error searching events:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/timeline
 * Get activity timeline
 */
chittychronicleRoutes.get("/timeline", async (c) => {
  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({ error: 'Database connection not configured' }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    if (!startDate || !endDate) {
      return c.json({ error: 'startDate and endDate are required' }, 400);
    }

    const services = c.req.query('services')?.split(',');
    const groupBy = c.req.query('groupBy');

    const timeline = await chronicle.getTimeline({
      startDate,
      endDate,
      services,
      groupBy
    });

    return c.json(timeline);
  } catch (error) {
    console.error('Error getting timeline:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/audit/:entityId
 * Get audit trail for entity
 */
chittychronicleRoutes.get("/audit/:entityId", async (c) => {
  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({ error: 'Database connection not configured' }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const entityId = c.req.param('entityId');
    const entityType = c.req.query('entityType');

    if (!entityType) {
      return c.json({ error: 'entityType query parameter is required' }, 400);
    }

    const trail = await chronicle.getAuditTrail(entityId, entityType);
    return c.json(trail);
  } catch (error) {
    console.error('Error getting audit trail:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/statistics
 * Get event statistics
 */
chittychronicleRoutes.get("/statistics", async (c) => {
  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({ error: 'Database connection not configured' }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    const stats = await chronicle.getStatistics(startDate, endDate);
    return c.json(stats);
  } catch (error) {
    console.error('Error getting statistics:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittychronicle/health
 * Get service health metrics
 */
chittychronicleRoutes.get("/health", async (c) => {
  try {
    const databaseUrl = await getCredential(
      c.env,
      'database/neon/chittyos_core',
      'NEON_DATABASE_URL',
      'ChittyChronicle'
    );

    if (!databaseUrl) {
      return c.json({ error: 'Database connection not configured' }, 503);
    }

    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();

    const health = await chronicle.getServiceHealth();
    return c.json(health);
  } catch (error) {
    console.error('Error getting health:', error);
    return c.json({ error: error.message }, 500);
  }
});

export { chittychronicleRoutes };
