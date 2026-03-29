/**
 * Credential Broker — Unified abstraction over credential backends
 *
 * Supports multiple backends:
 *   - "cloudflare-secrets" → Direct env binding reads (zero latency, default)
 *   - "chittyserv"         → ChittyServ API at CHITTYSERV_URL/v1/
 *   - "1password"          → 1Password Connect API (legacy, deprecated)
 *   - "auto"               → cloudflare-secrets → chittyserv → 1password
 *
 * Portal Pattern: Secrets are synced from 1Password synthetic-shared vault
 * to Cloudflare Secrets Store at deploy time. The broker reads from env
 * bindings first (zero network, zero latency), falling back to runtime
 * credential fetching only when env bindings are missing.
 *
 * Selection via env.CREDENTIAL_BROKER_TYPE (default: "cloudflare-secrets")
 *
 * @module lib/credential-broker
 */

import { OnePasswordConnectClient } from "../services/1password-connect-client.js";
import { ChittyServClient } from "../services/chittyserv-client.js";
import { CloudflareSecretsClient } from "../services/cloudflare-secrets-client.js";

/**
 * Create a credential broker based on environment configuration
 *
 * @param {object} env - Worker environment bindings
 * @returns {CredentialBrokerInterface} Broker instance
 */
export function createCredentialBroker(env) {
  const brokerType = (env.CREDENTIAL_BROKER_TYPE || "cloudflare-secrets").toLowerCase();

  switch (brokerType) {
    case "cloudflare-secrets":
    case "cf-secrets":
    case "env":
      return new CloudflareSecretsBroker(env);

    case "chittyserv":
      return new ChittyServBroker(env);

    case "1password":
      return new OnePasswordBroker(env);

    case "auto":
      return new AutoBroker(env);

    default:
      console.warn(
        `[CredentialBroker] Unknown broker type: ${brokerType}, using cloudflare-secrets`,
      );
      return new CloudflareSecretsBroker(env);
  }
}

// ─── Cloudflare Secrets Broker (Default — Portal Pattern) ────────────────────

class CloudflareSecretsBroker {
  constructor(env) {
    this.client = new CloudflareSecretsClient(env);
    this.type = "cloudflare-secrets";
  }

  async get(credentialPath, options = {}) {
    return this.client.get(credentialPath, options);
  }

  async prefetch(credentialPaths) {
    return this.client.prefetch(credentialPaths);
  }

  async invalidateCache() {
    // No-op — env bindings have no cache
  }

  async healthCheck() {
    return this.client.healthCheck();
  }
}

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

// ─── 1Password Broker (Legacy — Deprecated) ─────────────────────────────────

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

// ─── Auto Broker (cloudflare-secrets → chittyserv → 1password) ──────────────

class AutoBroker {
  constructor(env) {
    this.env = env;
    this.cfSecrets = new CloudflareSecretsBroker(env);
    this.chittyserv = new ChittyServBroker(env);
    this.onePassword = new OnePasswordBroker(env);
    this.type = "auto";
  }

  async get(credentialPath, options = {}) {
    // 1. Try env bindings first (zero latency)
    try {
      return await this.cfSecrets.get(credentialPath, options);
    } catch {
      // Not in env bindings
    }

    // 2. Try ChittyServ
    try {
      return await this.chittyserv.get(credentialPath, options);
    } catch (err) {
      console.warn(
        `[CredentialBroker:auto] ChittyServ failed for ${credentialPath}:`,
        err.message,
      );
    }

    // 3. Fall back to 1Password Connect
    return this.onePassword.get(credentialPath, options);
  }

  async prefetch(credentialPaths) {
    // Env bindings are instant — prefetch everything from there
    return this.cfSecrets.prefetch(credentialPaths);
  }

  async invalidateCache(credentialPath) {
    await Promise.allSettled([
      this.chittyserv.invalidateCache(credentialPath),
      this.onePassword.invalidateCache(credentialPath),
    ]);
  }

  async healthCheck() {
    const [cfHealth, csHealth, opHealth] = await Promise.allSettled([
      this.cfSecrets.healthCheck(),
      this.chittyserv.healthCheck(),
      this.onePassword.healthCheck(),
    ]);

    const cfOk = cfHealth.status === "fulfilled" &&
      (cfHealth.value.status === "healthy" || cfHealth.value.status === "ok");

    return {
      status: cfOk ? "healthy" : "degraded",
      backends: {
        "cloudflare-secrets": cfHealth.status === "fulfilled" ? cfHealth.value : { status: "down" },
        chittyserv: csHealth.status === "fulfilled" ? csHealth.value : { status: "down" },
        onePassword: opHealth.status === "fulfilled" ? opHealth.value : { status: "down" },
      },
      activeBackend: cfOk ? "cloudflare-secrets" : "fallback",
      timestamp: Date.now(),
    };
  }
}
