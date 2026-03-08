/**
 * Canonical credential paths used by ChittyConnect.
 *
 * Keep credential path definitions centralized to prevent drift across routes,
 * MCP tools, and provisioning services.
 */

export const CREDENTIAL_PATHS = {
  infrastructure: {
    cloudflareMakeApiKey: "infrastructure/cloudflare/make_api_key",
    cloudflareAccountId: "infrastructure/cloudflare/account_id",
    neonDatabaseUrl: "infrastructure/neon/database_url",
    githubAppId: "infrastructure/github/app_id",
    githubPrivateKey: "infrastructure/github/private_key",
  },
  integrations: {
    openaiApiKey: "integrations/openai/api_key",
    notionApiKey: "integrations/notion/api_key",
    githubPat: "integrations/github/personal_access_token",
    googleAccessToken: "integrations/google/access_token",
    neonApiKey: "integrations/neon/api_key",
  },
  services: {
    serviceToken: (serviceName) => `services/${serviceName}/service_token`,
  },
};

/**
 * Backward-compatibility aliases for legacy credential paths.
 */
export const LEGACY_CREDENTIAL_PATH_ALIASES = {
  "database/neon/chittyos_core": CREDENTIAL_PATHS.infrastructure.neonDatabaseUrl,
  "integrations/github/token": CREDENTIAL_PATHS.integrations.githubPat,
};