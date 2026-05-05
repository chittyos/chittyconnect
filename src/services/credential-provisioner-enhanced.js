/**
 * Enhanced Credential Provisioning Service with 1Password Integration
 *
 * This enhanced version integrates with 1Password Connect to retrieve
 * root credentials dynamically, eliminating the need to store sensitive
 * keys in environment variables.
 *
 * Security principles:
 * - Never store root credentials in environment variables
 * - Retrieve credentials from 1Password on-demand
 * - Context-aware provisioning with ContextConsciousness™
 * - Always create scoped, time-limited tokens
 * - Log all provisioning operations
 * - Rate limit requests
 */

import { createCredentialBroker } from "../lib/credential-broker.js";
import { CREDENTIAL_PATHS } from "../lib/credential-paths.js";

/**
 * Enhanced Credential provisioner for ChittyOS ecosystem
 */
export class EnhancedCredentialProvisioner {
  constructor(env, contextConsciousness) {
    this.env = env;
    this.contextConsciousness = contextConsciousness || null;
    this.broker = createCredentialBroker(env);
    // Keep .onePassword as alias for backward compat in internal methods
    this.onePassword = this.broker;

    // Cloudflare permissions will be fetched dynamically
    // These are fallback IDs if API fetch fails.
    //
    // `scope: "account"` (default) → goes in a policy block whose
    //   resources key is `com.cloudflare.api.account.{accountId}`.
    // `scope: "zone"` → must be emitted in a SEPARATE policy block per
    //   zone with resources key `com.cloudflare.api.account.zone.{zoneId}`.
    //   Callers that need a zone-scoped permission must pass
    //   `context.zones: [<zone_id>, ...]`. Without `context.zones`, any
    //   zone-scoped permission is dropped from the token (logged) so
    //   account-scoped permissions still issue cleanly.
    this.cloudflarePermissions = null;
    this.cloudflarePermissionsFallback = {
      workersScriptsWrite: {
        id: "c8fed203ed3043cba015a93ad1616f1f",
        name: "Workers Scripts Write",
        scope: "account",
      },
      workersScriptsRead: {
        id: "e086da7e2179491d91ee5f35b3ca210a",
        name: "Workers Scripts Read",
        scope: "account",
      },
      workersKVWrite: {
        id: "f7f0eda5697f475c90846e879bab8666",
        name: "Workers KV Storage Write",
        scope: "account",
      },
      accountSettingsRead: {
        id: "82e64a83756745bbbb1c9c2701bf816b",
        name: "Account Settings Read",
        scope: "account",
      },
      workersR2Write: {
        id: "e4a0e7ae101d4057abc990af58022017",
        name: "Workers R2 Storage Write",
        scope: "account",
      },
      workersDurableObjectsWrite: {
        id: "2fc0424ac60b42e0b849d4d99bdcd1e5",
        name: "Workers Durable Objects Write",
        scope: "account",
      },
      d1DatabaseWrite: {
        id: "5e2c30acd1434ea2adfb8442c3cbbbea",
        name: "D1 Database Write",
        scope: "account",
      },
      // Zone-scoped. Required for `wrangler deploy` against a worker
      // with a `routes` block — without this permission group, deploy
      // fails post-upload at PUT /zones/{zid}/workers/routes with
      // Authentication error code 10000.
      workersRoutesWrite: {
        id: "09b2857d1c31407795e75e3fce8e4d9e",
        name: "Workers Routes Write",
        scope: "zone",
      },
    };

    // Cache for permission groups (persists for Worker lifetime)
    this.permissionGroupsCache = null;
    this.permissionGroupsCacheTime = 0;
    this.permissionGroupsCacheTTL = 24 * 60 * 60 * 1000; // 24 hours

    // Expanded credential type mappings
    this.credentialTypes = {
      cloudflare_workers_deploy: {
        // `workersRoutesWrite` is zone-scoped — only takes effect when
        // the caller passes `context.zones`. Without zones it is
        // dropped at policy-build time (logged) so existing callers
        // that don't manage routes via wrangler keep working.
        permissions: [
          "workersScriptsWrite",
          "workersKVWrite",
          "accountSettingsRead",
          "workersRoutesWrite",
        ],
        ttl: 365 * 24 * 60 * 60 * 1000, // 1 year
        requiresContext: ["service"],
      },
      cloudflare_workers_read: {
        permissions: ["workersScriptsRead", "accountSettingsRead"],
        ttl: 90 * 24 * 60 * 60 * 1000, // 90 days
        requiresContext: ["service"],
      },
      cloudflare_r2_access: {
        permissions: ["workersR2Write", "accountSettingsRead"],
        ttl: 180 * 24 * 60 * 60 * 1000, // 180 days
        requiresContext: ["service", "bucket"],
      },
      cloudflare_d1_access: {
        permissions: ["d1DatabaseWrite", "accountSettingsRead"],
        ttl: 180 * 24 * 60 * 60 * 1000, // 180 days
        requiresContext: ["service", "database"],
      },
      chittyos_service_token: {
        type: "service_token",
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
        requiresContext: ["source_service", "target_service"],
      },
      github_deploy_token: {
        type: "github",
        ttl: 90 * 24 * 60 * 60 * 1000, // 90 days
        requiresContext: ["repository"],
      },
      neon_database_connection: {
        type: "neon",
        ttl: null, // Connection strings don't expire
        requiresContext: ["database", "readonly"],
      },
      neon_api_key: {
        type: "integration_api_key",
        platform: "neon",
        ttl: null,
        requiresContext: ["purpose"],
        onePasswordPath: CREDENTIAL_PATHS.integrations.neonApiKey,
        envVar: "NEON_API_KEY",
        description: "Neon API key for MCP server and database management",
      },
      openai_api_key: {
        type: "integration_api_key",
        platform: "openai",
        ttl: null,
        requiresContext: ["purpose"],
        onePasswordPath: CREDENTIAL_PATHS.integrations.openaiApiKey,
        envVar: "OPENAI_API_KEY",
        description: "OpenAI API key for GPT models",
      },
      anthropic_api_key: {
        type: "integration_api_key",
        platform: "anthropic",
        ttl: null,
        requiresContext: ["purpose"],
        onePasswordPath: "integrations/anthropic/api_key",
        envVar: "ANTHROPIC_API_KEY",
        description: "Anthropic API key for Claude models",
      },
      notion_api_key: {
        type: "integration_api_key",
        platform: "notion",
        ttl: null,
        requiresContext: ["purpose"],
        onePasswordPath: CREDENTIAL_PATHS.integrations.notionApiKey,
        envVar: "NOTION_TOKEN",
        description: "Notion integration token for workspace access",
      },
      github_api_key: {
        type: "integration_api_key",
        platform: "github",
        ttl: null,
        requiresContext: ["purpose"],
        onePasswordPath: CREDENTIAL_PATHS.integrations.githubPat,
        envVar: "GITHUB_TOKEN",
        description: "GitHub personal access token",
      },
      stripe_api_key: {
        type: "integration_api_key",
        platform: "stripe",
        ttl: null,
        requiresContext: ["purpose", "mode"],
        onePasswordPath: "integrations/stripe/api_key",
        envVar: "STRIPE_API_KEY",
        description: "Stripe API key for payment processing",
      },
    };
  }

