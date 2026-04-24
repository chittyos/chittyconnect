/**
 * Google API Proxy Routes
 *
 * Proxies Google Drive and Gmail APIs using auto-rotated OAuth tokens.
 * Token source priority:
 *   1. CREDENTIAL_CACHE KV (rotated every 50 min by secret-rotation.js)
 *   2. 1Password broker (integrations/google/access_token)
 *   3. GOOGLE_ACCESS_TOKEN env var (fallback)
 *
 * Supports: Drive Files API, Gmail Messages API
 * Consumers: chittystorage (source inventory), chittyevidence-db (intake)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#google-proxy
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";
import { getCachedGDriveToken } from "../../services/secret-rotation.js";
import { requireServiceToken } from "../../middleware/require-service-token.js";

const googleRoutes = new Hono();
googleRoutes.use("*", requireServiceToken("google"));

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

/**
 * Get a valid Google access token — tries KV rotation cache first (fastest),
 * falls back to 1Password broker, then env var.
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

  // Fallback: 1Password broker or env var
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
 * List files in Google Drive. Supports query, fields, pageSize, pageToken.
 * Maps directly to https://developers.google.com/drive/api/v3/reference/files/list
 */
googleRoutes.get("/gdrive/files", async (c) => {
  const { q, fields, pageSize, pageToken } = c.req.query();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (fields) params.set("fields", fields);
  if (pageSize) params.set("pageSize", pageSize);
  if (pageToken) params.set("pageToken", pageToken);

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
  const metadataResponse = await fetch(`${DRIVE_API}/files/${encodedFileId}?fields=mimeType`, {
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
    // Use export endpoint for Google-native files (export as PDF by default)
    const exportMimeType = encodeURIComponent("application/pdf");
    downloadUrl = `${DRIVE_API}/files/${encodedFileId}/export?mimeType=${exportMimeType}`;
  } else {
    // Use alt=media for binary-backed files
    downloadUrl = `${DRIVE_API}/files/${encodedFileId}?alt=media`;
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
