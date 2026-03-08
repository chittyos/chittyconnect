/**
 * 1Password Connect API Client
 *
 * Provides secure, cached access to credentials stored in 1Password.
 * Implements intelligent caching, error handling, and failover strategies.
 *
 * @module services/1password-connect-client
 */

import { LEGACY_CREDENTIAL_PATH_ALIASES } from "../lib/credential-paths.js";

const SUPPORTED_VAULTS = ["infrastructure", "services", "integrations", "emergency"];

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
   * Retrieve a credential from 1Password by path
   *
   * @param {string} credentialPath - Path like "infrastructure/cloudflare/make_api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, options = {}) {
    const { bypassCache = false, cacheOverrideTTL = null } = options;
    const resolvedPath = this.normalizeCredentialPath(credentialPath);

    // Parse credential path
    const parsed = this.parseCredentialPath(resolvedPath);
    if (!parsed) {
      throw new Error(`Invalid credential path: ${resolvedPath}`);
    }

    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await this.getFromCache(resolvedPath);
      if (cached) {
        console.log(`[1Password] Cache HIT for ${resolvedPath}`);
        return cached;
      }
    }

    console.log(
      `[1Password] Cache MISS for ${resolvedPath}, fetching from Connect API`,
    );

    // Fetch from 1Password Connect API
    const value = await this.fetchFromConnect(parsed);

    // Cache the result (unless emergency vault)
    if (parsed.vault !== "emergency") {
      const ttl = cacheOverrideTTL || this.cacheTTL[parsed.vault] || 900;
      await this.setCache(resolvedPath, value, ttl);
    }

    return value;
  }

  /**
   * Normalize legacy credential paths to their canonical equivalents.
   *
   * @param {string} credentialPath - Requested credential path
   * @returns {string} Canonical credential path
   */
  normalizeCredentialPath(credentialPath) {
    return LEGACY_CREDENTIAL_PATH_ALIASES[credentialPath] || credentialPath;
  }

  /**
   * Retrieve an infrastructure credential.
   *
   * @param {string} item - Infrastructure item name (e.g., "cloudflare")
   * @param {string} field - Field name (e.g., "make_api_key")
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async getInfrastructureCredential(item, field, options = {}) {
    return this.get(`infrastructure/${item}/${field}`, options);
  }

  /**
   * Retrieve a ChittyOS service token.
   *
   * @param {string} serviceName - Service name (e.g., "chittyauth")
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Service token
   */
  async getServiceToken(serviceName, options = {}) {
    return this.get(`services/${serviceName}/service_token`, options);
  }

  /**
   * Retrieve an integration credential.
   *
   * @param {string} platform - Integration platform (e.g., "openai")
   * @param {string} field - Field name, defaults to "api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Integration credential
   */
  async getIntegrationCredential(platform, field = "api_key", options = {}) {
    return this.get(`integrations/${platform}/${field}`, options);
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

    // Validate known vault names
    if (!SUPPORTED_VAULTS.includes(vault)) {
      console.error(`[1Password] Unknown vault: ${vault}`);
      return null;
    }

    // If Connect is configured this vault should have an ID, but allow parsing
    // in failover mode so env-based retrieval still works.
    if (!this.vaults[vault] && this.env.CREDENTIAL_FAILOVER_ENABLED !== "true") {
      console.error(`[1Password] Vault ID not configured: ${vault}`);
      return null;
    }

    return {
      vault,
      vaultId: this.vaults[vault],
      item,
      field,
      fullPath: path,
    };
  }

  /**
   * Fetch credential from 1Password Connect API
   *
   * @private
   * @param {object} parsed - Parsed credential path
   * @returns {Promise<string>} Credential value
   */
  async fetchFromConnect(parsed) {
    try {
      if (!this.connectUrl || !this.connectToken || !parsed.vaultId) {
        throw new Error("1Password Connect is not fully configured");
      }

      // Step 1: List items in vault to find the item ID
      const itemsUrl = `${this.connectUrl}/v1/vaults/${parsed.vaultId}/items`;

      const itemsResponse = await fetch(itemsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.connectToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!itemsResponse.ok) {
        throw new Error(
          `Failed to list items in vault ${parsed.vault}: ${itemsResponse.status} ${itemsResponse.statusText}`,
        );
      }

      const items = await itemsResponse.json();

      // Find item by title (case-insensitive match)
      const item = items.find(
        (i) => i.title.toLowerCase() === parsed.item.toLowerCase(),
      );

      if (!item) {
        throw new Error(
          `Item not found in vault ${parsed.vault}: ${parsed.item}`,
        );
      }

      // Step 2: Get full item details including fields
      const itemUrl = `${this.connectUrl}/v1/vaults/${parsed.vaultId}/items/${item.id}`;

      const itemResponse = await fetch(itemUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.connectToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!itemResponse.ok) {
        throw new Error(
          `Failed to get item details: ${itemResponse.status} ${itemResponse.statusText}`,
        );
      }

      const itemDetails = await itemResponse.json();

      // Step 3: Extract the requested field
      const field = itemDetails.fields?.find(
        (f) =>
          f.label?.toLowerCase() === parsed.field.toLowerCase() ||
          f.id?.toLowerCase() === parsed.field.toLowerCase(),
      );

      if (!field) {
        throw new Error(
          `Field not found in item ${parsed.item}: ${parsed.field}`,
        );
      }

      const value = field.value;

      if (!value) {
        throw new Error(
          `Field ${parsed.field} in item ${parsed.item} has no value`,
        );
      }

      console.log(
        `[1Password] Successfully retrieved ${parsed.fullPath} (${value.length} chars)`,
      );

      return value;
    } catch (error) {
      console.error(`[1Password] Fetch error for ${parsed.fullPath}:`, error);

      // Check if we should failover to environment variable
      if (this.env.CREDENTIAL_FAILOVER_ENABLED === "true") {
        return await this.failoverToEnvironment(parsed);
      }

      throw error;
    }
  }

  /**
   * Failover to environment variable if 1Password Connect fails
   *
   * @private
   * @param {object} parsed - Parsed credential path
   * @returns {string} Credential value from environment
   */
  async failoverToEnvironment(parsed) {
    console.warn(
      `[1Password] Attempting failover to environment variables for ${parsed.fullPath}`,
    );

    const candidates = this.getFailoverEnvCandidates(parsed);

    for (const envVarName of candidates) {
      const envValue = this.env[envVarName];
      if (envValue) {
        console.warn(
          `[1Password] Failover SUCCESS - using ${envVarName} from environment`,
        );
        return envValue;
      }
    }

    throw new Error(
      `Failover failed: none of the candidate env vars are set (${candidates.join(", ")})`,
    );
  }

  /**
   * Build ordered env-var candidates for failover.
   *
   * @private
   * @param {object} parsed - Parsed credential path
   * @returns {string[]} Candidate env var names
   */
  getFailoverEnvCandidates(parsed) {
    const normalizedItem = parsed.item.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const normalizedField = parsed.field.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const candidates = [`${normalizedItem}_${normalizedField}`];

    // services/chittyauth/service_token -> CHITTY_AUTH_TOKEN (preferred)
    if (parsed.vault === "services" && normalizedField === "SERVICE_TOKEN") {
      const serviceSuffix = normalizedItem.replace(/^CHITTY_?/, "");
      if (serviceSuffix) {
        candidates.unshift(`CHITTY_${serviceSuffix}_TOKEN`);
      }
      candidates.push(`${normalizedItem}_TOKEN`);
      candidates.push(`${normalizedItem}_SERVICE_TOKEN`);
    }

    // integrations/notion/api_key may be stored as NOTION_TOKEN
    if (parsed.vault === "integrations") {
      if (normalizedField === "API_KEY") {
        candidates.push(`${normalizedItem}_TOKEN`);
      }
      if (normalizedField === "PERSONAL_ACCESS_TOKEN") {
        candidates.push(`${normalizedItem}_TOKEN`);
      }
    }

    return [...new Set(candidates)];
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
      const cacheKey = `1password:cache:${credentialPath}`;
      const cached = await this.env.CREDENTIAL_CACHE.get(cacheKey);

      if (cached) {
        // Decrypt cached value (credentials are encrypted at rest in KV)
        return this.decrypt(cached);
      }

      return null;
    } catch (error) {
      console.error(`[1Password] Cache read error:`, error);
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
      const cacheKey = `1password:cache:${credentialPath}`;

      // Encrypt value before caching
      const encrypted = await this.encrypt(value);

      await this.env.CREDENTIAL_CACHE.put(cacheKey, encrypted, {
        expirationTtl: ttl,
      });

      console.log(`[1Password] Cached ${credentialPath} for ${ttl}s`);
    } catch (error) {
      console.error(`[1Password] Cache write error:`, error);
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
        salt: encoder.encode("chittyos-1password-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      this.cachedKeyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    console.log("[1Password] Encryption key cached for improved performance");
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
      console.log(`[1Password] Encryption took ${encryptTime}ms`);
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
      console.log(`[1Password] Decryption took ${decryptTime}ms`);
    }

    return decoder.decode(decrypted);
  }

  /**
   * Prefetch multiple credentials in parallel
   *
   * @param {string[]} credentialPaths - Array of credential paths
   * @returns {Promise<Map<string, string>>} Map of path to credential value
   */
  async prefetch(credentialPaths) {
    console.log(
      `[1Password] Prefetching ${credentialPaths.length} credentials`,
    );

    const results = await Promise.allSettled(
      credentialPaths.map((path) => this.get(path)),
    );

    const credentialMap = new Map();

    results.forEach((result, index) => {
      const path = credentialPaths[index];

      if (result.status === "fulfilled") {
        credentialMap.set(path, result.value);
        console.log(`[1Password] Prefetch SUCCESS: ${path}`);
      } else {
        console.error(`[1Password] Prefetch FAILED: ${path}`, result.reason);
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
      const cacheKey = `1password:cache:${credentialPath}`;
      await this.env.CREDENTIAL_CACHE.delete(cacheKey);
      console.log(`[1Password] Invalidated cache for ${credentialPath}`);
    } catch (error) {
      console.error(`[1Password] Cache invalidation error:`, error);
    }
  }

  /**
   * Health check for 1Password Connect API
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.connectUrl || !this.connectToken) {
        return {
          status: "not_configured",
          message: "1Password Connect not configured",
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