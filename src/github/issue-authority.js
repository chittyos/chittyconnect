/**
 * GitHub App-backed issue creation authority.
 *
 * The public Worker does not expose this as an HTTP write endpoint. Authorized
 * ChittyOS workers reach it through the named GitHubIssueBrokerService
 * WorkerEntrypoint. Each (repo,idempotency_key) tuple is serialized through a
 * dedicated Durable Object before any external GitHub write occurs.
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

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stableArray(values, limit) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function normalizeIssueRequest(env, input) {
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
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PK) {
    return {
      ok: false,
      status: 503,
      code: "GITHUB_APP_UNAVAILABLE",
      retryable: true,
      error: "GitHub App authority is not configured",
    };
  }
  if (
    !env.GITHUB_ISSUE_IDEMPOTENCY?.idFromName ||
    !env.GITHUB_ISSUE_IDEMPOTENCY?.get
  ) {
    return {
      ok: false,
      status: 503,
      code: "IDEMPOTENCY_ACTOR_UNAVAILABLE",
      retryable: true,
      error: "GitHub issue idempotency actor is not configured",
    };
  }

  const normalized = {
    repo: parsed.full,
    owner: parsed.owner,
    repository: parsed.repo,
    title,
    body: typeof input?.body === "string" ? input.body : "",
    labels: stableArray(input?.labels, 20),
    assignees: stableArray(input?.assignees, 10),
    idempotency_key: idempotencyKey,
  };

  const digest = await sha256Hex(
    `${parsed.full.toLowerCase()}\0${idempotencyKey}`,
  );
  const requestHash = await sha256Hex(
    JSON.stringify({
      repo: normalized.repo.toLowerCase(),
      title: normalized.title,
      body: normalized.body,
      labels: normalized.labels,
      assignees: normalized.assignees,
    }),
  );

  return { ok: true, normalized: { ...normalized, digest, request_hash: requestHash } };
}

export async function createIssueWithGitHubApp(env, input) {
  const checked = await normalizeIssueRequest(env, input);
  if (!checked.ok) return checked;

  const operation = checked.normalized;
  const id = env.GITHUB_ISSUE_IDEMPOTENCY.idFromName(operation.digest);
  const stub = env.GITHUB_ISSUE_IDEMPOTENCY.get(id);

  let response;
  try {
    response = await stub.fetch("https://internal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation),
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: "IDEMPOTENCY_ACTOR_UNREACHABLE",
      retryable: true,
      error: `GitHub issue idempotency actor unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return response.json().catch(() => ({
    ok: false,
    status: 503,
    code: "IDEMPOTENCY_ACTOR_INVALID_RESPONSE",
    retryable: true,
    error: "GitHub issue idempotency actor returned an invalid response",
  }));
}

async function githubJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(async () => ({
    message: await response.text().catch(() => ""),
  }));
  return { response, body };
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "ChittyConnect/1.0",
  };
}

async function resolveInstallation(env, operation, appJwt) {
  const result = await githubJson(
    `https://api.github.com/repos/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.repository)}/installation`,
    { headers: githubHeaders(appJwt) },
  );

  if (!result.response.ok) {
    const transient = result.response.status === 429 || result.response.status >= 500;
    return {
      ok: false,
      status: transient ? 503 : result.response.status === 404 ? 403 : result.response.status,
      code: transient ? "GITHUB_INSTALLATION_RETRYABLE" : "INSTALLATION_NOT_AUTHORIZED",
      retryable: transient,
      error: transient
        ? "GitHub installation lookup temporarily unavailable"
        : "GitHub App is not authorized for the target repository",
    };
  }

  if (result.body?.suspended_at) {
    return {
      ok: false,
      status: 403,
      code: "INSTALLATION_SUSPENDED",
      retryable: false,
      error: "GitHub App installation is suspended",
    };
  }
  if (result.body?.permissions?.issues !== "write") {
    return {
      ok: false,
      status: 403,
      code: "ISSUES_WRITE_NOT_GRANTED",
      retryable: false,
      error: "GitHub App installation does not grant Issues write permission",
    };
  }

  return { ok: true, installation: result.body };
}

async function getScopedInstallationToken(env, installation, operation, appJwt) {
  if (!env.TOKEN_KV?.get || !env.TOKEN_KV?.put) {
    return {
      ok: false,
      status: 503,
      code: "TOKEN_CACHE_UNAVAILABLE",
      retryable: true,
      error: "TOKEN_KV unavailable for repository-scoped installation token cache",
    };
  }

  const cacheDigest = await sha256Hex(
    `${installation.id}\0${operation.repo.toLowerCase()}\0issues:write`,
  );
  const cacheKey = `github-install-token:v2:${cacheDigest}`;
  const cached = await env.TOKEN_KV.get(cacheKey, "json").catch(() => null);
  const cachedExpiry = cached?.expires_at ? Date.parse(cached.expires_at) : 0;
  if (
    cached?.token &&
    cached?.permissions?.issues === "write" &&
    cachedExpiry > Date.now() + 120000
  ) {
    return { ok: true, tokenData: cached, cached: true };
  }

  let tokenData;
  try {
    tokenData = await getInstallationToken(installation.id, appJwt, {
      repositories: [operation.repository],
      permissions: { issues: "write" },
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: "INSTALLATION_TOKEN_RETRYABLE",
      retryable: true,
      error: `GitHub installation-token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!tokenData?.token || tokenData?.permissions?.issues !== "write") {
    return {
      ok: false,
      status: 403,
      code: "SCOPED_TOKEN_MISSING_PERMISSION",
      retryable: false,
      error: "repository-scoped installation token lacks Issues write permission",
    };
  }

  const expiry = tokenData.expires_at ? Date.parse(tokenData.expires_at) : Date.now() + 3600000;
  const ttl = Math.max(60, Math.min(3300, Math.floor((expiry - Date.now()) / 1000) - 120));
  await env.TOKEN_KV.put(cacheKey, JSON.stringify(tokenData), { expirationTtl: ttl });

  return { ok: true, tokenData, cached: false };
}

function idempotencyMarker(digest) {
  return `<!-- chittyconnect-idempotency:${digest} -->`;
}

async function findIssueByMarker(operation, tokenData) {
  const marker = idempotencyMarker(operation.digest);
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  for (let page = 1; page <= 3; page += 1) {
    const url =
      `https://api.github.com/repos/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.repository)}/issues` +
      `?state=all&sort=created&direction=desc&per_page=100&page=${page}&since=${encodeURIComponent(since)}`;
    const result = await githubJson(url, { headers: githubHeaders(tokenData.token) });
    if (!result.response.ok) {
      const transient = result.response.status === 429 || result.response.status >= 500;
      return {
        ok: false,
        status: transient ? 503 : result.response.status,
        code: transient ? "GITHUB_RECONCILE_RETRYABLE" : "GITHUB_RECONCILE_REJECTED",
        retryable: transient,
        error: result.body?.message || `GitHub reconciliation failed with HTTP ${result.response.status}`,
      };
    }

    const rows = Array.isArray(result.body) ? result.body : [];
    const match = rows.find(
      (issue) =>
        !issue?.pull_request &&
        typeof issue?.body === "string" &&
        issue.body.includes(marker),
    );
    if (match?.html_url && match?.number) {
      return { ok: true, issue: match };
    }
    if (rows.length < 100) break;
  }

  return { ok: true, issue: null };
}

function issueBodyWithMarker(operation) {
  const marker = idempotencyMarker(operation.digest);
  return operation.body ? `${operation.body}\n\n${marker}` : marker;
}

function receiptFromIssue(operation, issue, recovered = false) {
  return {
    repo: operation.repo,
    issue_number: issue.number,
    issue_url: issue.html_url,
    idempotency_receipt: operation.digest,
    recovered,
    created_at: issue.created_at || new Date().toISOString(),
  };
}

/**
 * Execute the strongly serialized external write for one Durable Object.
 * The caller is GitHubIssueIdempotency.fetch().
 */
