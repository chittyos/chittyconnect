/**
 * ChittyConnect - itsChitty™ GPT Connector
 *
 * The AI-intelligent spine with ContextConsciousness™
 * Comprehensive API for custom GPTs + MCP server for Claude
 *
 * Routes:
 * - /api/* - REST API for custom GPT Actions
 * - /mcp/* - MCP protocol endpoints for Claude
 * - /integrations/github/webhook - GitHub App integration
 * - /openapi.json - OpenAPI specification
 */

import { Hono } from 'hono';
import { verifyWebhookSignature } from './auth/webhook.js';
import { handleWebhookEvent } from './handlers/webhook.js';
import { queueConsumer } from './handlers/queue.js';
import { api } from './api/router.js';
import { mcp } from './mcp/server.js';

const app = new Hono();

/**
 * Root health check endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'chittyconnect',
    brand: 'itsChitty™',
    tagline: 'The AI-intelligent spine with ContextConsciousness™',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      api: '/api/*',
      mcp: '/mcp/*',
      github: '/integrations/github/*',
      openapi: '/openapi.json'
    }
  });
});

/**
 * Mount API router for custom GPT integration
 */
app.route('/', api);

/**
 * Mount MCP server for Claude integration
 */
app.route('/mcp', mcp);

/**
 * GitHub webhook endpoint
 * POST /integrations/github/webhook
 *
 * Fast-ack design:
 * 1. Verify HMAC signature (constant-time)
 * 2. Check idempotency (delivery ID)
 * 3. Queue event for async processing
 * 4. Return 200 OK immediately
 */
app.post('/integrations/github/webhook', async (c) => {
  const delivery = c.req.header('X-GitHub-Delivery');
  const event = c.req.header('X-GitHub-Event');
  const signature = c.req.header('X-Hub-Signature-256');

  if (!delivery || !event || !signature) {
    return c.text('missing required headers', 400);
  }

  // Check idempotency first (fastest path for duplicate deliveries)
  const existing = await c.env.IDEMP_KV.get(delivery);
  if (existing) {
    return c.text('ok', 200);
  }

  // Get raw body for signature verification
  const body = await c.req.arrayBuffer();

  // Verify webhook signature (constant-time comparison)
  const isValid = await verifyWebhookSignature(
    body,
    signature,
    c.env.GITHUB_WEBHOOK_SECRET
  );

  if (!isValid) {
    return c.text('unauthorized', 401);
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch (err) {
    return c.text('invalid json payload', 400);
  }

  // Queue for async MCP dispatch
  await c.env.EVENT_Q.send({
    delivery,
    event,
    payload,
    timestamp: new Date().toISOString()
  });

  // Mark as received (24h TTL)
  await c.env.IDEMP_KV.put(delivery, 'processing', { expirationTtl: 86400 });

  return c.text('ok', 200);
});

/**
 * GitHub App installation callback
 * Handles OAuth flow after app installation
 */
app.get('/integrations/github/callback', async (c) => {
  const code = c.req.query('code');
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');

  // TODO: Exchange code for installation access token
  // TODO: Store installation mapping to tenant

  return c.redirect(`https://app.chitty.cc/integrations/github/success?installation_id=${installationId}`);
});

/**
 * Export worker
 */
export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  /**
   * Queue consumer for async event processing
   */
  async queue(batch, env) {
    await queueConsumer(batch, env);
  }
};
