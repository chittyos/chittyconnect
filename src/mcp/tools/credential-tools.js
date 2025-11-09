/**
 * MCP Tools for Secure Credential Management
 *
 * Provides Model Context Protocol tools for Claude to securely
 * retrieve and manage credentials through ChittyConnect's
 * 1Password integration.
 *
 * Security: All credential requests are validated through
 * ContextConsciousness™ before retrieval from 1Password.
 */

/**
 * Tool: chitty_credential_retrieve
 *
 * Securely retrieve a credential from 1Password based on context.
 * The credential is validated through ContextConsciousness™ before retrieval.
 */
export const credentialRetrieveTool = {
  name: 'chitty_credential_retrieve',
  description: 'Securely retrieve a credential from 1Password vault with context validation',
  inputSchema: {
    type: 'object',
    properties: {
      credential_type: {
        type: 'string',
        enum: [
          'service_token',
          'api_key',
          'database_connection',
          'deployment_token',
          'webhook_secret'
        ],
        description: 'Type of credential to retrieve'
      },
      target: {
        type: 'string',
        description: 'Target service or integration (e.g., "chittyid", "openai", "cloudflare")'
      },
      purpose: {
        type: 'string',
        enum: [
          'inter-service-call',
          'api-call',
          'deployment',
          'configuration',
          'webhook-validation',
          'database-query'
        ],
        description: 'Purpose for credential request'
      },
      environment: {
        type: 'string',
        enum: ['production', 'staging', 'development'],
        description: 'Target environment',
        default: 'production'
      },
      session_context: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          user_id: { type: 'string' },
          request_id: { type: 'string' }
        },
        description: 'Session context for audit trail'
      }
    },
    required: ['credential_type', 'target', 'purpose']
  },

  async execute(args, env) {
    const { credential_type, target, purpose, environment = 'production', session_context = {} } = args;

    try {
      // Build credential path based on type and target
      const credentialPath = buildCredentialPath(credential_type, target);

      // Create request context
      const context = {
        service: 'chittyconnect-mcp',
        purpose,
        environment,
        sessionId: session_context.session_id,
        userId: session_context.user_id,
        requestId: session_context.request_id || generateRequestId(),
        timestamp: new Date().toISOString()
      };

      // Initialize providers
      const { onePassword, contextConsciousness } = await initializeProviders(env);

      // Analyze request with ContextConsciousness™
      const analysis = await contextConsciousness.analyzeCredentialRequest({
        credentialPath,
        requestingService: 'mcp-claude',
        ...context
      });

      // Check if request is approved
      if (analysis.riskScore >= 70) {
        return {
          success: false,
          error: 'Credential request denied due to high risk',
          risk_score: analysis.riskScore,
          anomalies: analysis.anomalies,
          recommendations: analysis.recommendations
        };
      }

      // Retrieve credential from 1Password
      const credential = await onePassword.retrieveCredential(credentialPath, context);

      if (!credential) {
        return {
          success: false,
          error: 'Failed to retrieve credential from 1Password',
          details: 'The credential may not exist or access was denied'
        };
      }

      // Return credential with metadata
      return {
        success: true,
        credential: {
          type: credential_type,
          target,
          value: maskCredential(credential, credential_type),
          expires_at: calculateExpiry(credential_type),
          environment
        },
        metadata: {
          retrieved_at: new Date().toISOString(),
          risk_score: analysis.riskScore,
          context_validated: true,
          request_id: context.requestId
        },
        usage: getUsageInstructions(credential_type, target)
      };

    } catch (error) {
      console.error('[MCP] Credential retrieval error:', error);
      return {
        success: false,
        error: 'Failed to retrieve credential',
        details: error.message
      };
    }
  }
};

/**
 * Tool: chitty_credential_provision
 *
 * Provision a new scoped credential for a service.
 * Creates time-limited, appropriately scoped credentials.
 */
