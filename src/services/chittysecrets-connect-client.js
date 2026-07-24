/**
 * chittysecrets Connect API Client
 *
 * Provides secure, cached access to credentials stored in chittysecrets.
 * Implements intelligent caching, error handling, and failover strategies.
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
    this.connectToken = env.ONEPASSWORD_CONNECT_TOKEN;

    // Vault IDs from environment
    this.vaults = {
      infrastructure: env.ONEPASSWORD_VAULT_INFRASTRUCTURE,
      services: env.ONEPASSWORD_VAULT_SERVICES,
      integrations: env.ONEPASSWORD_VAULT_INTEGRATIONS,
      emergency: env.ONEPASSWORD_VAULT_EMERGENCY,
    };

    // Cache configuration
    this.cacheTTL = {
      infrastructure: 3600, // 1 hour for infrastructure creds
      services: 1800, // 30 minutes for service tokens
      integrations: 900, // 15 minutes for third-party APIs
      emergency: 0, // Never cache emergency credentials
    };

    // Cached encryption key for performance
    // This dramatically improves encryption/decryption speed
    this.cachedEncryptionKey = null;
    this.cachedKeyMaterial = null;
  }

  /**
   * Retrieve a credential from chittysecrets by path
   *
   * @param {string} credentialPath - Path like "infrastructure/cloudflare/make_api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, options = {}) {
    const { bypassCache = false, cacheOverrideTTL = null } = options;

    // Parse credential path
    const parsed = this.parseCredentialPath(credentialPath);
    if (!parsed) {
      throw new Error(`Invalid credential path: ${credentialPath}`);
    }

    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await this.getFromCache(credentialPath);
      if (cached) {
        console.log(`[chittysecrets] Cache HIT for ${credentialPath}`);
        return cached;
      }
    }

    console.log(
      `[chittysecrets] Cache MISS for ${credentialPath}, fetching from Connect API`,
    );

    // Fetch from chittysecrets Connect API
    const value = await this.fetchFromConnect(parsed);

    // Cache the result (unless emergency vault)
    if (parsed.vault !== "emergency") {
      const ttl = cacheOverrideTTL || this.cacheTTL[parsed.vault] || 900;
      await this.setCache(credentialPath, value, ttl);
    }

    return value;
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
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status} ${res.statusText}`;
        try {
          const errJson = await res.json();
          errMsg = errJson.error || errJson.reason || errMsg;
        } catch (e) {
          // Ignore JSON parse errors on failed HTTP responses
        }
        throw new Error(`ChittySecrets reveal failed: ${errMsg}`);
      }

      const data = await res.json();
      const value = data.value;

      if (!value) {
        throw new Error(
          `ChittySecrets returned no value for secret ${secretName}`,
        );
      }

      console.log(
        `[chittysecrets] Successfully retrieved ${parsed.fullPath} via secret ${secretName} (${value.length} chars)`,
      );

      return value;
    } catch (error) {
      console.error(
        `[chittysecrets] Fetch error for ${parsed.fullPath}:`,
        error,
      );

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

    if (!envValue) {
      throw new Error(
        `Failover failed: Environment variable ${envVarName} not set`,
      );
    }

    console.warn(
      `[chittysecrets] Failover SUCCESS - using ${envVarName} from environment`,
    );

    return envValue;
  }

  /**
   * Get credential from cache
   * Now uses CREDENTIAL_CACHE KV namespace instead of RATE_LIMIT
   *
   * @private
   * @param {string} credentialPath - Credential path
   * @returns {Promise<string|null>} Cached value or null
   */
  async getFromCache(credentialPath) {
    try {
      const cacheKey = `chittysecrets:cache:${credentialPath}`;
      const cached = await this.env.CREDENTIAL_CACHE.get(cacheKey);

      if (cached) {
        // Decrypt cached value (credentials are encrypted at rest in KV)
        return this.decrypt(cached);
      }

      return null;
    } catch (error) {
      console.error(`[chittysecrets] Cache read error:`, error);
      return null;
    }
  }

  /**
   * Set credential in cache
   * Now uses CREDENTIAL_CACHE KV namespace instead of RATE_LIMIT
   *
   * @private
   * @param {string} credentialPath - Credential path
   * @param {string} value - Credential value
   * @param {number} ttl - Time to live in seconds
   */
  async setCache(credentialPath, value, ttl) {
    try {
      const cacheKey = `chittysecrets:cache:${credentialPath}`;

      // Encrypt value before caching
      const encrypted = await this.encrypt(value);

      await this.env.CREDENTIAL_CACHE.put(cacheKey, encrypted, {
        expirationTtl: ttl,
      });

      console.log(`[chittysecrets] Cached ${credentialPath} for ${ttl}s`);
    } catch (error) {
      console.error(`[chittysecrets] Cache write error:`, error);
      // Don't throw - cache failure shouldn't break credential retrieval
    }
  }

  /**
   * Get or create cached encryption key
   *
   * @private
   * @returns {Promise<CryptoKey>} Encryption key
   */
  async getEncryptionKey() {
    // Return cached key if available
    if (this.cachedEncryptionKey) {
      return this.cachedEncryptionKey;
    }

    const encoder = new TextEncoder();

    // Import key material (only once)
    if (!this.cachedKeyMaterial) {
      if (!this.env.ENCRYPTION_KEY) {
        throw new Error(
          "ENCRYPTION_KEY secret is not configured — cannot encrypt/decrypt credential cache",
        );
      }
      this.cachedKeyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(this.env.ENCRYPTION_KEY),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"],
      );
    }

    // Derive and cache the key
    this.cachedEncryptionKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("chittyos-chittysecrets-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      this.cachedKeyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    console.log(
      "[chittysecrets] Encryption key cached for improved performance",
    );
    return this.cachedEncryptionKey;
  }

  /**
   * Encrypt credential value for caching
   *
   * @private
   * @param {string} value - Plain text credential
   * @returns {Promise<string>} Encrypted credential
   */
  async encrypt(value) {
    // Use cached key for massive performance improvement
    const startTime = Date.now();

    const encoder = new TextEncoder();
    const data = encoder.encode(value);

    // Get cached encryption key
    const key = await this.getEncryptionKey();

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Base64 encode
    const result = btoa(String.fromCharCode(...combined));

    const encryptTime = Date.now() - startTime;
    if (encryptTime > 10) {
      console.log(`[chittysecrets] Encryption took ${encryptTime}ms`);
    }

    return result;
  }

  /**
   * Decrypt cached credential value
   *
   * @private
   * @param {string} encrypted - Encrypted credential
   * @returns {Promise<string>} Plain text credential
   */
  async decrypt(encrypted) {
    const startTime = Date.now();
    const decoder = new TextDecoder();

    // Base64 decode
    const combined = new Uint8Array(
      atob(encrypted)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    // Get cached encryption key (same key works for decrypt)
    const key = await this.getEncryptionKey();

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    const decryptTime = Date.now() - startTime;
    if (decryptTime > 10) {
      console.log(`[chittysecrets] Decryption took ${decryptTime}ms`);
    }

    return decoder.decode(decrypted);
  }

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
        console.error(
          `[chittysecrets] Prefetch FAILED: ${path}`,
          result.reason,
        );
      }
    });

    return credentialMap;
  }

  /**
   * Invalidate cached credential
   * Now uses CREDENTIAL_CACHE KV namespace instead of RATE_LIMIT
   *
   * @param {string} credentialPath - Credential path to invalidate
   */
  async invalidateCache(credentialPath) {
    try {
      const cacheKey = `chittysecrets:cache:${credentialPath}`;
      await this.env.CREDENTIAL_CACHE.delete(cacheKey);
      console.log(`[chittysecrets] Invalidated cache for ${credentialPath}`);
    } catch (error) {
      console.error(`[chittysecrets] Cache invalidation error:`, error);
    }
  }

  /**
   * Health check for chittysecrets Connect API
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.connectUrl || !this.connectToken) {
        return {
          status: "not_configured",
          message: "chittysecrets Connect not configured",
          timestamp: Date.now(),
        };
      }

      const response = await fetch(`${this.connectUrl}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.connectToken}`,
        },
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
