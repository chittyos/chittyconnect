/**
 * ChittyServ Credential Client
 *
 * HTTP client for the ChittyServ credential broker API.
 * Drop-in replacement for OnePasswordConnectClient — same interface,
 * different backend (CHITTYSERV_URL/v1/ instead of 1Password Connect).
 *
 * ChittyServ uses the same {vault}/{item}/{field} path convention,
 * so existing credential paths work without modification.
 *
 * @module services/chittyserv-client
 */

export class ChittyServClient {
  constructor(env) {
    this.env = env;
    this.baseUrl = env.CHITTYSERV_URL; // Set in env.dev only — absent in staging/prod
    this.token = env.CHITTY_SERV_TOKEN;

    if (this.baseUrl && !this.token) {
      console.warn(
        "[ChittyServ] CHITTY_SERV_TOKEN not set — unauthenticated requests will be made",
      );
    }

    // Cache configuration — same TTLs as 1Password client
    this.cacheTTL = {
      infrastructure: 3600,
      services: 1800,
      integrations: 900,
      emergency: 0,
    };
  }

  /**
   * Retrieve a credential by path
   *
   * @param {string} credentialPath - Path like "infrastructure/cloudflare/make_api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, options = {}) {
    const { bypassCache = false } = options;

    // Check KV cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await this.getFromCache(credentialPath);
      if (cached) {
        console.log(`[ChittyServ] Cache HIT for ${credentialPath}`);
        return cached;
      }
    }

    console.log(
      `[ChittyServ] Cache MISS for ${credentialPath}, fetching from ChittyServ`,
    );

    // Fetch from ChittyServ API
    const value = await this.fetchFromChittyServ(credentialPath);

    // Cache the result (parse vault from path for TTL)
    const vault = credentialPath.split("/")[0];
    if (vault !== "emergency") {
      const ttl = this.cacheTTL[vault] || 900;
      await this.setCache(credentialPath, value, ttl);
    }

    return value;
  }

  /**
   * Fetch credential from ChittyServ API
   *
   * @private
   * @param {string} credentialPath - Credential path ({vault}/{item}/{field})
   * @returns {Promise<string>} Credential value
   */
  async fetchFromChittyServ(credentialPath) {
    if (!this.baseUrl) {
      throw new Error("CHITTYSERV_URL not configured — ChittyServ unavailable in this environment");
    }
    const url = `${this.baseUrl}/v1/credentials/${credentialPath}`;

    const headers = {
      "Content-Type": "application/json",
      "X-Request-ID": crypto.randomUUID(),
      "X-Source-Service": "chittyconnect",
      "X-Canonical-URI": "chittycanon://core/services/connect",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `ChittyServ credential fetch failed for ${credentialPath}: ${response.status} ${response.statusText}${errorBody ? ` — ${errorBody}` : ""}`,
      );
    }

    const data = await response.json();

    // ChittyServ returns { success: true, value: "..." } or { value: "..." }
    const value = data.value || data.credential;

    if (!value) {
      throw new Error(`ChittyServ returned no value for ${credentialPath}`);
    }

    console.log(
      `[ChittyServ] Successfully retrieved ${credentialPath} (${value.length} chars)`,
    );

    return value;
  }

  /**
   * Get credential from KV cache
   *
   * @private
   * @param {string} credentialPath - Credential path
   * @returns {Promise<string|null>} Cached value or null
   */
  async getFromCache(credentialPath) {
    try {
      if (!this.env.CREDENTIAL_CACHE) return null;
      const cacheKey = `chittyserv:cache:${credentialPath}`;
      return await this.env.CREDENTIAL_CACHE.get(cacheKey);
    } catch (error) {
      console.error("[ChittyServ] Cache read error:", error);
      return null;
    }
  }

  /**
   * Set credential in KV cache
   *
   * @private
   * @param {string} credentialPath - Credential path
   * @param {string} value - Credential value
   * @param {number} ttl - Time to live in seconds
   */
  async setCache(credentialPath, value, ttl) {
    try {
      if (!this.env.CREDENTIAL_CACHE) return;
      const cacheKey = `chittyserv:cache:${credentialPath}`;
      await this.env.CREDENTIAL_CACHE.put(cacheKey, value, {
        expirationTtl: ttl,
      });
      console.log(`[ChittyServ] Cached ${credentialPath} for ${ttl}s`);
    } catch (error) {
      console.error("[ChittyServ] Cache write error:", error);
    }
  }

  /**
   * Prefetch multiple credentials in parallel
   *
   * @param {string[]} credentialPaths - Array of credential paths
   * @returns {Promise<Map<string, string>>} Map of path to credential value
   */
  async prefetch(credentialPaths) {
    console.log(
      `[ChittyServ] Prefetching ${credentialPaths.length} credentials`,
    );

    const results = await Promise.allSettled(
      credentialPaths.map((path) => this.get(path)),
    );

    const credentialMap = new Map();

    results.forEach((result, index) => {
      const path = credentialPaths[index];
      if (result.status === "fulfilled") {
        credentialMap.set(path, result.value);
      } else {
        console.error(`[ChittyServ] Prefetch FAILED: ${path}`, result.reason);
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
      if (!this.env.CREDENTIAL_CACHE) return;
      const cacheKey = `chittyserv:cache:${credentialPath}`;
      await this.env.CREDENTIAL_CACHE.delete(cacheKey);
      console.log(`[ChittyServ] Invalidated cache for ${credentialPath}`);
    } catch (error) {
      console.error("[ChittyServ] Cache invalidation error:", error);
    }
  }

  /**
   * Health check for ChittyServ API
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.baseUrl) {
        return {
          status: "not_configured",
          message: "CHITTYSERV_URL not set",
          timestamp: Date.now(),
        };
      }

      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          "X-Source-Service": "chittyconnect",
        },
        signal: AbortSignal.timeout(3000),
      });

      const body = await response.json().catch(() => ({}));

      return {
        status: response.ok ? body.status || "healthy" : "degraded",
        statusCode: response.status,
        backend: "chittyserv",
        url: this.baseUrl,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: "down",
        error: error.message,
        backend: "chittyserv",
        url: this.baseUrl,
        timestamp: Date.now(),
      };
    }
  }
}

export default ChittyServClient;
