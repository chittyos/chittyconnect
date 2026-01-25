/**
 * File routes: presign and commit endpoints (placeholders until R2 is configured).
 */

import { Hono } from "hono";

export const filesRoutes = new Hono();

// Presign an upload URL for R2-backed storage
// Body: { name, size, mime, session_id, sha256? }
filesRoutes.post("/presign", async (c) => {
  try {
    const { name, size, mime, session_id, sha256 } = await c.req.json();
    const apiKey = c.get("apiKey");

    if (!name || !session_id || !size) {
      return c.json(
        {
          error: "invalid_request",
          message: "name, session_id, and size required",
        },
        400,
      );
    }

    if (!c.env.FILES) {
      return c.json({ error: "r2_not_bound" }, 500);
    }

    // Generate R2 key
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const safeName = String(name).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const key = `files/${session_id}/${yyyy}/${mm}/${dd}/${sha256 || now.getTime()}-${safeName}`;

    // Generate upload token (1 hour expiry)
    const uploadToken = crypto.randomUUID();
    const expiresAt = Date.now() + 3600000; // 1 hour

    // Store upload intent in KV
    await c.env.TOKEN_KV.put(
      `upload:${uploadToken}`,
      JSON.stringify({
        r2_key: key,
        session_id,
        chitty_id: apiKey?.chittyId || apiKey?.userId || "unknown",
        name,
        size,
        mime,
        sha256,
        expires_at: expiresAt,
      }),
      { expirationTtl: 3600 },
    );

    return c.json({
      ok: true,
      upload_url: `https://api.chitty.cc/api/files/upload/${uploadToken}`,
      r2_key: key,
      expires_in: 3600,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch (err) {
    return c.json(
      { error: "presign_failed", message: String(err?.message || err) },
      500,
    );
  }
});

// Commit a file after upload (record metadata + broadcast event)
// Body: { r2_key, sha256, size, session_id, task_id? }
filesRoutes.post("/commit", async (c) => {
  try {
    const { r2_key, sha256, size, session_id, task_id } = await c.req.json();
    if (!r2_key || !session_id)
      return c.json({ error: "invalid_request" }, 400);
    const sm = c.get("streaming");
    if (sm) {
      await sm.broadcast({
        type: "context.files.committed",
        sessionId: session_id,
        file: { r2_key, sha256, size, task_id },
      });
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { error: "bad_json", message: String(err?.message || err) },
      400,
    );
  }
});

// PUT /api/files/upload/:token - Execute presigned upload
filesRoutes.put("/upload/:token", async (c) => {
  try {
    const token = c.req.param("token");

    // Validate token
    const intentData = await c.env.TOKEN_KV.get(`upload:${token}`);
    if (!intentData) {
      return c.json({ error: "invalid_or_expired_token" }, 401);
    }

    const intent = JSON.parse(intentData);

    // Upload to R2
    const body = await c.req.arrayBuffer();
    await c.env.FILES.put(intent.r2_key, body, {
      httpMetadata: { contentType: intent.mime || "application/octet-stream" },
    });

    // Record in context_files
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `
      INSERT OR REPLACE INTO context_files
      (id, session_id, chitty_id, file_uri, file_name, file_size, sha256, mime_type, is_active, last_accessed, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
    )
      .bind(
        crypto.randomUUID(),
        intent.session_id,
        intent.chitty_id,
        `r2://${intent.r2_key}`,
        intent.name,
        body.byteLength,
        intent.sha256,
        intent.mime,
        now,
        now,
      )
      .run();

    // Cleanup token
    await c.env.TOKEN_KV.delete(`upload:${token}`);

    // Broadcast via SSE
    const sm = c.get("streaming");
    if (sm) {
      await sm.broadcast({
        type: "context.files.uploaded",
        sessionId: intent.session_id,
        file: {
          r2_key: intent.r2_key,
          sha256: intent.sha256,
          size: body.byteLength,
          name: intent.name,
        },
      });
    }

    return c.json({ ok: true, r2_key: intent.r2_key, size: body.byteLength });
  } catch (err) {
    return c.json(
      { error: "upload_failed", message: String(err?.message || err) },
      500,
    );
  }
});

export default filesRoutes;

// Direct upload endpoint (base64 body) until presign is implemented
// Body: { name, sha256, session_id, size?, mime?, content_base64 }
filesRoutes.post("/upload", async (c) => {
  try {
    const env = c.env;
    if (!env || !env.FILES) return c.json({ error: "r2_not_bound" }, 500);
    const { name, sha256, session_id, size, mime, content_base64 } =
      await c.req.json();
    if (!name || !session_id || !content_base64)
      return c.json({ error: "invalid_request" }, 400);

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const safeName = String(name).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const key = `files/${session_id}/${yyyy}/${mm}/${dd}/${sha256 || now.getTime()}-${safeName}`;

    const bytes = Uint8Array.from(atob(content_base64), (c) => c.charCodeAt(0));
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: mime || "application/octet-stream" },
    });

    const sm = c.get("streaming");
    if (sm) {
      await sm.broadcast({
        type: "context.files.uploaded",
        sessionId: session_id,
        file: { r2_key: key, sha256, size: size || bytes.length, name },
      });
    }
    return c.json({ ok: true, r2_key: key });
  } catch (err) {
    return c.json(
      { error: "upload_failed", message: String(err?.message || err) },
      500,
    );
  }
});
