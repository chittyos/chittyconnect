/**
 * Hono middleware that resolves a ChittyOS service token via the credential
 * broker (1Password → env fallback) and attaches it to the context.
 *
 * Usage:
 *   import { requireServiceToken } from "../../middleware/require-service-token.js";
 *   route.use("*", requireServiceToken("chittycases"));
 *   // then in handler: c.get("serviceToken")
 */

import { getServiceToken } from "../lib/credential-helper.js";

/**
 * @param {string} serviceName - e.g. "chittycases", "chittyfinance"
 * @returns {import("hono").MiddlewareHandler}
 */
export function requireServiceToken(serviceName) {
  return async (c, next) => {
    const token = await getServiceToken(c.env, serviceName);
    if (!token) {
      return c.json(
        {
          error: `${serviceName} service token not configured`,
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503,
      );
    }
    c.set("serviceToken", token);
    await next();
  };
}
