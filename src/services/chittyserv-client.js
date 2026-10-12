/**
 * ChittyServ Credential Client
 *
 * HTTP client for the ChittyServ credential broker API.
 * Drop-in replacement for OnePasswordConnectClient — same interface,
 * different backend (CHITTYSERV_URL/v1/ instead of chittysecrets Connect).
 *
 * ChittyServ uses the same {vault}/{item}/{field} path convention,
 * so existing credential paths work without modification.
 *
 * @module services/chittyserv-client
 */

export class ChittyServClient {
  constructor(env) {
    this.env = env;
    this.baseUrl = env.CHITTYSERV_URL;
    // A bearer credential is resolved from its binding for each operation,
    // never copied into KV, an instance cache, or a log.
  }

  /**
   * Retrieve a credential by path
   *
   * @param {string} credentialPath - Path like "infrastructure/cloudflare/make_api_key"
   * @param {object} options - Retrieval options
   * @returns {Promise<string>} Credential value
   */
  async get(credentialPath, _options = {}) {
    // Compatibility: callers may still pass bypassCache. Credential values
    // cannot be cached in KV or memoized on the Worker instance at all.
    return this.fetchFromChittyServ(credentialPath);
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

    const parts = typeof credentialPath === "string" ? credentialPath.split("/") : [];
    if (parts.length !== 3 ||
        !["infrastructure", "services", "integrations", "emergency"].includes(parts[0]) ||
        !parts.every((p) => /^[A-Za-z0-9_-]{1,128}$/.test(p))) {
      throw new TypeError("Invalid ChittyServ credential reference");
    }

    const token = await this.resolveBearerToken();
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/credentials/${parts.join("/")}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Request-ID": crypto.randomUUID(),
        "X-Source-Service": "chittyconnect",
        "X-Canonical-URI": "chittycanon://core/services/connect",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Cancel, do not read, untrusted error bodies to release the stream.
      try { await response.body?.cancel(); } catch { /* Already closed */ }
      // Never incorporate an untrusted upstream error body into a log or
      // error message; it could contain material the backend must not reveal.
      // Preserve the existing /api/credentials/* 404 classification while
      // never copying upstream-controlled content into the exception.
      const err = new Error(response.status === 404
        ? "ChittyServ credential not found (HTTP 404)"
        : `ChittyServ credential retrieval failed: HTTP ${response.status}`);
      if (response.status === 404) err.code = "CREDENTIAL_NOT_FOUND";
      throw err;
    }

    // SyntaxError text from Response.json() may echo an upstream body.
    // Never allow malformed provider content into caller error messages.
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("ChittyServ returned malformed credential JSON");
    }
    const value = data?.value ?? data?.credential;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("ChittyServ returned an invalid credential response");
    }
    return value;
  }

  /**
   * Resolve the existing ChittyConnect→ChittyServ authentication binding at
   * the point of the call. Accept plain Worker secrets and Cloudflare
   * Secrets Store bindings; fail closed on missing or non-string values.
   */
  async resolveBearerToken() {
    const binding = this.env.CHITTY_SERV_TOKEN;
    let token;
    if (typeof binding === "string") {
      token = binding;
    } else if (binding && typeof binding.get === "function") {
      token = await binding.get();
    }
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("ChittyServ authentication binding is unavailable");
    }
    return token;
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
        // Never log arbitrary backend errors: they may contain secret material.
        console.error(`[ChittyServ] Prefetch FAILED: ${path}`);
      }
    });

    return credentialMap;
  }

  /**
   * Legacy interface compatibility. No credential values are cached.
   * Never mutate old KV entries from a read-only credential client.
   */
  async invalidateCache(_credentialPath) {
    // No-op: runtime-only retrieval means there is nothing to invalidate.
  }

  /**
   * Health check for ChittyServ API
   *
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.baseUrl) {
        return { status: "not_configured", message: "CHITTYSERV_URL not set", timestamp: Date.now() };
      }

      // A public /health is not proof of authorized credential retrieval.
      // Still, a configured broker cannot be reported healthy without
      // a usable local auth binding or enforced upstream authentication.
      const token = await this.resolveBearerToken();
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Source-Service": "chittyconnect",
        },
        signal: AbortSignal.timeout(3000),
      });
      const body = await response.json().catch(() => ({}));
      const healthy = response.ok && body?.status === "ok" &&
        body?.service === "chittyserv" && body?.auth === "required" &&
        body?.backend?.credentials === "configured";

      return {
        status: healthy ? "healthy" : "degraded",
        statusCode: response.status,
        backend: "chittyserv",
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: "down",
        error: "ChittyServ unavailable",
        backend: "chittyserv",
        timestamp: Date.now(),
      };
    }
  }

}

export default ChittyServClient;
