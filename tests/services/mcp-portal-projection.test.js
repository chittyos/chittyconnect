/**
 * Real-behavior tests for the MCP-portal projection diff + removal-safety
 * guard. These are PURE functions — no mocks of the logic under test. We feed
 * them real-shaped server arrays (the actual live `chitty-mcp` 27 and the live
 * registry discovery shape) and assert.
 */
import { describe, it, expect } from "vitest";
import {
  computePortalDiff,
  evaluateRemovalGuard,
  normalizeMcpHost,
  REMOVAL_GUARD,
} from "../../src/services/mcp-portal-projection.js";

// The live chitty-mcp portal membership (id + hostname), captured 2026-06-12.
const PORTAL_27 = [
  [
    "chittyagent-orchestrator",
    "https://chittyagent-orchestrator.ccorp.workers.dev/mcp",
  ],
  ["chittyagent-resolve", "https://resolve.chitty.cc/mcp"],
  ["chittyagent-tasks", "https://tasks.chitty.cc/mcp"],
  ["chittyagent-imessage", "https://imessage.chitty.cc/mcp"],
  ["chitty-evidence", "https://chittyagent-evidence.ccorp.workers.dev/mcp"],
  ["chittyagent-storage", "https://chittyagent-storage.ccorp.workers.dev/mcp"],
  ["chittyagent-scrape", "https://chittyagent-scrape.ccorp.workers.dev/mcp"],
  ["chittyagent-notion", "https://notion.chitty.cc/mcp"],
  ["openai-docs", "https://developers.openai.com/mcp"],
  ["chittyagent-cleaner", "https://cleaner.chitty.cc/mcp"],
  ["chittyagent-market", "https://market.chitty.cc/mcp"],
  ["chittyagent-twilio", "https://chittyagent-twilio.ccorp.workers.dev/mcp"],
  ["chittyagent-helper", "https://helper.chitty.cc/mcp"],
  ["chittyagent-dispute", "https://chittyagent-dispute.ccorp.workers.dev/mcp"],
  ["chittyagent-notes", "https://chittyagent-notes.ccorp.workers.dev/mcp"],
  ["chittyagent-gam", "https://chittyagent-gam.ccorp.workers.dev/mcp"],
  ["chittyagent-quo", "https://quo.chitty.cc/mcp"],
  [
    "chittyagent-bluebubbles",
    "https://chittyagent-bluebubbles.ccorp.workers.dev/mcp",
  ],
  ["chittyagent-sandbox", "https://sandbox.chitty.cc/mcp"],
  ["chittyagent-canon", "https://canon.chitty.cc/mcp"],
  ["chittyagent-chatgpt", "https://chittyagent-chatgpt.ccorp.workers.dev/mcp"],
  ["cloudeflare-codemode", "https://mcp.cloudflare.com/mcp"],
  ["chittyagent-auth", "https://chittyagent-auth.ccorp.workers.dev/mcp"],
  ["chittyagent-dispatch", "https://dispatch.chitty.cc/mcp"],
  ["chittyagent-autoassist", "https://autoassist.chitty.cc/mcp"],
  ["chittyagent-ship", "https://chittyagent-ship.ccorp.workers.dev/mcp"],
  ["chittyagent-neon", "https://neon.chitty.cc/mcp"],
].map(([id, hostname]) => ({ id, hostname }));

const portal = {
  id: "chitty-mcp",
  name: "ChittyMCP",
  hostname: "mcp.chitty.cc",
  servers: PORTAL_27,
};

/** Build a discovery `desired` set from a list of hostnames (matches the
 *  shape fetchDiscoveryServers returns). */
function discoveryFromHosts(hosts) {
  return {
    total: hosts.length,
    withUrl: hosts.length,
    desired: hosts.map((h) => ({
      hostname: h,
      key: normalizeMcpHost(h),
      name: h,
    })),
  };
}

describe("normalizeMcpHost", () => {
  it("is scheme/trailing-slash/case insensitive on host+path", () => {
    expect(normalizeMcpHost("https://Ship.Chitty.CC/mcp/")).toBe(
      "ship.chitty.cc/mcp",
    );
    expect(normalizeMcpHost("https://ship.chitty.cc/mcp")).toBe(
      "ship.chitty.cc/mcp",
    );
  });
  it("matches portal id vs slug mismatch by hostname (blocker 1c)", () => {
    // portal id chittyagent-ship but hostname is the real diff key
    expect(
      normalizeMcpHost("https://chittyagent-ship.ccorp.workers.dev/mcp"),
    ).toBe("chittyagent-ship.ccorp.workers.dev/mcp");
  });
});

