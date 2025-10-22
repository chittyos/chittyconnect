/**
 * GitHub Events Queue Consumer
 *
 * Processes webhook events asynchronously after fast-ack
 * Handles batches of events from the github-events queue
 */

import { processWebhookEvent } from './webhook.js';

/**
 * Queue consumer handler
 * Called by Cloudflare Workers queue system
 */
export async function handleQueueBatch(batch, env) {
  console.log(`[GitHub Queue] Processing batch of ${batch.messages.length} events`);

  const results = [];

  for (const message of batch.messages) {
    try {
      console.log(`[GitHub Queue] Processing message ${message.id}`);

      const event = message.body;

      // Process the webhook event
      const result = await processWebhookEvent(event, env);

      results.push({
        messageId: message.id,
        success: true,
        eventChittyId: result.eventChittyId
      });

      // Acknowledge successful processing
      message.ack();

      console.log(`[GitHub Queue] Message ${message.id} processed successfully`);

    } catch (error) {
      console.error(`[GitHub Queue] Failed to process message ${message.id}:`, error.message);

      // Retry the message (will be redelivered if not at max retries)
      message.retry();

      results.push({
        messageId: message.id,
        success: false,
        error: error.message
      });
    }
  }

  // Log batch processing summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`[GitHub Queue] Batch complete: ${successful} succeeded, ${failed} failed`);

  return results;
}

/**
 * Alternative: Handle single message
 * For manual queue processing
 */
export async function handleQueueMessage(message, env) {
  try {
    const event = message.body;
    const result = await processWebhookEvent(event, env);

    return {
      success: true,
      eventChittyId: result.eventChittyId
    };

  } catch (error) {
    console.error('[GitHub Queue] Message processing failed:', error.message);
    throw error;
  }
}