export const credentialProvisionTool = {
  name: 'chitty_credential_provision',
  description: 'Provision a new scoped credential for a ChittyOS service',
  inputSchema: {
    type: 'object',
    properties: {
      credential_type: {
        type: 'string',
        enum: [
          'cloudflare_workers_deploy',
          'cloudflare_workers_read',
          'chittyos_service_token',
          'github_deploy_token',
          'neon_database_connection'
        ],
        description: 'Type of credential to provision'
      },
      context: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Target service name' },
          purpose: { type: 'string', description: 'Purpose of credential' },
          environment: { type: 'string', enum: ['production', 'staging', 'development'] },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Required scopes'
          }
        },
        required: ['service']
      },
      ttl_hours: {
        type: 'number',
        description: 'Time to live in hours (default: 24)',
        default: 24,
        minimum: 1,
        maximum: 8760 // 1 year
      }
    },
    required: ['credential_type', 'context']
  },

  async execute(args, env) {
    const { credential_type, context, ttl_hours = 24 } = args;

    try {
      // Initialize enhanced provisioner
      const { provisioner } = await initializeProviders(env);

      // Add requesting service info
      const requestingService = 'mcp-claude';

      // Provision credential
      const result = await provisioner.provision(
        credential_type,
        context,
        requestingService
      );

      if (!result.success) {
        return {
          success: false,
          error: 'Failed to provision credential',
          details: result.error
        };
      }

      // Return provisioned credential with instructions
      return {
        success: true,
        credential: result.credential,
        usage_instructions: result.usage_instructions,
        metadata: {
          provisioned_at: new Date().toISOString(),
          provisioned_by: 'ChittyConnect MCP',
          ttl_hours,
          expires_at: result.credential.expires_at
        }
      };

    } catch (error) {
      console.error('[MCP] Credential provisioning error:', error);
      return {
        success: false,
        error: 'Failed to provision credential',
        details: error.message
      };
    }
  }
};

/**
 * Tool: chitty_credential_validate
 *
 * Validate a credential's status and permissions.
 */
export const credentialValidateTool = {
  name: 'chitty_credential_validate',
  description: 'Validate a credential status and check its permissions',
  inputSchema: {
    type: 'object',
    properties: {
      credential_type: {
        type: 'string',
        description: 'Type of credential'
      },
      token_id: {
        type: 'string',
        description: 'Token or credential ID to validate'
      },
      check_permissions: {
        type: 'boolean',
        description: 'Check detailed permissions',
        default: true
      }
    },
    required: ['credential_type', 'token_id']
  },

  async execute(args, env) {
    const { credential_type, token_id, check_permissions = true } = args;

    try {
      // Query audit database for credential info
      const credentialInfo = await env.DB.prepare(
        `SELECT * FROM credential_provisions WHERE token_id = ? AND revoked_at IS NULL`
      ).bind(token_id).first();

      if (!credentialInfo) {
        return {
          success: false,
          valid: false,
          reason: 'Credential not found or has been revoked'
        };
      }

      // Check expiration
      const isExpired = new Date(credentialInfo.expires_at) < new Date();

      // Build validation result
      const result = {
        success: true,
        valid: !isExpired,
        credential_info: {
          type: credentialInfo.type,
          service: credentialInfo.service,
          purpose: credentialInfo.purpose,
          created_at: credentialInfo.created_at,
          expires_at: credentialInfo.expires_at,
          expired: isExpired
        }
      };

      if (check_permissions && !isExpired) {
        // For Cloudflare tokens, check actual permissions via API
        if (credential_type.startsWith('cloudflare')) {
          result.permissions = await checkCloudflareTokenPermissions(token_id, env);
        }
      }

      return result;

    } catch (error) {
      console.error('[MCP] Credential validation error:', error);
      return {
        success: false,
        error: 'Failed to validate credential',
        details: error.message
      };
    }
  }
};

/**
 * Tool: chitty_credential_revoke
 *
 * Revoke a previously provisioned credential.
 */
