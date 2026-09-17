/**
 * Resolve Cloudflare Secrets Store bindings to plain strings before any
 * handler sees `env`.
 *
 * WHY THIS EXISTS
 * ---------------
 * A `secrets_store_secrets` binding is NOT a string. It arrives as an object
 * exposing an async `.get()` (see `resolveBinding()` in
 * `src/services/cloudflare-secrets-client.js`, which was written to cope with
 * exactly this). Anything that reads `env.NAME` and uses it directly gets the
 * object, and template interpolation then yields the literal text
 * "[object Object]".
 *
 * That is not hypothetical. Before this module existed,
 * `src/intelligence/context-resolver.js` built the primary ChittyMint auth
 * header as:
 *
 *     Authorization: `Bearer ${
 *       this.env.CHITTYAUTH_ISSUED_MINT_API_KEY ||   // Store binding: object
 *       this.env.CHITTYAUTH_ISSUED_MINT_TOKEN  ||   // Store binding: object
 *       this.env.MINT_API_KEY                  ||   // Store binding: object
 *       this.env.CHITTYMINT_SECRET             ||   // secret_text: string
 *       this.env.CHITTY_ID_TOKEN               ||   // secret_text: string
 *       ""
 *     }`
 *
 * A binding object is always truthy, so the chain short-circuited on the first
 * operand and never reached the two fallbacks that would have worked. The
 * worker sent `Bearer [object Object]` in production, and the failure was
 * masked by a fallback-URL path rather than surfacing.
 *
 * WHY EAGER, NOT LAZY
 * -------------------
 * A Proxy would be tidier, but call sites read `env.NAME` **synchronously** and
 * a Proxy get-trap cannot await. Resolution therefore has to happen before
 * handlers run.
 *
 * WHY NO CACHE HERE
 * -----------------
 * Deliberately none. Caching resolved values for the life of the isolate would
 * pin a rotated secret until that isolate recycled — converting a rotation into
 * a silent, staggered outage. The Workers runtime already caches Secrets Store
 * reads, so the right move is to ask every invocation and let the platform
 * decide, not to build a second cache with worse invalidation.
 *
 * FAILURE POSTURE
 * ---------------
 * A binding that cannot be resolved is set to `undefined`, never left as the
 * object. Undefined is falsy, so `||` chains fall through to their remaining
 * operands exactly as their authors intended; an object silently defeats them.
 * This does not invent a value and it does not throw: one unresolvable secret
 * must not take down every route in the worker. Call sites keep whatever
 * error handling they already have.
 *
 * Secret VALUES are never logged. Only binding NAMES appear in diagnostics.
 */

/**
 * Methods that positively identify a binding as something OTHER than a
 * Secrets Store secret.
 *
 * This list is the load-bearing part of this module. A Secrets Store binding
 * is identified by having `.get()` — but so do several bindings whose `.get`
 * means something entirely different:
 *
 *   KVNamespace            get(key), getWithMetadata, put, list, delete
 *   R2Bucket               get(key), head, put, delete, list, createMultipartUpload
 *   DurableObjectNamespace get(id), idFromName, idFromString, newUniqueId
 *
 * A naive `typeof v.get === "function"` test matches all three. Normalizing on
 * that basis would call `kv.get()` with no key and then REPLACE the binding
 * with the result — destroying `env.IDEMP_KV`, `env.TOKEN_KV`, `env.API_KEYS`,
 * `env.OAUTH_KV`, `env.CREDENTIAL_CACHE`, `env.FILES`, `env.MCP_AGENT` and
 * `env.SESSION_STATE` on this worker. That is a total outage, not a
 * degradation, and it is the exact mistake the first revision of this file
 * made. Do not "simplify" this back to a bare `.get` check.
 *
 * Detecting by absence rather than presence is deliberate: a false negative
 * leaves a secret unresolved (the pre-existing bug, loud at the call site),
 * whereas a false positive destroys a live binding. The asymmetry decides the
 * direction of the test.
 */
const NON_SECRET_BINDING_METHODS = Object.freeze([
  // KV
  "getWithMetadata",
  "put",
  "list",
  "delete",
  // R2
  "head",
  "createMultipartUpload",
  "resumeMultipartUpload",
  // Durable Objects
  "idFromName",
  "idFromString",
  "newUniqueId",
  "jurisdiction",
  // D1
  "prepare",
  "batch",
  "exec",
  // Queues
  "send",
  "sendBatch",
  // Service bindings / Hyperdrive / AI
  "fetch",
  "connect",
  "run",
]);

/**
 * True only for a Cloudflare Secrets Store binding: an object exposing an
 * async `get()` and none of the methods that mark it as a different resource.
 *
 * @param {unknown} v
 */
export function isSecretsStoreBinding(v) {
  if (!v || typeof v !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  if (typeof o.get !== "function") return false;
  for (const method of NON_SECRET_BINDING_METHODS) {
    if (typeof o[method] === "function") return false;
  }
  return true;
}

/**
 * Names of the Secrets Store bindings present on `env`, in declaration order.
 * Exported for tests and diagnostics.
 *
 * @param {Record<string, unknown>} env
 * @returns {string[]}
 */
export function secretsStoreBindingNames(env) {
  if (!env || typeof env !== "object") return [];
  return Object.keys(env).filter((k) => isSecretsStoreBinding(env[k]));
}

/**
 * Return a shallow copy of `env` in which every Secrets Store binding has been
 * replaced by its string value (or `undefined` if it could not be resolved).
 *
 * The original `env` is never mutated — the platform object stays intact for
 * anything holding a reference to it, and this stays safe to call more than
 * once. Calling it on an already-normalized env is a no-op, so it is safe at
 * nested entry points.
 *
 * @param {Record<string, unknown>} env
 * @param {{ onError?: (name: string, error: unknown) => void }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function normalizeEnv(env, options = {}) {
  if (!env || typeof env !== "object") return env;

  const names = secretsStoreBindingNames(env);
  if (names.length === 0) return env;

  const onError =
    options.onError ||
    ((name, error) => {
      // Name only — never the value, and never the binding object.
      console.warn(
        `[normalize-env] Secrets Store binding "${name}" did not resolve; ` +
          `treating as absent so || fallbacks still apply:`,
        error instanceof Error ? error.message : String(error),
      );
    });

  const resolved = await Promise.all(
    names.map(async (name) => {
      try {
        const value = await /** @type {{get: () => Promise<unknown>}} */ (
          env[name]
        ).get();
        if (typeof value === "string" && value.length > 0) {
          return [name, value];
        }
        // Present but empty is a misconfiguration, not an outage. Same posture.
        onError(name, new Error("resolved to an empty or non-string value"));
        return [name, undefined];
      } catch (error) {
        onError(name, error);
        return [name, undefined];
      }
    }),
  );

  const out = { ...env };
  for (const [name, value] of resolved) out[name] = value;
  return out;
}
