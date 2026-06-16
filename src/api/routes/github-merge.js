/**
 * GitHub PR Merge — governed, internally-authenticated connection action.
 *
 * Implements POST /integrations/github/merge-pr.
 *
 * This is the CONNECTION layer performing an authenticated GitHub merge on
 * behalf of an internally-authenticated caller (the autoassist executor).
 * The App installation token is minted/cached here and NEVER leaves this
 * layer — the caller holds no GitHub credential. ChittyConnect does NOT
 * decide maintainer policy; the calling executor already re-verifies the
 * full merge gate at execution time. This endpoint simply executes the
 * merge the executor has authorized, with a TOCTOU guard so a stale
 * decision cannot merge a moved head.
 *
 * Auth: internal-only. Requires the shared internal secret presented as
 * `X-Webhook-Secret` (same INTERNAL_WEBHOOK_SECRET used by the webhook
 * router's outbound forwarding). Validated with a constant-time compare and
 * failed closed if the secret is unset. This endpoint is NOT public.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/github-merge
 * @canon chittycanon://gov/governance#core-types
 */

import { Hono } from "hono";
import { getCachedInstallationToken, getInstallationIdForRepo } from "../../auth/github.js";

const githubMergeRoutes = new Hono();

const VALID_MERGE_METHODS = new Set(["squash", "merge", "rebase"]);

/**
 * Constant-time string comparison (length-independent leak only).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against a fixed-length accumulator; differing lengths still
  // run the full loop over the longer buffer to avoid early-exit timing.
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * POST /integrations/github/merge-pr
 *
 * Request body:
 *   {
 *     "repo": "owner/name",
 *     "pr_number": 123,
 *     "merge_method": "squash" | "merge" | "rebase"   (default "squash")
 *     "expected_head_sha": "<sha>"                     (optional TOCTOU guard)
 *   }
 *
 * Response 200:
 *   { "merged": true, "sha": "<merge-sha>", "message": "...", "status": 200 }
 *
 * Error JSON (fail-safe) on any failure with appropriate status.
 */
