/**
 * Queue consumer for Cloudflare Access Event Subscriptions
 * Processes events like cf.access.application.created and deleted
 */

export async function accessQueueConsumer(batch, env) {
  const results = await Promise.allSettled(
    batch.messages.map((msg) => processAccessEvent(msg.body, env)),
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error("Access event processing failed:", {
        type: batch.messages[i].body?.type,
        error: result.reason?.message,
      });
    }
  });

  // Ack all messages
  batch.messages.forEach((msg) => msg.ack());
}

async function processAccessEvent(message, env) {
  const { type, payload, metadata } = message;

  if (type === "cf.access.application.created") {
    console.log(
      `[Access Event] Application created: ${payload.name} (${payload.id})`,
    );

    // We can dispatch this to the MCP bus or trigger a drift scan in ChittySchema
    // For now, we log the creation and normalize the event.
    await trackAccessApplication(env, payload, "created");
  } else if (type === "cf.access.application.deleted") {
    console.log(
      `[Access Event] Application deleted: ${payload.name} (${payload.id})`,
    );

    await trackAccessApplication(env, payload, "deleted");
  } else {
    console.log(`[Access Event] Unknown access event type: ${type}`);
  }
}

async function trackAccessApplication(env, payload, status) {
  // If we have an IDEMP_KV or similar store, we can track it here.
  // We can also ping chittytrack or chittyschema drift scan via HTTP.
  try {
    if (env.IDEMP_KV) {
      await env.IDEMP_KV.put(
        `access:app:${payload.id}`,
        JSON.stringify({
          name: payload.name,
          status: status,
          updatedAt: new Date().toISOString(),
        }),
      );
    }

    // Trigger a Drift Scan on ChittySchema if the binding exists
    if (env.DRIFT_QUEUE) {
      console.log("Triggering ChittySchema drift scan for Access app");
      await env.DRIFT_QUEUE.send({
        type: "drift_scan",
        target: "access_application",
        id: payload.id,
        status: status,
      });
    }
  } catch (error) {
    console.error("Error tracking access application:", error);
    throw error;
  }
}
