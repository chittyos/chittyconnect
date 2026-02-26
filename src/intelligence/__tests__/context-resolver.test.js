/**
 * Context Resolver Tests - Entity Type Canonical Compliance
 *
 * Verifies that mintChittyId uses canonical Person (P) entity type,
 * calls ChittyMint (mint.chitty.cc) as primary, falls back to
 * fallback.id.chitty.cc, and never generates IDs locally.
 *
 * @canon chittycanon://gov/governance#core-types
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
});
