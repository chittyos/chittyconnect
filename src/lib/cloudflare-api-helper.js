/**
 * Cloudflare API Helper
 *
 * Shared utilities for Cloudflare infrastructure MCP tools:
 * credential retrieval and timeframe parsing.
 *
 * @module lib/cloudflare-api-helper
 */

import { getCredential } from "./credential-helper.js";
import { CREDENTIAL_PATHS } from "./credential-paths.js";

/**
 * Retrieve Cloudflare API credentials from 1Password or env fallbacks.
 *
 * @param {object} env - Cloudflare Worker environment bindings
 * @returns {Promise<{apiToken: string|undefined, accountId: string|undefined}>}
 */
export async function getCloudflareApiCredentials(env) {
  const apiToken = await getCredential(
    env,
    CREDENTIAL_PATHS.infrastructure.cloudflareApiToken,
    "CLOUDFLARE_MAKE_API_KEY",
    "CloudflareAPI",
  );

  const accountId =
    env.CHITTYOS_ACCOUNT_ID ||
    (await getCredential(
      env,
      CREDENTIAL_PATHS.infrastructure.cloudflareAccountId,
      "CLOUDFLARE_ACCOUNT_ID",
      "CloudflareAccountId",
    ));

  return { apiToken, accountId };
}

/**
 * Parse a human-friendly timeframe string into ISO 8601 `since`/`before` timestamps.
 *
 * Supported formats: "15m", "1h", "6h", "24h", "7d"
 *
 * @param {string} str - Timeframe shorthand (e.g. "1h")
 * @returns {{since: string, before: string}}
 * @throws {Error} If the format is invalid
 */
export function parseTimeframe(str) {
  const match = /^(\d+)([mhd])$/.exec(str);
  if (!match) {
    throw new Error(
      `Invalid timeframe "${str}". Use formats like 15m, 1h, 6h, 24h, 7d`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let ms;
  switch (unit) {
    case "m":
      ms = value * 60 * 1000;
      break;
    case "h":
      ms = value * 60 * 60 * 1000;
      break;
    case "d":
      ms = value * 24 * 60 * 60 * 1000;
      break;
  }

  const now = Date.now();
  return {
    since: new Date(now - ms).toISOString(),
    before: new Date(now).toISOString(),
  };
}
