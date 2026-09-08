#!/usr/bin/env node
/**
 * Print the binding names attached to the LIVE, ACTIVELY-SERVING version of the
 * worker, one per line.
 *
 * Reads through wrangler rather than calling the Cloudflare REST API directly.
 * That is not a stylistic choice: wrangler is already authenticated by whatever
 * ran the deploy — including Cloudflare Workers Builds, which authenticates
 * wrangler by its own internal mechanism and injects no CLOUDFLARE_API_TOKEN.
 * The previous curl-based audit needed a SECOND credential that does not exist in
 * CI, so the guard could never run on the one automated deploy path.
 *
 * Audits EVERY version currently serving traffic (from `deployments status`), not
 * the newest uploaded version — a failed or partially-rolled-out deploy would
 * otherwise be audited against code no user is hitting.
 *
 * It prints the INTERSECTION of the serving versions' bindings. During a gradual
 * rollout a binding present in only some versions is not safe, because some share
 * of live traffic hits a version without it. Intersecting means the caller flags it
 * as drift. Picking a single "primary" version instead — by highest traffic share —
 * would let a stripped minority version pass unnoticed, and ties would decide it
 * arbitrarily.
 *
 * Usage: node scripts/lib/audit-live-bindings.mjs <staging|production>
 */

import { execFileSync } from "node:child_process";

const env = process.argv[2];
if (!env) {
  console.error("usage: audit-live-bindings.mjs <staging|production>");
  process.exit(64);
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * wrangler may emit a banner or deprecation warning before the JSON payload, so
 * slice from the first structural character rather than parsing the whole stream.
 */
function wranglerJson(args) {
  const out = wrangler(args);
  const start = out.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in wrangler output: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start));
}

let status;
try {
  status = wranglerJson(["deployments", "status", "--env", env, "--json"]);
} catch (err) {
  console.error(`audit-live-bindings: could not read deployment status for env=${env}`);
  console.error(String(err.stderr || err.message).trim().slice(0, 800));
  process.exit(71);
}

const versions = Array.isArray(status?.versions) ? status.versions : [];
if (versions.length === 0) {
  console.error("audit-live-bindings: deployment reports no versions — refusing to audit");
  process.exit(71);
}

// Every version taking a non-zero share of traffic. A version at 0% serves nobody.
const serving = versions.filter((v) => v?.version_id && (v.percentage ?? 0) > 0);
if (serving.length === 0) {
  console.error("audit-live-bindings: no version is serving traffic — refusing to audit");
  process.exit(71);
}

let intersection = null;
for (const v of serving) {
  let version;
  try {
    version = wranglerJson(["versions", "view", v.version_id, "--env", env, "--json"]);
  } catch (err) {
    console.error(`audit-live-bindings: could not read version ${v.version_id}`);
    console.error(String(err.stderr || err.message).trim().slice(0, 800));
    process.exit(71);
  }

  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) {
    // Fail rather than print nothing: an empty list would read as "no drift" to the
    // caller and silently convert this guard into a no-op.
    console.error(`audit-live-bindings: version ${v.version_id} carried no resources.bindings array`);
    process.exit(71);
  }

  // Reject names carrying whitespace: the caller compares line-by-line, so an
  // embedded newline would split one name into two and could fabricate a match.
  const names = new Set(
    bindings.map((b) => b?.name).filter((n) => typeof n === "string" && n && !/\s/.test(n)),
  );
  if (names.size === 0) {
    console.error(
      `audit-live-bindings: version ${v.version_id} (${v.percentage}% of traffic) reports ZERO named bindings`,
    );
    process.exit(71);
  }
  intersection = intersection === null ? names : new Set([...intersection].filter((n) => names.has(n)));
}

const out = [...intersection].sort();
if (out.length === 0) {
  console.error("audit-live-bindings: serving versions share ZERO bindings — refusing to report success");
  process.exit(71);
}
console.log(out.join("\n"));
