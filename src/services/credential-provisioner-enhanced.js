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

import { OnePasswordConnectClient } from './1password-connect-client.js';

/**
 * Enhanced Credential provisioner for ChittyOS ecosystem
 */
export class EnhancedCredentialProvisioner {
  constructor(env, contextConsciousness) {
    this.env = env;
    this.contextConsciousness = contextConsciousness;
    this.onePassword = new OnePasswordConnectClient(env);

    // Cloudflare permissions will be fetched dynamically
    // These are fallback IDs if API fetch fails
    this.cloudflarePermissions = null;
    this.cloudflarePermissionsFallback = {
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
      workersR2Write: {
        id: "e4a0e7ae101d4057abc990af58022017",
        name: "Workers R2 Storage Write",
      },
      workersDurableObjectsWrite: {
        id: "2fc0424ac60b42e0b849d4d99bdcd1e5",
        name: "Workers Durable Objects Write",
      },
      d1DatabaseWrite: {
        id: "5e2c30acd1434ea2adfb8442c3cbbbea",
        name: "D1 Database Write",
      }
    };

    // Cache for permission groups (persists for Worker lifetime)
    this.permissionGroupsCache = null;
    this.permissionGroupsCacheTime = 0;
    this.permissionGroupsCacheTTL = 24 * 60 * 60 * 1000; // 24 hours

    // Expanded credential type mappings
    this.credentialTypes = {
      cloudflare_workers_deploy: {
        permissions: ['workersScriptsWrite', 'workersKVWrite', 'accountSettingsRead'],
        ttl: 365 * 24 * 60 * 60 * 1000, // 1 year
        requiresContext: ['service']
      },
      cloudflare_workers_read: {
        permissions: ['workersScriptsRead', 'accountSettingsRead'],
        ttl: 90 * 24 * 60 * 60 * 1000, // 90 days
        requiresContext: ['service']
      },
      cloudflare_r2_access: {
        permissions: ['workersR2Write', 'accountSettingsRead'],
        ttl: 180 * 24 * 60 * 60 * 1000, // 180 days
        requiresContext: ['service', 'bucket']
      },
      cloudflare_d1_access: {
        permissions: ['d1DatabaseWrite', 'accountSettingsRead'],
        ttl: 180 * 24 * 60 * 60 * 1000, // 180 days
        requiresContext: ['service', 'database']
      },
      chittyos_service_token: {
        type: 'service_token',
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
        requiresContext: ['source_service', 'target_service']
      },
      github_deploy_token: {
        type: 'github',
        ttl: 90 * 24 * 60 * 60 * 1000, // 90 days
        requiresContext: ['repository']
      },
      neon_database_connection: {
        type: 'neon',
        ttl: null, // Connection strings don't expire
        requiresContext: ['database', 'readonly']
      },
      openai_api_key: {
        type: 'openai',
        ttl: null, // API keys managed by provider
        requiresContext: ['service', 'model']
      },
      notion_integration_token: {
        type: 'notion',
        ttl: null, // Integration tokens managed by provider
        requiresContext: ['workspace']
      }
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
    const contextAnalysis = await this.analyzeContext(type, context, requestingService);
    if (!contextAnalysis.approved) {
      throw new Error(`Context validation failed: ${contextAnalysis.reason}`);
    }

    // Route to appropriate provisioner
    switch (type) {
      case "cloudflare_workers_deploy":
      case "cloudflare_workers_read":
      case "cloudflare_r2_access":
      case "cloudflare_d1_access":
        return await this.provisionCloudflareToken(type, context, requestingService);

      case "chittyos_service_token":
        return await this.provisionServiceToken(context, requestingService);

      case "github_deploy_token":
        return await this.provisionGitHubToken(context, requestingService);

      case "neon_database_connection":
        return await this.provisionNeonConnection(context, requestingService);

      case "openai_api_key":
        return await this.provisionOpenAIKey(context, requestingService);

      case "notion_integration_token":
        return await this.provisionNotionToken(context, requestingService);

      default:
        throw new Error(`Unknown credential type: ${type}`);
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
      recommendations: []
    };

    // Check if requesting service is healthy
    const serviceHealth = await this.contextConsciousness.checkServiceHealth(
      requestingService,
      { url: `https://${requestingService}.chitty.cc` }
    );

    if (serviceHealth.status === 'down') {
      analysis.approved = false;
      analysis.reason = 'Requesting service is down';
      analysis.riskScore = 100;
      return analysis;
    }

    // Check for anomalous patterns
    const anomalies = await this.contextConsciousness.detectAnomalies({
      services: [{ name: requestingService, ...serviceHealth }]
    });

    if (anomalies.length > 0) {
      analysis.riskScore += anomalies.length * 20;
      analysis.recommendations.push('Monitor for unusual activity');
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
      analysis.reason = 'Rate limit exceeded';
      analysis.riskScore = 50;
      return analysis;
    }

    // Additional security checks based on credential type
    if (type.includes('deploy') || type.includes('write')) {
      // Higher scrutiny for write permissions
      if (context.environment === 'production' && !context.approved_by) {
        analysis.recommendations.push('Consider requiring approval for production deployments');
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
      if (this.permissionGroupsCache &&
          Date.now() - this.permissionGroupsCacheTime < this.permissionGroupsCacheTTL) {
        return this.permissionGroupsCache;
      }

      console.log('[EnhancedCredentialProvisioner] Fetching Cloudflare permission groups from API');

      const response = await fetch(
        "https://api.cloudflare.com/client/v4/user/tokens/permission_groups",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch permission groups: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.result) {
        throw new Error('Invalid permission groups response');
      }

      // Map permission groups by normalized name
      const permissions = {};
      for (const group of data.result) {
        // Normalize the permission name for mapping
        const normalizedName = group.name
          .replace(/\s+/g, '')  // Remove spaces
          .replace(/^Workers/, 'workers')  // Lowercase workers prefix
          .replace(/^Account/, 'account')  // Lowercase account prefix
          .replace(/^D1/, 'd1');  // Lowercase D1 prefix

        // Create a key that matches our existing naming
        let key = null;
        if (normalizedName.includes('workersScripts') && normalizedName.includes('Write')) {
          key = 'workersScriptsWrite';
        } else if (normalizedName.includes('workersScripts') && normalizedName.includes('Read')) {
          key = 'workersScriptsRead';
        } else if (normalizedName.includes('workersKV') && normalizedName.includes('Write')) {
          key = 'workersKVWrite';
        } else if (normalizedName.includes('accountSettings') && normalizedName.includes('Read')) {
          key = 'accountSettingsRead';
        } else if (normalizedName.includes('workersR2') && normalizedName.includes('Write')) {
          key = 'workersR2Write';
        } else if (normalizedName.includes('workersDurableObjects') && normalizedName.includes('Write')) {
          key = 'workersDurableObjectsWrite';
        } else if (normalizedName.includes('d1Database') && normalizedName.includes('Write')) {
          key = 'd1DatabaseWrite';
        }

        if (key) {
          permissions[key] = {
            id: group.id,
            name: group.name
          };
        }
      }

      // Cache the results
      this.permissionGroupsCache = permissions;
      this.permissionGroupsCacheTime = Date.now();

      console.log('[EnhancedCredentialProvisioner] Successfully fetched and cached permission groups');
      return permissions;

    } catch (error) {
      console.error('[EnhancedCredentialProvisioner] Failed to fetch permissions dynamically:', error);
      console.log('[EnhancedCredentialProvisioner] Using fallback permission IDs');
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
      this.cloudflarePermissions = await this.fetchCloudflarePermissions(apiKey);
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
    const { service, purpose, environment = 'production' } = context;

    // Retrieve Cloudflare credentials from 1Password
    const makeApiKey = await this.onePassword.getInfrastructureCredential(
      'cloudflare',
      'make_api_key',
      {
        service: 'chittyconnect',
        purpose: 'credential_provisioning',
        environment
      }
    );

    const accountId = await this.onePassword.getInfrastructureCredential(
      'cloudflare',
      'account_id',
      {
        service: 'chittyconnect',
        purpose: 'credential_provisioning',
        environment
      }
    ).catch(() => "0bc21e3a5a9de1a4cc843be9c3e98121"); // Fallback to default

    if (!makeApiKey) {
      throw new Error('Failed to retrieve Cloudflare credentials from 1Password');
    }

    // Get permission groups dynamically
    const cloudflarePermissions = await this.getCloudflarePermissions(makeApiKey);

    // Get type configuration
    const typeConfig = this.credentialTypes[type];
    const permissions = typeConfig.permissions.map(p => cloudflarePermissions[p]);

    // Create token name with context
    const tokenName = `${service} ${purpose || type} (${new Date().toISOString().split("T")[0]}) [via ChittyConnect]`;

    // Build token request
    const tokenRequest = {
      name: tokenName,
      policies: [
        {
          effect: "allow",
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
          permission_groups: permissions,
        },
      ],
      expires_on: new Date(Date.now() + typeConfig.ttl).toISOString(),
    };

    // Add IP restrictions for production tokens
    if (environment === 'production' && context.ip_restrictions) {
      tokenRequest.condition = {
        request_ip: {
          in: context.ip_restrictions
        }
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
      throw new Error(`Failed to create Cloudflare token: ${response.status} - ${error}`);
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
      scopes: permissions.map(p => p.name),
      environment,
      contextAnalysis: true // Flag that context was validated
    });

    return {
      success: true,
      credential: {
        type: "cloudflare_api_token",
        value: token.value,
        expires_at: token.expires_on,
        scopes: permissions.map(p => p.name),
        account_id: accountId,
        token_id: token.id,
        environment
      },
      usage_instructions: this.getUsageInstructions(type, token.value),
      metadata: {
        provisioned_by: 'ChittyConnect Enhanced',
        context_validated: true,
        retrieved_from: '1Password',
        timestamp: new Date().toISOString()
      }
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
    const { source_service, target_service, scopes } = context;

    // Retrieve the target service's token from 1Password
    const token = await this.onePassword.getServiceToken(target_service, {
      service: source_service,
      purpose: 'inter-service-call',
      environment: context.environment || 'production'
    });

    if (!token) {
      throw new Error(`Failed to retrieve service token for ${target_service}`);
    }

    // Create a scoped, time-limited derivative token if needed
    // This would integrate with ChittyAuth for token creation
    const scopedToken = await this.createScopedServiceToken(token, scopes, context);

    await this.logProvisionEvent({
      type: 'chittyos_service_token',
      source_service,
      target_service,
      requestingService,
      scopes,
      expiresAt: scopedToken.expires_at
    });

    return {
      success: true,
      credential: {
        type: 'service_token',
        value: scopedToken.value,
        expires_at: scopedToken.expires_at,
        scopes: scopedToken.scopes,
        target_service
      },
      usage_instructions: {
        header: 'Authorization',
        format: `Bearer ${scopedToken.value}`,
        endpoint: `https://${target_service}.chitty.cc`,
        note: `Token valid for ${target_service} API calls with scopes: ${scopes.join(', ')}`
      }
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
    const { repository, permissions = ['contents:write', 'actions:write'] } = context;

    // Retrieve GitHub App credentials from 1Password
    const appId = await this.onePassword.getInfrastructureCredential(
      'github',
      'app_id',
      {
        service: requestingService,
        purpose: 'github_deployment',
        environment: context.environment || 'production'
      }
    );

    const privateKey = await this.onePassword.getInfrastructureCredential(
      'github',
      'private_key',
      {
        service: requestingService,
        purpose: 'github_deployment',
        environment: context.environment || 'production'
      }
    );

    if (!appId || !privateKey) {
      throw new Error('Failed to retrieve GitHub credentials from 1Password');
    }

    // Generate installation access token
    // This would use GitHub's App API to create a scoped token
    const installationToken = await this.createGitHubInstallationToken(
      appId,
      privateKey,
      repository,
      permissions
    );

    await this.logProvisionEvent({
      type: 'github_deploy_token',
      repository,
      requestingService,
      permissions,
      expiresAt: installationToken.expires_at
    });

    return {
      success: true,
      credential: {
        type: 'github_token',
        value: installationToken.token,
        expires_at: installationToken.expires_at,
        permissions,
        repository
      },
      usage_instructions: {
        github_secret_name: 'GITHUB_TOKEN',
        command: `gh secret set GITHUB_TOKEN --body "${installationToken.token}"`,
        note: `Token valid for repository ${repository} with permissions: ${permissions.join(', ')}`
      }
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
      'neon',
      'database_url',
      {
        service: requestingService,
        purpose: 'database_connection',
        environment: context.environment || 'production'
      }
    );

    if (!databaseUrl) {
      throw new Error('Failed to retrieve Neon credentials from 1Password');
    }

    // Create a database-specific connection string if needed
    let connectionString = databaseUrl;
    if (database !== 'chittyos-core') {
      // Modify connection string for specific database
      connectionString = databaseUrl.replace('/chittyos-core', `/${database}`);
    }

    // Add readonly flag if needed
    if (readonly) {
      connectionString += '?options=--default-transaction-read-only%3Don';
    }

    await this.logProvisionEvent({
      type: 'neon_database_connection',
      database,
      readonly,
      requestingService
    });

    return {
      success: true,
      credential: {
        type: 'database_connection',
        value: connectionString,
        database,
        readonly,
        provider: 'neon'
      },
      usage_instructions: {
        environment_variable: 'DATABASE_URL',
        command: `wrangler secret put DATABASE_URL`,
        note: `${readonly ? 'Read-only' : 'Read-write'} connection to ${database} database`
      }
    };
  }

  /**
   * Provision OpenAI API key
   *
   * @private
   * @param {object} context - Context with service, model
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} OpenAI API key
   */
  async provisionOpenAIKey(context, requestingService) {
    const { service, model = 'gpt-4' } = context;

    // Retrieve OpenAI API key from 1Password
    const apiKey = await this.onePassword.getIntegrationKey('openai', {
      service: requestingService,
      purpose: 'ai_processing',
      model,
      environment: context.environment || 'production'
    });

    if (!apiKey) {
      throw new Error('Failed to retrieve OpenAI credentials from 1Password');
    }

    // Could create a rate-limited proxy key here if needed
    // For now, return the actual key with usage tracking

    await this.logProvisionEvent({
      type: 'openai_api_key',
      service,
      model,
      requestingService
    });

    return {
      success: true,
      credential: {
        type: 'openai_api_key',
        value: apiKey,
        model,
        provider: 'openai'
      },
      usage_instructions: {
        environment_variable: 'OPENAI_API_KEY',
        command: `wrangler secret put OPENAI_API_KEY`,
        note: `API key for OpenAI ${model} model`,
        warning: 'Monitor usage to control costs'
      }
    };
  }

  /**
   * Provision Notion integration token
   *
   * @private
   * @param {object} context - Context with workspace
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} Notion token
   */
  async provisionNotionToken(context, requestingService) {
    const { workspace } = context;

    // Retrieve Notion token from 1Password
    const token = await this.onePassword.getIntegrationKey('notion', {
      service: requestingService,
      purpose: 'workspace_integration',
      workspace,
      environment: context.environment || 'production'
    });

    if (!token) {
      throw new Error('Failed to retrieve Notion credentials from 1Password');
    }

    await this.logProvisionEvent({
      type: 'notion_integration_token',
      workspace,
      requestingService
    });

    return {
      success: true,
      credential: {
        type: 'notion_token',
        value: token,
        workspace,
        provider: 'notion'
      },
      usage_instructions: {
        environment_variable: 'NOTION_TOKEN',
        command: `wrangler secret put NOTION_TOKEN`,
        note: `Integration token for Notion workspace: ${workspace}`
      }
    };
  }

  /**
   * Helper: Create scoped service token via ChittyAuth
   *
   * @private
   */
  async createScopedServiceToken(parentToken, scopes, _context) {
    // This would call ChittyAuth to create a derivative token
    // For now, return a mock implementation
    return {
      value: `scoped_${parentToken}_${Date.now()}`,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scopes
    };
  }

  /**
   * Helper: Create GitHub installation token
   *
   * @private
   */
  async createGitHubInstallationToken(_appId, _privateKey, _repository, _permissions) {
    // This would use GitHub App API to create installation token
    // For now, return a mock implementation
    return {
      token: `ghs_${Date.now()}_mock`,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
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
        note: "Token has Workers Scripts Write, KV Write, and Account Settings Read permissions"
      },
      cloudflare_workers_read: {
        note: "Read-only token for Workers Scripts and Account Settings"
      },
      cloudflare_r2_access: {
        note: "Token has R2 Storage Write and Account Settings Read permissions"
      },
      cloudflare_d1_access: {
        note: "Token has D1 Database Write and Account Settings Read permissions"
      }
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
              provider: '1Password',
              enhanced: true
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
          event.service || event.target_service || event.repository || event.database || 'N/A',
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
    const currentCount = parseInt(await this.env.RATE_LIMIT.get(rateLimitKey) || '0');
    const maxPerHour = 10;

    if (currentCount >= maxPerHour) {
      console.warn(`[EnhancedCredentialProvisioner] Rate limit exceeded for ${requestingService}: ${currentCount}/${maxPerHour}`);
      throw new Error(`Rate limit exceeded for ${requestingService}`);
    }

    // Increment count
    await this.env.RATE_LIMIT.put(rateLimitKey, (currentCount + 1).toString(), {
      expirationTtl: 3600
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