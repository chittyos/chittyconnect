/**
 * Enhanced Credential Provisioning Service with chittysecrets Integration
 *
 * This enhanced version integrates with chittysecrets Connect to retrieve
 * root credentials dynamically, eliminating the need to store sensitive
 * keys in environment variables.
 *
 * Security principles:
 * - Never store root credentials in environment variables
 * - Retrieve credentials from chittysecrets on-demand
 * - Context-aware provisioning with ContextConsciousness™
 * - Always create scoped, time-limited tokens
 * - Log all provisioning operations
 * - Rate limit requests
 */

import { createCredentialBroker } from "../lib/credential-broker.js";
import { CREDENTIAL_PATHS } from "../lib/credential-paths.js";

/**
 * Exact delivery targets for `context.deliver_to` (issue #380). Delivery
 * writes the token straight into the target worker's secret store so the
 * value never transits an HTTP response. A request is accepted only when
 * its (script, secret_name, credential type) triple matches an entry here
 * exactly; anything else is refused with `deliver_target_not_allowed`
 * before any Cloudflare call. Matching the full triple stops a caller from
 * overwriting a worker's other secrets or planting a broader token type in
 * a secret meant for a narrower one.
 *
 * `script` is the exact deployed script name the secret is written to.
 * chittyagent-mcp-builder's env.production sets `name =
 * "chittyagent-mcp-builder"`, so no `-<environment>` suffix is ever added.
 */
export const DELIVER_TARGETS = Object.freeze([
  Object.freeze({
    script: "chittyagent-mcp-builder",
    secret_name: "CF_API_TOKEN",
    type: "cloudflare_access_mcp_portals",
  }),
]);

// Types that may only be provisioned with deliver_to: their value must
// never be returned in a response body.
const DELIVER_ONLY_TYPES = new Set(["cloudflare_access_mcp_portals"]);

const DELIVER_TO_KEYS = new Set(["script", "secret_name"]);

// Bound on the secrets PUT. A timeout leaves the outcome unknown (Cloudflare
// may have applied the write), so it is reported, never revoked.
const DELIVER_TIMEOUT_MS = 15000;

// Lifetime of a per-target delivery lease. Covers the mint, the secrets
// PUT (bounded above) and the revocation of earlier tokens; a lease left
// behind by a crashed request is taken over once it expires.
const DELIVER_LEASE_MS = 120000;

// Reserved prefix of the audit-row purpose written by the delivery path.
const DELIVER_PURPOSE_PREFIX = "deliver_to:";

const deliveryKey = (target) => `${target.script}/${target.secret_name}`;

