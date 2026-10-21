/**
 * Google API Proxy Routes
 *
 * Proxies Google Drive and Gmail APIs using auto-rotated OAuth tokens.
 * Token source priority:
 *   1. CREDENTIAL_CACHE KV (rotated every 50 min by secret-rotation.js)
 *   2. chittysecrets broker (integrations/google/access_token)
 *   3. GOOGLE_ACCESS_TOKEN env var (fallback)
 *
 * Supports: Drive Files API (shared drives for authorized callers), Gmail Messages API
 * Consumers: chittystorage (source inventory), chittyevidence-db (intake)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#google-proxy
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";
import { getCachedGDriveToken } from "../../services/secret-rotation.js";

const googleRoutes = new Hono();
// Auth: covered by /api/* authenticate middleware in router.js

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

/**
 * Shared-drive support — gated authorization.
 *
 * Drive v3 omits shared-drive content unless the caller declares it can handle it.
 * `supportsAllDrives` is an app-capability declaration accepted by files.list and
 * files.get; `includeItemsFromAllDrives` is a results filter accepted by files.list
 * only ("If not present or set to false, then shared drive items are not returned"
 * — https://developers.google.com/workspace/drive/api/guides/enable-shareddrives).
 *
 * Without them a listing of a shared-drive folder returns HTTP 200 with zero files —
 * indistinguishable from an empty folder — and a metadata/content read of a file that
 * lives on a shared drive 404s.
 *
 * WHY THIS IS GATED RATHER THAN ALWAYS-ON:
 * `authenticate` (src/api/middleware/auth.js) checks only that the key exists in
 * API_KEYS KV and that `status === "active"`. There is no scope enforcement and no
 * per-route authorization — `scopes` is captured at auth.js:124 for OAuth tokens and
 * never read. Sending these parameters unconditionally would let any holder of any
 * active API key enumerate and read every shared drive the service account can see,
 * including litigation evidence. That is a privilege expansion on privileged material.
 *
 * WHY THE GRANT IS NOT A FIELD ON THE KEY RECORD:
 * `POST /api/auth/keys` (router.js:194 → routes/auth-keys.js) mints a key with
 * `scopes` and `name` taken verbatim from the request body, with no allowlist. Any
 * grant carried in those fields is self-servable in one request. `userId` is the only
 * identity on a KV key record a caller cannot choose: it is inherited from the minting
 * key, never read from the body. The allowlist therefore lives in worker config
 * (GDRIVE_SHARED_DRIVE_USER_IDS, a deploy-time var — a principal identifier, not a
 * secret) and is matched against `userId` alone.
 *
 * Default is CLOSED. An unset or empty allowlist authorizes nobody, and an
 * unauthorized caller gets a byte-identical request to the pre-change behaviour.
 *
 * NOTE ON `type`: an earlier revision rejected every record carrying a `type`,
 * on the stated premise that only fabricated principals have one. That premise was
 * false — production API_KEYS holds hand-written service records (`type: "service"`)
 * that never passed through generateAPIKey, including chittystorage, a documented
 * consumer of this proxy. The gate could therefore never open for the callers it
 * exists for. The test is now against the fabricated type names themselves.
 *
 * files.export takes only `mimeType` and is deliberately left untouched.
 * https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
 * https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
 */
