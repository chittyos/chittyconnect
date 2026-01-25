/**
 * Resource URI Resolution
 * Handles parsing and resolving stable resource URIs across ChittyConnect
 *
 * URI Scheme: resource://connect/{session_id}/{sha256}-{basename}
 *
 * Examples:
 *   resource://connect/sess_abc123/a1b2c3d4...-document.pdf
 *   r2://files/sess_abc123/2026/01/04/a1b2c3d4...-document.pdf
 *   https://example.com/file.pdf
 */

export class ResourceURIResolver {
  constructor(env) {
    this.env = env;
  }

  /**
   * Parse a resource URI into components
   * @param {string} uri - Resource URI to parse
   * @returns {object} Parsed components
   */
  parseURI(uri) {
    const match = uri.match(
      /^resource:\/\/connect\/([^/]+)\/([a-f0-9]{64})-(.+)$/,
    );
    if (!match) {
      throw new Error(`Invalid resource URI format: ${uri}`);
    }

    return {
      session_id: match[1],
      sha256: match[2],
      basename: match[3],
    };
  }

  /**
   * Resolve a URI to its actual location
   * @param {string} uri - URI to resolve
   * @param {string|null} session_id - Optional session ID for access control
   * @returns {Promise<object>} Resolved resource info
   */
  async resolve(uri, session_id = null) {
    // Direct R2 reference
    if (uri.startsWith("r2://")) {
      return {
        type: "r2",
        key: uri.slice(5), // Remove 'r2://' prefix
      };
    }

    // Resource URI - needs lookup
    if (uri.startsWith("resource://connect/")) {
      const { session_id: parsedSession, sha256 } = this.parseURI(uri);

      // Verify session access if provided
      if (session_id && session_id !== parsedSession) {
        throw new Error("Session mismatch: access denied");
      }

      // Look up in context_files by sha256
      const { results } = await this.env.DB.prepare(
        `
        SELECT file_uri, file_name, mime_type, file_size
        FROM context_files
        WHERE sha256 = ? AND session_id = ?
        ORDER BY synced_at DESC
        LIMIT 1
      `,
      )
        .bind(sha256, parsedSession)
        .all();

      if (results.length === 0) {
        throw new Error(`Resource not found: ${uri}`);
      }

      const fileRecord = results[0];

      // Recursively resolve the file_uri
      return this.resolve(fileRecord.file_uri, parsedSession);
    }

    // External URL (pass-through)
    if (uri.startsWith("https://") || uri.startsWith("http://")) {
      return {
        type: "external",
        url: uri,
      };
    }

    throw new Error(`Unsupported URI scheme: ${uri}`);
  }

  /**
   * Generate a stable resource URI
   * @param {string} session_id - Session ID
   * @param {string} sha256 - File SHA256 hash
   * @param {string} basename - File basename
   * @returns {string} Resource URI
   */
  generate(session_id, sha256, basename) {
    // Validate inputs
    if (!session_id || !sha256 || !basename) {
      throw new Error("session_id, sha256, and basename required");
    }

    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error("Invalid SHA256 hash format");
    }

    // Sanitize basename
    const safeName = String(basename).replace(/[^a-zA-Z0-9_.-]/g, "_");

    return `resource://connect/${session_id}/${sha256}-${safeName}`;
  }

  /**
   * Resolve a resource URI and get R2 object
   * @param {string} uri - URI to resolve
   * @param {string|null} session_id - Optional session ID for access control
   * @returns {Promise<R2ObjectBody|null>} R2 object or null
   */
  async getR2Object(uri, session_id = null) {
    const resolved = await this.resolve(uri, session_id);

    if (resolved.type === "r2") {
      return await this.env.FILES.get(resolved.key);
    }

    if (resolved.type === "external") {
      throw new Error("Cannot get R2 object for external URL");
    }

    return null;
  }

  /**
   * Generate a download URL for a resource
   * @param {string} uri - URI to resolve
   * @param {string|null} session_id - Optional session ID for access control
   * @param {number} expirySeconds - Expiry time in seconds (default 3600)
   * @returns {Promise<string>} Download URL
   */
  async generateDownloadURL(uri, session_id = null, expirySeconds = 3600) {
    const resolved = await this.resolve(uri, session_id);

    if (resolved.type === "r2") {
      // For R2, we'd need to generate a presigned URL
      // For now, return a token-based URL
      const downloadToken = crypto.randomUUID();
      const expiresAt = Date.now() + expirySeconds * 1000;

      await this.env.TOKEN_KV.put(
        `download:${downloadToken}`,
        JSON.stringify({
          r2_key: resolved.key,
          session_id,
          expires_at: expiresAt,
        }),
        { expirationTtl: expirySeconds },
      );

      return `https://api.chitty.cc/api/files/download/${downloadToken}`;
    }

    if (resolved.type === "external") {
      return resolved.url;
    }

    throw new Error("Cannot generate download URL for this resource type");
  }
}

export default ResourceURIResolver;