githubMergeRoutes.post("/merge-pr", async (c) => {
  // --- Internal auth: fail closed ---
  const expectedSecret = c.env.INTERNAL_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return c.json(
      {
        merged: false,
        error: {
          code: "POLICY_BLOCKED_INTERNAL_SECRET_UNSET",
          message: "INTERNAL_WEBHOOK_SECRET is not configured; refusing merge",
        },
        status: 503,
      },
      503,
    );
  }
  const presented = c.req.header("X-Webhook-Secret");
  if (!presented || !timingSafeEqual(presented, expectedSecret)) {
    return c.json(
      {
        merged: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing internal secret",
        },
        status: 401,
      },
      401,
    );
  }

  // --- Parse + validate body ---
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        merged: false,
        error: { code: "INVALID_JSON", message: "Body must be valid JSON" },
        status: 400,
      },
      400,
    );
  }

  const { repo, pr_number, merge_method, expected_head_sha } = body || {};

  // repo must be exactly "owner/name": two non-empty segments, each limited to
  // GitHub's identifier charset. A permissive check (e.g. includes("/")) lets
  // "owner/name/extra", "/name", or "owner/" through, and split("/", 2) would
  // silently drop trailing segments — risking a merge against the wrong repo.
  const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
  if (!repo || typeof repo !== "string" || !REPO_RE.test(repo)) {
    return c.json(
      {
        merged: false,
        error: {
          code: "MISSING_REQUIRED_FIELDS",
          message: 'repo must be exactly "owner/name"',
        },
        status: 400,
      },
      400,
    );
  }
  if (!Number.isInteger(pr_number) || pr_number <= 0) {
    return c.json(
      {
        merged: false,
        error: {
          code: "MISSING_REQUIRED_FIELDS",
          message: "pr_number must be a positive integer",
        },
        status: 400,
      },
      400,
    );
  }
  const method = merge_method ?? "squash";
  if (!VALID_MERGE_METHODS.has(method)) {
    return c.json(
      {
        merged: false,
        error: {
          code: "INVALID_MERGE_METHOD",
          message: `merge_method must be one of: ${[...VALID_MERGE_METHODS].join(", ")}`,
        },
        status: 400,
      },
      400,
    );
  }

  // expected_head_sha is the TOCTOU guard — only meaningful if it's a real
  // git object id. Reject non-string/whitespace early rather than forwarding a
  // malformed guard to GitHub where it would fail less predictably.
  if (
    expected_head_sha !== undefined &&
    (typeof expected_head_sha !== "string" ||
      !/^[0-9a-fA-F]{7,40}$/.test(expected_head_sha))
  ) {
    return c.json(
      {
        merged: false,
        error: {
          code: "INVALID_EXPECTED_HEAD_SHA",
          message: "expected_head_sha must be a 7-40 char hex git sha",
        },
        status: 400,
      },
      400,
    );
  }

  const [owner, name] = repo.split("/", 2);

  try {
    // --- Mint/get installation token (never leaves this layer) ---
    const installationId = await getInstallationIdForRepo(c.env, owner, name);
    const token = await getCachedInstallationToken(c.env, installationId);

    // --- Execute GitHub merge with TOCTOU sha guard ---
    const mergeBody = { merge_method: method };
    if (expected_head_sha) {
      // GitHub rejects (409) if the PR head has moved since the executor's
      // decision — this is the TOCTOU guard.
      mergeBody.sha = expected_head_sha;
    }

    const ghResp = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${pr_number}/merge`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ChittyConnect/1.0",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mergeBody),
      },
    );

    const ghJson = await ghResp.json().catch(() => ({}));

    // Success: GitHub returns 200 with { merged: true, sha, message }
    if (ghResp.ok && ghJson.merged) {
      return c.json(
        {
          merged: true,
          sha: ghJson.sha,
          message: ghJson.message,
          status: ghResp.status,
        },
        200,
      );
    }

    // 405 can mean BOTH "already merged" and "not mergeable". 409 means the
    // base/head moved (incl. the sha TOCTOU guard rejection). Do NOT assume
    // 405 == already-merged; confirm via the PR's merged state before
    // reporting success, otherwise surface the failure.
    if (ghResp.status === 405 || ghResp.status === 409) {
      const prResp = await fetch(
        `https://api.github.com/repos/${owner}/${name}/pulls/${pr_number}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "ChittyConnect/1.0",
          },
        },
      );
      const prJson = await prResp.json().catch(() => ({}));
      if (prResp.ok && prJson.merged === true) {
        // Idempotent success: already merged.
        return c.json(
          {
            merged: true,
            sha: prJson.merge_commit_sha,
            message: "Pull request already merged",
            status: 200,
          },
          200,
        );
      }

      return c.json(
        {
          merged: false,
          error: {
            code:
              ghResp.status === 409
                ? "HEAD_MOVED_OR_NOT_MERGEABLE"
                : "NOT_MERGEABLE",
            message:
              ghJson.message ||
              "GitHub refused the merge (head moved or PR not mergeable)",
          },
          status: ghResp.status,
        },
        ghResp.status,
      );
    }

    // Any other non-OK status from GitHub: surface it.
    return c.json(
      {
        merged: false,
        error: {
          code: "GITHUB_MERGE_FAILED",
          message: ghJson.message || `GitHub merge failed (${ghResp.status})`,
        },
        status: ghResp.status,
      },
      ghResp.status === 0 ? 502 : ghResp.status,
    );
  } catch (error) {
    return c.json(
      {
        merged: false,
        error: {
          code: "MERGE_EXECUTION_ERROR",
          message: error?.message || "Unexpected error executing merge",
        },
        status: 500,
      },
      500,
    );
  }
});

export { githubMergeRoutes };
