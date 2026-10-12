/**
 * Secret Rotation Service
 *
 * Machine-orchestrated credential rotation for the synthetic dev team.
 * Manages hot/cold/cache secret layers:
 *   - Cold: chittysecrets (source of truth via credential broker)
 *   - Hot:  Cloudflare Secrets (env vars, pushed at deploy)
 *   - Cache: Workers KV (rotated tokens like OAuth access tokens)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/secret-rotation
 */

// --- Rotation Registry ---


/**
 * Each entry defines a rotatable secret: how to refresh it, where to cache it,
 * and how often it should be checked.
 */
const ROTATION_REGISTRY = {
  gdrive_access_token: {
    description: 'Google Drive OAuth2 access token',
    kvKey: 'secret:gdrive:access_token',
    metaKey: 'secret:gdrive:meta',
    refreshIntervalMs: 50 * 60 * 1000, // 50 minutes (tokens expire at 60)
    rotator: 'rotateGDriveToken',
  },
  neon_password: {
    description: 'Neon database role password (rotation suspended: broker custody required)',
    kvKey: 'secret:neon:connection_uri', // deprecated historical key: DO NOT read or write
    metaKey: 'secret:neon:meta',
    refreshIntervalMs: 7 * 24 * 60 * 60 * 1000, // retained for status compatibility
    rotator: 'rotateNeonPassword',
    enabled: false, // no verified atomic ChittySecrets delivery/consumer cutover
  },
};

// --- Secret Rotation Engine ---

export class SecretRotationService {
  /**
   * @param {object} env - Worker environment bindings
   * @param {KVNamespace} env.CREDENTIAL_CACHE - KV for hot token storage
   */
  constructor(env) {
    this.env = env;
    this.kv = env.CREDENTIAL_CACHE;
    if (!this.kv) {
      throw new Error('[SecretRotation] CREDENTIAL_CACHE KV binding is not configured');
    }
  }

  // --- Public API ---

  /**
   * Run all due rotations. Called from scheduled() cron handler.
   * @returns {Promise<RotationReport>}
   */
  async runDueRotations() {
    const report = { rotated: [], skipped: [], failed: [], timestamp: new Date().toISOString() };

    for (const [name, config] of Object.entries(ROTATION_REGISTRY)) {
      try {
        // Never schedule a password reset unless ChittySecrets can atomically
        // publish the replacement and all consumers prove they can read it.
        // A new KV connection URI alone is NOT an authorized rotation path.
        if (config.enabled === false) {
          report.skipped.push({ name, reason: 'policy_blocked_credential_custody' });
          continue;
        }
        const meta = await this.getMeta(config.metaKey);
        const lastRotatedAt = meta?.lastRotatedAt ? new Date(meta.lastRotatedAt).getTime() : 0;
        const age = Date.now() - lastRotatedAt;

        if (age < config.refreshIntervalMs) {
          report.skipped.push({ name, reason: 'not_due', ageMs: age, intervalMs: config.refreshIntervalMs });
          continue;
        }

        const result = await this[config.rotator]();
        await this.setMeta(config.metaKey, {
          lastRotatedAt: new Date().toISOString(),
          lastResult: result.ok ? 'success' : 'error',
          lastError: result.error || null,
        });

        if (result.ok) {
          report.rotated.push({ name, ...result });
        } else {
          report.failed.push({ name, error: result.error });
        }
      } catch (err) {
        report.failed.push({ name, error: err.message });
        console.error(`[SecretRotation] ${name} failed:`, err);
      }
    }

    console.log(
      `[SecretRotation] Report: ${report.rotated.length} rotated, ${report.skipped.length} skipped, ${report.failed.length} failed`,
    );
    return report;
  }

