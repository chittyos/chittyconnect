/**
 * R2 Export Download Route
 *
 * Streams exported files (PDFs, proof bundles) from R2 without buffering.
 *
 * @module api/routes/exports
 */

import { Hono } from "hono";

export const exportRoutes = new Hono();

exportRoutes.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");

  if (!c.env.FILES) {
    return c.json({ error: "Storage not configured" }, 503);
  }

  try {
    const obj = await c.env.FILES.get(`exports/${key}`);
    if (!obj) {
      return c.json({ error: "Export not found" }, 404);
    }

    const filename = key
      .split("/")
      .pop()
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(obj.body, {
      headers: {
        "Content-Type":
          obj.httpMetadata?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(obj.size),
      },
    });
  } catch (err) {
    console.error(`[Exports] R2 get failed for exports/${key}:`, err);
    return c.json({ error: "Failed to retrieve export" }, 500);
  }
});