  /**
   * Provision a credential based on type and context
   * Enhanced with 1Password retrieval and ContextConsciousness validation
   *
   * @param {string} type - Credential type
   * @param {object} context - Context information
   * @param {string} requestingService - Service requesting the credential
   * @returns {Promise<object>} Provisioned credential with usage instructions
   */
  async provision(type, context, requestingService) {
    console.log(
      `[EnhancedCredentialProvisioner] Provisioning ${type} for ${requestingService}`,
    );

    // Validate with ContextConsciousness™
    const contextAnalysis = await this.analyzeContext(
      type,
      context,
      requestingService,
    );
    if (!contextAnalysis.approved) {
      throw new Error(`Context validation failed: ${contextAnalysis.reason}`);
    }

    // Route to appropriate provisioner
    switch (type) {
      case "cloudflare_workers_deploy":
      case "cloudflare_workers_read":
      case "cloudflare_r2_access":
      case "cloudflare_d1_access":
        return await this.provisionCloudflareToken(
          type,
          context,
          requestingService,
        );

      case "chittyos_service_token":
        return await this.provisionServiceToken(context, requestingService);

      case "github_deploy_token":
        return await this.provisionGitHubToken(context, requestingService);

      case "neon_database_connection":
        return await this.provisionNeonConnection(context, requestingService);

      default: {
        // Check if it's an integration API key type
        const typeConfig = this.credentialTypes[type];
        if (typeConfig?.type === "integration_api_key") {
          return await this.provisionIntegrationApiKey(
            type,
            typeConfig,
            context,
            requestingService,
          );
        }
        throw new Error(`Unknown credential type: ${type}`);
      }
    }
  }

