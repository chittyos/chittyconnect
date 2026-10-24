/**
 * GitHub PR epistemic command plane (#361).
 *
 * Commands:
 *   /chitty-trace   - structural PLTEA validation + Canon #102 resolution
 *   /chitty-approve - SHA-pinned approval; fails closed until broker signing is live
 *   /chitty-hold    - records an explicit hold for the current PR/head SHA
 *
 * No matter-specific rules live here.
 */

import { validateCanonBindingsAndTemporalBounds } from "../validators/pltea-contract.js";
import { getCodeOwners } from "./reviewers.js";
import { createComplianceCheck } from "./checks.js";

const COMMANDS = new Set(["/chitty-trace", "/chitty-approve", "/chitty-hold"]);
const POLICY_VERSION = "github-pr-epistemic-v1";
const STATE_TTL_SECONDS = 60 * 60 * 24 * 30;

function parseCommand(body) {
  const firstLine = String(body || "").trim().split(/\r?\n/, 1)[0].trim();
  return COMMANDS.has(firstLine) ? firstLine : null;
}

async function ghJson(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ChittyConnect/1.0",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${text}`);
  }
  return response.json();
}

async function postComment(token, owner, repo, issueNumber, body) {
  return ghJson(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function repositoryPermission(token, owner, repo, username) {
  const result = await ghJson(
    token,
    `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}/permission`,
  );
  return result.permission || "none";
}

function permissionAllowsCommand(permission) {
  return permission === "admin" || permission === "write";
}

async function authorizeActor(token, owner, repo, prNumber, username, changedFiles, command) {
  const permission = await repositoryPermission(token, owner, repo, username);
  if (!permissionAllowsCommand(permission)) {
    return { authorized: false, reason: "WRITE_PERMISSION_REQUIRED", permission };
  }

  if (command === "/chitty-trace") {
    return { authorized: true, permission, codeowner: null };
  }

  const owners = await getCodeOwners(token, owner, repo, changedFiles);
  if (owners.users.includes(username)) {
    return { authorized: true, permission, codeowner: `@${username}` };
  }

  if (owners.teams.length > 0) {
    // The App manifest does not currently grant organization-membership read.
    // Do not infer team membership from author_association or org membership.
    return {
      authorized: false,
      reason: "CODEOWNERS_TEAM_MEMBERSHIP_UNVERIFIED",
      permission,
      codeowner_teams: owners.teams,
    };
  }

  if (owners.users.length > 0) {
    return {
      authorized: false,
      reason: "CODEOWNER_REQUIRED",
      permission,
      codeowner_users: owners.users,
    };
  }

  // No CODEOWNERS rule resolved for the changed files. Verified repository
  // write permission is the authorization policy in that case.
  return { authorized: true, permission, codeowner: null };
}

function parseInlineArray(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((part) => part.trim().replace(/^["']|["']$/g, ""));
}

export function extractProjectionContract(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const bindings = {};
  const temporalBounds = {};
  let section = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    if (/^Canon_Bindings:\s*$/.test(rawLine)) {
      section = "bindings";
      continue;
    }
    if (/^Temporal_Bounds:\s*$/.test(rawLine)) {
      section = "temporal";
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*/.test(rawLine) && !/^\s/.test(rawLine)) {
      section = null;
      continue;
    }

    const item = rawLine.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!item) continue;
    const [, key, value] = item;

    if (section === "bindings") {
      const parsed = parseInlineArray(value);
      if (parsed !== null) bindings[key] = parsed;
    } else if (section === "temporal") {
      const cleaned = value.trim().replace(/^["']|["']$/g, "");
      temporalBounds[key] = cleaned === "null" ? null : cleaned;
    }
  }

  return { bindings, temporalBounds };
}

async function fetchChangedFilesWithContent(token, owner, repo, pr) {
  const files = await ghJson(
    token,
    `/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`,
  );

  const changedPaths = files.map((file) => file.filename);
  const projectionFiles = [];

  for (const file of files) {
    if (!file.filename.endsWith(".md")) continue;
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${file.filename}?ref=${encodeURIComponent(pr.head.sha)}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.raw+json",
          "User-Agent": "ChittyConnect/1.0",
        },
      },
    );
    if (!response.ok) continue;
    const content = await response.text();
    const contract = extractProjectionContract(content);
    if (contract) projectionFiles.push({ path: file.filename, ...contract });
  }

  return { changedPaths, projectionFiles };
}

async function resolveCanon(env, tokens, scope) {
  const request = new Request("https://canon.chitty.cc/api/v1/graph/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens, scope }),
  });

  const response =
    env.SVC_CANON && typeof env.SVC_CANON.fetch === "function"
      ? await env.SVC_CANON.fetch(request)
      : await fetch(request);

  if (!response.ok) {
    return {
      available: false,
      diagnostics: {
        unresolved_queries: [{ token: "chittycanon://graph/resolve", reason: "CANON_UNAVAILABLE" }],
        conflicts: [],
      },
    };
  }

  const body = await response.json();
  return {
    available: true,
    snapshot_sha256: body.graph_snapshot_sha256 || null,
    diagnostics: body.resolution_diagnostics || {
      unresolved_queries: [],
      conflicts: [],
    },
  };
}

function stateKey(owner, repo, prNumber) {
  return `epistemic:pr:${owner}/${repo}#${prNumber}`;
}

async function saveState(env, owner, repo, prNumber, state) {
  await env.IDEMP_KV.put(stateKey(owner, repo, prNumber), JSON.stringify(state), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

async function loadState(env, owner, repo, prNumber) {
  return env.IDEMP_KV.get(stateKey(owner, repo, prNumber), { type: "json" });
}

async function runTrace(env, token, owner, repo, pr, projectionFiles) {
  if (projectionFiles.length === 0) {
    return {
      gate_state: "PENDING_CANON_RESOLUTION",
      structural: [],
      canon_snapshot_sha256: null,
      diagnostics: {
        unresolved_queries: [
          { token: "projection_contract", reason: "NO_GOVERNED_PROJECTION_FOUND" },
        ],
        conflicts: [],
      },
    };
  }

  const structural = projectionFiles.map((file) => ({
    path: file.path,
    result: validateCanonBindingsAndTemporalBounds(
      file.bindings,
      file.temporalBounds,
      { unresolved_queries: [], conflicts: [] },
    ),
  }));

  const structuralViolations = structural.flatMap((item) =>
    item.result.violations.map((violation) => ({ path: item.path, ...violation })),
  );

  if (structuralViolations.length > 0) {
    return {
      gate_state: "BLOCKED_ONTOLOGY_VIOLATION",
      structural,
      canon_snapshot_sha256: null,
      diagnostics: { unresolved_queries: [], conflicts: [] },
    };
  }

  const tokens = [
    ...new Set(
      projectionFiles.flatMap((file) =>
        Object.values(file.bindings).flatMap((value) =>
          Array.isArray(value) ? value : [],
        ),
      ),
    ),
  ];

  const canon = await resolveCanon(env, tokens, `${owner}/${repo}#${pr.number}`);
  const unresolvedCount = canon.diagnostics.unresolved_queries?.length || 0;
  const conflictCount = canon.diagnostics.conflicts?.length || 0;

  return {
    gate_state:
      !canon.available || unresolvedCount > 0 || conflictCount > 0
        ? "PENDING_CANON_RESOLUTION"
        : "READY_FOR_APPROVAL",
    structural,
    canon_snapshot_sha256: canon.snapshot_sha256 || null,
    diagnostics: canon.diagnostics,
  };
}

function traceComment(result, headSha) {
  const unresolved = result.diagnostics.unresolved_queries?.length || 0;
  const conflicts = result.diagnostics.conflicts?.length || 0;
  return [
    "## ChittyOS Epistemic & SOP Gate",
    "",
    `**Head SHA:** \`${headSha}\``,
    `**State:** \`${result.gate_state}\``,
    `**Canon snapshot:** \`${result.canon_snapshot_sha256 || "unavailable"}\``,
    `**Unresolved:** ${unresolved}`,
    `**Conflicts:** ${conflicts}`,
    "",
    result.gate_state === "READY_FOR_APPROVAL"
      ? "Structural and Canon resolution checks are clean for this SHA."
      : "Approval remains blocked for this SHA.",
  ].join("\n");
}

export async function handleEpistemicCommand(env, token, payload) {
  const command = parseCommand(payload.comment?.body);
  if (!command || payload.action !== "created" || !payload.issue?.pull_request) {
    return { handled: false };
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.issue.number;
  const actor = payload.comment.user.login;
  const pr = await ghJson(token, `/repos/${owner}/${repo}/pulls/${prNumber}`);
  const { changedPaths, projectionFiles } = await fetchChangedFilesWithContent(
    token,
    owner,
    repo,
    pr,
  );

  const auth = await authorizeActor(
    token,
    owner,
    repo,
    prNumber,
    actor,
    changedPaths,
    command,
  );

  if (!auth.authorized) {
    await postComment(
      token,
      owner,
      repo,
      prNumber,
      `ChittyOS command denied for @${actor}: \`${auth.reason}\`.`,
    );
    return { handled: true, authorized: false, command, reason: auth.reason };
  }

  if (command === "/chitty-trace") {
    const result = await runTrace(env, token, owner, repo, pr, projectionFiles);
    const state = {
      policy_version: POLICY_VERSION,
      repo: `${owner}/${repo}`,
      pr_number: prNumber,
      head_sha: pr.head.sha,
      trace: result,
      approval: null,
      hold: null,
      updated_at: new Date().toISOString(),
    };
    await saveState(env, owner, repo, prNumber, state);
    await postComment(token, owner, repo, prNumber, traceComment(result, pr.head.sha));
    await createComplianceCheck(token, owner, repo, pr.head.sha, {
      name: "ChittyOS Epistemic & SOP Gate",
      conclusion: result.gate_state === "READY_FOR_APPROVAL" ? "neutral" : "action_required",
      title: result.gate_state,
      summary: traceComment(result, pr.head.sha),
    });
    return { handled: true, authorized: true, command, result };
  }

  const existing = await loadState(env, owner, repo, prNumber);

  if (command === "/chitty-hold") {
    const state = {
      ...(existing || {}),
      policy_version: POLICY_VERSION,
      repo: `${owner}/${repo}`,
      pr_number: prNumber,
      head_sha: pr.head.sha,
      approval: null,
      hold: {
        actor,
        head_sha: pr.head.sha,
        at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };
    await saveState(env, owner, repo, prNumber, state);
    await postComment(
      token,
      owner,
      repo,
      prNumber,
      `ChittyOS approval held by @${actor} for head \`${pr.head.sha}\`.`,
    );
    return { handled: true, authorized: true, command, state: "HOLD" };
  }

  // /chitty-approve
  if (!existing || existing.head_sha !== pr.head.sha) {
    await postComment(
      token,
      owner,
      repo,
      prNumber,
      "Approval blocked: no fresh /chitty-trace exists for the current head SHA.",
    );
    return { handled: true, authorized: true, command, state: "TRACE_REQUIRED" };
  }

  if (existing.hold?.head_sha === pr.head.sha) {
    await postComment(
      token,
      owner,
      repo,
      prNumber,
      "Approval blocked: the current head SHA is explicitly held.",
    );
    return { handled: true, authorized: true, command, state: "HELD" };
  }

  if (existing.trace?.gate_state !== "READY_FOR_APPROVAL") {
    await postComment(
      token,
      owner,
      repo,
      prNumber,
      `Approval blocked: trace state is \`${existing.trace?.gate_state || "UNKNOWN"}\`.`,
    );
    return { handled: true, authorized: true, command, state: "TRACE_NOT_READY" };
  }

  // #228 signing authority is still SPEC-only. Do not manufacture an
  // approval-token hash locally; approval becomes active only after the broker
  // signs the SHA-bound approval material.
  await postComment(
    token,
    owner,
    repo,
    prNumber,
    "Approval pending: ChittyConnect #228 signing authority is not yet implemented. No approval token was minted.",
  );
  return { handled: true, authorized: true, command, state: "SIGNING_AUTHORITY_PENDING" };
}
