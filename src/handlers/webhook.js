/**
 * Webhook event handler
 * Processes GitHub webhook events
 */

export async function handleWebhookEvent(event) {
  console.log("Processing webhook event:", event.event);

  // GitHub App webhook processing not yet implemented — log and acknowledge
  console.warn(
    `[webhook] Unhandled event type: ${event.event} (delivery: ${event.delivery})`,
  );

  return {
    success: false,
    error: "Webhook dispatch not yet implemented",
    event: event.event,
    delivery: event.delivery,
    timestamp: event.timestamp,
  };
}