function provisionError(message, code, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

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
      // Cloudflare publishes this group as "MCP Portals Write". Its ID is
      // not pinned here: it must resolve from the account's live
      // permission-groups catalog, and the provenance gate in
      // provisionCloudflareToken refuses to mint from a fallback entry
      // anyway, so a guessed ID would only ever be dead weight.
      mcpPortalsWrite: {
        id: null,
        name: "MCP Portals Write",
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
      cloudflare_access_mcp_portals: {
        permissions: ["mcpPortalsWrite", "accountSettingsRead"],
        ttl: 90 * 24 * 60 * 60 * 1000, // 90 days
        requiresContext: ["service"],
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
   * Enhanced with chittysecrets retrieval and ContextConsciousness validation
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
      case "cloudflare_access_mcp_portals":
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
  async fetchCloudflarePermissions(apiKey, accountId) {
    if (!accountId) {
      throw new Error(
        "fetchCloudflarePermissions requires accountId — the permission-groups catalog is account-scoped",
      );
    }
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

      // Account-owned tokens must read the account-scoped catalog. The
      // /user/tokens/* family answers 403 code 9109 "Valid user-level
      // authentication not found" for an account-owned bearer, which is
      // how this call had been failing into the static fallback below.
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/permission_groups`,
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
          normalizedName.includes("Write") &&
          (normalizedName.includes("d1Database") ||
            normalizedName.startsWith("d1"))
        ) {
          // Cloudflare's account catalog names group
          // 5e2c30acd1434ea2adfb8442c3cbbbea "D1 Write", while the static
          // fallback spells it "D1 Database Write". Matching only
          // "d1Database" left every real catalog read with
          // d1DatabaseWrite unresolved, so the provenance gate below
          // permanently blocked cloudflare_d1_access. Accept both
          // spellings; requiring "Write" keeps "D1 Read" out.
          key = "d1DatabaseWrite";
        } else if (
          normalizedName.includes("workersRoutes") &&
          normalizedName.includes("Write")
        ) {
          key = "workersRoutesWrite";
        } else if (
          normalizedName.includes("MCPPortals") &&
          normalizedName.includes("Write")
        ) {
          // "MCP Portals Write" -> "MCPPortalsWrite". Substring match so a
          // prefixed spelling ("Access: MCP Portals Write") also resolves.
          key = "mcpPortalsWrite";
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
      // Provenance: which groups came from the live catalog vs. the
      // hardcoded fallback. A token minted entirely from fallback IDs
      // carries permissions nobody verified against this account.
      this.permissionGroupsSource = Object.keys(permissions).length > 0
        ? "account-catalog"
        : "fallback";
      // Per-key provenance. The merge below lets a hardcoded fallback ID
      // stand in for a group the live catalog did not resolve, so a
      // whole-object flag is too coarse to gate a mint on.
      this.catalogResolvedKeys = new Set(Object.keys(permissions));
      // Names only, no IDs. Without this, a catalog that reads fine but
      // whose group names miss the normalizer's substring patterns below
      // is indistinguishable from a missing grant — both surface as a
      // refusal to mint, and you cannot tell which from the error.
      this.catalogGroupNames = data.result.map((g) => g.name);

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
      // Fail closed. This catch previously swallowed every error — the
      // 403 included — and returned hardcoded permission-group IDs, so
      // a token could be minted from a catalog nobody had read. Two
      // separated reviews landed on this independently. A mint that
      // cannot verify its own scope must not happen.
      this.permissionGroupsSource = "unavailable";
      this.catalogResolvedKeys = new Set();
      this.catalogGroupNames = null;
      throw new Error(
        `POLICY_BLOCKED_PERMISSION_CATALOG_UNAVAILABLE: cannot read the account permission-groups catalog, so a minted token's effective scope would be unverified (${error.message})`,
      );
    }
  }

  /**
   * Get Cloudflare permissions (dynamic or fallback)
   *
   * @private
   * @param {string} apiKey - Cloudflare API key
   * @returns {Promise<object>} Permission groups
   */
  async getCloudflarePermissions(apiKey, accountId) {
    if (!this.cloudflarePermissions) {
      this.cloudflarePermissions = await this.fetchCloudflarePermissions(
        apiKey,
        accountId,
      );
    }
    return this.cloudflarePermissions;
  }

  /**
   * Provision Cloudflare API token with credentials from chittysecrets
   *
   * @private
   * @param {string} type - Token type
   * @param {object} context - Context
   * @param {string} requestingService - Requesting service
   * @returns {Promise<object>} Provisioned token
   */
  async provisionCloudflareToken(type, context, requestingService) {
    // Checked again here, not only in validateRequest, so no caller of
    // this method can reach token creation with an unlisted target.
    const deliverTarget = this.resolveDeliverTarget(type, context);
    if (!deliverTarget) {
      return this.mintCloudflareToken(type, context, requestingService, null);
    }

    // One delivery per target at a time, taken before any Cloudflare call:
    // otherwise a slower delivery's rotation step can revoke the token a
    // concurrent delivery has just written into the same secret.
    const leaseHolder = crypto.randomUUID();
    await this.acquireDeliveryLease(deliverTarget, leaseHolder);
    try {
      return await this.mintCloudflareToken(
        type,
        context,
        requestingService,
        deliverTarget,
      );
    } finally {
      await this.releaseDeliveryLease(deliverTarget, leaseHolder);
    }
  }

  /**
   * Mint a Cloudflare token and, when deliverTarget is set, deliver it.
   * Callers go through provisionCloudflareToken, which validates the target
   * and holds the delivery lease.
   *
   * @private
   */
  async mintCloudflareToken(type, context, requestingService, deliverTarget) {
    const { service, purpose, environment = "production" } = context;

    // Retrieve Cloudflare credentials from chittysecrets
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
        console.warn("[EnhancedCredentialProvisioner] chittysecrets account_id fetch failed:", err.message);
        return this.env.CHITTYOS_ACCOUNT_ID;
      });

    if (!accountId) {
      throw new Error("Cloudflare Account ID unavailable — both chittysecrets and CHITTYOS_ACCOUNT_ID env var are empty");
    }
    if (!makeApiKey) {
      throw new Error(
        "Failed to retrieve Cloudflare credentials from chittysecrets",
      );
    }

    // Get permission groups dynamically (account-scoped catalog)
    const cloudflarePermissions = await this.getCloudflarePermissions(
      makeApiKey,
      accountId,
    );

    // Get type configuration
    const typeConfig = this.credentialTypes[type];
    // Carry the config key alongside the resolved group. The provenance
    // gate below reports on keys and the scope partition needs the
    // group, so a bare array of groups loses half of what is needed.
    const resolved = typeConfig.permissions.map((key) => ({
      key,
      group: cloudflarePermissions[key],
    }));
    const missingPermissions = resolved.filter((p) => !p.group);
    if (missingPermissions.length > 0) {
      throw new Error(
        `Unable to resolve all Cloudflare permission groups for ${type}`,
      );
    }

    // Partition by scope BEFORE the provenance gate. Account-scoped
    // permissions go in a single policy block keyed by the account;
    // zone-scoped ones need a separate policy block per zone with a
    // zone-keyed resources object — Cloudflare rejects mixing scopes in
    // one block. The order matters: zone-scoped permissions are dropped
    // when the caller supplies no zones, and a permission that never
    // reaches the token must not be able to block the mint.
    const requestedZones = Array.isArray(context.zones)
      ? context.zones.filter((z) => typeof z === "string" && z.length > 0)
      : [];

    const accountEntries = resolved.filter(
      (p) => (p.group.scope || "account") === "account",
    );
    const zoneEntries = resolved.filter((p) => p.group.scope === "zone");

    if (zoneEntries.length > 0 && requestedZones.length === 0) {
      // Drop zone-scoped perms when no zones provided. Caller still
      // gets the account-scoped subset. If the dropped perms are load-
      // bearing (e.g. wrangler deploy of a worker with `routes`), the
      // resulting deploy will fail with code 10000 — which is the
      // existing behavior, so no regression.
      console.warn(
        `[EnhancedCredentialProvisioner] Dropping zone-scoped permissions ${zoneEntries.map((p) => p.group.name).join(", ")} from token for ${type} — caller did not provide context.zones`,
      );
    }

    const includedEntries =
      requestedZones.length > 0 ? resolved : accountEntries;
    const accountPermissions = accountEntries.map((p) => p.group);
    const zonePermissions =
      requestedZones.length > 0 ? zoneEntries.map((p) => p.group) : [];

    // Every group that actually lands in the token must have come from
    // this account's live catalog. A hardcoded fallback ID may be absent
    // from, or mean something narrower in, the account-scoped catalog —
    // which mints an under-scoped token successfully instead of
    // erroring. Permissions dropped just above are excluded on purpose:
    // they are not in the token, so their provenance is not a claim the
    // mint is making.
    const requiredKeys = includedEntries.map((p) => p.key);
    const unverified = requiredKeys.filter(
      (name) => !this.catalogResolvedKeys?.has(name),
    );
    if (unverified.length > 0) {
      const verifiedKeys = requiredKeys.filter((name) =>
        this.catalogResolvedKeys?.has(name),
      );
      // Two very different causes reach this throw: the catalog was
      // never read at all, or it was read and some required keys did not
      // come back under a name the normalizer recognizes. In the second
      // case this error genuinely cannot tell a renamed group from an
      // ungranted one — report the partial result instead of asserting
      // either cause.
      const diagnosis = this.catalogGroupNames
        ? `catalog read OK and returned ${this.catalogGroupNames.length} groups (${this.catalogGroupNames.join(" | ") || "none"}); ${verifiedKeys.length} of ${requiredKeys.length} required keys resolved from it (${verifiedKeys.join(", ") || "none"}). The unresolved ones are either named differently than the normalizer expects or not granted on this account — this error cannot distinguish those two`
        : `catalog was never successfully read, so this is upstream of name matching`;
      throw new Error(
        `POLICY_BLOCKED_PERMISSION_UNVERIFIED: ${unverified.join(", ")} resolved from the static fallback, not this account's catalog; refusing to mint a token whose scope is unverified. Diagnosis: ${diagnosis}`,
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
      expires_on: new Date(Date.now() + typeConfig.ttl).toISOString().replace(/\.\d{3}Z$/, "Z"), // CF rejects fractional seconds
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
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens`,
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

    let delivered = null;
    let previousToken = null;
    if (deliverTarget) {
      // Tracked as pending before the write, so a token whose delivery
      // outcome is unknown, or whose cleanup failed, still has a row the
      // next successful delivery will revoke.
      const rowId = await this.recordPendingDelivery(
        token,
        deliverTarget,
        { type, requestingService },
        accountId,
        makeApiKey,
      );
      delivered = await this.deliverTokenToWorkerSecret(
        token,
        deliverTarget,
        accountId,
        makeApiKey,
        rowId,
      );
      previousToken = await this.rotateDeliveredToken(
        token,
        delivered,
        rowId,
        accountId,
        makeApiKey,
      );
    }

    // Provenance reported to callers and to Chronicle is derived from the
    // groups actually in this token, not from the catalog-wide flag. The
    // catalog-wide flag reads "account-catalog" as soon as ONE group
    // resolves, so it can claim a token was verified against the account
    // while some of its IDs came from the static fallback. The gate above
    // makes that impossible for the included set — this makes the reported
    // value provably derived from it rather than merely consistent with it.
    const includedScopeNames = includedEntries.map((p) => p.group.name);
    const permissionSource =
      includedEntries.length > 0 &&
      includedEntries.every((p) => this.catalogResolvedKeys?.has(p.key))
        ? "account-catalog"
        : this.permissionGroupsSource || "unknown";

    // Log provision event
    await this.logProvisionEvent({
      type,
      service,
      purpose,
      requestingService,
      tokenId: token.id,
      tokenName: token.name,
      expiresAt: token.expires_on,
      scopes: includedScopeNames,
      environment,
      contextAnalysis: true, // Flag that context was validated
      permissionSource,
      ...(delivered && {
        deliveredTo: {
          script: delivered.script,
          secret_name: delivered.secret_name,
        },
      }),
    });

    if (delivered) {
      // Value-free response: the token now lives only in the target
      // worker's secret store. No value, no usage_instructions, no echo
      // of any Cloudflare API body.
      return {
        token_id: token.id,
        secret_name: delivered.secret_name,
        script: delivered.script,
        expires_on: token.expires_on,
        permissions: includedScopeNames,
        previous_token: previousToken,
      };
    }

    return {
      success: true,
      credential: {
        type: "cloudflare_api_token",
        value: token.value,
        expires_at: token.expires_on,
        scopes: includedScopeNames,
        account_id: accountId,
        token_id: token.id,
        environment,
      },
      usage_instructions: this.getUsageInstructions(type, token.value),
      metadata: {
        provisioned_by: "ChittyConnect Enhanced",
        context_validated: true,
        retrieved_from: "chittysecrets",
        permission_source: permissionSource,
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

    // Retrieve the target service's token from chittysecrets
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

    // Retrieve GitHub App credentials from chittysecrets
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
      throw new Error("Failed to retrieve GitHub credentials from chittysecrets");
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

    // Retrieve Neon credentials from chittysecrets
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
      throw new Error("Failed to retrieve Neon credentials from chittysecrets");
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
   * Uses credential type metadata to determine chittysecrets path, env var name, etc.
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

    // Retrieve API key from chittysecrets using configured path
    const apiKey = await this.onePassword.get(onePasswordPath, {
      service: requestingService,
      purpose,
      environment: context.environment || "production",
    });

    if (!apiKey) {
      throw new Error(
        `Failed to retrieve ${platform} API key from chittysecrets (path: ${onePasswordPath})`,
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
      cloudflare_access_mcp_portals: {
        note: "Token has MCP Portals Write and Account Settings Read permissions",
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

    this.resolveDeliverTarget(type, context);
  }

  /**
   * Validate `context.deliver_to` and resolve the worker script it names.
   * Returns null when no delivery was requested (and the type allows
   * that). Throws before any Cloudflare call when delivery is required
   * but absent, malformed, or not an exact allow-listed triple.
   */
  resolveDeliverTarget(type, context) {
    const deliverTo = context?.deliver_to;
    if (deliverTo === undefined || deliverTo === null) {
      if (
        typeof context?.purpose === "string" &&
        context.purpose.startsWith(DELIVER_PURPOSE_PREFIX)
      ) {
        throw provisionError(
          `purpose_reserved: purpose may not start with "${DELIVER_PURPOSE_PREFIX}" without deliver_to`,
          "purpose_reserved",
          400,
        );
      }
      if (DELIVER_ONLY_TYPES.has(type)) {
        throw provisionError(
          `deliver_to_required: ${type} is only provisioned into a worker secret via context.deliver_to`,
          "deliver_to_required",
          400,
        );
      }
      return null;
    }

    if (typeof deliverTo !== "object" || Array.isArray(deliverTo)) {
      throw provisionError(
        "deliver_to must be an object { script, secret_name }",
        "deliver_to_invalid",
        400,
      );
    }
    const unknownKeys = Object.keys(deliverTo).filter(
      (k) => !DELIVER_TO_KEYS.has(k),
    );
    if (unknownKeys.length > 0) {
      // Includes `environment`: the target is the exact script name.
      throw provisionError(
        `deliver_to accepts only script and secret_name (unsupported: ${unknownKeys.join(", ")})`,
        "deliver_to_invalid",
        400,
      );
    }
    if (context.ip_restrictions !== undefined) {
      throw provisionError(
        "ip_restrictions cannot be combined with deliver_to: the token is used by the target worker, not by the caller",
        "deliver_to_invalid",
        400,
      );
    }

    const { script, secret_name: secretName } = deliverTo;
    const target = DELIVER_TARGETS.find(
      (t) =>
        t.script === script && t.secret_name === secretName && t.type === type,
    );
    if (!target) {
      throw provisionError(
        "deliver_target_not_allowed: (script, secret_name, type) is not an allow-listed delivery target",
        "deliver_target_not_allowed",
        403,
      );
    }

    return { script: target.script, secret_name: target.secret_name };
  }

  /**
   * Write a freshly created token into a worker secret.
   *
   * - HTTP 2xx: delivered, whatever the body (an unparseable 2xx body does
   *   not mean the write failed). A parseable body with success === false
   *   is the one 2xx case treated as failure.
   * - Non-2xx or success === false: the write did not happen, so the token
   *   is revoked and 502 deliver_failed is thrown.
   * - Timeout / network error: the outcome is unknown (Cloudflare may have
   *   applied it), so the token is NOT revoked; 502 deliver_unknown carries
   *   the token id for reconciliation.
   *
   * Errors never carry the token value or a Cloudflare response body.
   *
   * @private
   */
  async deliverTokenToWorkerSecret(token, target, accountId, makeApiKey, rowId) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
    let response;
    try {
      response = await fetch(
        `${base}/workers/scripts/${encodeURIComponent(target.script)}/secrets`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${makeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: target.secret_name,
            text: token.value,
            type: "secret_text",
          }),
          signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
        },
      );
    } catch {
      // The thrown error is not surfaced: a fetch error message is not a
      // channel this path controls.
      await this.markDelivery(rowId, "unknown", false);
      console.error(
        `[EnhancedCredentialProvisioner] Delivery of token ${token.id} to ${target.script} has unknown outcome (request failed or timed out); token NOT revoked`,
      );
      throw provisionError(
        `deliver_unknown: writing secret ${target.secret_name} to ${target.script} did not complete (request failed or timed out); token ${token.id} was NOT revoked — reconcile the worker secret against it`,
        "deliver_unknown",
        502,
        { token_id: token.id },
      );
    }

    let failure = null;
    if (!response.ok) {
      failure = `HTTP ${response.status}`;
    } else {
      const body = await response.json().catch(() => undefined);
      if (body && typeof body === "object" && body.success === false) {
        failure = "Cloudflare reported success=false";
      }
    }

    if (!failure) return target;

    const revoked = await this.revokeCloudflareToken(
      token.id,
      accountId,
      makeApiKey,
    );
    // A failed revoke leaves the row unrevoked, so the next successful
    // delivery to this target revokes the token.
    await this.markDelivery(rowId, "failed", revoked);

    console.error(
      `[EnhancedCredentialProvisioner] Delivery of token ${token.id} to ${target.script} failed (${failure}); revoked=${revoked}`,
    );
    throw provisionError(
      revoked
        ? `deliver_failed: writing secret ${target.secret_name} to ${target.script} failed (${failure}); token ${token.id} was revoked`
        : `deliver_failed: writing secret ${target.secret_name} to ${target.script} failed (${failure}); REVOKE FAILED for token ${token.id} — revoke it manually`,
      "deliver_failed",
      502,
    );
  }

  /**
   * Take the per-target delivery lease with one atomic upsert: it succeeds
   * when no lease exists or the existing one has expired. Throws 409
   * deliver_in_progress when another delivery holds it, and fails closed
   * (503) when the lease store is unavailable. Makes no Cloudflare call.
   *
   * @private
   */
  async acquireDeliveryLease(target, holder) {
    const key = deliveryKey(target);
    const now = Date.now();
    let row;
    try {
      row = await this.env.DB.prepare(
        `INSERT INTO credential_delivery_leases (target, holder, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(target) DO UPDATE
           SET holder = excluded.holder, expires_at = excluded.expires_at
           WHERE credential_delivery_leases.expires_at < ?
         RETURNING holder`,
      )
        .bind(key, holder, now + DELIVER_LEASE_MS, now)
        .first();
    } catch (error) {
      console.error(
        `[EnhancedCredentialProvisioner] Delivery lease for ${key} unavailable: ${error?.message}`,
      );
      throw provisionError(
        `deliver_lease_unavailable: could not take the delivery lease for ${key}; no token was minted`,
        "deliver_lease_unavailable",
        503,
      );
    }
    if (row?.holder !== holder) {
      throw provisionError(
        `deliver_in_progress: another delivery to ${key} is in progress; no token was minted — retry after it completes`,
        "deliver_in_progress",
        409,
      );
    }
  }

  /** @private Never throws; an unreleased lease expires on its own. */
  async releaseDeliveryLease(target, holder) {
    try {
      await this.env.DB.prepare(
        `DELETE FROM credential_delivery_leases WHERE target = ? AND holder = ?`,
      )
        .bind(deliveryKey(target), holder)
        .run();
    } catch (error) {
      console.error(
        `[EnhancedCredentialProvisioner] Could not release delivery lease for ${deliveryKey(target)}: ${error?.message}`,
      );
    }
  }

  /**
   * Insert the audit row for a minted-but-not-yet-delivered token, marked
   * delivery_state = 'pending'. The row is keyed to its target by service =
   * script and purpose = `deliver_to:<script>/<secret>`; delivery_state is
   * set only on this path. If the row cannot be written the token is
   * revoked and 503 is thrown, so no live token goes untracked.
   *
   * @private
   * @returns {Promise<number>} the row id
   */
  async recordPendingDelivery(token, target, meta, accountId, makeApiKey) {
    let row = null;
    try {
      row = await this.env.DB.prepare(
        `INSERT INTO credential_provisions
         (type, service, purpose, requesting_service, token_id, expires_at, created_at, delivery_state)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'pending')
         RETURNING id`,
      )
        .bind(
          meta.type,
          target.script,
          `${DELIVER_PURPOSE_PREFIX}${deliveryKey(target)}`,
          meta.requestingService,
          token.id,
          token.expires_on || null,
        )
        .first();
    } catch (error) {
      console.error(
        `[EnhancedCredentialProvisioner] Could not record pending delivery of token ${token.id}: ${error?.message}`,
      );
    }
    if (row?.id != null) return row.id;

    const revoked = await this.revokeCloudflareToken(
      token.id,
      accountId,
      makeApiKey,
    );
    throw provisionError(
      revoked
        ? `deliver_tracking_unavailable: could not record token ${token.id} before delivery; it was revoked and not delivered`
        : `deliver_tracking_unavailable: could not record token ${token.id} before delivery and REVOKE FAILED — revoke it manually`,
      "deliver_tracking_unavailable",
      503,
    );
  }

  /** @private Never throws. */
  async markDelivery(rowId, state, revoked) {
    try {
      await this.env.DB.prepare(
        revoked
          ? `UPDATE credential_provisions SET delivery_state = ?, revoked_at = datetime('now') WHERE id = ?`
          : `UPDATE credential_provisions SET delivery_state = ? WHERE id = ?`,
      )
        .bind(state, rowId)
        .run();
    } catch (error) {
      console.error(
        `[EnhancedCredentialProvisioner] Could not mark delivery row ${rowId} ${state}: ${error?.message}`,
      );
    }
  }

  /**
   * @private
   * @returns {Promise<boolean>} true when the token is gone (2xx, or 404:
   *   it no longer exists, which is the state revocation is after).
   */
  async revokeCloudflareToken(tokenId, accountId, makeApiKey) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/${encodeURIComponent(tokenId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${makeApiKey}` },
        },
      );
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  /**
   * Mark this delivery's row delivered and revoke every earlier token still
   * live for the same target, so re-provisioning does not leave the old
   * token valid. Only delivery-path rows (delivery_state set) strictly older
   * than this request's own row are eligible — pending, unknown and
   * failed-but-unrevoked rows included.
   *
   * Never throws: the new token is already in the worker secret, so every
   * outcome is reported as a non-secret status instead.
   *
   * @private
   * @returns {Promise<{status: string, token_ids: string[]}>}
   *   status: "none" (no earlier token), "revoked", "revoke_failed", or
   *   "tracking_unavailable" (audit store unreadable/unwritable).
   */
  async rotateDeliveredToken(token, target, rowId, accountId, makeApiKey) {
    const db = this.env.DB;
    let previous;
    try {
      await db
        .prepare(
          `UPDATE credential_provisions SET delivery_state = 'delivered' WHERE id = ?`,
        )
        .bind(rowId)
        .run();
      const rows = await db
        .prepare(
          `SELECT token_id FROM credential_provisions
           WHERE service = ? AND purpose = ? AND delivery_state IS NOT NULL
             AND revoked_at IS NULL AND token_id IS NOT NULL AND id < ?
           ORDER BY id`,
        )
        .bind(
          target.script,
          `${DELIVER_PURPOSE_PREFIX}${deliveryKey(target)}`,
          rowId,
        )
        .all();
      previous = (rows?.results || []).map((r) => r.token_id);
    } catch (error) {
      console.error(
        `[EnhancedCredentialProvisioner] Delivery tracking for ${target.script} unavailable: ${error?.message}`,
      );
      return { status: "tracking_unavailable", token_ids: [] };
    }

    if (previous.length === 0) return { status: "none", token_ids: [] };

    const failed = [];
    for (const id of previous) {
      if (!(await this.revokeCloudflareToken(id, accountId, makeApiKey))) {
        failed.push(id);
        continue;
      }
      try {
        await db
          .prepare(
            `UPDATE credential_provisions SET revoked_at = datetime('now') WHERE token_id = ?`,
          )
          .bind(id)
          .run();
      } catch (error) {
        console.error(
          `[EnhancedCredentialProvisioner] Revoked token ${id} but could not mark it revoked: ${error?.message}`,
        );
      }
    }

    if (failed.length > 0) {
      console.error(
        `[EnhancedCredentialProvisioner] Revoking previous token(s) ${failed.join(", ")} for ${target.script} failed`,
      );
      return { status: "revoke_failed", token_ids: failed };
    }
    return { status: "revoked", token_ids: previous };
  }
}
