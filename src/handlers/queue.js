/**
 * Queue consumer for async GitHub event processing
 *
 * Processes events from the EVENT_Q queue:
 * 1. Normalize event into MCP schema
 * 2. Lookup tenant mapping
 * 3. Dispatch to MCP bus
 * 4. Execute automations
 */

// Temporary inline normalization until MCP normalize module is wired
const normalizeGitHubEvent = ({
  delivery,
  event,
  payload,
  installationId,
  tenantId,
}) => ({
  type: `github.${event}`,
  delivery,
  installationId,
  tenantId,
  payload,
});
import { getCachedInstallationToken } from "../auth/github.js";
import { createComplianceCheck } from "../github/checks.js";
import { autoLabelPullRequest } from "../github/labels.js";
import { summarizePullRequest } from "../github/comments.js";
import { requestReviewers } from "../github/reviewers.js";

/**
 * Fetch changed file paths for a pull request
 * @param {string} token - Installation access token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @returns {Promise<string[]>} Array of changed file paths
 */
async function fetchChangedFiles(token, owner, repo, prNumber) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
      },
    },
  );

  if (!response.ok) return [];

  const files = await response.json();
  return files.map((f) => f.filename);
}

/**
 * Process batch of queued events
 * @param {MessageBatch} batch - Queue message batch
 * @param {object} env - Worker environment
 */
export async function queueConsumer(batch, env) {
  const results = await Promise.allSettled(
    batch.messages.map((msg) => processEvent(msg.body, env)),
  );

  // Log failures
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error("Event processing failed:", {
        delivery: batch.messages[i].body.delivery,
        error: result.reason?.message,
      });
    }
  });

  // Ack all messages (even failures, to avoid infinite retries)
  batch.messages.forEach((msg) => msg.ack());
}

/**
 * Process single event
 * @param {object} message - Queue message body
 * @param {object} env - Worker environment
 */
async function processEvent(message, env) {
  const { delivery, event, payload } = message;

  try {
    // Get installation ID from payload
    const installationId = payload.installation?.id;
    if (!installationId) {
      console.warn("No installation_id in event:", { delivery, event });
      return;
    }

    // Lookup tenant mapping
    const tenantId = await lookupTenant(env, installationId);
    if (!tenantId) {
      console.warn("No tenant mapping for installation:", {
        installationId,
        delivery,
      });
      return;
    }

    // Normalize into MCP event schema
    const mcpEvent = normalizeGitHubEvent({
      delivery,
      event,
      payload,
      installationId,
      tenantId,
    });

    // Log normalized event for observability (MCP bus dispatch deferred to v3)
    console.log("MCP event normalized:", {
      type: mcpEvent.type,
      delivery: mcpEvent.delivery,
      tenantId: mcpEvent.tenantId,
    });

    // Execute v1 automations based on event type
    await runAutomations(env, event, payload, installationId);

    // Mark as completed
    await env.IDEMP_KV.put(delivery, "completed", { expirationTtl: 86400 });

    console.log("Event processed:", {
      delivery,
      event,
      installationId,
      tenantId,
    });
  } catch (error) {
    console.error("Event processing error:", {
      delivery,
      event,
      error: error.message,
      stack: error.stack,
    });

    // Mark as failed
    await env.IDEMP_KV.put(delivery, "failed", { expirationTtl: 86400 });
    throw error;
  }
}

/**
 * Lookup tenant ID from installation ID
 * @param {object} env
 * @param {number} installationId
 * @returns {Promise<string|null>} Tenant UUID
 */
async function lookupTenant(env, installationId) {
  // Our schema stores GitHub installations in the `installations` table
  // with a `chittyid` column. Use that as the tenant identifier.
  const result = await env.DB.prepare(
    "SELECT chittyid FROM installations WHERE installation_id = ?",
  )
    .bind(installationId)
    .first();

  return result?.chittyid || null;
}

/**
 * Run v1 automations based on event type
 * @param {object} env
 * @param {string} event
 * @param {object} payload
 * @param {number} installationId
 */
async function runAutomations(env, event, payload, installationId) {
  const token = await getCachedInstallationToken(env, installationId);

  switch (event) {
    case "push":
      // Post compliance check on push
      if (payload.after && payload.repository) {
        await createComplianceCheck(
          token,
          payload.repository.owner.login,
          payload.repository.name,
          payload.after,
        );
      }
      break;

    case "pull_request":
      if (["opened", "synchronize", "reopened"].includes(payload.action)) {
        const pr = payload.pull_request;
        const repo = payload.repository;

        // Fetch changed files first (used by labeling and reviewer assignment)
        const changedFiles = await fetchChangedFiles(
          token,
          repo.owner.login,
          repo.name,
          pr.number,
        );

        // Run automations in parallel
        await Promise.allSettled([
          // 1. Compliance check
          createComplianceCheck(
            token,
            repo.owner.login,
            repo.name,
            pr.head.sha,
          ),

          // 2. Auto-label based on title/paths
          autoLabelPullRequest(
            token,
            repo.owner.login,
            repo.name,
            pr.number,
            pr.title,
            changedFiles,
          ),

          // 3. PR summary comment
          summarizePullRequest(
            token,
            repo.owner.login,
            repo.name,
            pr.number,
            pr,
          ),

          // 4. Request reviewers (with CODEOWNERS resolution)
          requestReviewers(token, repo.owner.login, repo.name, pr.number, {
            changedFiles,
          }),
        ]);
      }
      break;

    case "issue_comment":
      // Re-summarize on "/chitty summarize" command
      if (payload.comment?.body?.includes("/chitty summarize")) {
        const issue = payload.issue;
        const repo = payload.repository;

        if (issue.pull_request) {
          // Fetch PR details
          const prResponse = await fetch(issue.pull_request.url, {
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github+json",
            },
          });
          const pr = await prResponse.json();

          await summarizePullRequest(
            token,
            repo.owner.login,
            repo.name,
            issue.number,
            pr,
          );
        }
      }
      break;
  }
}
