/**
 * ExperienceAnchor entity_type canonical compliance tests
 *
 * ChittyOS canonical governance requires entity types to be one of P/L/T/E/A.
 * Claude contexts are Person (P), Synthetic characterization -- NEVER Thing (T).
 * @canon: chittycanon://gov/governance#core-types
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExperienceAnchor } from "../experience-anchor.js";

describe("ExperienceAnchor - canonical entity_type compliance", () => {
  let anchor;
  let mockEnv;

  beforeEach(() => {
    mockEnv = {
      DB: null,
      MEMORY_KV: null,
      CHITTYID_SERVICE_URL: "https://id.chitty.cc",
      CHITTY_ID_SERVICE_TOKEN: "test-token",
    };
    anchor = new ExperienceAnchor(mockEnv);
  });

  // =========================================================================
  // Fix 1: mintContextIdentity must send entity_type "P" + characterization "Synthetic"
  // =========================================================================
  describe("mintContextIdentity", () => {
    it('should send entity_type "P" (Person) in the mint request body', async () => {
      let capturedBody = null;

      // Mock fetch to capture the request body
      globalThis.fetch = vi.fn(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ chitty_id: "test-id" }) };
      });

      await anchor.mintContextIdentity({ platform: "claude" });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.entity_type).toBe("P");
    });

    it('should NOT send entity_type "context_identity" (non-canonical value)', async () => {
      let capturedBody = null;

      globalThis.fetch = vi.fn(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ chitty_id: "test-id" }) };
      });

      await anchor.mintContextIdentity({ platform: "claude" });

      expect(capturedBody.entity_type).not.toBe("context_identity");
    });

    it('should include characterization "Synthetic" in the mint request body', async () => {
      let capturedBody = null;

      globalThis.fetch = vi.fn(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ chitty_id: "test-id" }) };
      });

      await anchor.mintContextIdentity({ platform: "claude" });

      expect(capturedBody.characterization).toBe("Synthetic");
    });
  });

  // =========================================================================
  // Fix 2: generateLocalChittyId must use canonical format with type "P"
  // =========================================================================
  describe("generateLocalChittyId", () => {
    it("should produce an ID with type segment P (Person)", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      // Canonical format: VV-G-LLL-SSSS-P-YYMM-C-X
      // The 5th segment (index 4) must be "P"
      const segments = id.split("-");
      expect(segments[4]).toBe("P");
    });

    it("should NOT produce an ID with type segment I (non-canonical)", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      const segments = id.split("-");
      expect(segments[4]).not.toBe("I");
    });

    it("should follow canonical VV-G-LLL-SSSS-P-YYMM-C-X format with 8 segments", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      const segments = id.split("-");
      expect(segments).toHaveLength(8);
    });

    it("should use version 03 as the VV segment", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      const segments = id.split("-");
      expect(segments[0]).toBe("03");
    });

    it("should use USA as the LLL (location) segment", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      const segments = id.split("-");
      expect(segments[2]).toBe("USA");
    });

    it("should include a valid YYMM segment matching current date", () => {
      const id = anchor.generateLocalChittyId({ platform: "claude" });
      const segments = id.split("-");
      const now = new Date();
      const expectedYYMM = `${now.getFullYear() % 100}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
      expect(segments[5]).toBe(expectedYYMM);
    });
  });
});