export async function processIdempotentIssueCreate(storage, env, operation) {
  const existing = await storage.get("operation");
  if (existing?.request_hash && existing.request_hash !== operation.request_hash) {
    return {
      ok: false,
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      retryable: false,
      error: "idempotency_key was already used with a different issue payload",
    };
  }
  if (existing?.status === "done" && existing?.receipt?.issue_url) {
    return {
      ok: true,
      status: 200,
      deduplicated: true,
      receipt_persisted: true,
      ...existing.receipt,
    };
  }

  if (!existing) {
    try {
      await storage.put("operation", {
        status: "creating",
        request_hash: operation.request_hash,
        repo: operation.repo,
        started_at: new Date().toISOString(),
      });
    } catch (error) {
      return {
        ok: false,
        status: 503,
        code: "IDEMPOTENCY_RESERVATION_FAILED",
        retryable: true,
        error: `Failed to reserve idempotency key: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  let appJwt;
  try {
    appJwt = await generateAppJWT(String(env.GITHUB_APP_ID), String(env.GITHUB_APP_PK));
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: "GITHUB_APP_JWT_RETRYABLE",
      retryable: true,
      error: `GitHub App JWT generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const installationResult = await resolveInstallation(env, operation, appJwt);
  if (!installationResult.ok) return installationResult;

  const tokenResult = await getScopedInstallationToken(
    env,
    installationResult.installation,
    operation,
    appJwt,
  );
  if (!tokenResult.ok) return tokenResult;

  // If a previous attempt crashed after GitHub accepted the POST but before the
  // Durable Object receipt committed, recover the external result before any
  // second create call.
  const reconciliation = await findIssueByMarker(operation, tokenResult.tokenData);
  if (!reconciliation.ok) return reconciliation;
  if (reconciliation.issue) {
    const receipt = receiptFromIssue(operation, reconciliation.issue, true);
    try {
      await storage.put("operation", {
        status: "done",
        request_hash: operation.request_hash,
        receipt,
      });
      return {
        ok: true,
        status: 200,
        deduplicated: true,
        receipt_persisted: true,
        ...receipt,
      };
    } catch (error) {
      console.error("[GitHubIssueAuthority] recovered receipt persistence failed", {
        repo: operation.repo,
        receipt: operation.digest.slice(0, 16),
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: true,
        status: 200,
        deduplicated: true,
        receipt_persisted: false,
        ...receipt,
      };
    }
  }

  const issuePayload = {
    title: operation.title,
    body: issueBodyWithMarker(operation),
  };
  if (operation.labels.length > 0) issuePayload.labels = operation.labels;
  if (operation.assignees.length > 0) issuePayload.assignees = operation.assignees;

  const created = await githubJson(
    `https://api.github.com/repos/${encodeURIComponent(operation.owner)}/${encodeURIComponent(operation.repository)}/issues`,
    {
      method: "POST",
      headers: {
        ...githubHeaders(tokenResult.tokenData.token),
        "Content-Type": "application/json",
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

  const receipt = receiptFromIssue(operation, created.body, false);
  try {
    await storage.put("operation", {
      status: "done",
      request_hash: operation.request_hash,
      receipt,
    });
    return {
      ok: true,
      status: 201,
      deduplicated: false,
      receipt_persisted: true,
      ...receipt,
    };
  } catch (error) {
    // GitHub already committed the side effect. Return success, leave the
    // durable state at "creating", and let the marker reconciliation above
    // recover the receipt on the next retry instead of POSTing again.
    console.error("[GitHubIssueAuthority] post-write receipt persistence failed", {
      repo: operation.repo,
      issue_number: receipt.issue_number,
      receipt: operation.digest.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: true,
      status: 201,
      deduplicated: false,
      receipt_persisted: false,
      ...receipt,
    };
  }
}
