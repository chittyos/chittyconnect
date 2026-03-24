/**
 * 1Password credential paths for ChittyOS integrations.
 *
 * @module lib/credential-paths
 */

export const CREDENTIAL_PATHS = {
  integrations: {
    neonApiKey: "integrations/neon/api_key",
    neonDatabaseUrl: "integrations/neon/database_url",
    openaiApiKey: "integrations/openai/api_key",
    notionApiKey: "integrations/notion/api_key",
    githubPat: "integrations/github/pat",
    anthropicApiKey: "integrations/anthropic/api_key",
    stripeApiKey: "integrations/stripe/api_key",
  },
  infrastructure: {
    cloudflareApiToken: "infrastructure/cloudflare/api_token",
    cloudflareAccountId: "infrastructure/cloudflare/account_id",
  },
};
