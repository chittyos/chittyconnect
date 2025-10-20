/**
 * GitHub Labels API client
 *
 * Auto-labels PRs based on title patterns and changed files
 */

/**
 * Label rules based on PR title patterns
 */
const TITLE_RULES = [
  { pattern: /^feat:|^feature:/i, label: 'type/feature' },
  { pattern: /^fix:|^bugfix:/i, label: 'type/bugfix' },
  { pattern: /^chore:/i, label: 'type/chore' },
  { pattern: /^docs:/i, label: 'type/docs' },
  { pattern: /^refactor:/i, label: 'type/refactor' },
  { pattern: /^test:/i, label: 'type/test' },
  { pattern: /^perf:/i, label: 'type/performance' },
  { pattern: /^ci:/i, label: 'type/ci' }
];

/**
 * Label rules based on changed file paths
 */
const PATH_RULES = [
  { pattern: /^src\/api\//i, label: 'area/api' },
  { pattern: /^src\/auth\//i, label: 'area/auth' },
  { pattern: /^src\/github\//i, label: 'area/github' },
  { pattern: /^src\/mcp\//i, label: 'area/mcp' },
  { pattern: /\.test\.[jt]s$/i, label: 'area/tests' },
  { pattern: /^docs\//i, label: 'area/docs' },
  { pattern: /wrangler\.toml$/i, label: 'area/infrastructure' },
  { pattern: /package\.json$/i, label: 'area/dependencies' }
];

/**
 * Size labels based on changes count
 */
const SIZE_LABELS = [
  { max: 10, label: 'size/XS' },
  { max: 50, label: 'size/S' },
  { max: 200, label: 'size/M' },
  { max: 500, label: 'size/L' },
  { max: Infinity, label: 'size/XL' }
];

/**
 * Auto-label pull request based on title and changed files
 * @param {string} token - Installation access token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {string} title - PR title
 * @param {string[]} changedFiles - Array of changed file paths
 */
export async function autoLabelPullRequest(token, owner, repo, prNumber, title, changedFiles = []) {
  const labels = new Set();

  // Match title patterns
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) {
      labels.add(rule.label);
    }
  }

  // Match file paths
  for (const file of changedFiles) {
    for (const rule of PATH_RULES) {
      if (rule.pattern.test(file)) {
        labels.add(rule.label);
      }
    }
  }

  // Add size label
  const changesCount = changedFiles.length;
  for (const { max, label } of SIZE_LABELS) {
    if (changesCount <= max) {
      labels.add(label);
      break;
    }
  }

  // Apply labels if any were matched
  if (labels.size > 0) {
    await addLabels(token, owner, repo, prNumber, Array.from(labels));
  }

  return Array.from(labels);
}

/**
 * Add labels to issue/PR
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string[]} labels
 */
export async function addLabels(token, owner, repo, issueNumber, labels) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      },
      body: JSON.stringify({ labels })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Add labels failed (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Remove label from issue/PR
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} label
 */
export async function removeLabel(token, owner, repo, issueNumber, label) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0'
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    throw new Error(`Remove label failed (${response.status}): ${error}`);
  }
}
