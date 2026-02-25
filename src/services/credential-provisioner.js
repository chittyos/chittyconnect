/**
 * Credential Provisioning Service
 *
 * Securely provisions credentials from 1Password and creates
 * appropriately scoped tokens for ChittyOS services.
 *
 * Security principles:
 * - Never return raw make_api_key tokens
 * - Always create scoped, time-limited tokens
 * - Log all provisioning operations
 * - Rate limit requests
 */

/**
 * Credential provisioner for ChittyOS ecosystem
 */
export class CredentialProvisioner {
  constructor(env) {
    this.env = env;
    // 1Password references are injected at deploy time via `op run`.
    // Env vars: CLOUDFLARE_MAKE_API_KEY, CLOUDFLARE_ACCOUNT_ID
    this.onePasswordRefs = {
      cloudflare: {
        makeApiKey: "CLOUDFLARE_MAKE_API_KEY",
        accountId: "CLOUDFLARE_ACCOUNT_ID",
      },
    };

    // Cloudflare permission group IDs
    this.cloudflarePermissions = {
      workersScriptsWrite: {
        id: "c8fed203ed3043cba015a93ad1616f1f",
        name: "Workers Scripts Write",
      },
      workersScriptsRead: {
        id: "e086da7e2179491d91ee5f35b3ca210a",
        name: "Workers Scripts Read",
      },
      workersKVWrite: {
        id: "f7f0eda5697f475c90846e879bab8666",
        name: "Workers KV Storage Write",
      },
      accountSettingsRead: {
        id: "82e64a83756745bbbb1c9c2701bf816b",
        name: "Account Settings Read",
      },
    };
  }

  /**
   * Provision a credential based on type and context
   *
   * @param {string} type - Credential type (e.g., 'cloudflare_workers_deploy')
   * @param {object} context - Context information (service, purpose, etc.)
   * @param {string} requestingService - Service requesting the credential
   * @returns {Promise<object>} Provisioned credential with usage instructions
   */
  async provision(type, context, requestingService) {
    console.log(
      `[CredentialProvisioner] Provisioning ${type} for ${requestingService}`,
    );

    switch (type) {
      case "cloudflare_workers_deploy":
        return await this.provisionCloudflareWorkersDeploy(
          context,
          requestingService,
        );

      case "cloudflare_workers_read":
        return await this.provisionCloudflareWorkersRead(
          context,
          requestingService,
        );

      case "github_deploy_token":
        throw new Error("GitHub deploy token provisioning not yet implemented");

      case "neon_database_connection":
        throw new Error(
          "Neon database connection provisioning not yet implemented",
        );

      case "openai_api_key":
        throw new Error("OpenAI API key provisioning not yet implemented");

      case "notion_integration_token":
        throw new Error(
          "Notion integration token provisioning not yet implemented",
        );

      default:
        throw new Error(`Unknown credential type: ${type}`);
    }
  }

