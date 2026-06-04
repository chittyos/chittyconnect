/**
 * Git Confirm Routes — second-factor token endpoint for sensitive git writes.
 *
 * Implements POST /api/git/confirm per chittyos/chittyconnect#210.
 * Issues short-TTL (90s) confirmation tokens that the write tools
 * (`git_push` with `force=true`, future `git_reset --hard`, etc.) must redeem
 * on the actual mutation request.
 *
 * Tokens are scoped: a token issued for `intent="force_push"`,
 * `repo_path="/abs/path"`, `remote="origin"`, `ref="refs/heads/foo"` can only
 * be redeemed for that exact tuple. This prevents a token harvested for one
 * action from being replayed against another.
 *
 * Hard-deny rule: tokens for force-push to a repo's default branch
 * (`main` / `master`) are refused at issue time, not just at redeem time —
 * per CHARTER.md "Force-push to main/master is hard-denied."
 *
 * Storage: TOKEN_KV (existing binding, see wrangler.jsonc).
 * Auth: X-ChittyOS-API-Key via mcpAuthMiddleware.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/git-confirm
 * @canon chittycanon://gov/governance#core-types
 */

import { Hono } from "hono";
import { mcpAuthMiddleware } from "../../middleware/mcp-auth.js";

const gitConfirmRoutes = new Hono();

// All endpoints require an authenticated MCP caller.
gitConfirmRoutes.use("*", mcpAuthMiddleware);

const CONFIRM_TTL_SECONDS = 90;
const TOKEN_BYTES = 24;
const SUPPORTED_INTENTS = new Set(["force_push", "force_push_with_lease"]);
const HARD_DENY_REFS = new Set([
  "main",
  "master",
  "refs/heads/main",
  "refs/heads/master",
]);

function isHardDeniedRef(ref) {
  if (!ref) return false;
  return HARD_DENY_REFS.has(ref);
}

function newConfirmationToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url (RFC 4648 §5) without padding — safe for headers and URL paths.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function tokenKey(token) {
  return `git:confirm:${token}`;
}

/**
 * POST /api/git/confirm
 *
 * Request body:
 *   {
 *     "intent": "force_push" | "force_push_with_lease",
 *     "repo_path": "/abs/path/to/repo",
 *     "remote": "origin",
 *     "ref": "refs/heads/feature-x",
 *     "reason": "Optional human-readable rationale (audit only)"
 *   }
 *
 * Response 201:
 *   {
 *     "confirmation_token": "<base64url>",
 *     "expires_at": "2026-06-04T02:30:00.000Z",
 *     "ttl_seconds": 90,
 *     "scope": { intent, repo_path, remote, ref }
 *   }
 *
 * Error codes:
 *   POLICY_BLOCKED_FORCE_TO_PROTECTED — ref is in the hard-deny set
 *   INVALID_INTENT                    — intent not in SUPPORTED_INTENTS
 *   MISSING_REQUIRED_FIELDS           — required body field absent
 */
gitConfirmRoutes.post("/confirm", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON",
        },
      },
      400,
    );
  }

  const { intent, repo_path, remote, ref, reason } = body || {};

  if (!intent || !repo_path || !remote || !ref) {
    return c.json(
      {
        error: {
          code: "MISSING_REQUIRED_FIELDS",
          message:
            "intent, repo_path, remote, and ref are all required",
        },
      },
      400,
    );
  }

  if (!SUPPORTED_INTENTS.has(intent)) {
    return c.json(
      {
        error: {
          code: "INVALID_INTENT",
          message: `intent must be one of: ${[...SUPPORTED_INTENTS].join(", ")}`,
        },
      },
      400,
    );
  }

  if (isHardDeniedRef(ref)) {
    return c.json(
      {
        error: {
          code: "POLICY_BLOCKED_FORCE_TO_PROTECTED",
          message:
            "Force operations against main/master are hard-denied regardless of confirmation",
        },
      },
      403,
    );
  }

  const apiKey = c.req.header("X-ChittyOS-API-Key");
  // mcpAuthMiddleware already validated; the key itself is non-secret as
  // an identifier (real secret is the validation against API_KEYS KV).
  // We persist a hash so the stored record can't be replayed as a key.
  const issuerFingerprint = await sha256Hex(apiKey).then((h) => h.slice(0, 16));

  const token = newConfirmationToken();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CONFIRM_TTL_SECONDS * 1000);

  const record = {
    intent,
    repo_path,
    remote,
    ref,
    reason: typeof reason === "string" ? reason.slice(0, 512) : null,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    issuer_fingerprint: issuerFingerprint,
    redeemed_at: null,
  };

  await c.env.TOKEN_KV.put(tokenKey(token), JSON.stringify(record), {
    expirationTtl: CONFIRM_TTL_SECONDS,
  });

  return c.json(
    {
      confirmation_token: token,
      expires_at: expiresAt.toISOString(),
      ttl_seconds: CONFIRM_TTL_SECONDS,
      scope: { intent, repo_path, remote, ref },
    },
    201,
  );
});

