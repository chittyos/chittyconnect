/**
 * GitHub Actions OIDC Authentication
 *
 * Validates GitHub Actions OIDC tokens for zero-secret CI/CD authentication.
 * No secrets stored in GitHub - just OIDC trust relationship.
 *
 * @module auth/github-oidc
 */

import * as jose from "jose";

// GitHub Actions OIDC configuration
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS_URL =
  "https://token.actions.githubusercontent.com/.well-known/jwks";

// Cache JWKS for performance
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Get GitHub's JWKS (JSON Web Key Set)
 * Cached for performance
 */
async function getGitHubJWKS() {
  const now = Date.now();

  if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  jwksCache = jose.createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));
  jwksCacheTime = now;

  return jwksCache;
}

/**
 * Validate GitHub Actions OIDC token
 *
 * @param {string} token - The OIDC token from GitHub Actions
 * @param {object} options - Validation options
 * @param {string[]} options.allowedRepositories - List of allowed repos (e.g., ['CHITTYOS/chittyconnect'])
 * @param {string[]} options.allowedWorkflows - List of allowed workflow names (optional)
 * @param {string} options.audience - Expected audience (default: ChittyConnect URL)
 * @returns {Promise<object>} Validated claims
 * @throws {Error} If validation fails
 */
export async function validateGitHubOIDC(token, options = {}) {
  const {
    allowedRepositories = [],
    allowedWorkflows = [],
    audience = "https://connect.chitty.cc",
  } = options;

  try {
    const JWKS = await getGitHubJWKS();

    // Verify the token
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: audience,
    });

    // Validate repository
    if (allowedRepositories.length > 0) {
      const repo = payload.repository;
      if (!allowedRepositories.includes(repo)) {
        throw new Error(`Repository not allowed: ${repo}`);
      }
    }

    // Validate workflow (optional)
    if (allowedWorkflows.length > 0) {
      const workflow = payload.workflow;
      if (!allowedWorkflows.includes(workflow)) {
        throw new Error(`Workflow not allowed: ${workflow}`);
      }
    }

    // Extract useful claims
    return {
      valid: true,
      claims: {
        // Repository info
        repository: payload.repository,
        repositoryOwner: payload.repository_owner,
        repositoryId: payload.repository_id,

        // Workflow info
        workflow: payload.workflow,
        workflowRef: payload.workflow_ref,
        jobWorkflowRef: payload.job_workflow_ref,

        // Run info
        runId: payload.run_id,
        runNumber: payload.run_number,
        runAttempt: payload.run_attempt,

        // Actor info
        actor: payload.actor,
        actorId: payload.actor_id,

        // Ref info (branch/tag)
        ref: payload.ref,
        refType: payload.ref_type,
        sha: payload.sha,

        // Environment
        environment: payload.environment,

        // Event info
        eventName: payload.event_name,

        // Token metadata
        iss: payload.iss,
        aud: payload.aud,
        sub: payload.sub,
        exp: payload.exp,
        iat: payload.iat,
      },
    };
  } catch (error) {
    console.error("[GitHub OIDC] Validation failed:", error.message);
    throw new Error(`OIDC validation failed: ${error.message}`);
  }
}

/**
 * Middleware for GitHub OIDC authentication
 *
 * Usage:
 * ```javascript
 * app.use('/api/credentials/*', githubOIDCMiddleware({
 *   allowedRepositories: ['CHITTYOS/*', 'CHITTYFOUNDATION/*']
 * }));
 * ```
 *
 * @param {object} options - Middleware options
 * @returns {Function} Hono middleware
 */
export function githubOIDCMiddleware(options = {}) {
  const {
    allowedRepositories = [],
    allowedWorkflows = [],
    audience = "https://connect.chitty.cc",
    allowedOrgs = [
      "CHITTYOS",
      "CHITTYFOUNDATION",
      "CHITTYAPPS",
      "CHITTYCORP",
      "CHICAGOAPPS",
      "FURNISHED-CONDOS",
    ],
  } = options;

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // Not an OIDC request, let other auth handle it
      return next();
    }

    const token = authHeader.slice(7);

    // Check if this looks like a GitHub OIDC token (they're JWTs)
    if (!token.includes(".") || token.split(".").length !== 3) {
      // Not a JWT, let other auth handle it
      return next();
    }

    try {
      // Decode header to check issuer without verifying
      const [headerB64] = token.split(".");
      const header = JSON.parse(atob(headerB64));

      // Quick check - is this from GitHub?
      // We'll do full verification below
      if (header.typ !== "JWT") {
        return next();
      }

      // Validate the token
      const result = await validateGitHubOIDC(token, {
        allowedRepositories,
        allowedWorkflows,
        audience,
      });

      // Check organization if using wildcard repos
      if (allowedOrgs.length > 0) {
        const owner = result.claims.repositoryOwner;
        if (!allowedOrgs.includes(owner)) {
          return c.json(
            {
              success: false,
              error: {
                code: "OIDC_ORG_NOT_ALLOWED",
                message: `Organization not allowed: ${owner}`,
              },
            },
            403,
          );
        }
      }

      // Set auth context for downstream handlers
      c.set("auth", {
        type: "github_oidc",
        ...result.claims,
      });

      c.set("apiKey", {
        service: `github:${result.claims.repository}`,
        name: result.claims.workflow,
        type: "oidc",
      });

      console.log(
        `[GitHub OIDC] Authenticated: ${result.claims.repository} (${result.claims.workflow})`,
      );

      return next();
    } catch (error) {
      // If OIDC validation fails, return error (don't fall through)
      if (error.message.includes("OIDC validation failed")) {
        return c.json(
          {
            success: false,
            error: {
              code: "OIDC_VALIDATION_FAILED",
              message: error.message,
            },
          },
          401,
        );
      }

      // Other errors, let other auth handle
      return next();
    }
  };
}

/**
 * ChittyOS allowed repositories configuration
 */
export const CHITTYOS_ALLOWED_REPOS = [
  // Foundation
  "CHITTYFOUNDATION/chittyid",
  "CHITTYFOUNDATION/chittyauth",
  "CHITTYFOUNDATION/chittytrust",
  "CHITTYFOUNDATION/chittycert",
  "CHITTYFOUNDATION/chittyschema",
  "CHITTYFOUNDATION/chittyregister",

  // Core
  "CHITTYOS/chittyconnect",
  "CHITTYOS/chittyrouter",
  "CHITTYOS/chittygateway",
  "CHITTYOS/chittymonitor",
  "CHITTYOS/chittydiscovery",
  "CHITTYOS/chittybeacon",

  // Apps
  "CHITTYAPPS/chittycases",
  "CHITTYAPPS/chittyevidence",
  "CHITTYAPPS/chittyportal",

  // Corp
  "CHITTYCORP/chittyfinance",
  "CHITTYCORP/chittyledger",

  // Chicago Apps
  "CHICAGOAPPS/chittycases",

  // Wildcard - allow all from trusted orgs
  // (handled by allowedOrgs check in middleware)
];

export default {
  validateGitHubOIDC,
  githubOIDCMiddleware,
  CHITTYOS_ALLOWED_REPOS,
};
