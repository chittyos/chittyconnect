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

const googleRoutes = new Hono();

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

/**
 * Get a valid Google access token — tries KV rotation cache first (fastest),
 * falls back to 1Password broker, then env var.
 */
async function getGoogleToken(env) {
  // Fast path: KV-cached rotated token (updated every 50 min)
  if (env.CREDENTIAL_CACHE) {
    const kvToken = await env.CREDENTIAL_CACHE.get("secret:gdrive:access_token");
    if (kvToken) return kvToken;
  }

  // Fallback: 1Password broker or env var
  return getCredential(env, "integrations/google/access_token", "GOOGLE_ACCESS_TOKEN");
}

/**
 * Proxy a request to a Google API, injecting the access token.
 */
async function googleProxy(env, googleUrl) {
  const token = await getGoogleToken(env);
  if (!token) {
    return { ok: false, status: 503, error: "Google access token not available" };
  }

  const response = await fetch(googleUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: `Google API ${response.status}: ${body.slice(0, 200)}` };
  }

  return { ok: true, data: await response.json() };
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

  const result = await googleProxy(c.env, `${DRIVE_API}/files?${params.toString()}`);
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

  const result = await googleProxy(c.env, `${DRIVE_API}/files/${fileId}?${params.toString()}`);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * PATCH /gdrive/files/:fileId
 * Update file metadata (rename, move, set description).
 * Body: { name?, addParents?, removeParents?, description? }
 */
googleRoutes.patch("/gdrive/files/:fileId", async (c) => {
  const fileId = c.req.param("fileId");
  const token = await getGoogleToken(c.env);
  if (!token) return c.json({ error: "Google access token not available" }, 503);

  const body = await c.req.json();
  const { name, addParents, removeParents, description } = body;

  const params = new URLSearchParams();
  if (addParents) params.set("addParents", addParents);
  if (removeParents) params.set("removeParents", removeParents);

  const patchBody = {};
  if (name) patchBody.name = name;
  if (description !== undefined) patchBody.description = description;

  const response = await fetch(`${DRIVE_API}/files/${fileId}?${params.toString()}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchBody),
  });

  if (!response.ok) {
    const err = await response.text();
    return c.json({ error: `Drive PATCH failed: ${response.status} ${err.slice(0, 200)}` }, response.status);
  }

  return c.json(await response.json());
});

/**
 * POST /gdrive/folders
 * Create a folder in Drive.
 * Body: { name, parentId? }
 */
googleRoutes.post("/gdrive/folders", async (c) => {
  const token = await getGoogleToken(c.env);
  if (!token) return c.json({ error: "Google access token not available" }, 503);

  const { name, parentId } = await c.req.json();
  if (!name) return c.json({ error: "name required" }, 400);

  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];

  const response = await fetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    const err = await response.text();
    return c.json({ error: `Folder create failed: ${response.status} ${err.slice(0, 200)}` }, response.status);
  }

  return c.json(await response.json());
});

/**
 * GET /gdrive/files/:fileId/content
 * Download file content (returns raw bytes).
 */
googleRoutes.get("/gdrive/files/:fileId/content", async (c) => {
  const fileId = c.req.param("fileId");
  const token = await getGoogleToken(c.env);
  if (!token) return c.json({ error: "Google access token not available" }, 503);

  const response = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return c.json({ error: `Drive download failed: ${response.status}` }, response.status);
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": response.headers.get("Content-Length") || "",
    },
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

  const result = await googleProxy(c.env, `${GMAIL_API}/messages/${messageId}?${params.toString()}`);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.data);
});

/**
 * GET /email/messages/:messageId/attachments/:attachmentId
 * Download a Gmail attachment (returns raw bytes).
 */
googleRoutes.get("/email/messages/:messageId/attachments/:attachmentId", async (c) => {
  const { messageId, attachmentId } = c.req.param();

  const result = await googleProxy(
    c.env,
    `${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`,
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);

  // Gmail returns attachment data as base64url-encoded in { data, size }
  const { data, size } = result.data;
  if (!data) return c.json({ error: "No attachment data returned" }, 404);

  // Decode base64url → binary
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));

  return new Response(binary, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size || binary.length),
    },
  });
});

export { googleRoutes };