/**
 * POST /api/git/confirm/redeem
 *
 * Single-use redemption by the write handler. Validates that the token's
 * stored scope matches the requested operation, then deletes the token from
 * KV so it cannot be reused.
 *
 * Request body:
 *   {
 *     "confirmation_token": "...",
 *     "intent": "force_push",
 *     "repo_path": "/abs/path/to/repo",
 *     "remote": "origin",
 *     "ref": "refs/heads/feature-x"
 *   }
 *
 * Response 200:
 *   { "valid": true, "scope": {...}, "issued_at": "...", "issuer_fingerprint": "..." }
 *
 * Error codes:
 *   POLICY_BLOCKED_CONFIRMATION_REQUIRED — token not found or expired
 *   POLICY_BLOCKED_SCOPE_MISMATCH        — token exists but scope differs from request
 *   POLICY_BLOCKED_TOKEN_REDEEMED        — token already consumed (defense in depth; KV expiration normally handles this)
 */
gitConfirmRoutes.post("/confirm/redeem", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON",
        },
      },
      400,
    );
  }

  const { confirmation_token, intent, repo_path, remote, ref } = body || {};

  if (!confirmation_token || !intent || !repo_path || !remote || !ref) {
    return c.json(
      {
        error: {
          code: "MISSING_REQUIRED_FIELDS",
          message:
            "confirmation_token, intent, repo_path, remote, and ref are required",
        },
      },
      400,
    );
  }

  const key = tokenKey(confirmation_token);
  const raw = await c.env.TOKEN_KV.get(key);
  if (!raw) {
    return c.json(
      {
        error: {
          code: "POLICY_BLOCKED_CONFIRMATION_REQUIRED",
          message: "Confirmation token not found or expired",
        },
      },
      403,
    );
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    // Corrupt record — treat as missing, delete and refuse.
    await c.env.TOKEN_KV.delete(key);
    return c.json(
      {
        error: {
          code: "POLICY_BLOCKED_CONFIRMATION_REQUIRED",
          message: "Confirmation token record was unreadable; please re-issue",
        },
      },
      403,
    );
  }

  if (record.redeemed_at) {
    return c.json(
      {
        error: {
          code: "POLICY_BLOCKED_TOKEN_REDEEMED",
          message: "Confirmation token has already been redeemed",
        },
      },
      403,
    );
  }

  const scopeMatches =
    record.intent === intent &&
    record.repo_path === repo_path &&
    record.remote === remote &&
    record.ref === ref;

  if (!scopeMatches) {
    return c.json(
      {
        error: {
          code: "POLICY_BLOCKED_SCOPE_MISMATCH",
          message:
            "Confirmation token scope does not match the requested operation",
          expected: {
            intent: record.intent,
            repo_path: record.repo_path,
            remote: record.remote,
            ref: record.ref,
          },
        },
      },
      403,
    );
  }

  // Consume: delete from KV so the token cannot be replayed.
  await c.env.TOKEN_KV.delete(key);

  return c.json({
    valid: true,
    scope: {
      intent: record.intent,
      repo_path: record.repo_path,
      remote: record.remote,
      ref: record.ref,
    },
    issued_at: record.issued_at,
    issuer_fingerprint: record.issuer_fingerprint,
  });
});

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { gitConfirmRoutes };
