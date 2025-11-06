/**
 * Credential Provisioning Routes
 *
 * Secure credential management for ChittyOS ecosystem services.
 * Provisions appropriately scoped credentials from 1Password and
 * creates time-limited tokens for service-to-service operations.
 *
 * All routes require ChittyAuth authentication.
 */

import { Hono } from "hono";
import { CredentialProvisioner } from "../../services/credential-provisioner.js";

const credentialsRoutes = new Hono();

/**
 * POST /api/credentials/provision
 *
 * Provision a credential for a ChittyOS service
 *
 * Request body:
 * {
 *   "type": "cloudflare_workers_deploy",
 *   "context": {
 *     "service": "chittyregister",
 *     "purpose": "github_actions"
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "credential": {
 *     "type": "cloudflare_api_token",
 *     "value": "generated_token",
 *     "expires_at": "2026-11-06T00:00:00Z",
 *     "scopes": ["workers:write", "kv:write"],
 *     "account_id": "xxx"
 *   },
 *   "usage_instructions": {
 *     "github_secret_name": "CLOUDFLARE_API_TOKEN",
 *     "command": "gh secret set CLOUDFLARE_API_TOKEN"
 *   }
 * }
 */
credentialsRoutes.post("/provision", async (c) => {
  try {
    const { type, context } = await c.req.json();

    // Get requesting service from API key metadata
    const apiKeyInfo = c.get("apiKey");
    const requestingService =
      apiKeyInfo?.service || apiKeyInfo?.name || "unknown";

    // Initialize provisioner
    const provisioner = new CredentialProvisioner(c.env);

    // Validate request
    provisioner.validateRequest(type, context, requestingService);

    // Check rate limit
    await provisioner.checkRateLimit(requestingService);

    // Provision credential
    const result = await provisioner.provision(
      type,
      context,
      requestingService,
    );

    return c.json(result);
  } catch (error) {
    console.error("[Credentials] Provision error:", error);

    // Determine appropriate status code
    let status = 500;
    if (error.message.includes("Rate limit exceeded")) {
      status = 429;
    } else if (
      error.message.includes("required") ||
      error.message.includes("Unknown credential type")
    ) {
      status = 400;
    } else if (error.message.includes("not configured")) {
      status = 503; // Service unavailable
    }

    return c.json(
      {
        success: false,
        error: {
          code: "PROVISION_FAILED",
          message: error.message,
          details: error.stack,
        },
        metadata: {
          timestamp: new Date().toISOString(),
        },
      },
      status,
    );
  }
});

/**
 * GET /api/credentials/types
 *
 * List supported credential types
 *
 * Response:
 * {
 *   "success": true,
 *   "types": [
 *     {
 *       "type": "cloudflare_workers_deploy",
 *       "description": "Cloudflare Workers deployment token with write permissions",
 *       "required_context": ["service"],
 *       "optional_context": ["purpose"],
 *       "status": "available"
 *     },
 *     ...
 *   ]
 * }
 */
credentialsRoutes.get("/types", async (c) => {
  const types = [
    {
      type: "cloudflare_workers_deploy",
      description: "Cloudflare Workers deployment token with write permissions",
      required_context: ["service"],
      optional_context: ["purpose"],
      scopes: [
        "Workers Scripts Write",
        "Workers KV Storage Write",
        "Account Settings Read",
      ],
      ttl: "365 days",
      status: "available",
    },
    {
      type: "cloudflare_workers_read",
      description: "Read-only Cloudflare Workers token",
      required_context: ["service"],
      optional_context: ["purpose"],
      scopes: ["Workers Scripts Read", "Account Settings Read"],
      ttl: "90 days",
      status: "available",
    },
    {
      type: "github_deploy_token",
      description: "GitHub deployment token for Actions",
      required_context: ["repository"],
      optional_context: ["purpose"],
      status: "planned",
    },
    {
      type: "neon_database_connection",
      description: "Neon PostgreSQL connection string",
      required_context: ["database"],
      optional_context: ["readonly"],
      status: "planned",
    },
    {
      type: "openai_api_key",
      description: "OpenAI API key for GPT models",
      required_context: ["service"],
      optional_context: ["purpose"],
      status: "planned",
    },
    {
      type: "notion_integration_token",
      description: "Notion integration token",
      required_context: ["workspace"],
      optional_context: ["purpose"],
      status: "planned",
    },
  ];

  return c.json({
    success: true,
    types,
    metadata: {
      timestamp: new Date().toISOString(),
      total: types.length,
      available: types.filter((t) => t.status === "available").length,
    },
  });
});

