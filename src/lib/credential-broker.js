/**
 * Credential Broker — Unified abstraction over credential backends
 *
 * Supports multiple backends:
 *   - "cloudflare-secrets" → Direct env binding reads (zero latency, default)
 *   - "chittyserv"         → ChittyServ API at CHITTYSERV_URL/v1/
 *   - "chittysecrets"      → chittysecrets Connect API (legacy, deprecated)
 *   - "auto"               → cloudflare-secrets → chittyserv → chittysecrets
 *
 * Portal Pattern: Secrets are synced from chittysecrets synthetic-shared vault
 * to Cloudflare Secrets Store at deploy time. The broker reads from env
 * bindings first (zero network, zero latency), falling back to runtime
 * credential fetching only when env bindings are missing.
 *
 * Selection via env.CREDENTIAL_BROKER_TYPE (default: "cloudflare-secrets")
 *
 * @module lib/credential-broker
 */

import { OnePasswordConnectClient } from "../services/chittysecrets-connect-client.js";
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

    case "chittysecrets":
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


/**
 * Adapter for the 1Password-shaped call signature the provisioner still uses.
 *
 * The 1Password retirement repointed `EnhancedCredentialProvisioner.onePassword`
 * at the broker ("Keep .onePassword as alias for backward compat"), but only
 * OnePasswordConnectClient ever implemented getInfrastructureCredential(). Every
 * broker class exposes get(path) instead, so with the production setting
 * CREDENTIAL_BROKER_TYPE="cloudflare-secrets" the provisioner threw TypeError at
 * call time — silently, because nothing exercises it until a token mint is
 * attempted. That severed Cloudflare API-token minting, which is the sanctioned
 * path for issuing scoped tokens.
 *
 * Path convention is the existing one in cloudflare-secrets-client.js PATH_TO_ENV:
 *   infrastructure/{service}/{field}
 */
function attachInfrastructureCredentialAdapter(cls) {
  cls.prototype.getInfrastructureCredential = async function (service, field, options = {}) {
    if (!service || !field) {
      throw new Error(
        `E_CREDENTIAL_BAD_REF: getInfrastructureCredential requires (service, field); got (${service}, ${field})`,
      );
    }
    const path = `infrastructure/${service}/${field}`;
    return this.get(path, options);
  };
}

/**
 * Adapter for the second 1Password-shaped signature the provisioner uses.
 *
 * provisionServiceToken() (credential type `chittyos_service_token`) calls
 * this.onePassword.getServiceToken(target_service, ...). Only
 * OnePasswordConnectClient ever implemented it, so every broker configuration
 * threw `TypeError: this.onePassword.getServiceToken is not a function` —
 * the same severed-call-site class as getInfrastructureCredential above, in
 * the one code path the infrastructure adapter does not cover.
 *
 * PATH_TO_ENV in cloudflare-secrets-client.js spells the field both ways
 * depending on the service (services/chittyconnect/service_token vs
 * services/chittyledger/token), so try the more specific name first. get()
 * throws on a miss rather than returning undefined, hence the try/fallback.
 */
function attachServiceTokenAdapter(cls) {
  cls.prototype.getServiceToken = async function (service, options = {}) {
    if (!service) {
      throw new Error(
        `E_CREDENTIAL_BAD_REF: getServiceToken requires (service); got (${service})`,
      );
    }

    const paths = [
      `services/${service}/service_token`,
      `services/${service}/token`,
    ];

    const failures = [];
    for (const path of paths) {
      try {
        return await this.get(path, options);
      } catch (err) {
        // Path and binding names are safe to log; the value is never touched.
        failures.push(`${path}: ${err?.message ?? "lookup failed"}`);
      }
    }

    throw new Error(
      `E_CREDENTIAL_NOT_FOUND: no service token for ${service}. Tried ${failures.join("; ")}`,
    );
  };
}

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

// ─── chittysecrets Broker (Legacy — Deprecated) ─────────────────────────────────

class OnePasswordBroker {
  constructor(env) {
    this.client = new OnePasswordConnectClient(env);
    this.type = "chittysecrets";
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

// ─── Auto Broker (cloudflare-secrets → chittyserv → chittysecrets) ──────────────

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

    // 3. Fall back to chittysecrets Connect
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

// Every broker speaks the provisioner's legacy call shape.
attachInfrastructureCredentialAdapter(CloudflareSecretsBroker);
attachInfrastructureCredentialAdapter(ChittyServBroker);
attachInfrastructureCredentialAdapter(OnePasswordBroker);
attachInfrastructureCredentialAdapter(AutoBroker);

attachServiceTokenAdapter(CloudflareSecretsBroker);
attachServiceTokenAdapter(ChittyServBroker);
attachServiceTokenAdapter(OnePasswordBroker);
attachServiceTokenAdapter(AutoBroker);

