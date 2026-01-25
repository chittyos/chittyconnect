/**
 * GitHub Reviewers API client
 *
 * Requests reviewers based on CODEOWNERS rules
 */

/**
 * Request reviewers for PR
 * @param {string} token - Installation access token
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {object} options - Reviewer options
 */
export async function requestReviewers(
  token,
  owner,
  repo,
  prNumber,
  options = {},
) {
  const {
    reviewers = [],
    teamReviewers = [],
    useCODEOWNERS: _useCODEOWNERS = true,
  } = options;

  // TODO: Parse CODEOWNERS file and match changed files
  // For now, use fallback reviewers
  const defaultReviewers = reviewers.length > 0 ? reviewers : [];
  const defaultTeams = teamReviewers.length > 0 ? teamReviewers : ["core"];

  if (defaultReviewers.length === 0 && defaultTeams.length === 0) {
    return; // No reviewers to request
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
      },
      body: JSON.stringify({
        reviewers: defaultReviewers,
        team_reviewers: defaultTeams,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    // Don't throw on 422 (reviewers already requested or author can't review)
    if (response.status !== 422) {
      throw new Error(
        `Request reviewers failed (${response.status}): ${error}`,
      );
    }
  }

  return await response.json();
}

/**
 * Parse CODEOWNERS file and get owners for paths
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {string[]} paths - Changed file paths
 * @returns {Promise<{users: string[], teams: string[]}>}
 */
export async function getCodeOwners(token, owner, repo, paths) {
  // Try to fetch CODEOWNERS file from common locations
  const locations = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

  let codeownersContent = null;

  for (const location of locations) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${location}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.raw",
          },
        },
      );

      if (response.ok) {
        codeownersContent = await response.text();
        break;
      }
    } catch (err) {
      // Continue to next location
    }
  }

  if (!codeownersContent) {
    return { users: [], teams: [] };
  }

  // Parse CODEOWNERS (simple implementation)
  const rules = parseCodeOwners(codeownersContent);
  const owners = matchPathsToOwners(paths, rules);

  return owners;
}

/**
 * Parse CODEOWNERS file content
 * @param {string} content
 * @returns {Array<{pattern: RegExp, owners: string[]}>}
 */
function parseCodeOwners(content) {
  const rules = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }

    const pattern = parts[0];
    const owners = parts.slice(1);

    // Convert glob pattern to regex (simplified)
    const regex = new RegExp(
      "^" +
        pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") +
        "$",
    );

    rules.push({ pattern: regex, owners });
  }

  return rules;
}

/**
 * Match file paths to CODEOWNERS rules
 * @param {string[]} paths
 * @param {Array} rules
 * @returns {{users: string[], teams: string[]}}
 */
function matchPathsToOwners(paths, rules) {
  const users = new Set();
  const teams = new Set();

  for (const path of paths) {
    for (const rule of rules) {
      if (rule.pattern.test(path)) {
        for (const owner of rule.owners) {
          if (owner.startsWith("@")) {
            const name = owner.slice(1);
            if (name.includes("/")) {
              // Team reference: @org/team
              teams.add(name.split("/")[1]);
            } else {
              // User reference: @username
              users.add(name);
            }
          }
        }
      }
    }
  }

  return {
    users: Array.from(users),
    teams: Array.from(teams),
  };
}