  /**
   * Analyze context using ContextConsciousness™
   *
   * @private
   * @param {string} type - Credential type
   * @param {object} context - Request context
   * @param {string} requestingService - Service making request
   * @returns {Promise<object>} Analysis result
   */
  async analyzeContext(type, context, requestingService) {
    const analysis = {
      approved: true,
      reason: null,
      riskScore: 0,
      recommendations: [],
    };

    const hasContextConsciousness =
      this.contextConsciousness &&
      typeof this.contextConsciousness.checkServiceHealth === "function" &&
      typeof this.contextConsciousness.detectAnomalies === "function";

    if (hasContextConsciousness) {
      // Check if requesting service is healthy
      const serviceHealth = await this.contextConsciousness.checkServiceHealth(
        requestingService,
        { url: `https://${requestingService}.chitty.cc` },
      );

      if (serviceHealth.status === "down") {
        analysis.approved = false;
        analysis.reason = "Requesting service is down";
        analysis.riskScore = 100;
        return analysis;
      }

      // Check for anomalous patterns
      const anomalies = await this.contextConsciousness.detectAnomalies({
        services: [{ name: requestingService, ...serviceHealth }],
      });

      if (anomalies.length > 0) {
        analysis.riskScore += anomalies.length * 20;
        analysis.recommendations.push("Monitor for unusual activity");
      }
    } else {
      analysis.recommendations.push(
        "ContextConsciousness unavailable; using baseline validation only",
      );
    }

    // Validate required context fields
    const typeConfig = this.credentialTypes[type];
    if (typeConfig?.requiresContext) {
      for (const required of typeConfig.requiresContext) {
        if (!context[required]) {
          analysis.approved = false;
          analysis.reason = `Missing required context field: ${required}`;
          return analysis;
        }
      }
    }

    // Check rate limits
    const rateLimitOk = await this.checkRateLimit(requestingService);
    if (!rateLimitOk) {
      analysis.approved = false;
      analysis.reason = "Rate limit exceeded";
      analysis.riskScore = 50;
      return analysis;
    }

    // Additional security checks based on credential type
    if (type.includes("deploy") || type.includes("write")) {
      // Higher scrutiny for write permissions
      if (context.environment === "production" && !context.approved_by) {
        analysis.recommendations.push(
          "Consider requiring approval for production deployments",
        );
        analysis.riskScore += 30;
      }
    }

    // Deny if risk score too high
    if (analysis.riskScore >= 70) {
      analysis.approved = false;
      analysis.reason = `Risk score too high: ${analysis.riskScore}`;
    }

    return analysis;
  }