function parseAllowlist(raw) {
  if (typeof raw !== "string") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Principal `type` values that middleware synthesises for a caller that has no
 * API_KEYS record of its own. A record is only trusted for this grant if its type
 * is NOT one of these — a `type` that is merely unfamiliar (e.g. the hand-written
 * `service` records in production) is a real key record, not a synthetic principal.
 *
 * Enumerated from every `c.set("apiKey", …)` in src/ rather than assumed:
 *   api/middleware/auth.js:79   → "public"            (policy-bundle, unauthenticated)
 *   api/middleware/auth.js:86   → "cloudflare-access" (context-sync via Access headers)
 *   api/middleware/auth.js:121  → "oauth"             (MCP OAuth bearer token)
 *   auth/secrets-portal-guard.js:147 → "cloudflare-access"
 *   auth/github-oidc.js:215     → "oidc"              (GitHub Actions workflow identity)
 * and two that set no type at all: auth.js:165 and middleware/mcp-auth.js:107, both
 * of which pass through a real KV record.
 *
 * Only auth.js's three can currently reach this route — router.js:94 applies
 * `authenticate` to all of /api/*, and googleRoutes mounts at router.js:163, so the
 * portal guard and the OIDC middleware never run here. "oidc" is listed anyway:
 * which middleware runs on which path is not a property of this file, and the bug
 * this replaces was caused by exactly that kind of unchecked assumption.
 */
const FABRICATED_PRINCIPAL_TYPES = new Set([
  "public",
  "cloudflare-access",
  "oauth",
  "oidc",
]);

/**
 * Is this caller authorized to reach shared-drive content?
 *
 * Requires a real API_KEYS record (not a synthetic principal) whose `userId` —
 * the one identity field a caller cannot choose — is on the configured allowlist.
 */
function sharedDriveAuthorized(c) {
  const keyInfo = c.get("apiKey");
  if (!keyInfo || FABRICATED_PRINCIPAL_TYPES.has(keyInfo.type)) return false;

  const { userId } = keyInfo;
  if (typeof userId !== "string" || !userId) return false;

  return parseAllowlist(c.env?.GDRIVE_SHARED_DRIVE_USER_IDS).includes(userId);
}

/** Add shared-drive parameters, but only for an authorized caller. */
function withAllDrives(c, params, { includeItems = false } = {}) {
  if (!sharedDriveAuthorized(c)) return params;
  params.set("supportsAllDrives", "true");
  if (includeItems) params.set("includeItemsFromAllDrives", "true");
  return params;
}

/**
 * Get a valid Google access token — tries KV rotation cache first (fastest),
 * falls back to chittysecrets broker, then env var.
 *
 * scope: "gmail" (default, requires delegated token with a user sub) or "drive"
 * (accepts a delegated token first, then a non-delegated app-only token).
 */
async function getGoogleToken(env, { scope = "gmail" } = {}) {
  // Fast path: KV-cached rotated token (updated every 50 min)
  if (env.CREDENTIAL_CACHE) {
    try {
      const cached = await getCachedGDriveToken(env.CREDENTIAL_CACHE, {
        allowAppOnly: scope === "drive",
      });
      if (cached) return cached;
    } catch {
      console.warn("Google token KV cache read failed; falling back to broker/env token source");
    }
  }

  // Fallback: chittysecrets broker or env var
  return getCredential(env, "integrations/google/access_token", "GOOGLE_ACCESS_TOKEN");
}

/**
 * Proxy a request to a Google API, injecting the access token.
 */
async function googleProxy(env, googleUrl, opts = {}) {
  const token = await getGoogleToken(env, opts);
  if (!token) {
    return { ok: false, status: 503, error: "Google access token not available" };
  }

  let response;
  try {
    response = await fetch(googleUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 502, error: "Google API request failed" };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: `Google API ${response.status}: ${body.slice(0, 200)}` };
  }

  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, status: 502, error: "Google API returned an invalid JSON response" };
  }
}

// ============================================
// GOOGLE DRIVE
// ============================================

/**
 * GET /gdrive/files
 * List files in Google Drive. Supports q, fields, pageSize, pageToken, and the
 * optional shared-drive scoping pair corpora/driveId, which are forwarded only for
 * a caller authorized for shared drives — see sharedDriveAuthorized above.
 * Maps directly to https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
 */
