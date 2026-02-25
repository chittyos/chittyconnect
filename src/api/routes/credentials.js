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
import { EnhancedCredentialProvisioner } from "../../services/credential-provisioner-enhanced.js";
import { OnePasswordConnectClient } from "../../services/1password-connect-client.js";

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

    // Gather request metadata for ContextConsciousness™
    const requestMetadata = {
      sessionId: c.req.header("X-Session-ID"),
      userId: c.req.header("X-User-ID"),
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("User-Agent"),
    };

    // Initialize provisioner
    const provisioner = new EnhancedCredentialProvisioner(c.env);

    // Validate request
    provisioner.validateRequest(type, context, requestingService);

    // Check rate limit
    await provisioner.checkRateLimit(requestingService);

    // Provision credential with ContextConsciousness™
    const result = await provisioner.provision(
      type,
      context,
      requestingService,
      requestMetadata,
    );

    return c.json(result);
  } catch (error) {
    console.error("[Credentials] Provision error:", error);

    // Determine appropriate status code
    let status = 500;
    if (error.message.includes("Rate limit exceeded")) {
      status = 429;
    } else if (error.message.includes("DENIED")) {
      status = 403; // Forbidden - high risk
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
      status: "available",
    },
    // Provider API keys (dynamic provisioning via provisionProviderApiKey)
    {
      type: "neon_api_key",
      description: "Neon API key for MCP server and database management",
      required_context: ["purpose"],
      optional_context: ["environment"],
      provider: "neon",
      status: "available",
    },
    {
      type: "openai_api_key",
      description: "OpenAI API key for GPT models",
      required_context: ["purpose"],
      optional_context: ["environment"],
      provider: "openai",
      status: "available",
    },
    {
      type: "anthropic_api_key",
      description: "Anthropic API key for Claude models",
      required_context: ["purpose"],
      optional_context: ["environment"],
      provider: "anthropic",
      status: "available",
    },
    {
      type: "notion_api_key",
      description: "Notion integration token for workspace access",
      required_context: ["purpose"],
      optional_context: ["environment"],
      provider: "notion",
      status: "available",
    },
    {
      type: "github_api_key",
      description: "GitHub personal access token",
      required_context: ["purpose"],
      optional_context: ["environment"],
      provider: "github",
      status: "available",
    },
    {
      type: "stripe_api_key",
      description: "Stripe API key for payment processing",
      required_context: ["purpose", "mode"],
      optional_context: ["environment"],
      provider: "stripe",
      status: "available",
    },
    {
      type: "twilio_credentials",
      description:
        "Twilio account SID, auth token, and phone number for SMS/Voice",
      required_context: [],
      optional_context: [],
      provider: "twilio",
      endpoint: "GET /api/credentials/twilio",
      status: "available",
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
 * GET /api/credentials/twilio
 *
 * Get Twilio credentials for ChittyConcierge and other services.
 * Returns account SID, auth token, and phone number.
 *
 * Headers:
 * - X-Service-Name: The requesting service name (required)
 *
 * Response:
 * {
 *   "accountSid": "AC...",
 *   "authToken": "...",
 *   "phoneNumber": "+1..."
 * }
 */
credentialsRoutes.get("/twilio", async (c) => {
  try {
    const serviceName =
      c.req.header("X-Service-Name") || c.get("apiKey")?.service || "unknown";

    console.log(
      `[Credentials] Twilio credentials requested by: ${serviceName}`,
    );

    // Initialize 1Password client
    const opClient = new OnePasswordConnectClient(c.env);

    let accountSid, authToken, phoneNumber;

    try {
      // Try 1Password first
      accountSid = await opClient.get("integrations/twilio/account_sid");
      authToken = await opClient.get("integrations/twilio/auth_token");
      phoneNumber = await opClient.get("integrations/twilio/phone_number");
    } catch (opError) {
      console.warn(
        "[Credentials] 1Password unavailable, falling back to env vars:",
        opError.message,
      );

      // Fallback to environment variables
      accountSid = c.env.TWILIO_ACCOUNT_SID;
      authToken = c.env.TWILIO_AUTH_TOKEN;
      phoneNumber = c.env.TWILIO_PHONE_NUMBER;
    }

    if (!accountSid || !authToken || !phoneNumber) {
      return c.json(
        {
          success: false,
          error: {
            code: "CREDENTIALS_NOT_FOUND",
            message:
              "Twilio credentials not configured in 1Password or environment",
          },
        },
        503,
      );
    }

    // Log credential access (no sensitive data)
    try {
      await c.env.DB.prepare(
        `
        INSERT INTO credential_provisions (type, service, purpose, requesting_service, created_at)
        VALUES ('twilio_credentials', 'twilio', 'sms_voice', ?, datetime('now'))
      `,
      )
        .bind(serviceName)
        .run();
    } catch (dbError) {
      console.warn(
        "[Credentials] Failed to log credential access:",
        dbError.message,
      );
    }

    return c.json({
      accountSid,
      authToken,
      phoneNumber,
    });
  } catch (error) {
    console.error("[Credentials] Twilio credentials error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "TWILIO_CREDENTIALS_FAILED",
          message: error.message,
        },
      },
      500,
    );
  }
});