  /**
   * Fetch Cloudflare permission groups dynamically
   *
   * @private
   * @param {string} apiKey - Cloudflare API key
   * @returns {Promise<object>} Permission groups mapped by name
   */
  async fetchCloudflarePermissions(apiKey) {
    try {
      // Check cache first
      if (
        this.permissionGroupsCache &&
        Date.now() - this.permissionGroupsCacheTime <
          this.permissionGroupsCacheTTL
      ) {
        return this.permissionGroupsCache;
      }

      console.log(
        "[EnhancedCredentialProvisioner] Fetching Cloudflare permission groups from API",
      );

      const response = await fetch(
        "https://api.cloudflare.com/client/v4/user/tokens/permission_groups",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch permission groups: ${response.status}`,
        );
      }

      const data = await response.json();
      if (!data.success || !data.result) {
        throw new Error("Invalid permission groups response");
      }

      // Map permission groups by normalized name
      const permissions = {};
      for (const group of data.result) {
        // Normalize the permission name for mapping
        const normalizedName = group.name
          .replace(/\s+/g, "") // Remove spaces
          .replace(/^Workers/, "workers") // Lowercase workers prefix
          .replace(/^Account/, "account") // Lowercase account prefix
          .replace(/^D1/, "d1"); // Lowercase D1 prefix

        // Create a key that matches our existing naming
        let key = null;
        if (
          normalizedName.includes("workersScripts") &&
          normalizedName.includes("Write")
        ) {
          key = "workersScriptsWrite";
        } else if (
          normalizedName.includes("workersScripts") &&
          normalizedName.includes("Read")
        ) {
          key = "workersScriptsRead";
        } else if (
          normalizedName.includes("workersKV") &&
          normalizedName.includes("Write")
        ) {
          key = "workersKVWrite";
        } else if (
          normalizedName.includes("accountSettings") &&
          normalizedName.includes("Read")
        ) {
          key = "accountSettingsRead";
        } else if (
          normalizedName.includes("workersR2") &&
          normalizedName.includes("Write")
        ) {
          key = "workersR2Write";
        } else if (
          normalizedName.includes("workersDurableObjects") &&
          normalizedName.includes("Write")
        ) {
          key = "workersDurableObjectsWrite";
        } else if (
          normalizedName.includes("d1Database") &&
          normalizedName.includes("Write")
        ) {
          key = "d1DatabaseWrite";
        } else if (
          normalizedName.includes("workersRoutes") &&
          normalizedName.includes("Write")
        ) {
          key = "workersRoutesWrite";
        }

        if (key) {
          // Preserve the scope from the static fallback; the Cloudflare
          // permission-groups API doesn't always echo a stable scope
          // identifier, so fallback is the source of truth for scope.
          const fallback = this.cloudflarePermissionsFallback[key];
          permissions[key] = {
            id: group.id,
            name: group.name,
            scope: fallback?.scope || "account",
          };
        }
      }

      // Merge dynamic with fallback so missing groups still resolve.
      const mergedPermissions = {
        ...this.cloudflarePermissionsFallback,
        ...permissions,
      };

      // Cache the results
      this.permissionGroupsCache = mergedPermissions;
      this.permissionGroupsCacheTime = Date.now();

      console.log(
        "[EnhancedCredentialProvisioner] Successfully fetched and cached permission groups",
      );
      return mergedPermissions;
    } catch (error) {
      console.error(
        "[EnhancedCredentialProvisioner] Failed to fetch permissions dynamically:",
        error,
      );
      console.log(
        "[EnhancedCredentialProvisioner] Using fallback permission IDs",
      );
      return this.cloudflarePermissionsFallback;
    }
  }

  /**
   * Get Cloudflare permissions (dynamic or fallback)
   *
   * @private
   * @param {string} apiKey - Cloudflare API key
   * @returns {Promise<object>} Permission groups
   */
  async getCloudflarePermissions(apiKey) {
    if (!this.cloudflarePermissions) {
      this.cloudflarePermissions =
        await this.fetchCloudflarePermissions(apiKey);
    }
    return this.cloudflarePermissions;
  }

  /**
   * Provision Cloudflare API token with credentials from 1Password
   *
   * @private
   * @param {string} type - Token type
   * @param {object} context - Context
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} Provisioned token
   */
  async provisionCloudflareToken(type, context, requestingService) {
    const { service, purpose, environment = "production" } = context;

    // Retrieve Cloudflare credentials from 1Password
    const makeApiKey = await this.onePassword.getInfrastructureCredential(
      "cloudflare",
      "make_api_key",
      {
        service: "chittyconnect",
        purpose: "credential_provisioning",
        environment,
      },
    );

    const accountId = await this.onePassword
      .getInfrastructureCredential("cloudflare", "account_id", {
        service: "chittyconnect",
        purpose: "credential_provisioning",
        environment,
      })
      .catch((err) => {
        console.warn("[EnhancedCredentialProvisioner] 1Password account_id fetch failed:", err.message);
        return this.env.CHITTYOS_ACCOUNT_ID;
      });

    if (!accountId) {
      throw new Error("Cloudflare Account ID unavailable — both 1Password and CHITTYOS_ACCOUNT_ID env var are empty");
    }
    if (!makeApiKey) {
      throw new Error(
        "Failed to retrieve Cloudflare credentials from 1Password",
      );
    }

    // Get permission groups dynamically
    const cloudflarePermissions =
      await this.getCloudflarePermissions(makeApiKey);

    // Get type configuration
    const typeConfig = this.credentialTypes[type];
    const permissions = typeConfig.permissions.map(
      (p) => cloudflarePermissions[p],
    );
    const missingPermissions = permissions.filter((p) => !p);
    if (missingPermissions.length > 0) {
      throw new Error(
        `Unable to resolve all Cloudflare permission groups for ${type}`,
      );
    }

    // Partition permissions by scope. Account-scoped permissions go in
    // a single policy block keyed by the account; zone-scoped ones
    // need a separate policy block per zone with a zone-keyed
    // resources object — Cloudflare rejects mixing scopes in one block.
    const accountPermissions = permissions.filter(
      (p) => (p.scope || "account") === "account",
    );
    const zonePermissions = permissions.filter((p) => p.scope === "zone");

    const requestedZones = Array.isArray(context.zones)
      ? context.zones.filter((z) => typeof z === "string" && z.length > 0)
      : [];

    if (zonePermissions.length > 0 && requestedZones.length === 0) {
      // Drop zone-scoped perms when no zones provided. Caller still
      // gets the account-scoped subset. If the dropped perms are load-
      // bearing (e.g. wrangler deploy of a worker with `routes`), the
      // resulting deploy will fail with code 10000 — which is the
      // existing behavior, so no regression.
      console.warn(
        `[EnhancedCredentialProvisioner] Dropping zone-scoped permissions ${zonePermissions.map((p) => p.name).join(", ")} from token for ${type} — caller did not provide context.zones`,
      );
    }

    // Create token name with context
    const tokenName = `${service} ${purpose || type} (${new Date().toISOString().split("T")[0]}) [via ChittyConnect]`;

    // Build the policy list: one account-scoped block (if any account
    // perms requested) plus one block per zone for zone-scoped perms.
    const policies = [];
    if (accountPermissions.length > 0) {
      policies.push({
        effect: "allow",
        resources: {
          [`com.cloudflare.api.account.${accountId}`]: "*",
        },
        permission_groups: accountPermissions,
      });
    }
    if (zonePermissions.length > 0 && requestedZones.length > 0) {
      for (const zoneId of requestedZones) {
        policies.push({
          effect: "allow",
          resources: {
            [`com.cloudflare.api.account.zone.${zoneId}`]: "*",
          },
          permission_groups: zonePermissions,
        });
      }
    }

    if (policies.length === 0) {
      throw new Error(
        `No policies to issue for ${type} — both account and zone permission sets resolved empty`,
      );
    }

    // Build token request
    const tokenRequest = {
      name: tokenName,
      policies,
      expires_on: new Date(Date.now() + typeConfig.ttl).toISOString(),
    };

    // Add IP restrictions for production tokens
    if (environment === "production" && context.ip_restrictions) {
      tokenRequest.condition = {
        request_ip: {
          in: context.ip_restrictions,
        },
      };
    }

    console.log(
      `[EnhancedCredentialProvisioner] Creating Cloudflare token: ${tokenName}`,
    );

    // Create token via Cloudflare API
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

    // Log provision event
    await this.logProvisionEvent({
      type,
      service,
      purpose,
      requestingService,
      tokenId: token.id,
      tokenName: token.name,
      expiresAt: token.expires_on,
      scopes: permissions.map((p) => p.name),
      environment,
      contextAnalysis: true, // Flag that context was validated
    });

    return {
      success: true,
      credential: {
        type: "cloudflare_api_token",
        value: token.value,
        expires_at: token.expires_on,
        scopes: permissions.map((p) => p.name),
        account_id: accountId,
        token_id: token.id,
        environment,
      },
      usage_instructions: this.getUsageInstructions(type, token.value),
      metadata: {
        provisioned_by: "ChittyConnect Enhanced",
        context_validated: true,
        retrieved_from: "1Password",
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Provision ChittyOS inter-service token
   *
   * @private
   * @param {object} context - Context with source_service, target_service
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} Service token
   */
  async provisionServiceToken(context, requestingService) {
    const { source_service, target_service, scopes = [] } = context;

    // Retrieve the target service's token from 1Password
    const token = await this.onePassword.getServiceToken(target_service, {
      service: source_service,
      purpose: "inter-service-call",
      environment: context.environment || "production",
    });

    if (!token) {
      throw new Error(`Failed to retrieve service token for ${target_service}`);
    }

    // Create a scoped, time-limited derivative token if needed
    // This would integrate with ChittyAuth for token creation
    const scopedToken = await this.createScopedServiceToken(
      token,
      scopes,
      context,
    );

    await this.logProvisionEvent({
      type: "chittyos_service_token",
      source_service,
      target_service,
      requestingService,
      scopes,
      expiresAt: scopedToken.expires_at,
    });

    return {
      success: true,
      credential: {
        type: "service_token",
        value: scopedToken.value,
        expires_at: scopedToken.expires_at,
        scopes: scopedToken.scopes,
        target_service,
      },
      usage_instructions: {
        header: "Authorization",
        format: `Bearer ${scopedToken.value}`,
        endpoint: `https://${target_service}.chitty.cc`,
        note: `Token valid for ${target_service} API calls with scopes: ${scopes.join(", ")}`,
      },
    };
  }