/**
 * GET /api/credentials/audit
 *
 * Get credential provisioning audit log
 *
 * Query params:
 * - limit: Number of records (default: 50, max: 500)
 * - offset: Pagination offset
 * - service: Filter by service name
 * - type: Filter by credential type
 *
 * Response:
 * {
 *   "success": true,
 *   "provisions": [
 *     {
 *       "id": 1,
 *       "type": "cloudflare_workers_deploy",
 *       "service": "chittyregister",
 *       "purpose": "github_actions",
 *       "requesting_service": "chittyconnect",
 *       "token_id": "xxx",
 *       "expires_at": "2026-11-06T00:00:00Z",
 *       "created_at": "2025-11-06T10:00:00Z"
 *     }
 *   ],
 *   "pagination": {
 *     "total": 100,
 *     "limit": 50,
 *     "offset": 0
 *   }
 * }
 */
credentialsRoutes.get("/audit", async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 500);
    const offset = parseInt(c.req.query("offset") || "0");
    const service = c.req.query("service");
    const type = c.req.query("type");

    // Build query
    let query = `
      SELECT id, type, service, purpose, requesting_service, token_id, expires_at, created_at
      FROM credential_provisions
      WHERE 1=1
    `;
    const params = [];

    if (service) {
      query += ` AND service = ?`;
      params.push(service);
    }

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    // Execute query
    const result = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM credential_provisions WHERE 1=1`;
    const countParams = [];

    if (service) {
      countQuery += ` AND service = ?`;
      countParams.push(service);
    }

    if (type) {
      countQuery += ` AND type = ?`;
      countParams.push(type);
    }

    const countResult = await c.env.DB.prepare(countQuery)
      .bind(...countParams)
      .first();

    return c.json({
      success: true,
      provisions: result.results || [],
      pagination: {
        total: countResult?.total || 0,
        limit,
        offset,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Credentials] Audit error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "AUDIT_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * DELETE /api/credentials/revoke
 *
 * Revoke a Cloudflare API token
 *
 * Request body:
 * {
 *   "token_id": "xxx"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Token revoked successfully"
 * }
 */
credentialsRoutes.delete("/revoke", async (c) => {
  try {
    const { token_id } = await c.req.json();

    if (!token_id) {
      return c.json(
        {
          success: false,
          error: "token_id is required",
        },
        400,
      );
    }

    const makeApiKey = c.env.CLOUDFLARE_MAKE_API_KEY;

    if (!makeApiKey) {
      return c.json(
        {
          success: false,
          error:
            "Credential revocation not available (CLOUDFLARE_MAKE_API_KEY not configured)",
        },
        503,
      );
    }

    // Revoke token via Cloudflare API
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/user/tokens/${token_id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${makeApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to revoke token: ${response.status} - ${error}`);
    }

    // Log revocation
    await c.env.DB.prepare(
      `
      UPDATE credential_provisions
      SET revoked_at = datetime('now')
      WHERE token_id = ?
    `,
    )
      .bind(token_id)
      .run();

    return c.json({
      success: true,
      message: "Token revoked successfully",
      token_id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Credentials] Revoke error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "REVOKE_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * GET /api/credentials/health
 *
 * Check credential provisioning service health
 *
 * Response:
 * {
 *   "status": "healthy",
 *   "checks": {
 *     "cloudflare_make_api_key": "configured",
 *     "database": "connected",
 *     "rate_limit": "available"
 *   }
 * }
 */
credentialsRoutes.get("/health", async (c) => {
  const checks = {
    cloudflare_make_api_key: c.env.CLOUDFLARE_MAKE_API_KEY
      ? "configured"
      : "missing",
    cloudflare_account_id: c.env.CLOUDFLARE_ACCOUNT_ID
      ? "configured"
      : "using_default",
    database: "unknown",
    rate_limit: c.env.RATE_LIMIT ? "available" : "missing",
    chronicle: c.env.CHITTY_CHRONICLE_TOKEN ? "configured" : "missing",
  };

  // Test database connection
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.database = "connected";
  } catch (error) {
    checks.database = "error";
  }

  const isHealthy =
    checks.cloudflare_make_api_key === "configured" &&
    checks.database === "connected";

  return c.json({
    status: isHealthy ? "healthy" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

export { credentialsRoutes };
