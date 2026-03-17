/**
 * Credential Broker — Unified abstraction over credential backends
 *
 * Supports multiple backends:
 *   - "chittyserv" → ChittyServ API at CHITTYSERV_URL/v1/
 *   - "1password"  → 1Password Connect API (legacy)
 *
 * Selection via env.CREDENTIAL_BROKER_TYPE (default: "1password" for backward compat)
 *
 * @module lib/credential-broker
 */

import { OnePasswordConnectClient } from "../services/1password-connect-client.js";
import { ChittyServClient } from "../services/chittyserv-client.js";

/**
 * Create a credential broker based on environment configuration
 *
 * @param {object} env - Worker environment bindings
 * @returns {CredentialBrokerInterface} Broker instance
 */
export function createCredentialBroker(env) {
  const brokerType = (env.CREDENTIAL_BROKER_TYPE || "1password").toLowerCase();

  switch (brokerType) {
    case "chittyserv":
      return new ChittyServBroker(env);

    case "1password":
      return new OnePasswordBroker(env);

    case "auto":
      // Try chittyserv first, fall back to 1password
      return new AutoBroker(env);

    default:
      console.warn(
        `[CredentialBroker] Unknown broker type: ${brokerType}, falling back to 1password`,
      );
      return new OnePasswordBroker(env);
  }
}

// ─── Broker Interface ─────────────────────────────────────────────────────────

/**
 * @typedef {object} CredentialBrokerInterface
 * @property {function(string, object): Promise<string>} get - Retrieve credential by path
 * @property {function(string[]): Promise<Map<string, string>>} prefetch - Bulk fetch
 * @property {function(): Promise<object>} healthCheck - Check backend health
 * @property {string} type - Backend type identifier
 */

// ─── ChittyServ Broker ───────────────────────────────────────────────────────

class ChittyServBroker {
  constructor(env) {
    this.client = new ChittyServClient(env);
    this.type = "chittyserv";
  }

  async get(credentialPath, options = {}) {
    return this.client.get(credentialPath, options);
  }

  async prefetch(credentialPaths) {
    return this.client.prefetch(credentialPaths);
  }

  async invalidateCache(credentialPath) {
    return this.client.invalidateCache(credentialPath);
  }

  async healthCheck() {
    return this.client.healthCheck();
  }
}

// ─── 1Password Broker (Legacy) ───────────────────────────────────────────────

class OnePasswordBroker {
  constructor(env) {
    this.client = new OnePasswordConnectClient(env);
    this.type = "1password";
  }

  async get(credentialPath, options = {}) {
    return this.client.get(credentialPath, options);
  }

  async prefetch(credentialPaths) {
    return this.client.prefetch(credentialPaths);
  }

  async invalidateCache(credentialPath) {
    return this.client.invalidateCache(credentialPath);
  }

  async healthCheck() {
    return this.client.healthCheck();
  }
}

// ─── Auto Broker (chittyserv → 1password fallback) ──────────────────────────

class AutoBroker {
  constructor(env) {
    this.env = env;
    this.chittyserv = new ChittyServBroker(env);
    this.onePassword = new OnePasswordBroker(env);
    this.type = "auto";
    this._activeBackend = null;
    this._lastHealthCheck = 0;
    this._healthCheckInterval = 60_000; // Re-check every 60s
  }

  async _resolveBackend() {
    const now = Date.now();
    if (
      this._activeBackend &&
      now - this._lastHealthCheck < this._healthCheckInterval
    ) {
      return this._activeBackend;
    }

    try {
      const health = await this.chittyserv.healthCheck();
      if (health.status === "healthy" || health.status === "ok") {
        this._activeBackend = this.chittyserv;
        this._lastHealthCheck = now;
        return this._activeBackend;
      }
    } catch {
      // chittyserv unavailable
    }

    this._activeBackend = this.onePassword;
    this._lastHealthCheck = now;
    return this._activeBackend;
  }

  async get(credentialPath, options = {}) {
    const backend = await this._resolveBackend();
    try {
      return await backend.get(credentialPath, options);
    } catch (error) {
      // If primary failed, try the other
      if (backend === this.chittyserv) {
        console.warn(
          `[CredentialBroker:auto] ChittyServ failed for ${credentialPath}, falling back to 1Password:`,
          error.message,
        );
        this._activeBackend = this.onePassword;
        return this.onePassword.get(credentialPath, options);
      }
      throw error;
    }
  }

  async prefetch(credentialPaths) {
    const backend = await this._resolveBackend();
    return backend.prefetch(credentialPaths);
  }

  async invalidateCache(credentialPath) {
    // Invalidate on both backends
    await Promise.allSettled([
      this.chittyserv.invalidateCache(credentialPath),
      this.onePassword.invalidateCache(credentialPath),
    ]);
  }

  async healthCheck() {
    const [csHealth, opHealth] = await Promise.allSettled([
      this.chittyserv.healthCheck(),
      this.onePassword.healthCheck(),
    ]);

    return {
      status:
        csHealth.status === "fulfilled" &&
        (csHealth.value.status === "healthy" || csHealth.value.status === "ok")
          ? "healthy"
          : opHealth.status === "fulfilled" &&
              opHealth.value.status === "healthy"
            ? "degraded"
            : "down",
      backends: {
        chittyserv:
          csHealth.status === "fulfilled" ? csHealth.value : { status: "down" },
        onePassword:
          opHealth.status === "fulfilled" ? opHealth.value : { status: "down" },
      },
      activeBackend: this._activeBackend?.type || "none",
      timestamp: Date.now(),
    };
  }
}
