/**
 * Secret Rotation Service
 *
 * Machine-orchestrated credential rotation for the synthetic dev team.
 * Manages hot/cold/cache secret layers:
 *   - Cold: 1Password (source of truth via credential broker)
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
    description: 'Neon database role password',
    kvKey: 'secret:neon:connection_uri',
    metaKey: 'secret:neon:meta',
    refreshIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    rotator: 'rotateNeonPassword',
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
        lastRotatedAt: meta?.lastRotatedAt || null,
        lastResult: meta?.lastResult || 'never',
        lastError: meta?.lastError || null,
        ageMs: lastRotatedAt ? age : null,
        intervalMs: config.refreshIntervalMs,
        isDue: age >= config.refreshIntervalMs,
        fresh: lastRotatedAt > 0 && age < config.refreshIntervalMs,
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
    // Primary path: service account JWT flow (no refresh token needed)
    const saJson = await this.kv.get('secret:gdrive:service_account');
    if (saJson) {
      return this._rotateViaServiceAccount(saJson);
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
    if (!sa.impersonate || typeof sa.impersonate !== 'string' || sa.impersonate.trim() === '') {
      return { ok: false, error: 'missing service-account field: impersonate' };
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
      sub: sa.impersonate,
      scope: normalizedScopes,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

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

    await this.kv.put('secret:gdrive:access_token', accessToken, {
      expirationTtl: Math.max(expiresIn - 120, 300),
    });

    console.log(`[SecretRotation] GDrive access token rotated via service_account JWT, expires in ${expiresIn}s`);
    return { ok: true, expiresIn, method: 'service_account' };
  }

  /**
   * Rotate Neon database password via the Neon API.
   *
   * Flow:
   *   1. Read Neon API key from Worker env
   *   2. Generate new password via Neon roles API
   *   3. Update CREDENTIAL_CACHE with new connection string
   *
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async rotateNeonPassword() {
    const neonApiKey = this.env.NEON_API_KEY;
    const neonProjectId = this.env.NEON_PROJECT_ID;
    const neonBranchId = this.env.NEON_BRANCH_ID;
    const neonHost = this.env.NEON_HOST;
    const neonRoleName = this.env.NEON_ROLE_NAME || 'chittyos_app';
    const neonDb = this.env.NEON_DATABASE || 'neondb';

    if (!neonApiKey || !neonProjectId || !neonBranchId) {
      return { ok: false, error: 'Missing Neon API credentials (NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH_ID are all required)' };
    }

    if (!neonHost) {
      return { ok: false, error: 'NEON_HOST is required — without it the rotated password cannot be cached as a connection URI' };
    }

    // Step 1: Reset the role password via Neon API
    const resetUrl = `https://console.neon.tech/api/v2/projects/${neonProjectId}/branches/${neonBranchId}/roles/${neonRoleName}/reset_password`;
    const resetResponse = await fetch(resetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${neonApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resetResponse.ok) {
      const body = await resetResponse.text();
      return { ok: false, error: `Neon password reset failed: ${resetResponse.status} — ${body}` };
    }

    const resetData = await resetResponse.json();
    const newPassword = resetData.role?.password;

    if (!newPassword) {
      return { ok: false, error: 'Neon API did not return a new password' };
    }

    // Step 2: Build new connection URI and cache it
    const newUri = `postgresql://${neonRoleName}:${encodeURIComponent(newPassword)}@${neonHost}/${neonDb}?sslmode=require`;
    await this.kv.put('secret:neon:connection_uri', newUri, {
      expirationTtl: 8 * 24 * 60 * 60, // 8 days (rotation is weekly)
    });

    // Step 3: Cache the rotated-at timestamp (password itself is NOT cached in KV)
    await this.kv.put('secret:neon:password_rotated_at', new Date().toISOString());

    console.log(`[SecretRotation] Neon password rotated for role ${neonRoleName}`);
    return { ok: true };
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
 * @returns {Promise<string|null>}
 */
export async function getCachedGDriveToken(kv) {
  return kv.get('secret:gdrive:access_token');
}

/**
 * Get the cached Neon connection URI (rotated password).
 *
 * @param {KVNamespace} kv - CREDENTIAL_CACHE binding
 * @returns {Promise<string|null>}
 */
export async function getCachedNeonUri(kv) {
  return kv.get('secret:neon:connection_uri');
}
