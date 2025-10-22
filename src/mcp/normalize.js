/**
 * MCP Event Normalization
 *
 * Normalizes GitHub webhook events into ChittyOS MCP event schema
 */

/**
 * Normalize GitHub webhook event into MCP event schema
 * @param {object} params
 * @param {string} params.delivery - X-GitHub-Delivery ID
 * @param {string} params.event - X-GitHub-Event type
 * @param {object} params.payload - GitHub webhook payload
 * @param {number} params.installationId - Installation ID
 * @param {string} params.tenantId - Tenant UUID
 * @returns {object} Normalized MCP event
 */
export function normalizeGitHubEvent({
  delivery,
  event,
  payload,
  installationId,
  tenantId,
}) {
  const baseEvent = {
    source: "github",
    event,
    installation_id: installationId,
    tenant_id: tenantId,
    delivery_id: delivery,
    ts: new Date().toISOString(),
  };

  // Extract common fields based on event type
  switch (event) {
    case "push":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        refs: {
          branch: payload.ref?.replace("refs/heads/", ""),
          sha: payload.after,
          before: payload.before,
        },
        actor: extractActor(payload.sender),
        commits: payload.commits?.map((c) => ({
          sha: c.id,
          message: c.message,
          author: c.author,
          url: c.url,
        })),
      };

    case "pull_request":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        refs: {
          branch: payload.pull_request.head.ref,
          sha: payload.pull_request.head.sha,
          base_branch: payload.pull_request.base.ref,
          base_sha: payload.pull_request.base.sha,
        },
        actor: extractActor(payload.sender),
        pull_request: {
          number: payload.pull_request.number,
          title: payload.pull_request.title,
          state: payload.pull_request.state,
          action: payload.action,
          draft: payload.pull_request.draft,
          url: payload.pull_request.html_url,
        },
      };

    case "issue_comment":
    case "pull_request_review_comment":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        actor: extractActor(payload.sender),
        comment: {
          id: payload.comment.id,
          body: payload.comment.body,
          action: payload.action,
          url: payload.comment.html_url,
        },
        issue: payload.issue
          ? {
              number: payload.issue.number,
              title: payload.issue.title,
            }
          : null,
      };

    case "check_run":
    case "check_suite":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        refs: {
          branch:
            payload.check_run?.check_suite?.head_branch ||
            payload.check_suite?.head_branch,
          sha: payload.check_run?.head_sha || payload.check_suite?.head_sha,
        },
        actor: extractActor(payload.sender),
        check: {
          id: payload.check_run?.id || payload.check_suite?.id,
          name: payload.check_run?.name || payload.check_suite?.app?.name,
          status: payload.check_run?.status || payload.check_suite?.status,
          conclusion:
            payload.check_run?.conclusion || payload.check_suite?.conclusion,
          action: payload.action,
        },
      };

    case "workflow_run":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        refs: {
          branch: payload.workflow_run.head_branch,
          sha: payload.workflow_run.head_sha,
        },
        actor: extractActor(payload.sender),
        workflow: {
          id: payload.workflow_run.id,
          name: payload.workflow_run.name,
          status: payload.workflow_run.status,
          conclusion: payload.workflow_run.conclusion,
          action: payload.action,
          url: payload.workflow_run.html_url,
        },
      };

    case "status":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        refs: {
          sha: payload.sha,
          branch: payload.branches?.map((b) => b.name),
        },
        status: {
          state: payload.state,
          description: payload.description,
          context: payload.context,
          target_url: payload.target_url,
        },
      };

    case "issues":
      return {
        ...baseEvent,
        repo: extractRepo(payload.repository),
        actor: extractActor(payload.sender),
        issue: {
          number: payload.issue.number,
          title: payload.issue.title,
          state: payload.issue.state,
          action: payload.action,
          labels: payload.issue.labels?.map((l) => l.name),
          url: payload.issue.html_url,
        },
      };

    case "installation":
    case "installation_repositories":
      return {
        ...baseEvent,
        installation: {
          id: payload.installation.id,
          account: payload.installation.account.login,
          action: payload.action,
          repositories: payload.repositories_added || payload.repositories,
        },
      };

    default:
      // Generic fallback
      return {
        ...baseEvent,
        repo: payload.repository ? extractRepo(payload.repository) : null,
        actor: payload.sender ? extractActor(payload.sender) : null,
        raw_event: event,
      };
  }
}

/**
 * Extract repository info
 */
function extractRepo(repository) {
  if (!repository) return null;

  return {
    owner: repository.owner.login,
    name: repository.name,
    full_name: repository.full_name,
    private: repository.private,
    url: repository.html_url,
  };
}

/**
 * Extract actor info
 */
function extractActor(sender) {
  if (!sender) return null;

  return {
    login: sender.login,
    type: sender.type,
    url: sender.html_url,
  };
}
