/**
 * Cloudflare Secrets Store Client
 *
 * Zero-latency credential access via env bindings.
 * Secrets are synced from 1Password synthetic-shared vault
 * to Cloudflare Workers Secrets Store at deploy time.
 *
 * This is the portal pattern: no runtime credential fetching,
 * no network calls, no cache — secrets are bound directly
 * to the Worker environment.
 *
 * Path convention: {vault}/{item}/{field} maps to env var names:
 *   "integrations/neon/credential" → env.NEON_API_KEY
 *   "integrations/openai/credential" → env.OPENAI_API_KEY
 *
 * @module services/cloudflare-secrets-client
 */

/**
 * Mapping from legacy credential paths to env var names.
 * This bridges the old 1Password vault/item/field paths
 * to the flat CF Secrets Store namespace.
 */
const PATH_TO_ENV = {
  // Infrastructure
  "infrastructure/cloudflare/make_api_key": "CLOUDFLARE_MAKE_API_KEY",
  "infrastructure/cloudflare/api_token": "CLOUDFLARE_API_TOKEN",
  "infrastructure/neon/credential": "NEON_API_KEY",
  "infrastructure/neon/database_url": "NEON_DATABASE_URL",
  "infrastructure/neon/connection_string": "NEON_CONNECTION_STRING",

  // Integrations
  "integrations/openai/credential": "OPENAI_API_KEY",
  "integrations/openai/api_key": "OPENAI_API_KEY",
  "integrations/anthropic/credential": "ANTHROPIC_API_KEY",
  "integrations/notion/credential": "NOTION_TOKEN",
  "integrations/notion/token": "NOTION_TOKEN",
  "integrations/github/credential": "GITHUB_TOKEN",
  "integrations/github/token": "GITHUB_TOKEN",
  "integrations/twilio/account_sid": "TWILIO_ACCOUNT_SID",
  "integrations/twilio/auth_token": "TWILIO_AUTH_TOKEN",
  "integrations/twilio/phone_number": "TWILIO_PHONE_NUMBER",
  "integrations/stripe/secret_key": "STRIPE_SECRET_KEY",
  "integrations/stripe/webhook_secret": "STRIPE_WEBHOOK_SECRET",
  "integrations/plaid/client_id": "PLAID_CLIENT_ID",
  "integrations/plaid/secret": "PLAID_SECRET",
  "integrations/mercury/api_token": "MERCURY_API_TOKEN",

  // Services
  "services/chittyauth/jwt_secret": "JWT_SECRET",
  "services/chittyauth/encryption_key": "ENCRYPTION_KEY",
  "services/chittyauth/token_signing_key": "TOKEN_SIGNING_KEY",
  "services/chittyauth/auth_salt": "AUTH_SALT",
  "services/chittyconnect/service_token": "CHITTYCONNECT_SERVICE_TOKEN",
  "services/chittyconnect/mcp_token": "CHITTYCONNECT_TOKEN",
  "services/chittyid/service_token": "CHITTY_ID_SERVICE_TOKEN",
  "services/chittyid/token": "CHITTY_ID_TOKEN",
  "services/chittyregistry/token": "CHITTY_REGISTRY_TOKEN",
  "services/chittyregistry/service_token": "CHITTY_REGISTRY_SERVICE_TOKEN",
  "services/chittyregister/token": "CHITTY_REGISTER_TOKEN",
  "services/chittyledger/token": "CHITTYLEDGER_TOKEN",
  "services/chittyevidence/token": "CHITTY_EVIDENCE_TOKEN",
  "services/chittyfinance/token": "CHITTY_FINANCE_TOKEN",
  "services/chittycases/token": "CHITTY_CASES_TOKEN",
  "services/chittychronicle/token": "CHITTY_CHRONICLE_TOKEN",
  "services/chittydispute/token": "DISPUTES_API_TOKEN",
  "services/chittytrack/api_token": "API_TOKEN",
  "services/chittytrack/webhook_secret": "GITHUB_WEBHOOK_SECRET",
  "services/chittymint/secret": "CHITTYMINT_SECRET",
};

export class CloudflareSecretsClient {
  constructor(env) {
    this.env = env;
    this.type = "cloudflare-secrets";
  }

  /**
   * Retrieve a credential from env bindings
   *
   * @param {string} credentialPath - Path like "infrastructure/neon/credential"
   * @param {object} options - Unused (kept for interface compat)
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, options = {}) {
    // Try mapped path first
    const envName = PATH_TO_ENV[credentialPath];
    if (envName && this.env[envName]) {
      return this.env[envName];
    }

    // Try direct env var name (e.g., "NEON_DATABASE_URL")
    if (this.env[credentialPath]) {
      return this.env[credentialPath];
    }

    // Try constructing env var from path components
    const parts = credentialPath.split("/");
    if (parts.length === 3) {
      const [, item, field] = parts;
      // Try ITEM_FIELD pattern
      const envGuess = `${item.toUpperCase()}_${field.toUpperCase()}`;
      if (this.env[envGuess]) {
        return this.env[envGuess];
      }
      // Try just FIELD
      if (this.env[field.toUpperCase()]) {
        return this.env[field.toUpperCase()];
      }
    }

    throw new Error(
      `Credential not found in env bindings: ${credentialPath}. ` +
      `Add mapping to PATH_TO_ENV or ensure secret is deployed via sync-secrets.sh`
    );
  }

  /**
   * Bulk fetch credentials from env bindings
   *
   * @param {string[]} credentialPaths
   * @returns {Promise<Map<string, string>>}
   */
  async prefetch(credentialPaths) {
    const results = new Map();
    for (const path of credentialPaths) {
      try {
        const value = await this.get(path);
        results.set(path, value);
      } catch {
        // Skip missing credentials in bulk fetch
      }
    }
    return results;
  }

  /**
   * No-op — env bindings have no cache to invalidate
   */
  async invalidateCache() {
    // Secrets are bound at deploy time — no runtime cache
  }

  /**
   * Health check — verify key env bindings exist
   */
  async healthCheck() {
    const required = [
      "NEON_DATABASE_URL",
      "CHITTYCONNECT_SERVICE_TOKEN",
      "ENCRYPTION_KEY",
    ];

    const present = required.filter(k => !!this.env[k]);
    const missing = required.filter(k => !this.env[k]);

    return {
      status: missing.length === 0 ? "healthy" : "degraded",
      type: "cloudflare-secrets",
      bindings: {
        total: Object.keys(this.env).filter(k => k === k.toUpperCase() && k.length > 3).length,
        required: required.length,
        present: present.length,
        missing,
      },
      latency: "0ms (env binding)",
      timestamp: Date.now(),
    };
  }
}
