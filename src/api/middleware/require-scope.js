/**
 * Scope Enforcement Middleware
 *
 * Authorization layer for routes that return credential material. The
 * `authenticate` middleware (./auth.js) establishes *identity* — that a caller
 * presented a key which exists and is active. It deliberately makes no
 * authorization decision. This middleware makes that decision, keyed off the
 * `scopes` array already written onto every issued key record by
 * `generateAPIKey` (src/middleware/mcp-auth.js).
 *
 * Deny-by-default: a key with no `scopes` field, an empty `scopes` array, or a
 * `scopes` array lacking the required entry is rejected. There is no
 * allow-with-warning mode — per the sensitive-intent contract
 * (~/.ch1tty/canon/system-wide-sensitive-intent-contract-v1.md) the credential
 * path fails closed, and a warning nobody reads is an open door.
 *
 * The 403 body names the scope that was required so an under-provisioned
 * caller can be reissued a correct key without needing to read this source.
 *
 * Scope vocabulary is namespaced separately from the MCP OAuth vocabulary
 * (`mcp:read|write|admin`, declared in src/middleware/oauth-provider.js). Both
 * land in the same `keyInfo.scopes` array, and a key granted MCP tool access
 * must never satisfy a credential-reveal check by vocabulary coincidence.
 *
 * @module api/middleware/require-scope
 */

/**
 * Vaults the credential routes expose. Kept in sync with the `validVaults`
 * check in ../routes/credentials.js — a vault absent here has no reachable
 * scope and is therefore denied, which is the correct direction to fail.
 */
export const REVEAL_SCOPE_PREFIX = "credentials:reveal";

/**
 * Build the scope string that guards reveal of a given vault.
 *
 * @param {string} vault - Vault name (infrastructure | services | integrations)
 * @returns {string} e.g. "credentials:reveal:infrastructure"
 */
export function revealScopeFor(vault) {
  return `${REVEAL_SCOPE_PREFIX}:${vault}`;
}

/**
 * Read the scopes off the authenticated key, tolerating legacy records.
 *
 * Legacy keys predating the `scopes` field surface as `undefined`; keys issued
 * without explicit scopes surface as `[]`. Both mean "no grants" and collapse
 * to the same denial — there is no meaningful distinction to preserve.
 *
 * @param {object} c - Hono context
 * @returns {string[]}
 */
function scopesOf(c) {
  const keyInfo = c.get("apiKey");
  const scopes = keyInfo?.scopes;
  return Array.isArray(scopes) ? scopes : [];
}

/**
 * Require a fixed scope.
 *
 * @param {string} scope - Scope string the caller's key must carry
 * @returns {Function} Hono middleware
 */
export function requireScope(scope) {
  return async (c, next) => {
    return enforce(c, next, scope);
  };
}

/**
 * Require a scope derived from the request — used where the guarded resource
 * is identified by a path param (e.g. `:vault`) and a single fixed scope would
 * be either too coarse or unknowable at mount time.
 *
 * If the resolver returns a falsy value the request is denied: an unresolvable
 * scope means an unrecognised resource, and guessing would defeat the gate.
 *
 * @param {(c: object) => string|undefined} resolve - Derives the required scope
 * @returns {Function} Hono middleware
 */
export function requireScopeFrom(resolve) {
  return async (c, next) => {
    const scope = resolve(c);
    if (!scope) {
      return c.json(
        {
          success: false,
          error: {
            code: "SCOPE_UNRESOLVABLE",
            message:
              "Could not determine the scope required for this resource; denying.",
          },
        },
        403,
      );
    }
    return enforce(c, next, scope);
  };
}

/**
 * Shared decision + audit point for both middleware forms.
 *
 * The audit line carries the key's service/name and the scope decision but
 * never the key itself or any credential material.
 */
async function enforce(c, next, scope) {
  const keyInfo = c.get("apiKey") || {};
  const granted = scopesOf(c);
  const allowed = granted.includes(scope);

  console.log(
    JSON.stringify({
      tag: "scope-audit",
      scope,
      allowed,
      keyType: keyInfo.type || "api-key",
      service: keyInfo.service || keyInfo.name || "unknown",
      path: c.req.path,
    }),
  );

  if (!allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: "INSUFFICIENT_SCOPE",
          message: `This endpoint requires the '${scope}' scope. The presented key does not carry it.`,
          required: scope,
        },
      },
      403,
    );
  }

  await next();
}
