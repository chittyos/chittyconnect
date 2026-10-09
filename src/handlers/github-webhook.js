/**
 * GitHub App webhook endpoint handler
 * POST /integrations/github/webhook
 *
 * Fast-ack design:
 * 1. Verify HMAC signature (constant-time)
 * 2. Check idempotency (delivery ID)
 * 3. Queue event for async processing (see handlers/queue.js)
 * 4. Return 200 OK immediately
 */

import { verifyWebhookSignature } from "../auth/webhook.js";

export async function handleGitHubWebhook(c) {
  const delivery = c.req.header("X-GitHub-Delivery");
  const event = c.req.header("X-GitHub-Event");
  const signature = c.req.header("X-Hub-Signature-256");

  if (!delivery || !event || !signature) {
    return c.text("missing required headers", 400);
  }

  // Check idempotency first (fastest path for duplicate deliveries)
  const existing = await c.env.IDEMP_KV.get(delivery);
  if (existing) {
    return c.text("ok", 200);
  }

  // Get raw body for signature verification
  const body = await c.req.arrayBuffer();

  // Verify webhook signature (constant-time comparison)
  const isValid = await verifyWebhookSignature(
    body,
    signature,
    c.env.GITHUB_WEBHOOK_SECRET,
  );

  if (!isValid) {
    return c.text("unauthorized", 401);
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch (err) {
    return c.text("invalid json payload", 400);
  }

  // Queue for async MCP dispatch
  await c.env.EVENT_Q.send({
    delivery,
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  // Mark as received (24h TTL)
  await c.env.IDEMP_KV.put(delivery, "processing", { expirationTtl: 86400 });

  return c.text("ok", 200);
}