  /**
   * Force-rotate a specific secret by name.
   * @param {string} name - Key from ROTATION_REGISTRY
   * @returns {Promise<object>}
   */
  async forceRotate(name) {
    const config = ROTATION_REGISTRY[name];
    if (!config) {
      return { ok: false, error: `Unknown secret: ${name}` };
    }
    if (config.enabled === false) {
      // Forced requests are NOT an authorization to bypass the secret custody
      // boundary. Do not mutate metadata, KV, or the external provider.
      return { ok: false, error: 'POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED' };
    }

    try {
      const result = await this[config.rotator]();
      await this.setMeta(config.metaKey, {
        lastRotatedAt: new Date().toISOString(),
        lastResult: result.ok ? 'success' : 'error',
        lastError: result.error || null,
        forcedAt: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      console.error(`[SecretRotation] forceRotate("${name}") failed:`, err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get freshness status of all managed secrets.
   * @returns {Promise<object>}
   */
  async getStatus() {
    const secrets = {};

    for (const [name, config] of Object.entries(ROTATION_REGISTRY)) {
      const meta = await this.getMeta(config.metaKey);
      const lastRotatedAt = meta?.lastRotatedAt ? new Date(meta.lastRotatedAt).getTime() : 0;
      const age = Date.now() - lastRotatedAt;

      secrets[name] = {
        description: config.description,
        enabled: config.enabled !== false,
        blockedReason: config.enabled === false ? 'POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED' : null,
        lastRotatedAt: meta?.lastRotatedAt || null,
        lastResult: meta?.lastResult || 'never',
        lastError: meta?.lastError || null,
        ageMs: lastRotatedAt ? age : null,
        intervalMs: config.refreshIntervalMs,
        isDue: config.enabled !== false && age >= config.refreshIntervalMs,
        fresh: config.enabled !== false && lastRotatedAt > 0 && age < config.refreshIntervalMs,
      };
    }

    return {
      service: 'chittyconnect',
      component: 'secret-rotation',
      secrets,
      timestamp: new Date().toISOString(),
    };
  }

  // --- Rotators ---

  /**
   * Rotate Google Drive OAuth2 access token using a stored refresh token.
   *
   * Flow:
   *   1. Read refresh token from KV (seeded by provisioning bot)
   *   2. Exchange for new access token via Google OAuth2
   *   3. Cache new access token in KV with TTL
   *
   * @returns {Promise<{ok: boolean, expiresIn?: number, error?: string}>}
   */
  async rotateGDriveToken() {
    // Primary path: service account JWT flow (no refresh token needed).
    // Service-account failure must NOT short-circuit the refresh-token
    // fallback — otherwise a transient SA error causes an outage.
    const saJson = await this.kv.get('secret:gdrive:service_account');
    if (saJson) {
      try {
        const saResult = await this._rotateViaServiceAccount(saJson);
        if (saResult && saResult.ok) return saResult;
        console.warn(
          `[SecretRotation] Service-account rotation failed, falling back to refresh_token: ${saResult && saResult.error}`,
        );
      } catch (err) {
        console.warn(
          `[SecretRotation] Service-account rotation threw, falling back to refresh_token: ${err && err.message}`,
        );
      }
    }

    // Fallback: OAuth2 refresh token flow
    const refreshToken = await this.kv.get('secret:gdrive:refresh_token');
    const clientId = this.env.GDRIVE_CLIENT_ID;
    const clientSecret = this.env.GDRIVE_CLIENT_SECRET;

    if (!refreshToken || !clientId || !clientSecret) {
      return {
        ok: false,
        error: 'Missing GDrive credentials: neither service_account nor OAuth refresh_token configured in CREDENTIAL_CACHE KV',
      };
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Google OAuth2 error: ${response.status} — ${body}` };
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    await this.kv.put('secret:gdrive:access_token', accessToken, {
      expirationTtl: Math.max(expiresIn - 120, 300),
    });

    console.log(`[SecretRotation] GDrive access token rotated via refresh_token, expires in ${expiresIn}s`);
    return { ok: true, expiresIn, method: 'refresh_token' };
  }

  /**
   * Rotate GDrive token using service account JWT assertion.
   * No client_id/secret/refresh_token needed — uses domain-wide delegation.
   */
  async _rotateViaServiceAccount(saJson) {
    let sa;
    try {
      sa = JSON.parse(saJson);
    } catch {
      return { ok: false, error: 'Invalid service_account JSON in KV' };
    }

    // Validate and normalize service account fields
    if (!sa.client_email || !sa.private_key) {
      return { ok: false, error: 'missing service-account field: client_email or private_key' };
    }

    // If impersonate is provided at all, it must be a non-empty string —
    // an empty/whitespace value would silently cache as app-only and surprise callers.
    if (sa.impersonate !== undefined && sa.impersonate !== null) {
      if (typeof sa.impersonate !== 'string' || sa.impersonate.trim() === '') {
        return { ok: false, error: 'invalid service-account field: impersonate must be a non-empty string when provided' };
      }
    }

    let normalizedScopes;
    if (!sa.scopes) {
      return { ok: false, error: 'missing service-account field: scopes' };
    }
    if (typeof sa.scopes === 'string') {
      normalizedScopes = sa.scopes;
    } else if (Array.isArray(sa.scopes)) {
      if (sa.scopes.length === 0 || !sa.scopes.every((s) => typeof s === 'string')) {
        return { ok: false, error: 'invalid scopes: must be string or array of strings' };
      }
      normalizedScopes = sa.scopes.join(' ');
    } else {
      return { ok: false, error: 'invalid scopes: must be string or array of strings' };
    }

    const { createJwt } = await import('./jwt-helper.js');
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: sa.client_email,
      scope: normalizedScopes,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    if (sa.impersonate) {
      claims.sub = sa.impersonate;
    }

    const signedJwt = await createJwt(claims, sa.private_key);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJwt,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Service account JWT error: ${response.status} — ${body}` };
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    // Delegated tokens (with sub) work for Drive and Gmail; non-delegated tokens
    // only work for Drive — cache them separately so Gmail callers don't pick up
    // an app-only token and fail against users/me.
    const delegated = Boolean(claims.sub);
    const cacheKey = delegated
      ? 'secret:gdrive:access_token'
      : 'secret:gdrive:access_token:app_only';
    const staleKey = delegated
      ? 'secret:gdrive:access_token:app_only'
      : 'secret:gdrive:access_token';
    await this.kv.put(cacheKey, accessToken, {
      expirationTtl: Math.max(expiresIn - 120, 300),
    });
    // Evict the sibling key so a mode transition (adding/removing impersonate)
    // doesn't leave a stale token of the other flavor lingering until TTL expiry.
    await this.kv.delete(staleKey).catch(() => {});

    console.log(
      `[SecretRotation] GDrive access token rotated via service_account JWT (${delegated ? 'delegated' : 'app-only'}), expires in ${expiresIn}s`,
    );
    return { ok: true, expiresIn, method: 'service_account', delegated };
  }

  /**
   * Neon password rotation is explicitly suspended.
   *
   * The retired implementation reset the live Neon password and published the
   * only replacement connection string to eventually consistent CREDENTIAL_CACHE
   * KV, bypassing ChittySecrets and breaking brokered consumer consistency.
   *
   * Restart only through the existing ChittyConnect/ChittySecrets custody
   * authority after a verified atomic handoff, consumer-read receipt,
   * rollback plan, and separate production approval. No new store or token.
   */
  async rotateNeonPassword() {
    return { ok: false, error: 'POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED' };
  }

  // --- KV Helpers ---

  async getMeta(key) {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[SecretRotation] Failed to parse metadata for key "${key}":`, err.message);
      return null;
    }
  }

  async setMeta(key, meta) {
    await this.kv.put(key, JSON.stringify(meta));
  }
}

/**
 * Get a cached GDrive access token (for use by other services).
 *
 * @param {KVNamespace} kv - CREDENTIAL_CACHE binding
 * @param {{ allowAppOnly?: boolean }} [opts] - When true, falls back to a
 *   non-delegated (app-only) token that works for Drive but not Gmail.
 * @returns {Promise<string|null>}
 */
export async function getCachedGDriveToken(kv, opts = {}) {
  const delegated = await kv.get('secret:gdrive:access_token');
  if (delegated) return delegated;
  if (opts.allowAppOnly) {
    return kv.get('secret:gdrive:access_token:app_only');
  }
  return null;
}

/**
 * Retained legacy method signature; never returns a database credential
 * directly from KV. Existing callers must route through ChittyConnect's
 * authorized credential broker. No in-repository callers remain.
 */
export async function getCachedNeonUri(_kv) {
  return null;
}
