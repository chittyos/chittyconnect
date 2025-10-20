/**
 * GitHub Comments API client
 *
 * Posts and updates PR summary comments
 */

const COMMENT_MARKER = '<!-- chitty:summary v1 -->';

/**
 * Summarize pull request and post top-level comment
 * @param {string} token - Installation access token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {object} pr - PR object from GitHub API
 */
export async function summarizePullRequest(token, owner, repo, prNumber, pr) {
  // Generate summary
  const summary = generatePRSummary(pr);

  // Check if we already posted a summary comment
  const existingComment = await findExistingComment(token, owner, repo, prNumber);

  if (existingComment) {
    // Update existing comment
    await updateComment(token, owner, repo, existingComment.id, summary);
  } else {
    // Post new comment
    await postComment(token, owner, repo, prNumber, summary);
  }
}

/**
 * Generate PR summary text
 * @param {object} pr - PR object
 * @returns {string} Markdown summary
 */
function generatePRSummary(pr) {
  const lines = [];

  lines.push('## PR Summary');
  lines.push('');
  lines.push(`**Title:** ${pr.title}`);
  lines.push(`**Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\``);
  lines.push(`**Author:** @${pr.user.login}`);
  lines.push(`**State:** ${pr.state} ${pr.draft ? '(draft)' : ''}`);
  lines.push('');

  // Stats
  lines.push('### Changes');
  lines.push(`- **Files changed:** ${pr.changed_files || 0}`);
  lines.push(`- **Additions:** +${pr.additions || 0}`);
  lines.push(`- **Deletions:** -${pr.deletions || 0}`);
  lines.push(`- **Commits:** ${pr.commits || 0}`);
  lines.push('');

  // Risk assessment (simple heuristic)
  const totalChanges = (pr.additions || 0) + (pr.deletions || 0);
  const riskLevel = totalChanges > 500 ? 'High' : totalChanges > 200 ? 'Medium' : 'Low';
  lines.push(`### Risk Assessment: **${riskLevel}**`);
  lines.push('');

  // Labels
  if (pr.labels && pr.labels.length > 0) {
    lines.push('### Labels');
    lines.push(pr.labels.map(l => `\`${l.name}\``).join(', '));
    lines.push('');
  }

  // Checklist
  lines.push('### Review Checklist');
  lines.push('- [ ] Code follows project style guidelines');
  lines.push('- [ ] Tests added/updated for changes');
  lines.push('- [ ] Documentation updated if needed');
  lines.push('- [ ] No breaking changes introduced');
  lines.push('');

  lines.push('---');
  lines.push(`${COMMENT_MARKER}`);

  return lines.join('\n');
}

/**
 * Find existing Chitty summary comment
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<object|null>}
 */
async function findExistingComment(token, owner, repo, prNumber) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const comments = await response.json();
  return comments.find(c => c.body?.includes(COMMENT_MARKER)) || null;
}

/**
 * Post new comment
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} body
 */
async function postComment(token, owner, repo, issueNumber, body) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      },
      body: JSON.stringify({ body })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Post comment failed (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Update existing comment
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} commentId
 * @param {string} body
 */
async function updateComment(token, owner, repo, commentId, body) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      },
      body: JSON.stringify({ body })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Update comment failed (${response.status}): ${error}`);
  }

  return await response.json();
}
