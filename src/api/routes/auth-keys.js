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
 * The dashboard is a SELF-SERVICE key editor, not a capability issuer.
 * Privileged scopes (credentials:reveal:*, mcp:admin, infrastructure/admin)
 * belong to ChittyAuth/ChittyConnect's governed provisioning path.
 * Scope inheritance alone is not sufficient: legacy keys could previously
 * self-issue arbitrary scopes (#313). Allow only this narrow, immutable set.
 */
const SELF_SERVICE_SCOPES = new Set(["mcp:read", "mcp:write"]);

function normalizeSelfServiceKeyRequest(body, callerScopes) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, code: "INVALID_KEY_REQUEST" };
  }

  const name = body.name === undefined ? "Unnamed Key" : body.name;
  // Names are display labels, never a claim of service identity.
  if (typeof name !== "string" || name.trim().length < 1 ||
      name.trim().length > 80 ||
      [...name].some((ch) => {
        const cp = ch.codePointAt(0);
        return cp < 32 || cp === 127 || (cp >= 0x202a && cp <= 0x202e) ||
          (cp >= 0x2066 && cp <= 0x2069);
      })) {
    return { ok: false, status: 400, code: "INVALID_KEY_NAME" };
  }

  const parentScopes = Array.isArray(callerScopes)
    ? callerScopes.filter((s) => typeof s === "string") : [];

  // Omitted scopes inherit only the parent's own non-privileged permissions.
  // An empty or legacy parent set never creates an implicitly privileged key.
  const requested = body.scopes === undefined
    ? ["mcp:read", "mcp:write"].filter((s) => parentScopes.includes(s))
    : body.scopes;

  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 2 ||
      requested.some((s) => typeof s !== "string" || !SELF_SERVICE_SCOPES.has(s)) ||
      new Set(requested).size !== requested.length) {
    return { ok: false, status: 400, code: "INVALID_KEY_SCOPES" };
  }

  // The caller must already possess EVERY requested self-service permission.
  if (!requested.every((scope) => parentScopes.includes(scope))) {
    return { ok: false, status: 403, code: "SCOPE_ESCALATION_DENIED" };
  }

  const expiresAt = body.expiresAt ?? null;
  if (expiresAt !== null &&
      (typeof expiresAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(expiresAt) ||
       !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return { ok: false, status: 400, code: "INVALID_KEY_EXPIRY" };
  }

  return {
    ok: true,
    name: name.trim(),
    scopes: [...requested],
    expiresAt,
  };
}

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

  if (!keyInfo?.userId) {
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

  if (!keyInfo?.userId) {
    return c.json(
      { success: false, error: "No userId associated with this key" },
      400,
    );
  }

  const body = await c.req.json().catch(() => null);
  const admission = normalizeSelfServiceKeyRequest(body, keyInfo.scopes);
  if (!admission.ok) {
    return c.json({
      success: false,
      error: { code: admission.code, message: "Self-service key request denied" },
    }, admission.status);
  }
  const { name, scopes, expiresAt } = admission;

  const fullKey = await generateAPIKey(c.env, {
    name,
    userId: keyInfo.userId,
    scopes,
    expiresAt,
    // Mark provenance, but the key label is NOT a verified service identity.
    metadata: { issuance: "self-service", issuerUserId: keyInfo.userId },
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

  if (!keyInfo?.userId) {
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