  /**
   * Provision GitHub deployment token
   *
   * @private
   * @param {object} context - Context with repository
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} GitHub token
   */
  async provisionGitHubToken(context, requestingService) {
    const { repository, permissions = ["contents:write", "actions:write"] } =
      context;

    // Retrieve GitHub App credentials from 1Password
    const appId = await this.onePassword.getInfrastructureCredential(
      "github",
      "app_id",
      {
        service: requestingService,
        purpose: "github_deployment",
        environment: context.environment || "production",
      },
    );

    const privateKey = await this.onePassword.getInfrastructureCredential(
      "github",
      "private_key",
      {
        service: requestingService,
        purpose: "github_deployment",
        environment: context.environment || "production",
      },
    );

    if (!appId || !privateKey) {
      throw new Error("Failed to retrieve GitHub credentials from 1Password");
    }

    // Generate installation access token
    // This would use GitHub's App API to create a scoped token
    const installationToken = await this.createGitHubInstallationToken(
      appId,
      privateKey,
      repository,
      permissions,
    );

    await this.logProvisionEvent({
      type: "github_deploy_token",
      repository,
      requestingService,
      permissions,
      expiresAt: installationToken.expires_at,
    });

    return {
      success: true,
      credential: {
        type: "github_token",
        value: installationToken.token,
        expires_at: installationToken.expires_at,
        permissions,
        repository,
      },
      usage_instructions: {
        github_secret_name: "GITHUB_TOKEN",
        command: `gh secret set GITHUB_TOKEN --body "${installationToken.token}"`,
        note: `Token valid for repository ${repository} with permissions: ${permissions.join(", ")}`,
      },
    };
  }

