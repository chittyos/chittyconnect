/**
 * 1Password Connect API Client
 *
 * Provides secure, cached access to credentials stored in 1Password.
 * Implements intelligent caching, error handling, and failover strategies.
 *
 * @module services/1password-connect-client
 */

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
      emergency: env.ONEPASSWORD_VAULT_EMERGENCY
    };

    // Cache configuration
    this.cacheTTL = {
      infrastructure: 3600, // 1 hour for infrastructure creds
      services: 1800, // 30 minutes for service tokens
      integrations: 900, // 15 minutes for third-party APIs
      emergency: 0 // Never cache emergency credentials
    };
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

    // Parse credential path
    const parsed = this.parseCredentialPath(credentialPath);
    if (!parsed) {
      throw new Error(`Invalid credential path: ${credentialPath}`);
    }

    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await this.getFromCache(credentialPath);
      if (cached) {
        console.log(`[1Password] Cache HIT for ${credentialPath}`);
        return cached;
      }
    }

    console.log(`[1Password] Cache MISS for ${credentialPath}, fetching from Connect API`);

    // Fetch from 1Password Connect API
    const value = await this.fetchFromConnect(parsed);

    // Cache the result (unless emergency vault)
    if (parsed.vault !== 'emergency') {
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
    const parts = path.split('/');

    if (parts.length !== 3) {
      return null;
    }

    const [vault, item, field] = parts;

    // Validate vault
    if (!this.vaults[vault]) {
      console.error(`[1Password] Unknown vault: ${vault}`);
      return null;
    }

    return {
      vault,
      vaultId: this.vaults[vault],
      item,
      field,
      fullPath: path
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
      // Step 1: List items in vault to find the item ID
      const itemsUrl = `${this.connectUrl}/v1/vaults/${parsed.vaultId}/items`;

      const itemsResponse = await fetch(itemsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.connectToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!itemsResponse.ok) {
        throw new Error(
          `Failed to list items in vault ${parsed.vault}: ${itemsResponse.status} ${itemsResponse.statusText}`
        );
      }

      const items = await itemsResponse.json();

      // Find item by title (case-insensitive match)
      const item = items.find(
        i => i.title.toLowerCase() === parsed.item.toLowerCase()
      );

      if (!item) {
        throw new Error(
          `Item not found in vault ${parsed.vault}: ${parsed.item}`
        );
      }

      // Step 2: Get full item details including fields
      const itemUrl = `${this.connectUrl}/v1/vaults/${parsed.vaultId}/items/${item.id}`;

      const itemResponse = await fetch(itemUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.connectToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!itemResponse.ok) {
        throw new Error(
          `Failed to get item details: ${itemResponse.status} ${itemResponse.statusText}`
        );
      }

      const itemDetails = await itemResponse.json();

      // Step 3: Extract the requested field
      const field = itemDetails.fields?.find(
        f => f.label?.toLowerCase() === parsed.field.toLowerCase() ||
             f.id?.toLowerCase() === parsed.field.toLowerCase()
      );

      if (!field) {
        throw new Error(
          `Field not found in item ${parsed.item}: ${parsed.field}`
        );
      }

      const value = field.value;

      if (!value) {
        throw new Error(
          `Field ${parsed.field} in item ${parsed.item} has no value`
        );
      }

      console.log(
        `[1Password] Successfully retrieved ${parsed.fullPath} (${value.length} chars)`
      );

      return value;

    } catch (error) {
      console.error(`[1Password] Fetch error for ${parsed.fullPath}:`, error);

      // Check if we should failover to environment variable
      if (this.env.CREDENTIAL_FAILOVER_ENABLED === 'true') {
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
      `[1Password] Attempting failover to environment variables for ${parsed.fullPath}`
    );

    // Convert path to environment variable name
    // infrastructure/cloudflare/make_api_key -> CLOUDFLARE_MAKE_API_KEY
    const envVarName = `${parsed.item}_${parsed.field}`.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    const envValue = this.env[envVarName];

    if (!envValue) {
      throw new Error(
        `Failover failed: Environment variable ${envVarName} not set`
      );
    }

    console.warn(
      `[1Password] Failover SUCCESS - using ${envVarName} from environment`
    );

    return envValue;
  }

  /**
   * Get credential from cache
   *
   * @private
   * @param {string} credentialPath - Credential path
   * @returns {Promise<string|null>} Cached value or null
   */
  async getFromCache(credentialPath) {
    try {
      const cacheKey = `1password:cache:${credentialPath}`;
      const cached = await this.env.RATE_LIMIT.get(cacheKey);

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

      await this.env.RATE_LIMIT.put(cacheKey, encrypted, {
        expirationTtl: ttl
      });

      console.log(`[1Password] Cached ${credentialPath} for ${ttl}s`);
    } catch (error) {
      console.error(`[1Password] Cache write error:`, error);
      // Don't throw - cache failure shouldn't break credential retrieval
    }
  }

  /**
   * Encrypt credential value for caching
   *
   * @private
   * @param {string} value - Plain text credential
   * @returns {Promise<string>} Encrypted credential
   */
  async encrypt(value) {
    // Use Web Crypto API for encryption
    const encoder = new TextEncoder();
    const data = encoder.encode(value);

    // Derive key from environment encryption key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.env.ENCRYPTION_KEY || 'default-key-change-me'),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('chittyos-1password-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Base64 encode
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt cached credential value
   *
   * @private
   * @param {string} encrypted - Encrypted credential
   * @returns {Promise<string>} Plain text credential
   */
  async decrypt(encrypted) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Base64 decode
    const combined = new Uint8Array(
      atob(encrypted).split('').map(c => c.charCodeAt(0))
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    // Derive key (same as encryption)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.env.ENCRYPTION_KEY || 'default-key-change-me'),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('chittyos-1password-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    return decoder.decode(decrypted);
  }

  /**
   * Prefetch multiple credentials in parallel
   *
   * @param {string[]} credentialPaths - Array of credential paths
   * @returns {Promise<Map<string, string>>} Map of path to credential value
   */
  async prefetch(credentialPaths) {
    console.log(`[1Password] Prefetching ${credentialPaths.length} credentials`);

    const results = await Promise.allSettled(
      credentialPaths.map(path => this.get(path))
    );

    const credentialMap = new Map();

    results.forEach((result, index) => {
      const path = credentialPaths[index];

      if (result.status === 'fulfilled') {
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
   *
   * @param {string} credentialPath - Credential path to invalidate
   */
  async invalidateCache(credentialPath) {
    try {
      const cacheKey = `1password:cache:${credentialPath}`;
      await this.env.RATE_LIMIT.delete(cacheKey);
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
          status: 'not_configured',
          message: '1Password Connect not configured',
          timestamp: Date.now()
        };
      }

      const response = await fetch(`${this.connectUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.connectToken}`
        }
      });

      return {
        status: response.ok ? 'healthy' : 'degraded',
        statusCode: response.status,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'down',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
}

export default OnePasswordConnectClient;
