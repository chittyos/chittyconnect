/**
 * GitHub Checks API client
 *
 * Creates check runs for compliance/CI validation
 */

/**
 * Create a compliance check run
 * @param {string} token - Installation access token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @param {object} options - Check options
 * @returns {Promise<object>} Check run response
 */
export async function createComplianceCheck(
  token,
  owner,
  repo,
  sha,
  options = {},
) {
  const {
    status = "completed",
    conclusion = "success",
    title = "ChittyMCP checks passed",
    summary = "Baseline webhook→MCP→GitHub round-trip ok.",
    details = null,
  } = options;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/check-runs`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
      },
      body: JSON.stringify({
        name: "Chitty Compliance/CI",
        head_sha: sha,
        status,
        conclusion,
        output: {
          title,
          summary,
          text: details,
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Create check failed (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Update existing check run
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number} checkRunId
 * @param {object} updates
 */
export async function updateCheckRun(token, owner, repo, checkRunId, updates) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
      },
      body: JSON.stringify(updates),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Update check failed (${response.status}): ${error}`);
  }

  return await response.json();
}