describe("computePortalDiff — hostname keyed", () => {
  it("complete discovery (all 27 hostnames) => pure no-op (add 0 / remove 0 / keep 27)", () => {
    const discovery = discoveryFromHosts(PORTAL_27.map((s) => s.hostname));
    const diff = computePortalDiff(discovery, portal);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.keeps).toHaveLength(27);
    expect(diff.desired).toHaveLength(27);
  });

  it("does NOT churn on id-vs-slug mismatch (chittyagent-ship vs ship)", () => {
    // discovery presents the real workers.dev hostname; portal id is chittyagent-ship
    const discovery = discoveryFromHosts(PORTAL_27.map((s) => s.hostname));
    const diff = computePortalDiff(discovery, portal);
    // chittyagent-ship must be a KEEP, never a remove+add churn
    expect(diff.keeps).toContain("chittyagent-ship");
    expect(diff.toRemove).not.toContain("chittyagent-ship");
  });

  it("includes non-canonical + third-party hosts as keeps (blocker 1b)", () => {
    const discovery = discoveryFromHosts(PORTAL_27.map((s) => s.hostname));
    const diff = computePortalDiff(discovery, portal);
    // workers.dev direct-route AND third-party are kept, not removed
    expect(diff.keeps).toContain("openai-docs");
    expect(diff.keeps).toContain("cloudeflare-codemode");
    expect(diff.keeps).toContain("chitty-evidence");
  });

  it("sparse discovery (only 4 canonical) => remove 23 (the dangerous case)", () => {
    const discovery = discoveryFromHosts([
      "https://resolve.chitty.cc/mcp",
      "https://tasks.chitty.cc/mcp",
      "https://canon.chitty.cc/mcp",
      "https://neon.chitty.cc/mcp",
    ]);
    const diff = computePortalDiff(discovery, portal);
    expect(diff.keeps).toHaveLength(4);
    expect(diff.toRemove).toHaveLength(23);
  });
});

describe("evaluateRemovalGuard", () => {
  it("blocks the sparse 4-vs-27 wipe (the production hazard)", () => {
    const discovery = discoveryFromHosts([
      "https://resolve.chitty.cc/mcp",
      "https://tasks.chitty.cc/mcp",
      "https://canon.chitty.cc/mcp",
      "https://neon.chitty.cc/mcp",
    ]);
    const diff = computePortalDiff(discovery, portal);
    const v = evaluateRemovalGuard(diff, 27);
    expect(v.blocked).toBe(true);
    expect(v.safeToApplyRemovals).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/collapsed|remove/);
  });

  it("hard-fails empty membership and CANNOT be overridden", () => {
    const discovery = discoveryFromHosts([]); // desired empty
    const diff = computePortalDiff(discovery, portal);
    const forced = evaluateRemovalGuard(diff, 27, { override: true });
    expect(forced.emptyMembership).toBe(true);
    expect(forced.blocked).toBe(true); // override does NOT clear empty-membership
  });

  it("override bypasses proportional/collapse brakes (but logs it)", () => {
    const discovery = discoveryFromHosts([
      "https://resolve.chitty.cc/mcp",
      "https://tasks.chitty.cc/mcp",
      "https://canon.chitty.cc/mcp",
      "https://neon.chitty.cc/mcp",
    ]);
    const diff = computePortalDiff(discovery, portal);
    const v = evaluateRemovalGuard(diff, 27, { override: true });
    expect(v.blocked).toBe(false);
    expect(v.overrideApplied).toBe(true);
  });

  it("allows a small legitimate removal (1 of 27) without override", () => {
    const hosts = PORTAL_27.slice(0, 26).map((s) => s.hostname); // drop exactly 1
    const diff = computePortalDiff(discoveryFromHosts(hosts), portal);
    expect(diff.toRemove).toHaveLength(1);
    const v = evaluateRemovalGuard(diff, 27);
    // 1 removal <= max(2, 20%*27=6); desired 26 >= 50% of 27 — allowed
    expect(v.blocked).toBe(false);
  });

  it("allows the no-op (remove 0) — projection must keep working", () => {
    const diff = computePortalDiff(
      discoveryFromHosts(PORTAL_27.map((s) => s.hostname)),
      portal,
    );
    const v = evaluateRemovalGuard(diff, 27);
    expect(v.blocked).toBe(false);
    expect(v.metrics.removeCount).toBe(0);
  });

  it("respects custom thresholds", () => {
    const hosts = PORTAL_27.slice(0, 24).map((s) => s.hostname); // drop 3
    const diff = computePortalDiff(discoveryFromHosts(hosts), portal);
    // default ceiling max(2, 6)=6 → 3 allowed; tighten floor to 1, fraction to 0.05 → 3 > ceil(0.05*27)=2 → blocked
    const v = evaluateRemovalGuard(diff, 27, {
      thresholds: {
        REMOVE_ABS_FLOOR: 1,
        REMOVE_FRACTION: 0.05,
        DESIRED_FRACTION_FLOOR: 0,
      },
    });
    expect(v.blocked).toBe(true);
  });

  it("guard constants are the agreed defaults", () => {
    expect(REMOVAL_GUARD.REMOVE_ABS_FLOOR).toBe(2);
    expect(REMOVAL_GUARD.REMOVE_FRACTION).toBe(0.2);
    expect(REMOVAL_GUARD.DESIRED_FRACTION_FLOOR).toBe(0.5);
  });
});