  /**
   * Provision Neon database connection string
   *
   * @private
   * @param {object} context - Context with database, readonly
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} Database connection
   */
  async provisionNeonConnection(context, requestingService) {
    const { database, readonly = false } = context;

    // Retrieve Neon credentials from 1Password
    const databaseUrl = await this.onePassword.getInfrastructureCredential(
      "neon",
      "database_url",
      {
        service: requestingService,
        purpose: "database_connection",
        environment: context.environment || "production",
      },
    );

    if (!databaseUrl) {
      throw new Error("Failed to retrieve Neon credentials from 1Password");
    }

    // Create a database-specific connection string if needed
    let connectionString = databaseUrl;
    if (database !== "chittyos-core") {
      // Modify connection string for specific database
      connectionString = databaseUrl.replace("/chittyos-core", `/${database}`);
    }

    // Add readonly flag if needed
    if (readonly) {
      connectionString += "?options=--default-transaction-read-only%3Don";
    }

    await this.logProvisionEvent({
      type: "neon_database_connection",
      database,
      readonly,
      requestingService,
    });

    return {
      success: true,
      credential: {
        type: "database_connection",
        value: connectionString,
        database,
        readonly,
        provider: "neon",
      },
      usage_instructions: {
        environment_variable: "DATABASE_URL",
        command: `wrangler secret put DATABASE_URL`,
        note: `${readonly ? "Read-only" : "Read-write"} connection to ${database} database`,
      },
    };
  }