googleRoutes.get("/gdrive/files", async (c) => {
  const { q, fields, pageSize, pageToken, corpora, driveId } = c.req.query();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (fields) params.set("fields", fields);
  if (pageSize) params.set("pageSize", pageSize);
  if (pageToken) params.set("pageToken", pageToken);

  if (sharedDriveAuthorized(c)) {
    withAllDrives(c, params, { includeItems: true });
    // Optional: scope a search to one shared drive (corpora=drive requires driveId).
    // Not needed to see a folder's children, which `q` already scopes. Inside the
    // gate so an unauthorized request stays byte-identical to pre-change.
    if (corpora) params.set("corpora", corpora);
    if (driveId) params.set("driveId", driveId);
  }

  const result = await googleProxy(c.env, `${DRIVE_API}/files?${params.toString()}`, { scope: "drive" });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * GET /gdrive/files/:fileId
 * Get file metadata.
 */
googleRoutes.get("/gdrive/files/:fileId", async (c) => {
  const fileId = c.req.param("fileId");
  const { fields } = c.req.query();

  const params = new URLSearchParams();
  if (fields) params.set("fields", fields);
  withAllDrives(c, params);

  const encodedFileId = encodeURIComponent(fileId);
  const result = await googleProxy(c.env, `${DRIVE_API}/files/${encodedFileId}?${params.toString()}`, { scope: "drive" });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * GET /gdrive/files/:fileId/content
 * Download file content (returns raw bytes).
 * For Google-native files (Docs, Sheets, Slides), exports as PDF.
 * For binary-backed files, downloads with alt=media.
 */
googleRoutes.get("/gdrive/files/:fileId/content", async (c) => {
  const fileId = c.req.param("fileId");
  const token = await getGoogleToken(c.env, { scope: "drive" });
  if (!token) return c.json({ error: "Google access token not available" }, 503);

  // First, fetch file metadata to determine mimeType
  const encodedFileId = encodeURIComponent(fileId);
  const metadataParams = withAllDrives(c, new URLSearchParams({ fields: "mimeType" }));
  const metadataResponse = await fetch(`${DRIVE_API}/files/${encodedFileId}?${metadataParams}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metadataResponse.ok) {
    return c.json({ error: `Failed to fetch file metadata: ${metadataResponse.status}` }, metadataResponse.status);
  }

  const metadata = await metadataResponse.json();
  const mimeType = metadata.mimeType;

  // Check if it's a Google-native file type
  const googleNativeTypes = [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.spreadsheet",
    "application/vnd.google-apps.presentation",
  ];

  let downloadUrl;
  if (googleNativeTypes.includes(mimeType)) {
    // Use export endpoint for Google-native files (export as PDF by default).
    // files.export documents only `mimeType`; supportsAllDrives is NOT added here.
    const exportMimeType = encodeURIComponent("application/pdf");
    downloadUrl = `${DRIVE_API}/files/${encodedFileId}/export?mimeType=${exportMimeType}`;
  } else {
    // alt=media is files.get, which accepts supportsAllDrives.
    const mediaParams = withAllDrives(c, new URLSearchParams({ alt: "media" }));
    downloadUrl = `${DRIVE_API}/files/${encodedFileId}?${mediaParams}`;
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return c.json({ error: `Drive download failed: ${response.status}` }, response.status);
  }

  const headers = {
    "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
  };
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    headers["Content-Length"] = contentLength;
  }
  const contentDisposition = response.headers.get("Content-Disposition");
  if (contentDisposition) {
    headers["Content-Disposition"] = contentDisposition;
  }

  return new Response(response.body, {
    headers,
  });
});

// ============================================
// GMAIL
// ============================================

/**
 * GET /email/messages
 * List Gmail messages. Supports q (search query), maxResults, pageToken.
 */
googleRoutes.get("/email/messages", async (c) => {
  const { q, maxResults, pageToken } = c.req.query();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (maxResults) params.set("maxResults", maxResults);
  if (pageToken) params.set("pageToken", pageToken);

  const result = await googleProxy(c.env, `${GMAIL_API}/messages?${params.toString()}`);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * GET /email/messages/:messageId
 * Get a single message. Supports format (full, metadata, minimal, raw).
 */
googleRoutes.get("/email/messages/:messageId", async (c) => {
  const messageId = c.req.param("messageId");
  const { format } = c.req.query();

  const params = new URLSearchParams();
  if (format) params.set("format", format);

  const encodedMessageId = encodeURIComponent(messageId);
  const result = await googleProxy(c.env, `${GMAIL_API}/messages/${encodedMessageId}?${params.toString()}`);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * GET /email/messages/:messageId/attachments/:attachmentId
 * Download a Gmail attachment (returns raw bytes).
 */
googleRoutes.get("/email/messages/:messageId/attachments/:attachmentId", async (c) => {
  const { messageId, attachmentId } = c.req.param();

  const encodedMessageId = encodeURIComponent(messageId);
  const encodedAttachmentId = encodeURIComponent(attachmentId);

  const result = await googleProxy(
    c.env,
    `${GMAIL_API}/messages/${encodedMessageId}/attachments/${encodedAttachmentId}`,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);

  // Gmail returns attachment data as base64url-encoded in { data, size }
  const { data, size } = result.data;
  if (!data) return c.json({ error: "No attachment data returned" }, 404);

  // Decode base64url → binary
  // 1. Replace URL-safe chars with standard base64 chars
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");

  // 2. Add padding if needed (length must be multiple of 4)
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  base64 += "=".repeat(paddingNeeded);

  // 3. Decode with error handling
  let binary;
  try {
    binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch (err) {
    return c.json({ error: `Failed to decode attachment data: ${err.message}` }, 500);
  }

  return new Response(binary, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size || binary.length),
    },
  });
});

export { googleRoutes };