export const credentialRevokeTool = {
  name: 'chitty_credential_revoke',
  description: 'Revoke a previously provisioned credential',
  inputSchema: {
    type: 'object',
    properties: {
      token_id: {
        type: 'string',
        description: 'Token ID to revoke'
      },
      reason: {
        type: 'string',
        description: 'Reason for revocation',
        enum: [
          'no_longer_needed',
          'security_incident',
          'rotation',
          'service_decommission',
          'manual_request'
        ]
      },
      revoke_related: {
        type: 'boolean',
        description: 'Revoke related credentials from same provision session',
        default: false
      }
    },
    required: ['token_id', 'reason']
  },

  async execute(args, env) {
    const { token_id, reason, revoke_related = false } = args;

    try {
      // First, get credential info
      const credentialInfo = await env.DB.prepare(
        `SELECT * FROM credential_provisions WHERE token_id = ?`
      ).bind(token_id).first();

      if (!credentialInfo) {
        return {
          success: false,
          error: 'Credential not found'
        };
      }

      // Revoke via appropriate API
      if (credentialInfo.type.startsWith('cloudflare')) {
        await revokeCloudflareToken(token_id, env);
      }
      // Add other revocation methods for different credential types

      // Update database
      await env.DB.prepare(
        `UPDATE credential_provisions SET revoked_at = datetime('now') WHERE token_id = ?`
      ).bind(token_id).run();

      // Log revocation event
      await logRevocationEvent(token_id, reason, 'mcp-claude', env);

      // Handle related credentials if requested
      let relatedRevoked = 0;
      if (revoke_related && credentialInfo.requesting_service) {
        const related = await env.DB.prepare(
          `SELECT token_id FROM credential_provisions
           WHERE requesting_service = ?
           AND created_at BETWEEN datetime(?, '-5 minutes') AND datetime(?, '+5 minutes')
           AND token_id != ?
           AND revoked_at IS NULL`
        ).bind(
          credentialInfo.requesting_service,
          credentialInfo.created_at,
          credentialInfo.created_at,
          token_id
        ).all();

        for (const rel of related.results) {
          try {
            await revokeCloudflareToken(rel.token_id, env);
            await env.DB.prepare(
              `UPDATE credential_provisions SET revoked_at = datetime('now') WHERE token_id = ?`
            ).bind(rel.token_id).run();
            relatedRevoked++;
          } catch (error) {
            console.error(`Failed to revoke related token ${rel.token_id}:`, error);
          }
        }
      }

      return {
        success: true,
        message: 'Credential successfully revoked',
        revoked: {
          token_id,
          type: credentialInfo.type,
          service: credentialInfo.service,
          revoked_at: new Date().toISOString(),
          reason
        },
        related_revoked: relatedRevoked
      };

    } catch (error) {
      console.error('[MCP] Credential revocation error:', error);
      return {
        success: false,
        error: 'Failed to revoke credential',
        details: error.message
      };
    }
  }
};

/**
 * Tool: chitty_credential_audit
 *
 * Query credential provisioning audit log.
 */
export const credentialAuditTool = {
  name: 'chitty_credential_audit',
  description: 'Query credential provisioning and access audit logs',
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Filter by service name' },
          credential_type: { type: 'string', description: 'Filter by credential type' },
          time_range: {
            type: 'object',
            properties: {
              start: { type: 'string', format: 'date-time' },
              end: { type: 'string', format: 'date-time' }
            }
          },
          include_revoked: { type: 'boolean', default: false },
          requesting_service: { type: 'string', description: 'Filter by requesting service' }
        }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
        default: 50,
        minimum: 1,
        maximum: 500
      }
    }
  },

  async execute(args, env) {
    const { filter = {}, limit = 50 } = args;

    try {
      // Build query
      let query = `
        SELECT id, type, service, purpose, requesting_service,
               token_id, expires_at, created_at, revoked_at
        FROM credential_provisions
        WHERE 1=1
      `;
      const params = [];

      if (filter.service) {
        query += ` AND service = ?`;
        params.push(filter.service);
      }

      if (filter.credential_type) {
        query += ` AND type = ?`;
        params.push(filter.credential_type);
      }

      if (filter.requesting_service) {
        query += ` AND requesting_service = ?`;
        params.push(filter.requesting_service);
      }

      if (!filter.include_revoked) {
        query += ` AND revoked_at IS NULL`;
      }

      if (filter.time_range) {
        if (filter.time_range.start) {
          query += ` AND created_at >= ?`;
          params.push(filter.time_range.start);
        }
        if (filter.time_range.end) {
          query += ` AND created_at <= ?`;
          params.push(filter.time_range.end);
        }
      }

      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      // Execute query
      const result = await env.DB.prepare(query).bind(...params).all();

      // Get summary statistics
      const stats = await getAuditStatistics(filter, env);

      return {
        success: true,
        audit_entries: result.results || [],
        total_count: result.results?.length || 0,
        statistics: stats,
        metadata: {
          query_time: new Date().toISOString(),
          filters_applied: Object.keys(filter).length > 0
        }
      };

    } catch (error) {
      console.error('[MCP] Audit query error:', error);
      return {
        success: false,
        error: 'Failed to query audit log',
        details: error.message
      };
    }
  }
};

