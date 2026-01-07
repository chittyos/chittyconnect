/**
 * Central Webhook Router
 * Routes incoming webhooks to appropriate agents after logging to ChittyChronicle
 */

// Agent webhook endpoints
const AGENTS = {
  'notion': 'https://notion-ops.chitty.cc/webhook',
  'github': null, // Handled internally
  'cloudflare': 'https://cloudflare-ops.chitty.cc/webhook',
  'stripe': 'https://stripe-ops.chitty.cc/webhook',
  // Add more agents as needed
};

/**
 * Route webhook to appropriate agent
 * @param {string} source - Webhook source (notion, cloudflare, etc.)
 * @param {object} payload - Webhook payload
 * @param {object} env - Environment variables
 * @returns {object} Routing result
 */
export async function routeWebhook(source, payload, env) {
  const timestamp = new Date().toISOString();

  // Log to ChittyChronicle
  await logWebhook(env, {
    source,
    event_type: payload.type || payload.event || 'unknown',
    timestamp,
    payload_size: JSON.stringify(payload).length
  });

  // Get agent endpoint
  const agentUrl = AGENTS[source];

  if (!agentUrl) {
    // Handle internally or return unhandled
    return {
      routed: false,
      source,
      reason: agentUrl === null ? 'handled_internally' : 'no_agent_configured',
      timestamp
    };
  }

  // Forward to agent
  try {
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': source,
        'X-Webhook-Timestamp': timestamp,
        'X-Forwarded-By': 'chittyconnect',
        'X-Webhook-Secret': env.INTERNAL_WEBHOOK_SECRET || ''
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    return {
      routed: true,
      source,
      agent: agentUrl,
      status: response.status,
      result,
      timestamp
    };
  } catch (error) {
    // Log failure but don't throw - webhook should be acknowledged
    console.error(`Failed to forward webhook to ${agentUrl}:`, error);

    return {
      routed: false,
      source,
      agent: agentUrl,
      error: error.message,
      timestamp
    };
  }
}

/**
 * Log webhook to ChittyChronicle
 */
async function logWebhook(env, event) {
  try {
    // Use internal Chronicle logging
    if (env.CHRONICLE_KV) {
      const key = `webhook:${event.source}:${Date.now()}`;
      await env.CHRONICLE_KV.put(key, JSON.stringify(event), { expirationTtl: 86400 * 30 }); // 30 days
    }

    // Also log to Chronicle API if available
    if (env.CHITTYCHRONICLE_URL) {
      await fetch(`${env.CHITTYCHRONICLE_URL}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.CHITTYCONNECT_SERVICE_TOKEN}`
        },
        body: JSON.stringify({
          event_type: 'webhook.received',
          source: 'chittyconnect',
          data: event
        })
      });
    }
  } catch (e) {
    console.error('Failed to log webhook:', e);
  }
}

/**
 * Get list of configured agents
 */
export function getConfiguredAgents() {
  return Object.entries(AGENTS)
    .filter(([_, url]) => url !== null)
    .map(([source, url]) => ({ source, url }));
}

/**
 * Validate webhook signature (generic)
 */
export async function validateWebhookSignature(source, request, env) {
  const signature = request.headers.get('X-Webhook-Signature') ||
                    request.headers.get('X-Hub-Signature-256') ||
                    request.headers.get('X-Signature');

  if (!signature) {
    // Some sources don't sign webhooks
    return { valid: true, signed: false };
  }

  const secret = env[`${source.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret) {
    return { valid: true, signed: true, verified: false, reason: 'no_secret_configured' };
  }

  // Implement signature verification based on source
  // GitHub uses HMAC-SHA256, Stripe uses similar, etc.
  // For now, return unverified
  return { valid: true, signed: true, verified: false, reason: 'verification_not_implemented' };
}
