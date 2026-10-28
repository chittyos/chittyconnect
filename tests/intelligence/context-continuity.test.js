import { describe, expect, it, vi } from "vitest";
import { ContextResolver } from "../../src/intelligence/context-resolver.js";

const legacy = {
  id: "ctx-legacy",
  chitty_id: "03-1-USA-2629-T-2601-0-21",
  context_hash: "legacy-hash",
  project_path: "/project",
  workspace: "workspace",
  support_type: "development",
  organization: "CHITTYOS",
  status: "active",
  trust_level: 4,
  total_sessions: 1,
  last_activity: Date.now() / 1000,
  competencies: "[]",
  expertise_domains: "[]",
  current_sessions: "[]",
};

describe("Synthetic Person context continuity", () => {
  it("marks an exact legacy context match as migration-required", async () => {
    const resolver = new ContextResolver({
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => legacy }),
        }),
      },
    });

    const result = await resolver.resolveContext({
      projectPath: legacy.project_path,
      workspace: legacy.workspace,
      supportType: legacy.support_type,
      organization: legacy.organization,
    });

    expect(result.action).toBe("migration_required");
    expect(result.resolution).toBe("anchor_hash_legacy");
    expect(result.legacyContext.chitty_id).toBe(legacy.chitty_id);
    expect(result.migration.targetEntityType).toBe("P");
    expect(result.migration.mutateLegacyIdentityInPlace).toBe(false);
  });

  it("marks a legacy multi-signal candidate as migration-required", async () => {
    const resolver = new ContextResolver({
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => null }),
          all: async () => ({ results: [legacy] }),
        }),
      },
    });

    const result = await resolver.resolveContext({
      projectPath: legacy.project_path,
      workspace: legacy.workspace,
      supportType: legacy.support_type,
      organization: legacy.organization,
    });

    expect(result.action).toBe("migration_required");
    expect(result.resolution).toBe("multi_signal_legacy");
  });

  it("rejects malformed ChittyIDs without starting a migration flow", async () => {
    const resolver = new ContextResolver({ DB: {} });

    expect(resolver.isWellFormedChittyId("not-a-chittyid")).toBe(false);
    await expect(
      resolver.bindSession("ctx-bad", "not-a-chittyid", "session-bad"),
    ).rejects.toMatchObject({ code: "CONTEXT_INVALID_CHITTY_ID" });
  });

  it("refuses a legacy identity at the bind boundary", async () => {
    const resolver = new ContextResolver({ DB: {} });
    await expect(
      resolver.bindSession("ctx-legacy", legacy.chitty_id, "session-1"),
    ).rejects.toMatchObject({ code: "CONTEXT_MIGRATION_REQUIRED" });
  });

  it("rejects a mint result that is not a Synthetic Person", async () => {
    const resolver = new ContextResolver({
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => null }),
        }),
      },
    });
    resolver.mintChittyId = vi.fn().mockResolvedValue(legacy.chitty_id);

    await expect(
      resolver.createContext({
        projectPath: "/new",
        workspace: "new",
        supportType: "development",
        organization: "CHITTYOS",
        coordinationNeed: "new coordination role",
      }),
    ).rejects.toThrow("non-canonical Synthetic Person identity");
  });

  it("rechecks anchor ownership before minting and refuses to mint around a legacy row", async () => {
    const resolver = new ContextResolver({
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => legacy }),
        }),
      },
    });
    resolver.mintChittyId = vi.fn();

    await expect(
      resolver.createContext({
        projectPath: legacy.project_path,
        workspace: legacy.workspace,
        supportType: legacy.support_type,
        organization: legacy.organization,
        coordinationNeed: "replacement requested",
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MIGRATION_REQUIRED" });

    expect(resolver.mintChittyId).not.toHaveBeenCalled();
  });

  it("accepts P and rejects T identity classes", () => {
    const resolver = new ContextResolver({ DB: {} });
    expect(
      resolver.isSyntheticPersonChittyId("03-1-USA-5537-P-2602-0-38"),
    ).toBe(true);
    expect(resolver.isSyntheticPersonChittyId(legacy.chitty_id)).toBe(false);
  });
});
