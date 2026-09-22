/**
 * GitHub App-backed issue creation authority.
 *
 * Credentials never leave ChittyConnect. The caller provides a repository,
 * issue content, and an idempotency key; ChittyConnect resolves the repository
 * installation, mints a repository-scoped installation token, performs the
 * write, and returns only a non-secret receipt.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#github-issue-authority
 */

import { generateAppJWT, getInstallationToken } from "../auth/github.js";

const DEFAULT_ALLOWED_ORGS = new Set([
  "chittyos",
  "chittyfoundation",
  "chittyapps",
  "chittycorp",
  "chicagoapps",
  "furnished-condos",
]);

function parseRepo(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], full: `${match[1]}/${match[2]}` };
}

function allowedOrgs(env) {
  const configured = String(env.GITHUB_BROKER_ALLOWED_ORGS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : DEFAULT_ALLOWED_ORGS;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function githubJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(async () => ({
    message: await response.text().catch(() => ""),
  }));
  return { response, body };
}

export async function createIssueWithGitHubApp(env, input, caller) {
  const parsed = parseRepo(input?.repo);
  if (!parsed) {
    return { ok: false, status: 400, code: "INVALID_REPO", error: "repo must be OWNER/REPO" };
  }
  if (!allowedOrgs(env).has(parsed.owner.toLowerCase())) {
    return { ok: false, status: 403, code: "ORG_NOT_ALLOWED", error: "repository owner is not allowlisted" };
  }

  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const idempotencyKey =
    typeof input?.idempotency_key === "string" ? input.idempotency_key.trim() : "";
  if (!title) {
    return { ok: false, status: 400, code: "TITLE_REQUIRED", error: "title is required" };
  }
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return {
      ok: false,
      status: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      error: "idempotency_key is required and must be <= 256 characters",
    };
  }
  if (!env.TOKEN_KV?.get || !env.TOKEN_KV?.put) {
    return {
      ok: false,
      status: 503,
      code: "IDEMPOTENCY_STORE_UNAVAILABLE",
      error: "TOKEN_KV unavailable; refusing non-idempotent GitHub write",
    };
  }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PK) {
    return {
      ok: false,
      status: 503,
      code: "GITHUB_APP_UNAVAILABLE",
      error: "GitHub App authority is not configured",
    };
  }

  const digest = await sha256Hex(`${parsed.full.toLowerCase()}\0${idempotencyKey}`);
  const receiptKey = `github-issue-idem:v1:${digest}`;
  const prior = await env.TOKEN_KV.get(receiptKey, "json");
  if (prior?.issue_url && prior?.issue_number) {
    console.log("[GitHubIssueAuthority] replay", {
      caller,
      repo: parsed.full,
      issue_number: prior.issue_number,
      receipt: digest.slice(0, 16),
    });
    return { ok: true, status: 200, deduplicated: true, ...prior };
  }

  const appJwt = await generateAppJWT(String(env.GITHUB_APP_ID), String(env.GITHUB_APP_PK));

  // Resolve the installation from the repository itself. This verifies the App
  // is actually installed on this repo instead of trusting a caller-supplied
  // installation id or a stale local mapping.
  const installationResult = await githubJson(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/installation`,
    {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "ChittyConnect/1.0",
      },
    },
  );
  if (!installationResult.response.ok) {
    return {
      ok: false,
      status: installationResult.response.status === 404 ? 403 : 502,
      code: "INSTALLATION_NOT_AUTHORIZED",
      error: "GitHub App is not authorized for the target repository",
    };
  }

  const installation = installationResult.body;
  if (installation?.suspended_at) {
    return { ok: false, status: 403, code: "INSTALLATION_SUSPENDED", error: "GitHub App installation is suspended" };
  }
  if (installation?.permissions?.issues !== "write") {
    return {
      ok: false,
      status: 403,
      code: "ISSUES_WRITE_NOT_GRANTED",
      error: "GitHub App installation does not grant Issues write permission",
    };
  }

  const tokenData = await getInstallationToken(installation.id, appJwt, {
    repositories: [parsed.repo],
    permissions: { issues: "write" },
  });
  if (tokenData?.permissions?.issues !== "write") {
    return {
      ok: false,
      status: 403,
      code: "SCOPED_TOKEN_MISSING_PERMISSION",
      error: "repository-scoped installation token lacks Issues write permission",
    };
  }

  const issuePayload = { title };
  if (typeof input.body === "string" && input.body.length > 0) issuePayload.body = input.body;
  if (Array.isArray(input.labels) && input.labels.length > 0) {
    issuePayload.labels = input.labels.filter((v) => typeof v === "string").slice(0, 20);
  }
  if (Array.isArray(input.assignees) && input.assignees.length > 0) {
    issuePayload.assignees = input.assignees.filter((v) => typeof v === "string").slice(0, 10);
  }

  const created = await githubJson(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "ChittyConnect/1.0",
      },
      body: JSON.stringify(issuePayload),
    },
  );

  if (!created.response.ok || !created.body?.html_url || !created.body?.number) {
    const retryable = created.response.status === 429 || created.response.status >= 500;
    return {
      ok: false,
      status: retryable ? 503 : created.response.status,
      code: retryable ? "GITHUB_RETRYABLE" : "GITHUB_CREATE_REJECTED",
      retryable,
      error: created.body?.message || `GitHub issue creation failed with HTTP ${created.response.status}`,
    };
  }

  const receipt = {
    repo: parsed.full,
    issue_number: created.body.number,
    issue_url: created.body.html_url,
    idempotency_receipt: digest,
    created_at: new Date().toISOString(),
    caller,
  };
  // No TTL: replay protection should outlive the Queue retry window and normal
  // operational history. The record contains no credential or matter payload.
  await env.TOKEN_KV.put(receiptKey, JSON.stringify(receipt));

  console.log("[GitHubIssueAuthority] created", {
    caller,
    repo: parsed.full,
    issue_number: receipt.issue_number,
    receipt: digest.slice(0, 16),
  });

  return { ok: true, status: 201, deduplicated: false, ...receipt };
}
