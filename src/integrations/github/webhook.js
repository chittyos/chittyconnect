/**
 * GitHub App Webhook Handler
 *
 * Fast-Ack Design:
 * 1. Verify HMAC Signature (constant-time comparison)
 * 2. Check Idempotency (IDEMP_KV lookup)
 * 3. Queue Event (EVENT_Q dispatch)
 * 4. Return 200 OK immediately (<100ms)
 *
 * Async Processing handled by Queue Consumer
 */

import { verifySignature } from './utils.js';
import { mintChittyID, logEvent } from '../chittyos-ecosystem.js';

/**
 * Handle GitHub webhook requests
 * Fast acknowledgment (<100ms target)
 */
export async function handleWebhook(request, env) {
  const startTime = Date.now();

  try {
    // Step 1: Verify HMAC Signature
    const signature = request.headers.get('x-hub-signature-256');
    const eventType = request.headers.get('x-github-event');
    const deliveryId = request.headers.get('x-github-delivery');

    if (!signature || !eventType || !deliveryId) {
      return new Response(JSON.stringify({ error: 'Missing required headers' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const payload = await request.text();

    // Verify signature (constant-time comparison)
    const isValid = await verifySignature(payload, signature, env.GITHUB_WEBHOOK_SECRET);

    if (!isValid) {
      console.error('[GitHub Webhook] Invalid signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Step 2: Check Idempotency
    const idempKey = `gh:delivery:${deliveryId}`;
    const alreadyProcessed = await env.IDEMP_KV.get(idempKey);

    if (alreadyProcessed) {
      console.log(`[GitHub Webhook] Duplicate delivery: ${deliveryId}`);
      return new Response(JSON.stringify({ status: 'ok', duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Mark as received (24-hour TTL)
    await env.IDEMP_KV.put(idempKey, '1', { expirationTtl: 86400 });

    // Step 3: Queue Event for async processing
    await env.EVENT_Q.send({
      deliveryId,
      eventType,
      payload: payload,
      receivedAt: new Date().toISOString()
    });

    const responseTime = Date.now() - startTime;
    console.log(`[GitHub Webhook] Queued ${eventType} in ${responseTime}ms`);

    // Step 4: Return 200 OK immediately
    return new Response(JSON.stringify({
      status: 'ok',
      deliveryId,
      eventType,
      responseTime: `${responseTime}ms`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[GitHub Webhook] Error:', error.message);

    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Process GitHub webhook event (called by queue consumer)
 * This runs asynchronously after fast-ack
 */
export async function processWebhookEvent(event, env) {
  try {
    const { deliveryId, eventType, payload } = event;
    const data = JSON.parse(payload);

    console.log(`[GitHub Processor] Processing ${eventType} event: ${deliveryId}`);

    // Mint ChittyID for event
    const eventChittyId = await mintChittyID(env, 'EVNT', {
      type: 'github_webhook',
      eventType,
      deliveryId,
      repository: data.repository?.full_name,
      sender: data.sender?.login
    });

    console.log(`[GitHub Processor] Event ChittyID: ${eventChittyId}`);

    // Log to ChittyChronicle
    await logEvent(env, {
      event: `github.${eventType}`,
      chittyId: eventChittyId,
      deliveryId,
      metadata: {
        repository: data.repository?.full_name,
        sender: data.sender?.login,
        action: data.action
      }
    });

    // Process specific event types
    switch (eventType) {
      case 'installation':
        await handleInstallationEvent(data, env);
        break;

      case 'installation_repositories':
        await handleInstallationRepositoriesEvent(data, env);
        break;

      case 'push':
        await handlePushEvent(data, env);
        break;

      case 'pull_request':
        await handlePullRequestEvent(data, env);
        break;

      case 'issues':
        await handleIssuesEvent(data, env);
        break;

      case 'issue_comment':
        await handleIssueCommentEvent(data, env);
        break;

      default:
        console.log(`[GitHub Processor] Unhandled event type: ${eventType}`);
    }

    return { success: true, eventChittyId };

  } catch (error) {
    console.error('[GitHub Processor] Processing failed:', error.message);
    throw error;
  }
}

/**
 * Handle installation events (created, deleted, etc.)
 */
async function handleInstallationEvent(data, env) {
  const { action, installation } = data;

  console.log(`[GitHub] Installation ${action}: ${installation.id}`);

  if (action === 'deleted') {
    // Remove installation record
    const { deleteInstallation } = await import('../../database/schema.js');
    await deleteInstallation(env.DB, installation.id);
    console.log(`[GitHub] Installation ${installation.id} deleted from database`);
  }

  // Log to ChittyChronicle
  await logEvent(env, {
    event: `github.installation.${action}`,
    metadata: {
      installationId: installation.id,
      account: installation.account.login,
      accountType: installation.account.type
    }
  });
}

/**
 * Handle installation repository changes
 */
async function handleInstallationRepositoriesEvent(data, env) {
  const { action, installation, repositories_added, repositories_removed } = data;

  console.log(`[GitHub] Installation repositories ${action}: ${installation.id}`);

  // Update installation metadata
  const { updateInstallation, getInstallation } = await import('../../database/schema.js');

  const currentInstallation = await getInstallation(env.DB, installation.id);

  if (currentInstallation) {
    const metadata = currentInstallation.metadata || {};
    metadata.repositories_added = repositories_added;
    metadata.repositories_removed = repositories_removed;

    await updateInstallation(env.DB, installation.id, { metadata });
  }

  // Log to ChittyChronicle
  await logEvent(env, {
    event: `github.installation_repositories.${action}`,
    metadata: {
      installationId: installation.id,
      addedCount: repositories_added?.length || 0,
      removedCount: repositories_removed?.length || 0
    }
  });
}

/**
 * Handle push events
 */
async function handlePushEvent(data, env) {
  const { ref, repository, commits } = data;

  console.log(`[GitHub] Push to ${repository.full_name} (${ref}): ${commits.length} commits`);

  // Mint ChittyIDs for commits
  for (const commit of commits.slice(0, 10)) { // Limit to 10 commits
    const commitChittyId = await mintChittyID(env, 'EVNT', {
      type: 'github_commit',
      repository: repository.full_name,
      sha: commit.id,
      message: commit.message,
      author: commit.author.name
    });

    console.log(`[GitHub] Commit ChittyID: ${commitChittyId}`);
  }

  // Log to ChittyChronicle
  await logEvent(env, {
    event: 'github.push',
    metadata: {
      repository: repository.full_name,
      ref,
      commitCount: commits.length,
      headCommit: commits[commits.length - 1]?.id
    }
  });
}

/**
 * Handle pull request events
 */
async function handlePullRequestEvent(data, env) {
  const { action, pull_request, repository } = data;

  console.log(`[GitHub] PR ${action}: ${repository.full_name}#${pull_request.number}`);

  // Mint ChittyID for PR
  const prChittyId = await mintChittyID(env, 'EVNT', {
    type: 'github_pull_request',
    repository: repository.full_name,
    number: pull_request.number,
    title: pull_request.title,
    action
  });

  console.log(`[GitHub] PR ChittyID: ${prChittyId}`);

  // Log to ChittyChronicle
  await logEvent(env, {
    event: `github.pull_request.${action}`,
    chittyId: prChittyId,
    metadata: {
      repository: repository.full_name,
      prNumber: pull_request.number,
      title: pull_request.title,
      author: pull_request.user.login
    }
  });
}

/**
 * Handle issues events
 */
async function handleIssuesEvent(data, env) {
  const { action, issue, repository } = data;

  console.log(`[GitHub] Issue ${action}: ${repository.full_name}#${issue.number}`);

  // Mint ChittyID for issue
  const issueChittyId = await mintChittyID(env, 'EVNT', {
    type: 'github_issue',
    repository: repository.full_name,
    number: issue.number,
    title: issue.title,
    action
  });

  console.log(`[GitHub] Issue ChittyID: ${issueChittyId}`);

  // Log to ChittyChronicle
  await logEvent(env, {
    event: `github.issue.${action}`,
    chittyId: issueChittyId,
    metadata: {
      repository: repository.full_name,
      issueNumber: issue.number,
      title: issue.title,
      author: issue.user.login
    }
  });
}

/**
 * Handle issue comment events
 */
async function handleIssueCommentEvent(data, env) {
  const { action, issue, comment, repository } = data;

  console.log(`[GitHub] Comment ${action} on ${repository.full_name}#${issue.number}`);

  // Mint ChittyID for comment
  const commentChittyId = await mintChittyID(env, 'EVNT', {
    type: 'github_comment',
    repository: repository.full_name,
    issueNumber: issue.number,
    commentId: comment.id,
    action
  });

  console.log(`[GitHub] Comment ChittyID: ${commentChittyId}`);

  // Log to ChittyChronicle
  await logEvent(env, {
    event: `github.issue_comment.${action}`,
    chittyId: commentChittyId,
    metadata: {
      repository: repository.full_name,
      issueNumber: issue.number,
      commentId: comment.id,
      author: comment.user.login
    }
  });
}