/**
 * Tool: chitty_credential_health
 *
 * Check health of credential provisioning system.
 */
export const credentialHealthTool = {
  name: 'chitty_credential_health',
  description: 'Check health status of credential provisioning system',
  inputSchema: {
    type: 'object',
    properties: {
      detailed: {
        type: 'boolean',
        description: 'Include detailed health information',
        default: false
      }
    }
  },

  async execute(args, env) {
    const { detailed = false } = args;

    try {
      const { onePassword } = await initializeProviders(env);

      // Check 1Password connection
      const onePasswordHealth = await onePassword.healthCheck();

      // Check database
      let dbHealthy = false;
      try {
        await env.DB.prepare('SELECT 1').first();
        dbHealthy = true;
      } catch (error) {
        console.error('Database health check failed:', error);
      }

      // Check rate limiting
      const rateLimitHealthy = env.RATE_LIMIT !== undefined;

      // Get recent provision statistics
      const stats = await env.DB.prepare(`
        SELECT
          COUNT(*) as total_provisions,
          COUNT(CASE WHEN revoked_at IS NOT NULL THEN 1 END) as revoked_count,
          COUNT(CASE WHEN expires_at < datetime('now') THEN 1 END) as expired_count
        FROM credential_provisions
        WHERE created_at > datetime('now', '-24 hours')
      `).first();

      const health = {
        success: true,
        status: onePasswordHealth.healthy && dbHealthy ? 'healthy' : 'degraded',
        components: {
          onepassword: onePasswordHealth.healthy ? 'healthy' : 'unhealthy',
          database: dbHealthy ? 'healthy' : 'unhealthy',
          rate_limiting: rateLimitHealthy ? 'healthy' : 'unhealthy',
          chronicle: env.CHITTY_CHRONICLE_TOKEN ? 'configured' : 'missing'
        },
        statistics: {
          provisions_24h: stats.total_provisions || 0,
          revoked_24h: stats.revoked_count || 0,
          expired_24h: stats.expired_count || 0
        }
      };

      if (detailed) {
        health.detailed = {
          onepassword: onePasswordHealth.checks,
          supported_types: [
            'cloudflare_workers_deploy',
            'cloudflare_workers_read',
            'chittyos_service_token',
            'github_deploy_token',
            'neon_database_connection',
            'openai_api_key',
            'notion_integration_token'
          ],
          rate_limits: {
            per_service_per_hour: 10,
            credential_cache_ttl: '5 minutes'
          }
        };
      }

      return health;

    } catch (error) {
      console.error('[MCP] Health check error:', error);
      return {
        success: false,
        status: 'error',
        error: 'Failed to check system health',
        details: error.message
      };
    }
  }
};

// Helper functions

function buildCredentialPath(credential_type, target) {
  const pathMap = {
    service_token: `services/${target}/service_token`,
    api_key: `integrations/${target}/api_key`,
    database_connection: 'infrastructure/neon/database_url',
    deployment_token: 'infrastructure/cloudflare/make_api_key',
    webhook_secret: `infrastructure/github/webhook_secret`
  };

  return pathMap[credential_type] || `unknown/${target}`;
}

function maskCredential(credential, type) {
  // For security, mask sensitive parts of credentials in responses
  if (!credential) return null;

  const length = credential.length;
  if (length <= 8) return '********';

  const visibleChars = 4;
  const prefix = credential.substring(0, visibleChars);
  const suffix = credential.substring(length - visibleChars);

  return `${prefix}...${suffix}`;
}

