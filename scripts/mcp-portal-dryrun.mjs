#!/usr/bin/env node
/**
 * D3 dry-run: compute the registry→chitty-mcp portal projection diff with
 * ZERO writes. Reads:
 *   - registry.chitty.cc/v0.1/servers   (discovery, public)
 *   - the chitty-mcp portal current servers[]  (read-only GET)
 *
 * The portal GET requires a CF_API_TOKEN with the ai-controls scope. When the
 * token is absent, the portal-side snapshot can be injected via
 * --portal-fixture <path> (a JSON file shaped like the live GET result) so the
 * diff still runs offline. This script NEVER writes.
 *
 * Usage:
 *   CF_API_TOKEN=… node scripts/mcp-portal-dryrun.mjs
 *   node scripts/mcp-portal-dryrun.mjs --portal-fixture ./fixtures/chitty-mcp.json
 */

import {
  fetchDiscoveryServers,
  computePortalDiff,
  PORTAL_SERVER_CAP,
  evaluateRemovalGuard,
} from "../src/services/mcp-portal-projection.js";
import { readFileSync } from "node:fs";

const env = {
  REGISTRY_SERVICE_URL:
    process.env.REGISTRY_SERVICE_URL || "https://registry.chitty.cc",
  CHITTYOS_ACCOUNT_ID:
    process.env.CHITTYOS_ACCOUNT_ID || "0bc21e3a5a9de1a4cc843be9c3e98121",
  CF_API_TOKEN: process.env.CF_API_TOKEN,
};
const portalId = process.env.MCP_PORTAL_ID || "chitty-mcp";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function getPortalSnapshot() {
  const fixture = arg("--portal-fixture");
  if (fixture) {
    const j = JSON.parse(readFileSync(fixture, "utf8"));
    const p = j.result || j;
    return {
      id: p.id,
      name: p.name,
      hostname: p.hostname,
      servers: p.servers || [],
    };
  }
  // live read (read-only)
  const { fetchPortal } =
    await import("../src/services/mcp-portal-projection.js");
  const p = await fetchPortal(env, portalId);
  if (!p) throw new Error(`portal ${portalId} not found`);
  return {
    id: p.id,
    name: p.name,
    hostname: p.hostname,
    servers: p.servers || [],
  };
}

const discovery = await fetchDiscoveryServers(env);
const portal = await getPortalSnapshot();
const diff = computePortalDiff(discovery, portal);

const report = {
  portalId,
  generatedAt: new Date().toISOString(),
  writes: "NONE (dry-run)",
  discovery_health: {
    registry_total_entries: discovery.total,
    entries_with_url: discovery.withUrl,
    desired_mcp_servers: (discovery.desired || discovery.compliant || [])
      .length,
    canonical_subset: discovery.canonicalCount,
    note:
      "desired = active + url ends in /mcp (ANY host: {svc}.chitty.cc, *.ccorp.workers.dev, third-party). " +
      "Diff keys on normalized hostname, so portal-id vs URL-slug mismatch never churns.",
  },
  portal_current: {
    server_count: portal.servers.length,
    ids: portal.servers.map((s) => s.id),
  },
  diff: {
    desired_count: diff.desired.length,
    to_add: diff.toAdd.map((s) => ({ key: s.key, hostname: s.hostname })),
    to_remove: diff.toRemove,
    keeps_count: diff.keeps.length,
  },
  cap_check: {
    cap: PORTAL_SERVER_CAP,
    desired_within_cap: diff.desired.length <= PORTAL_SERVER_CAP,
  },
  removal_guard: evaluateRemovalGuard(diff, portal.servers.length),
};

console.log(JSON.stringify(report, null, 2));
