/**
 * CORS origin validation for ChittyOS services.
 * Allows *.chitty.cc and localhost origins only.
 */

const ALLOWED_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*chitty\.cc$/,
  /^https:\/\/chat\.openai\.com$/,
  /^https:\/\/chatgpt\.com$/,
  /^https:\/\/chittyconnect-ui\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.chittyconnect-ui\.pages\.dev$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

/**
 * Returns the origin if allowed, or null if not.
 * @param {string|null} origin - The request Origin header
 * @returns {string|null}
 */
export function getAllowedOrigin(origin) {
  if (!origin) return null;
  return ALLOWED_PATTERNS.some((p) => p.test(origin)) ? origin : null;
}

/**
 * Returns CORS headers for a request.
 * @param {Request} request
 * @returns {Record<string, string>}
 */
export function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowed = getAllowedOrigin(origin);
  return {
    ...(allowed && { "Access-Control-Allow-Origin": allowed }),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}