  /**
   * Provision Cloudflare Workers deployment token
   *
   * @param {object} context - Context with service, account_id, purpose
   * @param {string} requestingService - Service requesting the credential
   * @returns {Promise<object>} Cloudflare API token with deployment permissions
   */
  async provisionCloudflareWorkersDeploy(context, requestingService) {
    const { service, purpose } = context;

    if (!service) {
      throw new Error("Service name is required in context");
    }

    // Retrieve credentials from 1Password via environment variables
    // In production, these should be set via wrangler secrets
    const makeApiKey = this.env.CLOUDFLARE_MAKE_API_KEY;
    const accountId =
      this.env.CLOUDFLARE_ACCOUNT_ID || "0bc21e3a5a9de1a4cc843be9c3e98121";

    if (!makeApiKey) {
      throw new Error(
        "CLOUDFLARE_MAKE_API_KEY not configured. Please set via wrangler secret.",
      );
    }

    // Create scoped API token via Cloudflare API
    const tokenName = `${service} ${purpose || "deploy"} (${new Date().toISOString().split("T")[0]})`;

    const tokenRequest = {
      name: tokenName,
      policies: [
        {
          effect: "allow",
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
          permission_groups: [
            this.cloudflarePermissions.workersScriptsWrite,
            this.cloudflarePermissions.workersKVWrite,
            this.cloudflarePermissions.accountSettingsRead,
          ],
        },
      ],
      // Token expires in 1 year
      expires_on: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      // Restrict to GitHub Actions IPs if possible
      condition: {
        request_ip: {
          in: [], // Could add GitHub Actions IP ranges here
        },
      },
    };

    // Remove empty condition if no IPs specified
    if (tokenRequest.condition.request_ip.in.length === 0) {
      delete tokenRequest.condition;
    }

    console.log(
      `[CredentialProvisioner] Creating Cloudflare token: ${tokenName}`,
    );

    const response = await fetch(
      "https://api.cloudflare.com/client/v4/user/tokens",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${makeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tokenRequest),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("[CredentialProvisioner] Cloudflare API error:", error);
      throw new Error(
        `Failed to create Cloudflare token: ${response.status} - ${error}`,
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(
        `Cloudflare API returned error: ${JSON.stringify(result.errors)}`,
      );
    }

    const token = result.result;

    // Log provision event to audit trail
    await this.logProvisionEvent({
      type: "cloudflare_workers_deploy",
      service,
      purpose,
      requestingService,
      tokenId: token.id,
      tokenName: token.name,
      expiresAt: token.expires_on,
      scopes: token.policies.flatMap((p) =>
        p.permission_groups.map((pg) => pg.name),
      ),
    });

    return {
      success: true,
      credential: {
        type: "cloudflare_api_token",
        value: token.value,
        expires_at: token.expires_on,
        scopes: token.policies.flatMap((p) =>
          p.permission_groups.map((pg) => pg.name),
        ),
        account_id: accountId,
        token_id: token.id,
      },
      usage_instructions: {
        github_secret_name: "CLOUDFLARE_API_TOKEN",
        command: `gh secret set CLOUDFLARE_API_TOKEN --body "${token.value}"`,
        wrangler_command: `wrangler secret put CLOUDFLARE_API_TOKEN`,
        note: "This token has Workers Scripts Write, KV Write, and Account Settings Read permissions",
      },
    };
  }

  /**
   * Provision read-only Cloudflare Workers token
   *
   * @param {object} context - Context with service, purpose
   * @param {string} requestingService - Service requesting the credential
   * @returns {Promise<object>} Read-only Cloudflare API token
   */
  async provisionCloudflareWorkersRead(context, requestingService) {
    const { service, purpose } = context;

    const makeApiKey = this.env.CLOUDFLARE_MAKE_API_KEY;
    const accountId =
      this.env.CLOUDFLARE_ACCOUNT_ID || "0bc21e3a5a9de1a4cc843be9c3e98121";

    if (!makeApiKey) {
      throw new Error("CLOUDFLARE_MAKE_API_KEY not configured");
    }

    const tokenName = `${service} read-only (${new Date().toISOString().split("T")[0]})`;

    const tokenRequest = {
      name: tokenName,
      policies: [
        {
          effect: "allow",
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
          permission_groups: [
            this.cloudflarePermissions.workersScriptsRead,
            this.cloudflarePermissions.accountSettingsRead,
          ],
        },
      ],
      expires_on: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
    };

    const response = await fetch(
      "https://api.cloudflare.com/client/v4/user/tokens",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${makeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tokenRequest),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to create Cloudflare token: ${response.status} - ${error}`,
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(`Cloudflare API error: ${JSON.stringify(result.errors)}`);
    }

    const token = result.result;

    await this.logProvisionEvent({
      type: "cloudflare_workers_read",
      service,
      purpose,
      requestingService,
      tokenId: token.id,
      tokenName: token.name,
      expiresAt: token.expires_on,
      scopes: token.policies.flatMap((p) =>
        p.permission_groups.map((pg) => pg.name),
      ),
    });

    return {
      success: true,
      credential: {
        type: "cloudflare_api_token",
        value: token.value,
        expires_at: token.expires_on,
        scopes: token.policies.flatMap((p) =>
          p.permission_groups.map((pg) => pg.name),
        ),
        account_id: accountId,
        token_id: token.id,
      },
      usage_instructions: {
        note: "Read-only token for Workers Scripts and Account Settings",
      },
    };
  }

  /**
   * Log credential provision event to audit trail
   *
   * @param {object} event - Provision event details
   */
  async logProvisionEvent(event) {
    try {
      // Log to ChittyChronicle
      const chronicleResponse = await fetch(
        "https://chronicle.chitty.cc/api/entries",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.CHITTY_CHRONICLE_TOKEN}`,
          },
          body: JSON.stringify({
            eventType: "credential.provisioned",
            entityId: event.requestingService,
            data: {
              ...event,
              timestamp: new Date().toISOString(),
            },
          }),
        },
      );

      if (!chronicleResponse.ok) {
        console.warn(
          "[CredentialProvisioner] Failed to log to ChittyChronicle:",
          chronicleResponse.status,
        );
      }

      // Also log to D1 for local auditing
      await this.env.DB.prepare(
        `
        INSERT INTO credential_provisions
        (type, service, purpose, requesting_service, token_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      )
        .bind(
          event.type,
          event.service,
          event.purpose || null,
          event.requestingService,
          event.tokenId,
          event.expiresAt,
        )
        .run();

      console.log(
        `[CredentialProvisioner] Logged provision event: ${event.type} for ${event.service}`,
      );
    } catch (error) {
      console.error(
        "[CredentialProvisioner] Failed to log provision event:",
        error,
      );
      // Don't throw - logging failure shouldn't break provisioning
    }
  }

  /**
   * Check rate limit for credential provisioning
   *
   * @param {string} requestingService - Service requesting credential
   * @returns {Promise<boolean>} True if within rate limit
   */
  async checkRateLimit(requestingService) {
    const rateLimitKey = `credential:ratelimit:${requestingService}:${Math.floor(Date.now() / 3600000)}`; // Hourly
    const requests = await this.env.RATE_LIMIT.get(rateLimitKey);
    const requestCount = requests ? parseInt(requests) : 0;

    // Allow max 10 credential provisions per hour per service
    const maxPerHour = 10;

    if (requestCount >= maxPerHour) {
      throw new Error(
        `Rate limit exceeded: ${requestCount}/${maxPerHour} provisions per hour`,
      );
    }

    // Increment counter
    await this.env.RATE_LIMIT.put(rateLimitKey, (requestCount + 1).toString(), {
      expirationTtl: 3600, // 1 hour
    });

    return true;
  }

  /**
   * Validate provision request
   *
   * @param {string} type - Credential type
   * @param {object} context - Request context
   * @param {string} requestingService - Service making request
   * @throws {Error} If validation fails
   */
  validateRequest(type, context, requestingService) {
    if (!type) {
      throw new Error("Credential type is required");
    }

    if (!context || typeof context !== "object") {
      throw new Error("Context object is required");
    }

    if (!requestingService) {
      throw new Error("Requesting service identifier is required");
    }

    // Type-specific validation
    if (
      type === "cloudflare_workers_deploy" ||
      type === "cloudflare_workers_read"
    ) {
      if (!context.service) {
        throw new Error(
          "Service name is required in context for Cloudflare tokens",
        );
      }
    }
  }
}
