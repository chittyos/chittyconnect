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
 * Audits the version that is actually serving traffic (from `deployments status`),
 * not the newest uploaded version — a failed or partially-rolled-out deploy would
 * otherwise be audited against code no user is hitting.
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

let status;
try {
  status = JSON.parse(wrangler(["deployments", "status", "--env", env, "--json"]));
} catch (err) {
  console.error(`audit-live-bindings: could not read deployment status for env=${env}`);
  console.error(String(err.stderr || err.message).trim().slice(0, 800));
  process.exit(71);
}

// Pick the version carrying the most traffic. A gradual rollout can list several;
// auditing the minority version would let a binding-stripped majority slip through.
const versions = Array.isArray(status?.versions) ? status.versions : [];
if (versions.length === 0) {
  console.error("audit-live-bindings: deployment reports no versions — refusing to audit");
  process.exit(71);
}
const active = versions.reduce((a, b) => ((b.percentage ?? 0) > (a.percentage ?? 0) ? b : a));
if (!active?.version_id) {
  console.error("audit-live-bindings: active version has no version_id");
  process.exit(71);
}

let version;
try {
  version = JSON.parse(wrangler(["versions", "view", active.version_id, "--env", env, "--json"]));
} catch (err) {
  console.error(`audit-live-bindings: could not read version ${active.version_id}`);
  console.error(String(err.stderr || err.message).trim().slice(0, 800));
  process.exit(71);
}

const bindings = version?.resources?.bindings;
if (!Array.isArray(bindings)) {
  // Fail rather than print nothing: an empty list would read as "no drift" to the
  // caller and silently convert this guard into a no-op.
  console.error("audit-live-bindings: version payload carried no resources.bindings array");
  process.exit(71);
}

const names = [...new Set(bindings.map((b) => b?.name).filter((n) => typeof n === "string" && n))].sort();
if (names.length === 0) {
  console.error("audit-live-bindings: live version reports ZERO named bindings — refusing to report success");
  process.exit(71);
}
console.log(names.join("\n"));
