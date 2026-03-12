/**
 * Auth Key Management Routes
 *
 * Endpoints for managing API keys from the dashboard UI.
 * All routes are behind the existing `authenticate` middleware.
 */

import { Hono } from "hono";
import {
  generateAPIKey,
  revokeAPIKey,
  listUserAPIKeys,
} from "../../middleware/mcp-auth.js";

export const authKeysRoutes = new Hono();

/**
 * GET /me — Return current key's metadata
 */
authKeysRoutes.get("/me", (c) => {
  const keyInfo = c.get("apiKey");

  return c.json({
    success: true,
    data: {
      userId: keyInfo.userId,
      name: keyInfo.name,
      scopes: keyInfo.scopes || [],
      type: keyInfo.type || "api_key",
      metadata: keyInfo.metadata || {},
      rateLimit: keyInfo.rateLimit,
    },
  });
});

/**
 * GET / — List all keys for the authenticated user
 */
authKeysRoutes.get("/", async (c) => {
  const keyInfo = c.get("apiKey");

  if (!keyInfo.userId) {
    return c.json(
      { success: false, error: "No userId associated with this key" },
      400,
    );
  }

  const keys = await listUserAPIKeys(c.env, keyInfo.userId);

  return c.json({ success: true, data: { keys } });
});

/**
 * POST / — Create a new API key for the authenticated user
 */
authKeysRoutes.post("/", async (c) => {
  const keyInfo = c.get("apiKey");

  if (!keyInfo.userId) {
    return c.json(
      { success: false, error: "No userId associated with this key" },
      400,
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const {
    name = "Unnamed Key",
    scopes = ["mcp:read", "mcp:write"],
    expiresAt = null,
  } = body;

  const fullKey = await generateAPIKey(c.env, {
    name,
    userId: keyInfo.userId,
    scopes,
    expiresAt,
  });

  return c.json(
    {
      success: true,
      data: {
        key: fullKey,
        name,
        scopes,
        expiresAt,
        message: "Store this key securely — it will not be shown again.",
      },
    },
    201,
  );
});

/**
 * DELETE /:keyPrefix — Revoke a key by its truncated prefix
 *
 * Iterates the user's keys, finds the one matching the prefix,
 * and revokes it. Ownership is enforced by userId match.
 */
authKeysRoutes.delete("/:keyPrefix", async (c) => {
  const keyInfo = c.get("apiKey");
  const prefix = c.req.param("keyPrefix");

  if (!keyInfo.userId) {
    return c.json(
      { success: false, error: "No userId associated with this key" },
      400,
    );
  }

  // Find the full key matching the prefix for this user
  const list = await c.env.API_KEYS.list({ prefix: "key:" });
  let targetFullKey = null;

  for (const item of list.keys) {
    const rawKey = item.name.replace("key:", "");
    if (rawKey.startsWith(prefix)) {
      const data = await c.env.API_KEYS.get(item.name);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.userId === keyInfo.userId) {
          targetFullKey = rawKey;
          break;
        }
      }
    }
  }

  if (!targetFullKey) {
    return c.json(
      { success: false, error: "Key not found or not owned by you" },
      404,
    );
  }

  const revoked = await revokeAPIKey(c.env, targetFullKey);

  if (!revoked) {
    return c.json({ success: false, error: "Failed to revoke key" }, 500);
  }

  return c.json({ success: true, data: { revoked: true } });
});
