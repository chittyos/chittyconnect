/**
 * Queue Consumer for Async Operations
 *
 * Handles async processing for:
 * - Context operations (created, updated, deleted)
 * - ChittyDNA updates
 * - ChittyChronicle event logging
 * - Background tasks
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';

/**
 * Process context created event
 */
async function processContextCreated(message, env, ctx) {
  const { contextId, owner, timestamp } = message.body;

  console.log(`[Queue] Processing context.created: ${contextId}`);

  try {
    const ecosystem = createEcosystem(env, ctx);

    // Fetch context from database
    const context = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(contextId).first();

    if (!context) {
      console.error(`[Queue] Context not found: ${contextId}`);
      return;
    }

    // Log to ChittyChronicle
    await ecosystem.logEvent('context.created', contextId, {
      name: context.name,
      owner: owner,
      systems: JSON.parse(context.systems),
      tools: JSON.parse(context.tools),
      timestamp,
    });

    console.log(`[Queue] Context created event processed: ${contextId}`);

  } catch (error) {
    console.error(`[Queue] Error processing context.created:`, error);
    throw error; // Retry
  }
}

/**
 * Process context updated event
 */
async function processContextUpdated(message, env, ctx) {
  const { contextId, changes, timestamp } = message.body;

  console.log(`[Queue] Processing context.updated: ${contextId}`);

  try {
    const ecosystem = createEcosystem(env, ctx);

    // Fetch updated context
    const context = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(contextId).first();

    if (!context) {
      console.error(`[Queue] Context not found: ${contextId}`);
      return;
    }

    // Log to ChittyChronicle
    await ecosystem.logEvent('context.updated', contextId, {
      name: context.name,
      changes,
      timestamp,
    });

    console.log(`[Queue] Context updated event processed: ${contextId}`);

  } catch (error) {
    console.error(`[Queue] Error processing context.updated:`, error);
    throw error; // Retry
  }
}

/**
 * Process context deleted event
 */
async function processContextDeleted(message, env, ctx) {
  const { contextId, timestamp } = message.body;

  console.log(`[Queue] Processing context.deleted: ${contextId}`);

  try {
    const ecosystem = createEcosystem(env, ctx);

    // Fetch deleted context (soft delete)
    const context = await env.DB.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(contextId).first();

    if (!context) {
      console.error(`[Queue] Context not found: ${contextId}`);
      return;
    }

    // Track in ChittyDNA (archive)
    await ecosystem.trackEvolution(contextId, 'context.archived', {
      deleted_at: timestamp,
      name: context.name,
    });

    // Log to ChittyChronicle
    await ecosystem.logEvent('context.deleted', contextId, {
      name: context.name,
      timestamp,
    });

    console.log(`[Queue] Context deleted event processed: ${contextId}`);

  } catch (error) {
    console.error(`[Queue] Error processing context.deleted:`, error);
    throw error; // Retry
  }
}

/**
 * Process GitHub webhook event
 */
async function processGitHubEvent(message, env, ctx) {
  const { event, payload, timestamp } = message.body;

  console.log(`[Queue] Processing GitHub event: ${event}`);

  try {
    const ecosystem = createEcosystem(env, ctx);

    // Basic event logging (full GitHub integration in Week 4-6)
    await ecosystem.logEvent(`github.${event}`, payload.installation?.id || 'unknown', {
      event,
      repository: payload.repository?.full_name,
      sender: payload.sender?.login,
      action: payload.action,
      timestamp,
    });

    console.log(`[Queue] GitHub event processed: ${event}`);

  } catch (error) {
    console.error(`[Queue] Error processing GitHub event:`, error);
    throw error; // Retry
  }
}

/**
 * Main queue consumer handler
 */
export async function handleQueueMessage(batch, env, ctx) {
  console.log(`[Queue] Processing batch of ${batch.messages.length} messages`);

  for (const message of batch.messages) {
    try {
      const { operation } = message.body;

      switch (operation) {
        case 'context_created':
          await processContextCreated(message, env, ctx);
          message.ack();
          break;

        case 'context_updated':
          await processContextUpdated(message, env, ctx);
          message.ack();
          break;

        case 'context_deleted':
          await processContextDeleted(message, env, ctx);
          message.ack();
          break;

        case 'github_event':
          await processGitHubEvent(message, env, ctx);
          message.ack();
          break;

        default:
          console.warn(`[Queue] Unknown operation: ${operation}`);
          message.ack(); // Ack unknown operations to avoid retry loop
      }

    } catch (error) {
      console.error(`[Queue] Error processing message:`, error);
      // Don't ack - message will be retried
      message.retry();
    }
  }

  console.log(`[Queue] Batch processing complete`);
}

/**
 * Queue consumer export for Cloudflare Workers
 */
export default {
  async queue(batch, env, ctx) {
    return handleQueueMessage(batch, env, ctx);
  }
};
