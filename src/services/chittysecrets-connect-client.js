/**
 * chittysecrets Connect API Client
 *
 * Provides runtime-only access to credentials stored in ChittySecrets.
 * Retains legacy retrieval and failover interfaces without credential persistence.
 *
 * @module services/chittysecrets-connect-client
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

export class OnePasswordConnectClient {
  constructor(env) {
    this.env = env;
    this.connectUrl = env.ONEPASSWORD_CONNECT_URL;

    // Vault IDs from environment
    this.vaults = {
      infrastructure: env.ONEPASSWORD_VAULT_INFRASTRUCTURE,
      services: env.ONEPASSWORD_VAULT_SERVICES,
      integrations: env.ONEPASSWORD_VAULT_INTEGRATIONS,
      emergency: env.ONEPASSWORD_VAULT_EMERGENCY,
    };

    // Credentials are resolved for each operation; no KV cache or
    // in-process secret memoization is permitted.
  }

  /**
   * Retrieve a credential from chittysecrets by path
   *
   * @param {string} credentialPath - Path like "infrastructure/cloudflare/make_api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, _options = {}) {
    const parsed = this.parseCredentialPath(credentialPath);
    if (!parsed) {
      throw new Error("Invalid credential reference");
    }
    return this.fetchFromConnect(parsed);
  }

  /**
   * Parse credential path into components
   *
   * @private
   * @param {string} path - Credential path
   * @returns {object} Parsed components
   */
  parseCredentialPath(path) {
    // Expected format: {vault}/{item}/{field}
    // Example: infrastructure/cloudflare/make_api_key
    const parts = path.split("/");

    if (parts.length !== 3) {
      return null;
    }

    const [vault, item, field] = parts;

    // Validate vault name
    const validVaults = [
      "infrastructure",
      "services",
      "integrations",
      "emergency",
    ];
    if (!validVaults.includes(vault)) {
      console.error(`[chittysecrets] Unknown vault: ${vault}`);
      return null;
    }

    return {
      vault,
      vaultId: this.vaults[vault] || "legacy-vault",
      item,
      field,
      fullPath: path,
    };
  }

  /**
   * Fetch credential from chittysecrets Connect API
   *
   * @private
   * @param {object} parsed - Parsed credential path
   * @returns {Promise<string>} Credential value
   */
  async fetchFromConnect(parsed) {
    try {
      const secretsUrl =
        this.env.CHITTYSECRETS_URL || "https://secrets.chitty.cc";

      // Map path to secret name
      const pathKey = `${parsed.vault}/${parsed.item}/${parsed.field}`;
      let secretName = PATH_TO_ENV[pathKey];
      if (!secretName) {
        secretName = `${parsed.item}_${parsed.field}`
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "_");
      }

      // Resolve Access client credentials
      const clientId =
        this.env.CF_ACCESS_CLIENT_ID ||
        this.env.CF_ACCESS_CLIENT_ID_CHITTYAGENT ||
        this.env.CHITTY_CF_ACCESS_CLIENT_ID;
      const clientSecret =
        this.env.CF_ACCESS_CLIENT_SECRET ||
        this.env.CF_ACCESS_CLIENT_SECRET_CHITTYAGENT ||
        this.env.CHITTY_CF_ACCESS_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error(
          `CF Access Client Credentials (CF_ACCESS_CLIENT_ID/SECRET) not found in environment`,
        );
      }

      const res = await fetch(`${secretsUrl}/mcp?action=reveal`, {
        method: "POST",
        headers: {
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: secretName }),
        // Runtime-only credential calls must not hang if a provider stalls.
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        // Upstream-supplied error bodies are untrusted and may contain
        // material that must never reach worker logs or caller exceptions.
        await res.body?.cancel();
        const err = new Error(res.status === 404
          ? "ChittySecrets credential not found (HTTP 404)"
          : `ChittySecrets reveal failed: HTTP ${res.status}`);
        if (res.status === 404) err.code = "CREDENTIAL_NOT_FOUND";
        throw err;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("ChittySecrets returned malformed credential JSON");
      }
      const value = data?.value;

      if (typeof value !== "string" || value.length === 0) {
        const err = new Error(
          `ChittySecrets returned no value for secret ${secretName}`,
        );
        err.code = "CREDENTIAL_NOT_FOUND";
        throw err;
      }

      return value;
    } catch (error) {
      // Transport errors may embed upstream content. Log only the operation,
      // never provider-provided exception bodies or resolved secret values.
      console.error(`[chittysecrets] Fetch failed for ${parsed.fullPath}`);

      // Check if we should failover to environment variable
      if (this.env.CREDENTIAL_FAILOVER_ENABLED === "true") {
        return await this.failoverToEnvironment(parsed);
      }

      throw error;
    }
  }

  /**
   * Failover to environment variable if chittysecrets Connect fails
   *
   * @private
   * @param {object} parsed - Parsed credential path
   * @returns {string} Credential value from environment
   */
  async failoverToEnvironment(parsed) {
    console.warn(
      `[chittysecrets] Attempting failover to environment variables for ${parsed.fullPath}`,
    );

    // Convert path to environment variable name
    // infrastructure/cloudflare/make_api_key -> CLOUDFLARE_MAKE_API_KEY
    const envVarName = `${parsed.item}_${parsed.field}`
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_");

    const envValue = this.env[envVarName];

    if (typeof envValue !== "string" || envValue.length === 0) {
      throw new Error(`Failover failed: ${envVarName} is not a usable string binding`);
    }

    console.warn(
      `[chittysecrets] Failover SUCCESS - using ${envVarName} from environment`,
    );

    return envValue;
  }

  // Legacy cache/encryption implementation removed. Credentials must be
  // resolved at the runtime broker boundary and never persisted into KV.

  /**
   * Retrieve an infrastructure credential from chittysecrets.
   *
   * Convenience wrapper around `get()` that constructs the path
   * `infrastructure/{item}/{field}` so callers do not need to hard-code
   * the vault segment.
   *
   * @param {string} item  - Item name within the infrastructure vault
   *   (e.g. "cloudflare", "neon", "github")
   * @param {string} field - Field name within that item
   *   (e.g. "make_api_key", "account_id", "database_url")
   * @param {object} [options] - Options forwarded to `get()`
   * @returns {Promise<string>} Credential value
   */
  async getInfrastructureCredential(item, field, options = {}) {
    const credentialPath = `infrastructure/${item}/${field}`;
    return this.get(credentialPath, options);
  }

  /**
   * Retrieve a ChittyOS inter-service token from chittysecrets.
   *
   * Convenience wrapper around `get()` that constructs the path
   * `services/{service}/token` so callers do not need to hard-code
   * the vault segment.
   *
   * @param {string} service  - Target service name (e.g. "chittyauth")
   * @param {object} [options] - Options forwarded to `get()`
   * @returns {Promise<string>} Service token value
   */
  async getServiceToken(service, options = {}) {
    const credentialPath = `services/${service}/token`;
    return this.get(credentialPath, options);
  }

  /**
   * Prefetch multiple credentials in parallel
   *
   * @param {string[]} credentialPaths - Array of credential paths
   * @returns {Promise<Map<string, string>>} Map of path to credential value
   */
  async prefetch(credentialPaths) {
    console.log(
      `[chittysecrets] Prefetching ${credentialPaths.length} credentials`,
    );

    const results = await Promise.allSettled(
      credentialPaths.map((path) => this.get(path)),
    );

    const credentialMap = new Map();

    results.forEach((result, index) => {
      const path = credentialPaths[index];

      if (result.status === "fulfilled") {
        credentialMap.set(path, result.value);
        console.log(`[chittysecrets] Prefetch SUCCESS: ${path}`);
      } else {
        // An untrusted backend failure can contain credential material.
        console.error(`[chittysecrets] Prefetch FAILED: ${path}`);
      }
    });

    return credentialMap;
  }

  /**
   * Compatibility method: runtime-only credentials cannot be invalidated
   * from KV. Historical KV records are left untouched pending custody review.
   */
  async invalidateCache(_credentialPath) {
    // No-op.
  }

  /**
   * Health check for chittysecrets Connect API
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.connectUrl || !this.env.ONEPASSWORD_CONNECT_TOKEN) {
        return {
          status: "not_configured",
          message: "chittysecrets Connect not configured",
          timestamp: Date.now(),
        };
      }

      const response = await fetch(`${this.connectUrl}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${typeof this.env.ONEPASSWORD_CONNECT_TOKEN === "string" ? this.env.ONEPASSWORD_CONNECT_TOKEN : await this.env.ONEPASSWORD_CONNECT_TOKEN.get()}`,
        },
        signal: AbortSignal.timeout(3000),
      });

      return {
        status: response.ok ? "healthy" : "degraded",
        statusCode: response.status,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: "down",
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }
}

export default OnePasswordConnectClient;

/**
 * Store a credential in chittysecrets via Connect API.
 * Creates a new item or updates an existing field.
 *
 * @param {string} credentialPath - "vault/item/field"
 * @param {string} value - Credential value
 * @param {object} [options]
 * @param {string} [options.notes] - Item notes
 * @returns {Promise<{stored: boolean, action: string, item: string}>}
 */
OnePasswordConnectClient.prototype.put = async function (
  credentialPath,
  value,
  options = {},
) {
  throw new Error(
    "Writing secrets at runtime is not supported by ChittySecrets. Deploy secrets via sync-secrets.sh instead.",
  );
};
