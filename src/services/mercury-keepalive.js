/**
 * Mercury token keepalive.
 *
 * WHY THIS EXISTS
 *
 * Mercury API tokens are static bearer keys with no OAuth refresh. Mercury deletes
 * a token after a period of API inactivity (30-45 days, depending on which Mercury
 * doc you read — we ping well inside the shorter figure). A token is not "expired"
 * in a recoverable sense when that happens: it is gone, and only a human in the
 * Mercury dashboard can mint a replacement.
 *
 * Two keepalive implementations were already written for this and BOTH were dead
 * code, wired to nothing:
 *   - POST /api/thirdparty/mercury/refresh in this repo (src/api/routes/thirdparty.js)
 *   - TokenSteward in chittyconnect-finance (library-only repo, never deployed)
 *
 * Meanwhile, on 2026-09-17, 2 of the 3 Mercury tokens deployed on chittyagent-finance
 * returned 401 — deleted for inactivity. The only thing keeping any token alive was an
 * incidental side effect of chittycommand's daily sync cron.
 *
 * This module is the wiring those implementations never got. It runs from
 * chittyconnect's existing hourly cron, which is a deployed, live scheduler.
 *
 * SAFETY
 *
 * Token values are resolved and handed to fetch. They are never logged, never
 * returned, and never written to KV. Everything this module reports is a count, a
 * slug, or an HTTP status.
 */

/** Binding prefix for per-entity Mercury read tokens. */
const MERCURY_TOKEN_PREFIX = "MERCURY_TOKEN_";

/** KV key prefix for per-slug last-successful-ping timestamps. */
const KEEPALIVE_KEY_PREFIX = "mercury:keepalive:";

/**
 * Default ping cadence. Mercury's documented inactivity window is 30-45 days;
 * 20 days leaves room for two consecutive missed runs before a token is at risk.
 */
const DEFAULT_INTERVAL_DAYS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Binding names that start with MERCURY_TOKEN_ but are not per-entity read tokens.
 * Empty today — MERCURY_WRITE_TOKEN_* and MERCURY_OIDC_* do not share the prefix —
 * but kept explicit so a future MERCURY_TOKEN_SOMETHING_GLOBAL cannot silently
 * become a phantom entity.
 */
const NON_ENTITY_BINDINGS = new Set([]);

/**
 * Per-entity Mercury token binding names present on env.
 *
 * Presence only — this never resolves a value, so it is safe to call from
 * unauthenticated or diagnostic paths.
 *
 * Sorted explicitly: Object.keys() ordering on a runtime-constructed env is not a
 * documented Workers guarantee, and unsorted iteration makes "which slugs were
 * pinged" vary between runs for no reason.
 *
 * @param {Record<string, unknown>} env
 * @returns {string[]} binding names
 */
export function mercuryTokenBindings(env) {
  const e = env || {};
  return Object.keys(e)
    .filter(
      (k) =>
        k.startsWith(MERCURY_TOKEN_PREFIX) &&
        !NON_ENTITY_BINDINGS.has(k) &&
        e[k] != null,
    )
    .sort();
}

/**
 * Binding name -> Mercury org slug.
 * MERCURY_TOKEN_ARIBIA_LLC_CITY_STUDIO -> aribia-llc-city-studio
 *
 * @param {string} binding
 * @returns {string}
 */
export function bindingToSlug(binding) {
  return binding
    .slice(MERCURY_TOKEN_PREFIX.length)
    .toLowerCase()
    .replace(/_/g, "-");
}

/**
 * Is this slug due for a ping?
 *
 * An unknown or unparseable last-ping is treated as DUE, not as fresh. Failing the
 * other way would mean a token whose state was lost silently stops being pinged and
 * quietly dies — the exact failure this module exists to prevent.
 *
 * @param {string|null|undefined} lastPingedIso
 * @param {number} now epoch ms
 * @param {number} intervalDays
 * @returns {boolean}
 */
export function isDue(lastPingedIso, now, intervalDays = DEFAULT_INTERVAL_DAYS) {
  if (!lastPingedIso) return true;
  const last = Date.parse(lastPingedIso);
  if (Number.isNaN(last)) return true;
  return now - last >= intervalDays * DAY_MS;
}

/**
 * Run the keepalive sweep.
 *
 * Every dependency that touches the network or a binding is injected, so the
 * scheduling and reporting logic is exercised by real unit tests rather than by
 * mocking a module graph.
 *
 * @param {Record<string, unknown>} env
 * @param {object} deps
 * @param {(binding: unknown) => Promise<string|undefined>} deps.resolveBinding
 * @param {(token: string, path: string, options: object, egress: object) => Promise<unknown>} deps.mercuryFetch
 * @param {(env: Record<string, unknown>, slug: string) => object} deps.resolveEgressProfile
 * @param {number} [deps.now] epoch ms, defaults to Date.now()
 * @param {number} [deps.intervalDays]
 * @returns {Promise<{checked:number,pinged:number,skipped:number,failed:number,unauthorized:string[],errors:Array<{slug:string,error:string}>}>}
 */
export async function runMercuryKeepalive(env, deps) {
  const {
    resolveBinding,
    mercuryFetch,
    resolveEgressProfile,
    now = Date.now(),
    intervalDays = Number(env?.MERCURY_KEEPALIVE_INTERVAL_DAYS) ||
      DEFAULT_INTERVAL_DAYS,
  } = deps;

  const kv = env?.TOKEN_KV;
  const bindings = mercuryTokenBindings(env);

  const report = {
    checked: bindings.length,
    pinged: 0,
    skipped: 0,
    failed: 0,
    unauthorized: [],
    errors: [],
  };

  for (const binding of bindings) {
    const slug = bindingToSlug(binding);
    const key = `${KEEPALIVE_KEY_PREFIX}${slug}`;

    try {
      // A KV read failure must not mark the slug fresh — treat it as due.
      let lastPinged = null;
      if (kv) {
        try {
          lastPinged = await kv.get(key);
        } catch (err) {
          console.warn(
            `[mercury-keepalive] KV read failed for ${slug}, treating as due: ${err.message}`,
          );
        }
      }

      if (!isDue(lastPinged, now, intervalDays)) {
        report.skipped++;
        continue;
      }

      const token = await resolveBinding(env[binding]);
      if (!token) {
        report.failed++;
        report.errors.push({ slug, error: "binding present but resolved empty" });
        continue;
      }

      // GET /accounts is the cheapest authenticated call Mercury offers. Any
      // successful call resets the inactivity clock; the response is discarded.
      await mercuryFetch(token, "/accounts", {}, resolveEgressProfile(env, slug));

      report.pinged++;
      if (kv) {
        try {
          await kv.put(key, new Date(now).toISOString());
        } catch (err) {
          // The ping succeeded — that is what keeps the token alive. A failed
          // bookkeeping write only costs an extra ping next run.
          console.warn(
            `[mercury-keepalive] KV write failed for ${slug}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      const message = err?.message || String(err);
      report.failed++;
      // A 401 means the token is already gone — it needs a human to reissue it in
      // the Mercury dashboard, so it is surfaced separately from transient errors.
      if (/\b401\b/.test(message)) {
        report.unauthorized.push(slug);
      } else {
        report.errors.push({ slug, error: message });
      }
    }
  }

  return report;
}

export const __testing = {
  MERCURY_TOKEN_PREFIX,
  KEEPALIVE_KEY_PREFIX,
  DEFAULT_INTERVAL_DAYS,
  DAY_MS,
};
