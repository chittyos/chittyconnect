/**
 * Cloudflare Secrets Store Client
 *
 * Zero-latency credential access via env bindings.
 * Secrets are synced from chittysecrets synthetic-shared vault
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
 * This bridges the old chittysecrets vault/item/field paths
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
  "services/chittyid/service_token": "CHITTY_ID_TOKEN",
  "services/chittyid/token": "CHITTY_ID_TOKEN",
  "services/chittyregistry/token": "CHITTY_REGISTRY_TOKEN",
  "services/chittyregistry/service_token": "CHITTY_REGISTRY_SERVICE_TOKEN",
  "services/chittyregister/token": "CHITTY_REGISTER_TOKEN",
  "services/chittyledger/token": "CHITTYLEDGER_TOKEN",
  "services/chittyevidence/token": "CHITTY_EVIDENCE_TOKEN",
  "services/chittyfinance/token": "CHITTY_FINANCE_TOKEN",
  "services/chittycases/token": "CHITTY_CASES_TOKEN",
  "services/chittychronicle/token": "CHITTY_CHRONICLE_TOKEN",
  "services/chittydispute/service_token": "DISPUTES_API_TOKEN",
  "services/chittydispute/token": "DISPUTES_API_TOKEN",
  "services/chittytrack/api_token": "API_TOKEN",
  "services/chittytrack/webhook_secret": "GITHUB_WEBHOOK_SECRET",
  "services/chittymint/secret": "CHITTYAUTH_ISSUED_MINT_API_KEY",
  "services/chittymint/service_token": "CHITTYAUTH_ISSUED_MINT_API_KEY",
};

/**
 * Resolve one env entry to a secret STRING.
 *
 * Two binding shapes land on `env` and they are not interchangeable:
 *
 *   wrangler secret put  -> a plain string
 *   secrets_store_secrets -> an object with an async .get()
 *
 * Every lookup below used to be `if (this.env[X]) return this.env[X]`. A
 * Secrets Store binding is an object, and an object is truthy, so that
 * returned the BINDING where callers expect the secret — silently, with no
 * type error, producing "[object Object]" wherever the value got
 * interpolated into a header or a connection string.
 *
 * The defect is dormant only because no consumer binds Secrets Store today
 * (0 of 51 tracked wrangler configs in chittyentity). It fires on the first
 * worker that adopts the documented policy — i.e. it punishes exactly the
 * person doing the right thing, and would read as "Secrets Store is broken"
 * rather than "the broker never supported it".
 *
 * Duck-typed rather than instanceof-checked because the binding class is not
 * exported by the runtime. Same shape as
 * chittyentity/packages/agent-cf/src/adapters/env-secret-provider.ts, which
 * already got this right.
 *
 * @param {unknown} bound
 * @returns {Promise<string|undefined>} the secret, or undefined if absent
 */
async function resolveBinding(bound) {
  if (typeof bound === "string") return bound.length > 0 ? bound : undefined;
  if (bound && typeof bound === "object" && typeof bound.get === "function") {
    const value = await bound.get();
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return undefined;
}

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
    // Each candidate is resolved through resolveBinding so a Secrets Store
    // binding yields its VALUE rather than the binding object. Order is
    // unchanged: mapped path, then literal name, then derived names.
    const candidates = [];

    const envName = PATH_TO_ENV[credentialPath];
    if (envName) candidates.push(envName);

    candidates.push(credentialPath);

    const parts = credentialPath.split("/");
    if (parts.length === 3) {
      const [, item, field] = parts;
      candidates.push(`${item.toUpperCase()}_${field.toUpperCase()}`);
      candidates.push(field.toUpperCase());
    }

    for (const name of candidates) {
      const value = await resolveBinding(this.env[name]);
      if (value !== undefined) return value;
    }

    throw new Error(
      `Credential not found in env bindings: ${credentialPath}. ` +
        `Add mapping to PATH_TO_ENV or ensure secret is deployed via sync-secrets.sh`,
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

    const present = required.filter((k) => !!this.env[k]);
    const missing = required.filter((k) => !this.env[k]);

    return {
      status: missing.length === 0 ? "healthy" : "degraded",
      type: "cloudflare-secrets",
      bindings: {
        total: Object.keys(this.env).filter(
          (k) => k === k.toUpperCase() && k.length > 3,
        ).length,
        required: required.length,
        present: present.length,
        missing,
      },
      latency: "0ms (env binding)",
      timestamp: Date.now(),
    };
  }
}
