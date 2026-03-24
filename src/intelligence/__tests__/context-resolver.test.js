/**
 * Context Resolver Tests
 *
 * Tests canonical compliance + doctrine enforcement:
 * - mintChittyId uses Person (P) entity type
 * - DB failure returns error, never mints
 * - createContext requires coordination need justification
 * - Multi-signal resolution finds best existing entity
 *
 * @canon chittycanon://gov/governance#core-types
 * @canon chittycanon://doctrine/synthetic-continuity
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextResolver } from "../context-resolver.js";

describe("ContextResolver", () => {
  let resolver;
  let mockEnv;

  beforeEach(() => {
    mockEnv = {
      DB: {},
      CHITTYMINT_URL: "https://mint.chitty.cc",
      CHITTY_FALLBACK_URL: "https://fallback.id.chitty.cc",
      CHITTYMINT_SECRET: "test-secret",
      CHITTY_ID_TOKEN: "test-token",
    };
    resolver = new ContextResolver(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("mintChittyId - canonical entity type compliance", () => {
    it('should send entity_type "P" (Person) to ChittyMint, not "CONTEXT"', async () => {
      let capturedUrl = null;
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedUrl = url;
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-42" }),
          };
        }),
      );

      await resolver.mintChittyId({
        projectPath: "/test/project",
        workspace: "dev",
        supportType: "development",
        organization: "test-org",
      });

      // Should call mint.chitty.cc, not id.chitty.cc
      expect(capturedUrl).toBe("https://mint.chitty.cc/api/mint");
      expect(capturedBody).not.toBeNull();
      // @canon: chittycanon://gov/governance#core-types
      expect(capturedBody.entity_type).toBe("P");
      expect(capturedBody.entity_type).not.toBe("CONTEXT");
    });

    it('should include characterization "Synthetic" in mint request', async () => {
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-42" }),
          };
        }),
      );

      await resolver.mintChittyId({
        projectPath: "/test/project",
        workspace: "dev",
        supportType: "development",
        organization: "test-org",
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.characterization).toBe("Synthetic");
    });

    it("should fall back to fallback.id.chitty.cc when ChittyMint fails", async () => {
      let callCount = 0;
      let fallbackUrl = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          callCount++;
          if (url.includes("mint.chitty.cc")) {
            // Primary fails
            return { ok: false, status: 503, text: async () => "unavailable" };
          }
          // Fallback succeeds
          fallbackUrl = url;
          return {
            ok: true,
            json: async () => ({
              chitty_id: "03-1-USA-0001-P-2602-E-42",
            }),
          };
        }),
      );

      const id = await resolver.mintChittyId({
        projectPath: "/test/project",
        workspace: "dev",
        supportType: "development",
        organization: "test-org",
      });

      expect(callCount).toBe(2);
      expect(fallbackUrl).toBe("https://fallback.id.chitty.cc/api/mint");
      expect(id).toBe("03-1-USA-0001-P-2602-E-42");
    });

    it("should throw when both primary and fallback are unavailable — no local generation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Service unavailable");
        }),
      );

      await expect(
        resolver.mintChittyId({
          projectPath: "/test/project",
          workspace: "dev",
          supportType: "development",
          organization: "test-org",
        }),
      ).rejects.toThrow("both primary");
    });
  });

  describe("resolveContext - doctrine: sessions are viewports, not births", () => {
    it("should return error when DB fails during anchor hash lookup — never mint", async () => {
      mockEnv.DB = {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("D1 unavailable");
            },
            all: async () => {
              throw new Error("D1 unavailable");
            },
          }),
        }),
      };
      resolver = new ContextResolver(mockEnv);

      const result = await resolver.resolveContext({
        projectPath: "/test/project",
        workspace: "dev",
      });

      expect(result.action).toBe("error");
      expect(result.resolution).toBe("db_error");
      // Must NOT be "create_new" — DB failure is error, not mint trigger
      expect(result.action).not.toBe("create_new");
    });

    it("should return error when explicit ChittyID DB lookup fails", async () => {
      mockEnv.DB = {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("D1 unavailable");
            },
          }),
        }),
      };
      resolver = new ContextResolver(mockEnv);

      const result = await resolver.resolveContext({
        explicitChittyId: "03-1-USA-5537-P-2602-0-38",
      });

      expect(result.action).toBe("error");
      expect(result.resolution).toBe("db_error");
    });

    it("should reconstitute existing entity by anchor hash", async () => {
      const mockEntity = {
        id: "ctx-123",
        chitty_id: "03-1-USA-5537-P-2602-0-38",
        project_path: "/test/project",
        workspace: "dev",
        trust_level: 5,
        last_activity: Date.now() / 1000,
        competencies: "[]",
        expertise_domains: "[]",
        current_sessions: "[]",
      };

      mockEnv.DB = {
        prepare: () => ({
          bind: () => ({
            first: async () => mockEntity,
          }),
        }),
      };
      resolver = new ContextResolver(mockEnv);

      const result = await resolver.resolveContext({
        projectPath: "/test/project",
        workspace: "dev",
      });

      expect(result.action).toBe("bind_existing");
      expect(result.resolution).toBe("anchor_hash");
      expect(result.context.chitty_id).toBe("03-1-USA-5537-P-2602-0-38");
    });

    it("should require confirmation and coordination need for new entities", async () => {
      mockEnv.DB = {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
          }),
          all: async () => ({ results: [] }),
        }),
      };
      resolver = new ContextResolver(mockEnv);

      const result = await resolver.resolveContext({
        projectPath: "/brand/new/project",
        workspace: "dev",
      });

      expect(result.action).toBe("create_new");
      expect(result.requiresConfirmation).toBe(true);
      expect(result.coordinationNeedRequired).toBe(true);
    });
  });

  describe("createContext - doctrine: coordination need required", () => {
    it("should throw when coordinationNeed is not provided", async () => {
      await expect(
        resolver.createContext({
          projectPath: "/test/project",
          workspace: "dev",
          supportType: "development",
          anchorHash: "abc123",
        }),
      ).rejects.toThrow("Coordination need justification required");
    });

    it("should throw when coordinationNeed is blank", async () => {
      await expect(
        resolver.createContext({
          projectPath: "/test/project",
          workspace: "dev",
          supportType: "development",
          anchorHash: "abc123",
          coordinationNeed: "   ",
        }),
      ).rejects.toThrow("Coordination need justification required");
    });
  });

  describe("resolveContext - multi-signal DB failure returns error", () => {
    it("should return error when multi-signal search throws", async () => {
      let callCount = 0;
      mockEnv.DB = {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              callCount++;
              if (callCount === 1) return null; // anchor hash miss
              throw new Error("D1 unavailable");
            },
            all: async () => {
              throw new Error("D1 unavailable");
            },
          }),
        }),
      };
      resolver = new ContextResolver(mockEnv);

      const result = await resolver.resolveContext({
        projectPath: "/test/project",
        workspace: "dev",
      });

      expect(result.action).toBe("error");
      expect(result.resolution).toBe("db_error");
      expect(result.action).not.toBe("create_new");
    });
  });
});