  /**
   * Generic integration API key provisioner
   *
   * Dynamically provisions API keys for any configured integration platform.
   * Uses credential type metadata to determine 1Password path, env var name, etc.
   *
   * @private
   * @param {string} type - Credential type name (e.g., 'neon_api_key')
   * @param {object} typeConfig - Credential type configuration from this.credentialTypes
   * @param {object} context - Request context
   * @param {string} requestingService - Service requesting the credential
   * @returns {Promise<object>} Provisioned API key with usage instructions
   */
  async provisionIntegrationApiKey(
    type,
    typeConfig,
    context,
    requestingService,
  ) {
    const { platform, onePasswordPath, envVar, description } = typeConfig;
    const { purpose = "general" } = context;

    console.log(
      `[EnhancedCredentialProvisioner] Provisioning ${platform} API key via dynamic handler`,
    );

    // Retrieve API key from 1Password using configured path
    const apiKey = await this.onePassword.get(onePasswordPath, {
      service: requestingService,
      purpose,
      environment: context.environment || "production",
    });

    if (!apiKey) {
      throw new Error(
        `Failed to retrieve ${platform} API key from 1Password (path: ${onePasswordPath})`,
      );
    }

    await this.logProvisionEvent({
      type,
      platform,
      purpose,
      requestingService,
    });

    // Build platform-specific usage instructions
    const usageInstructions = this.buildProviderUsageInstructions(
      platform,
      envVar,
      apiKey,
      context,
    );

    return {
      success: true,
      credential: {
        type,
        value: apiKey,
        platform,
        purpose,
        provider: platform,
      },
      usage_instructions: usageInstructions,
      metadata: {
        provisioned_by: "ChittyConnect Dynamic",
        description,
        onePasswordPath,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Build platform-specific usage instructions for integration API keys
   *
   * @private
   * @param {string} platform - Platform name (neon, openai, etc.)
   * @param {string} envVar - Environment variable name
   * @param {string} apiKey - The API key value
   * @param {object} context - Request context
   * @returns {object} Usage instructions
   */
  buildProviderUsageInstructions(platform, envVar, apiKey, context) {
    const base = {
      environment_variable: envVar,
      wrangler_command: `wrangler secret put ${envVar}`,
      github_secret_command: `gh secret set ${envVar}`,
    };

    // Platform-specific instructions
    const platformInstructions = {
      neon: {
        mcp_command: `claude mcp add neon -- npx -y @neondatabase/mcp-server-neon start "${apiKey}"`,
        note: "Use with Neon MCP server or direct Neon API access for database management.",
      },
      openai: {
        note: "Use with OpenAI SDK or direct API calls. Monitor usage to control costs.",
        sdk_example: `import OpenAI from 'openai'; const client = new OpenAI({ apiKey: env.${envVar} });`,
      },
      anthropic: {
        note: "Use with Anthropic SDK or direct API calls for Claude models.",
        sdk_example: `import Anthropic from '@anthropic-ai/sdk'; const client = new Anthropic({ apiKey: env.${envVar} });`,
      },
      notion: {
        note: "Use with Notion SDK or MCP server for workspace access.",
        mcp_command: `claude mcp add notion -- npx -y @notionhq/client`,
      },
      github: {
        note: "Use with GitHub CLI, Octokit SDK, or direct API calls.",
        cli_command: `gh auth login --with-token <<< "${apiKey}"`,
      },
      stripe: {
        note: `Use with Stripe SDK. Mode: ${context.mode || "test"}`,
        sdk_example: `import Stripe from 'stripe'; const stripe = new Stripe(env.${envVar});`,
      },
    };

    return {
      ...base,
      ...(platformInstructions[platform] || {
        note: `API key for ${platform}`,
      }),
    };
  }

  /**
   * Helper: Create scoped service token via ChittyAuth
   *
   * @private
   */
  async createScopedServiceToken(parentToken, scopes, context) {
    const requestedScopes = Array.isArray(scopes) ? scopes : [];

    const response = await fetch(
      "https://auth.chitty.cc/api/v1/tokens/derivative",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${parentToken}`,
          "Content-Type": "application/json",
          "User-Agent": "ChittyConnect/2.2.0",
        },
        body: JSON.stringify({
          scopes: requestedScopes,
          ttl: context.ttl || 3600,
          source: context.source || "chittyconnect",
          purpose: context.purpose || "inter-service-call",
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `ChittyAuth derivative token failed (${response.status}): ${error}`,
      );
    }

    const data = await response.json();
    return {
      value: data.token,
      expires_at: data.expires_at,
      scopes: data.scopes || requestedScopes,
    };
  }

  /**
   * Helper: Create GitHub installation token
   *
   * @private
   */
  async createGitHubInstallationToken(
    appId,
    privateKey,
    repository,
    permissions,
  ) {
    const { generateAppJWT, getInstallationToken } = await import(
      "../auth/github.js"
    );

    // Generate App JWT
    const appJwt = await generateAppJWT(appId, privateKey);

    // Find installation for the repository
    const installationsResponse = await fetch(
      "https://api.github.com/app/installations",
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ChittyConnect/2.2.0",
        },
      },
    );

    if (!installationsResponse.ok) {
      throw new Error(
        `Failed to list installations (${installationsResponse.status})`,
      );
    }

    const installations = await installationsResponse.json();
    const repoOwner = repository.split("/")[0]?.toLowerCase();
    const installation = installations.find(
      (i) => i.account?.login?.toLowerCase() === repoOwner,
    );

    if (!installation) {
      throw new Error(`No GitHub App installation found for ${repository}`);
    }

    // Create scoped installation token
    const response = await fetch(
      `https://api.github.com/app/installations/${installation.id}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ChittyConnect/2.2.0",
        },
        body: JSON.stringify({
          repositories: [repository.split("/")[1]],
          permissions: permissions || { contents: "read", metadata: "read" },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `GitHub installation token failed (${response.status}): ${error}`,
      );
    }

    const data = await response.json();
    return {
      value: data.token,
      expires_at: data.expires_at,
      permissions: data.permissions,
      repositories: data.repositories,
    };
  }

  /**
   * Get usage instructions for credential type
   *
   * @private
   */
  getUsageInstructions(type, value) {
    const instructions = {
      cloudflare_workers_deploy: {
        github_secret_name: "CLOUDFLARE_API_TOKEN",
        command: `gh secret set CLOUDFLARE_API_TOKEN --body "${value}"`,
        wrangler_command: `wrangler secret put CLOUDFLARE_API_TOKEN`,
        note: "Token has Workers Scripts Write, KV Write, and Account Settings Read permissions",
      },
      cloudflare_workers_read: {
        note: "Read-only token for Workers Scripts and Account Settings",
      },
      cloudflare_r2_access: {
        note: "Token has R2 Storage Write and Account Settings Read permissions",
      },
      cloudflare_d1_access: {
        note: "Token has D1 Database Write and Account Settings Read permissions",
      },
    };

    return instructions[type] || { note: `Token for ${type}` };
  }

  /**
   * Log provision event to audit trail
   *
   * @private
   */
  async logProvisionEvent(event) {
    try {
      // Log to ChittyChronicle
      const chronicleUrl = this.env.CHITTYCHRONICLE_SERVICE_URL;
      if (!chronicleUrl) throw new Error("CHITTYCHRONICLE_SERVICE_URL not configured");
      const chronicleResponse = await fetch(
        `${chronicleUrl}/api/entries`,
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
              provider: this.broker?.type || "unknown",
              enhanced: true,
            },
          }),
        },
      );

      if (!chronicleResponse.ok) {
        console.warn(
          "[EnhancedCredentialProvisioner] Failed to log to ChittyChronicle:",
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
          event.service ||
            event.target_service ||
            event.repository ||
            event.database ||
            "N/A",
          event.purpose || null,
          event.requestingService,
          event.tokenId || null,
          event.expiresAt || null,
        )
        .run();

      console.log(
        `[EnhancedCredentialProvisioner] Logged provision event: ${event.type}`,
      );
    } catch (error) {
      console.error(
        "[EnhancedCredentialProvisioner] Failed to log provision event:",
        error,
      );
      // Don't throw - logging failure shouldn't break provisioning
    }
  }

  /**
   * Check rate limit for credential provisioning
   * Uses KV for rate limiting across Worker instances
   *
   * @private
   */
  async checkRateLimit(requestingService) {
    const rateLimitKey = `provision:${requestingService}:${Math.floor(Date.now() / 3600000)}`;
    const currentCount = parseInt(
      (await this.env.RATE_LIMIT.get(rateLimitKey)) || "0",
    );
    const maxPerHour = 10;

    if (currentCount >= maxPerHour) {
      console.warn(
        `[EnhancedCredentialProvisioner] Rate limit exceeded for ${requestingService}: ${currentCount}/${maxPerHour}`,
      );
      throw new Error(`Rate limit exceeded for ${requestingService}`);
    }

    // Increment count
    await this.env.RATE_LIMIT.put(rateLimitKey, (currentCount + 1).toString(), {
      expirationTtl: 3600,
    });

    return true;
  }

  /**
   * Validate provision request
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
    const typeConfig = this.credentialTypes[type];
    if (typeConfig?.requiresContext) {
      for (const field of typeConfig.requiresContext) {
        if (!context[field]) {
          throw new Error(`${field} is required in context for ${type}`);
        }
      }
    }
  }
}
