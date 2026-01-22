/**
 * GitHub Actions Credential Routes
 *
 * Dedicated endpoints for GitHub Actions to fetch credentials via OIDC.
 * Zero secrets stored in GitHub - just OIDC trust.
 *
 * Flow:
 * 1. GitHub Actions gets OIDC token from GitHub
 * 2. Sends token to ChittyConnect
 * 3. ChittyConnect validates OIDC token
 * 4. ChittyConnect fetches credential from 1Password
 * 5. Returns credential to GitHub Actions
 *
 * @module api/routes/github-actions
 */

import { Hono } from 'hono';
import { validateGitHubOIDC } from '../../auth/github-oidc.js';
import { OnePasswordConnectClient } from '../../services/1password-connect-client.js';

const githubActionsRoutes = new Hono();

/**
 * POST /api/github-actions/credentials
 *
 * Fetch credentials for GitHub Actions deployment.
 * Requires GitHub OIDC token in Authorization header.
 *
 * Request:
 * Authorization: Bearer <GitHub OIDC Token>
 *
 * Body:
 * {
 *   "credentials": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "credentials": {
 *     "CLOUDFLARE_API_TOKEN": "xxx",
 *     "CLOUDFLARE_ACCOUNT_ID": "xxx"
 *   },
 *   "metadata": {
 *     "repository": "CHITTYOS/chittyconnect",
 *     "workflow": "Deploy",
 *     "expires_in": 300
 *   }
 * }
 */
githubActionsRoutes.post('/credentials', async (c) => {
  try {
    // Extract OIDC token
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization header with Bearer token required',
        },
      }, 401);
    }

    const token = authHeader.slice(7);

    // Validate GitHub OIDC token
    const oidcResult = await validateGitHubOIDC(token, {
      audience: 'https://connect.chitty.cc',
    });

    // Check if repo is in allowed orgs
    const allowedOrgs = ['CHITTYOS', 'CHITTYFOUNDATION', 'CHITTYAPPS', 'CHITTYCORP', 'CHICAGOAPPS', 'FURNISHED-CONDOS'];
    const repoOwner = oidcResult.claims.repositoryOwner;

    if (!allowedOrgs.includes(repoOwner)) {
      return c.json({
        success: false,
        error: {
          code: 'ORG_NOT_ALLOWED',
          message: `Organization ${repoOwner} is not authorized`,
        },
      }, 403);
    }

    // Parse request body
    const body = await c.req.json();
    const { credentials: requestedCredentials = [] } = body;

    if (!Array.isArray(requestedCredentials) || requestedCredentials.length === 0) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'credentials array is required',
        },
      }, 400);
    }

    // Credential mapping - what can be requested and where it lives
    const credentialMap = {
      CLOUDFLARE_API_TOKEN: {
        path: 'infrastructure/cloudflare/api_token',
        env: 'CLOUDFLARE_MAKE_API_KEY', // Fallback
      },
      CLOUDFLARE_ACCOUNT_ID: {
        path: 'infrastructure/cloudflare/account_id',
        env: 'CLOUDFLARE_ACCOUNT_ID',
        default: '0bc21e3a5a9de1a4cc843be9c3e98121',
      },
      NEON_DATABASE_URL: {
        path: 'infrastructure/neon/database_url',
        env: 'NEON_DATABASE_URL',
      },
      GITHUB_APP_ID: {
        path: 'infrastructure/github/app_id',
        env: 'GITHUB_APP_ID',
      },
      GITHUB_APP_PRIVATE_KEY: {
        path: 'infrastructure/github/private_key',
        env: 'GITHUB_APP_PK',
      },
      OPENAI_API_KEY: {
        path: 'integrations/openai/api_key',
        env: 'OPENAI_API_KEY',
      },
      NOTION_TOKEN: {
        path: 'integrations/notion/api_key',
        env: 'NOTION_TOKEN',
      },
    };

    // Validate requested credentials are allowed
    const invalidCredentials = requestedCredentials.filter(
      (cred) => !credentialMap[cred]
    );

    if (invalidCredentials.length > 0) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Unknown credentials: ${invalidCredentials.join(', ')}`,
          allowed: Object.keys(credentialMap),
        },
      }, 400);
    }

    // Fetch credentials
    const result = {};
    const opClient = new OnePasswordConnectClient(c.env);

    for (const credName of requestedCredentials) {
      const config = credentialMap[credName];

      try {
        // Try 1Password first
        if (c.env.ONEPASSWORD_CONNECT_TOKEN) {
          const value = await opClient.get(config.path);
          result[credName] = value;
          continue;
        }
      } catch (error) {
        console.warn(`[GitHub Actions] 1Password fetch failed for ${credName}:`, error.message);
      }

      // Fallback to environment variable
      if (config.env && c.env[config.env]) {
        result[credName] = c.env[config.env];
      } else if (config.default) {
        result[credName] = config.default;
      } else {
        return c.json({
          success: false,
          error: {
            code: 'CREDENTIAL_NOT_AVAILABLE',
            message: `Credential ${credName} is not configured`,
          },
        }, 503);
      }
    }

    // Log the access
    console.log(`[GitHub Actions] Credentials issued to ${oidcResult.claims.repository} (${oidcResult.claims.workflow})`);

    // Log to D1
    try {
      await c.env.DB.prepare(`
        INSERT INTO github_actions_credential_access
        (repository, workflow, run_id, actor, credentials, timestamp)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        oidcResult.claims.repository,
        oidcResult.claims.workflow,
        oidcResult.claims.runId,
        oidcResult.claims.actor,
        requestedCredentials.join(',')
      ).run();
    } catch (error) {
      // Table might not exist yet, that's ok
      console.warn('[GitHub Actions] Failed to log access:', error.message);
    }

    return c.json({
      success: true,
      credentials: result,
      metadata: {
        repository: oidcResult.claims.repository,
        workflow: oidcResult.claims.workflow,
        actor: oidcResult.claims.actor,
        ref: oidcResult.claims.ref,
        sha: oidcResult.claims.sha,
        run_id: oidcResult.claims.runId,
        issued_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[GitHub Actions] Error:', error);

    if (error.message.includes('OIDC validation failed')) {
      return c.json({
        success: false,
        error: {
          code: 'OIDC_INVALID',
          message: error.message,
        },
      }, 401);
    }

    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    }, 500);
  }
});

