/**
 * Central Webhook Router
 * Routes incoming webhooks to appropriate agents after logging to ChittyChronicle
 */

import { verifyWebhookSignature } from "../auth/webhook.js";

// Agent webhook endpoints
const AGENTS = {
  notion: "https://notion-ops.chitty.cc/webhook",
  github: null, // Handled internally
  linear: "https://tasks.chitty.cc/api/v1/webhook/linear",
  cloudflare: "https://cloudflare-ops.chitty.cc/webhook",
  stripe: "https://stripe-ops.chitty.cc/webhook",
  // Add more agents as needed
};

/**
 * Route webhook to appropriate agent
 * @param {string} source - Webhook source (notion, linear, cloudflare, etc.)
 * @param {object} payload - Webhook payload
 * @param {object} env - Environment variables
 * @returns {object} Routing result
 */
export async function routeWebhook(source, payload, env) {
  const timestamp = new Date().toISOString();

  // Log to ChittyChronicle
  await logWebhook(env, {
    source,
    event_type: payload.type || payload.event || payload.action || "unknown",
    timestamp,
    payload_size: JSON.stringify(payload).length,
  });

  // Forward review-triggering events to chittyclaw Oracle node for separated adversarial review
  const isReviewTrigger =
    (source === "linear" &&
      (payload.action === "update" || payload.action === "create") &&
      payload.data?.state?.name?.toLowerCase().includes("review")) ||
    (source === "github" &&
      (payload.action === "review_requested" || payload.action === "opened"));

  if (isReviewTrigger) {
    const clawUrl =
      env.CHITTYCLAW_REVIEW_URL ||
      "http://100.69.69.7:18789/hooks/adversarial-review";
    fetch(clawUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Source": source,
        "X-Webhook-Timestamp": timestamp,
        "X-Forwarded-By": "chittyconnect",
        ...(env.INTERNAL_WEBHOOK_SECRET && {
          "X-Webhook-Secret": env.INTERNAL_WEBHOOK_SECRET,
        }),
      },
      body: JSON.stringify(payload),
    }).catch((e) =>
      console.warn(
        `[webhook-router] Forward to chittyclaw review failed:`,
        e.message,
      ),
    );
  }

  // Get agent endpoint
  const agentUrl = AGENTS[source];

  if (!agentUrl) {
    // Handle internally or return unhandled
    return {
      routed: false,
      source,
      reason: agentUrl === null ? "handled_internally" : "no_agent_configured",
      timestamp,
    };
  }

  // Forward to agent
  try {
    const response = await fetch(agentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Source": source,
        "X-Webhook-Timestamp": timestamp,
        "X-Forwarded-By": "chittyconnect",
        ...(env.INTERNAL_WEBHOOK_SECRET && {
          "X-Webhook-Secret": env.INTERNAL_WEBHOOK_SECRET,
        }),
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    return {
      routed: true,
      source,
      agent: agentUrl,
      status: response.status,
      result,
      timestamp,
    };
  } catch (error) {
    // Log failure but don't throw - webhook should be acknowledged
    console.error(`Failed to forward webhook to ${agentUrl}:`, error);

    return {
      routed: false,
      source,
      agent: agentUrl,
      error: error.message,
      timestamp,
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
      await env.CHRONICLE_KV.put(key, JSON.stringify(event), {
        expirationTtl: 86400 * 30,
      }); // 30 days
    }

    // Also log to Chronicle API if available
    const chronicleUrl =
      env.CHITTYCHRONICLE_SERVICE_URL || env.CHITTYCHRONICLE_URL;
    if (env.CHITTYCHRONICLE_URL && !env.CHITTYCHRONICLE_SERVICE_URL) {
      console.warn(
        "[webhook-router] CHITTYCHRONICLE_URL is deprecated, use CHITTYCHRONICLE_SERVICE_URL",
      );
    }
    if (chronicleUrl) {
      const resp = await fetch(`${chronicleUrl}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.CHITTYCONNECT_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          event_type: "webhook.received",
          source: "chittyconnect",
          data: event,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.warn(
          `[webhook-router] Chronicle log returned ${resp.status}: ${body}`,
        );
      }
    }
  } catch (e) {
    console.error("[webhook-router] Failed to log webhook:", e);
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
  const signature =
    request.headers.get("X-Linear-Signature") ||
    request.headers.get("X-Webhook-Signature") ||
    request.headers.get("X-Hub-Signature-256") ||
    request.headers.get("X-Signature");

  if (!signature) {
    // Some sources don't sign webhooks
    return { valid: true, signed: false };
  }

  const secret = env[`${source.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret) {
    return {
      valid: false,
      signed: true,
      verified: false,
      reason: "no_secret_configured",
    };
  }

  // Use HMAC-SHA256 verification
  const body = await request.clone().arrayBuffer();
  const isValid = await verifyWebhookSignature(body, signature, secret);

  return {
    valid: isValid,
    signed: true,
    verified: isValid,
    reason: isValid ? "signature_verified" : "signature_mismatch",
  };
}
