import { verifyWebhookSignature } from "../auth/webhook.js";

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * GitHub webhook handler (framework-agnostic)
 *
 * Returns a Response and never throws (caller safe).
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleGitHubWebhook(request, env) {
  try {
    const delivery = request.headers.get("X-GitHub-Delivery");
    const event = request.headers.get("X-GitHub-Event");
    const signature = request.headers.get("X-Hub-Signature-256");

    if (!delivery || !event || !signature) {
      return new Response("missing required headers", { status: 400 });
    }

    // Idempotency (best-effort): if KV is missing/misconfigured, continue.
    try {
      const existing = await env?.IDEMP_KV?.get?.(delivery);
      if (existing) {
        return new Response("ok", { status: 200 });
      }
    } catch (err) {
      console.warn("[GitHub webhook] IDEMP_KV.get failed:", err?.message || err);
    }

    const body = await request.arrayBuffer();
    const isValid = await verifyWebhookSignature(
      body,
      signature,
      env?.GITHUB_WEBHOOK_SECRET,
    );

    if (!isValid) {
      return new Response("unauthorized", { status: 401 });
    }

    const parsed = safeJsonParse(new TextDecoder().decode(body));
    if (!parsed.ok) {
      return new Response("invalid json payload", { status: 400 });
    }

    const message = {
      delivery,
      event,
      payload: parsed.value,
      timestamp: new Date().toISOString(),
    };

    // Queue dispatch (best-effort): if send fails, accept the webhook to avoid 1101.
    try {
      if (!env?.EVENT_Q?.send) {
        console.error("[GitHub webhook] EVENT_Q not configured; accepting webhook");
        return new Response("accepted", { status: 202 });
      }
      await env.EVENT_Q.send(message, { contentType: "json" });
    } catch (err) {
      console.error("[GitHub webhook] EVENT_Q.send failed; accepting webhook:", {
        delivery,
        event,
        error: err?.message || String(err),
      });
      return new Response("accepted", { status: 202 });
    }

    // Mark as received (24h TTL) only after successful enqueue.
    try {
      await env?.IDEMP_KV?.put?.(delivery, "processing", {
        expirationTtl: 86400,
      });
    } catch (err) {
      console.warn("[GitHub webhook] IDEMP_KV.put failed:", err?.message || err);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[GitHub webhook] Unhandled error; returning 500:", err);
    return new Response("internal error", { status: 500 });
  }
}