/**
 * GET /api/github-actions/available
 *
 * List available credentials that can be requested.
 * No auth required - this is public info.
 */
githubActionsRoutes.get('/available', async (c) => {
  return c.json({
    success: true,
    credentials: [
      {
        name: 'CLOUDFLARE_API_TOKEN',
        description: 'Cloudflare API token for Workers deployment',
        required_for: ['wrangler deploy', 'wrangler d1'],
      },
      {
        name: 'CLOUDFLARE_ACCOUNT_ID',
        description: 'Cloudflare account ID',
        required_for: ['wrangler deploy'],
      },
      {
        name: 'NEON_DATABASE_URL',
        description: 'Neon PostgreSQL connection string',
        required_for: ['database migrations'],
      },
      {
        name: 'GITHUB_APP_ID',
        description: 'GitHub App ID',
        required_for: ['GitHub App authentication'],
      },
      {
        name: 'GITHUB_APP_PRIVATE_KEY',
        description: 'GitHub App private key (PEM)',
        required_for: ['GitHub App authentication'],
      },
      {
        name: 'OPENAI_API_KEY',
        description: 'OpenAI API key',
        required_for: ['AI features'],
      },
      {
        name: 'NOTION_TOKEN',
        description: 'Notion integration token',
        required_for: ['Notion integrations'],
      },
    ],
    allowed_organizations: [
      'CHITTYOS',
      'CHITTYFOUNDATION',
      'CHITTYAPPS',
      'CHITTYCORP',
      'CHICAGOAPPS',
      'FURNISHED-CONDOS',
    ],
    authentication: {
      method: 'GitHub Actions OIDC',
      audience: 'https://connect.chitty.cc',
      documentation: 'https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect',
    },
  });
});

export { githubActionsRoutes };