/**
 * GET /api/credentials/:vault/:item/:field
 *
 * Retrieve a specific credential from 1Password by path.
 * This is the secure way for ChittyOS services to access credentials.
 *
 * Path parameters:
 * - vault: The 1Password vault (infrastructure, services, integrations)
 * - item: The item name in the vault
 * - field: The field name within the item
 *
 * Example: GET /api/credentials/infrastructure/neon/chittycanon_db_url
 *
 * Response:
 * {
 *   "success": true,
 *   "value": "postgres://...",
 *   "metadata": {
 *     "vault": "infrastructure",
 *     "item": "neon",
 *     "field": "chittycanon_db_url",
 *     "cached": false
 *   }
 * }
 */
credentialsRoutes.get("/:vault/:item/:field", async (c) => {
  try {
    const vault = c.req.param("vault");
    const item = c.req.param("item");
    const field = c.req.param("field");

    // Validate vault name
    const validVaults = ["infrastructure", "services", "integrations"];
    if (!validVaults.includes(vault)) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_VAULT",
            message: `Invalid vault: ${vault}. Must be one of: ${validVaults.join(", ")}`,
          },
        },
        400,
      );
    }

    // Get requesting service identifier (non-sensitive metadata only)
    const apiKeyMeta = c.get("apiKey");
    const requestingService = String(
      apiKeyMeta?.service || apiKeyMeta?.name || "unknown",
    );

    console.log(
      `[Credentials] ${requestingService} requesting ${vault}/${item}/${field}`,
    );

    // Initialize 1Password client
    const opClient = new OnePasswordConnectClient(c.env);

    // Build credential path
    const credentialPath = `${vault}/${item}/${field}`;

    // Fetch from 1Password
    const value = await opClient.get(credentialPath);

    // Log credential access (no sensitive data)
    try {
      await c.env.DB.prepare(
        `
        INSERT INTO credential_provisions (type, service, purpose, requesting_service, created_at)
        VALUES ('1password_retrieval', ?, ?, ?, datetime('now'))
      `,
      )
        .bind(item, field, requestingService)
        .run();
    } catch (dbError) {
      console.warn(
        "[Credentials] Failed to log credential access:",
        dbError.message,
      );
    }

    return c.json({
      success: true,
      value,
      metadata: {
        vault,
        item,
        field,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[Credentials] Retrieval error:", error);

    let status = 500;
    let code = "RETRIEVAL_FAILED";

    if (
      error.message.includes("Unknown vault") ||
      error.message.includes("Invalid credential path")
    ) {
      status = 400;
      code = "INVALID_PATH";
    } else if (
      error.message.includes("not found") ||
      error.message.includes("has no value")
    ) {
      status = 404;
      code = "NOT_FOUND";
    } else if (error.message.includes("not configured")) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
    }

    return c.json(
      {
        success: false,
        error: {
          code,
          message: error.message,
        },
      },
      status,
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
    onepassword_connect: "unknown",
  };

  // Test database connection
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.database = "connected";
  } catch (error) {
    checks.database = "error";
  }

  // Test 1Password Connect
  try {
    const opClient = new OnePasswordConnectClient(c.env);
    const opHealth = await opClient.healthCheck();
    checks.onepassword_connect = opHealth.status;
  } catch (error) {
    checks.onepassword_connect = "error";
  }

  const isHealthy =
    (checks.cloudflare_make_api_key === "configured" ||
      checks.onepassword_connect === "healthy") &&
    checks.database === "connected";

  return c.json({
    status: isHealthy ? "healthy" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

export { credentialsRoutes };