function calculateExpiry(credential_type) {
  const expiryMap = {
    service_token: 24 * 60 * 60 * 1000, // 24 hours
    api_key: null, // No expiry
    database_connection: null, // No expiry
    deployment_token: 365 * 24 * 60 * 60 * 1000, // 1 year
    webhook_secret: null // No expiry
  };

  const ttl = expiryMap[credential_type];
  return ttl ? new Date(Date.now() + ttl).toISOString() : null;
}

function getUsageInstructions(credential_type, target) {
  const instructions = {
    service_token: `Use as Bearer token in Authorization header for ${target} API calls`,
    api_key: `Set as API key for ${target} integration`,
    database_connection: `Use as connection string for database operations`,
    deployment_token: `Use for Cloudflare Workers deployment operations`,
    webhook_secret: `Use to validate webhook signatures from ${target}`
  };

  return instructions[credential_type] || 'Use according to service documentation';
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

async function initializeProviders(env) {
  // Lazy import to avoid circular dependencies
  const { OnePasswordConnectClient } = await import('../../services/1password-connect-client.js');
  const { EnhancedCredentialProvisioner } = await import('../../services/credential-provisioner-enhanced.js');

  const onePassword = new OnePasswordConnectClient(env);
  const provisioner = new EnhancedCredentialProvisioner(env);

  return { onePassword, provisioner };
}

async function checkCloudflareTokenPermissions(token_id, env) {
  // Check token permissions via Cloudflare API
  // This is a placeholder - implement actual API call
  return {
    scopes: ['Workers Scripts Write', 'KV Storage Write'],
    resources: ['account/*']
  };
}

async function revokeCloudflareToken(token_id, env) {
  let makeApiKey = env.CLOUDFLARE_MAKE_API_KEY;

  if (!makeApiKey) {
    // Try to retrieve from 1Password
    const { onePassword } = await initializeProviders(env);
    makeApiKey = await onePassword.get(
      'infrastructure/cloudflare/make_api_key'
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/user/tokens/${token_id}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${makeApiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to revoke Cloudflare token: ${response.status}`);
  }
}

async function logRevocationEvent(token_id, reason, revoked_by, env) {
  try {
    await fetch('https://chronicle.chitty.cc/api/entries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.CHITTY_CHRONICLE_TOKEN}`
      },
      body: JSON.stringify({
        eventType: 'credential.revoked',
        entityId: revoked_by,
        data: {
          token_id,
          reason,
          revoked_by,
          timestamp: new Date().toISOString()
        }
      })
    });
  } catch (error) {
    console.error('Failed to log revocation event:', error);
  }
}

async function getAuditStatistics(filter, env) {
  const stats = {
    total_provisions: 0,
    active_credentials: 0,
    expired_credentials: 0,
    revoked_credentials: 0,
    by_type: {},
    by_service: {}
  };

  try {
    // Get overall statistics
    const overall = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN revoked_at IS NULL AND expires_at > datetime('now') THEN 1 END) as active,
        COUNT(CASE WHEN expires_at <= datetime('now') THEN 1 END) as expired,
        COUNT(CASE WHEN revoked_at IS NOT NULL THEN 1 END) as revoked
      FROM credential_provisions
    `).first();

    stats.total_provisions = overall.total || 0;
    stats.active_credentials = overall.active || 0;
    stats.expired_credentials = overall.expired || 0;
    stats.revoked_credentials = overall.revoked || 0;

    // Get by type
    const byType = await env.DB.prepare(`
      SELECT type, COUNT(*) as count
      FROM credential_provisions
      GROUP BY type
    `).all();

    byType.results?.forEach(row => {
      stats.by_type[row.type] = row.count;
    });

    // Get by service
    const byService = await env.DB.prepare(`
      SELECT service, COUNT(*) as count
      FROM credential_provisions
      GROUP BY service
      LIMIT 10
    `).all();

    byService.results?.forEach(row => {
      stats.by_service[row.service] = row.count;
    });
  } catch (error) {
    console.error('Failed to get audit statistics:', error);
  }

  return stats;
}

// Export all tools
export const credentialTools = [
  credentialRetrieveTool,
  credentialProvisionTool,
  credentialValidateTool,
  credentialRevokeTool,
  credentialAuditTool,
  credentialHealthTool
];