/**
 * Context Intelligence Tests - Canonical Compliance & Preferences Removal
 *
 * Verifies:
 * 1. loadContextProfile does NOT return a `preferences` field
 * 2. Lifecycle operations (supernova, fission, derivative, suspension) use
 *    entity type 'P' (Person) with lifecycle metadata, not S/F/D/X codes
 *
 * @canon chittycanon://gov/governance#core-types
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-intelligence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextIntelligence } from "../context-intelligence.js";

// Helper: create a mock DB that returns a context profile row
function createMockDb(overrides = {}) {
  const defaultRow = {
    id: "ctx-001",
    chitty_id: "03-1-USA-0001-P-2602-0-42",
    context_hash: "hash123",
    project_path: "/test/project",
    workspace: "dev",
    support_type: "development",
    organization: "test-org",
    trust_score: 80,
    trust_level: 3,
    status: "active",
    patterns: '["pattern1"]',
    traits: '["methodical"]',
    preferences: '["dark-mode"]',
    competencies: '["typescript","cloudflare-workers"]',
    expertise_domains: '["backend-development"]',
    total_interactions: 100,
    total_decisions: 50,
    success_rate: 0.85,
    anomaly_count: 0,
    last_anomaly_at: null,
    current_sessions: "[]",
    ...overrides,
  };

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(defaultRow),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    }),
  };
}

describe("ContextIntelligence", () => {
  let intelligence;
  let mockEnv;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEnv = {
      DB: mockDb,
      CHITTYID_SERVICE_URL: "https://id.chitty.cc",
      CHITTY_ID_SERVICE_TOKEN: "test-token",
    };
    intelligence = new ContextIntelligence(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========== Category B: preferences removal ==========

  describe("loadContextProfile - preferences removal", () => {
    it("should NOT include a preferences field in the returned profile", async () => {
      const profile = await intelligence.loadContextProfile(
        "03-1-USA-0001-P-2602-0-42",
      );

      expect(profile).not.toBeNull();
      // The profile MUST NOT have a preferences key at all
      expect(profile).not.toHaveProperty("preferences");
    });

    it("should still include patterns, traits, and competencies", async () => {
      const profile = await intelligence.loadContextProfile(
        "03-1-USA-0001-P-2602-0-42",
      );

      expect(profile).not.toBeNull();
      expect(profile.patterns).toEqual(["pattern1"]);
      expect(profile.traits).toEqual(["methodical"]);
      expect(profile.competencies).toEqual([
        "typescript",
        "cloudflare-workers",
      ]);
      expect(profile.expertise_domains).toEqual(["backend-development"]);
    });

    it("should NOT select cd.preferences in the SQL query", async () => {
      await intelligence.loadContextProfile("03-1-USA-0001-P-2602-0-42");

      // Verify the SQL query does not reference preferences
      const prepareCall = mockDb.prepare.mock.calls[0][0];
      expect(prepareCall).not.toMatch(/cd\.preferences/);
    });
  });

  // ========== Category C: lifecycle mint calls ==========

  describe("executeSupernova - canonical entity type", () => {
    it("should mint with entity type P and lifecycle supernova metadata", async () => {
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-99" }),
          };
        }),
      );

      // We need loadContextProfile to return valid data for both contexts
      const ctx1 = {
        id: "ctx-001",
        chitty_id: "id1",
        context_hash: "h1",
        project_path: "/p",
        workspace: "dev",
        support_type: "development",
        organization: "org",
        trust_score: 80,
        trust_level: 3,
        status: "active",
        patterns: [],
        traits: [],
        competencies: ["ts"],
        expertise_domains: ["backend-development"],
        total_interactions: 10,
        total_decisions: 5,
        success_rate: 0.9,
        anomaly_count: 0,
        current_sessions: [],
      };
      const ctx2 = {
        ...ctx1,
        id: "ctx-002",
        chitty_id: "id2",
        context_hash: "h2",
      };

      let callCount = 0;
      intelligence.loadContextProfile = vi.fn(async () => {
        callCount++;
        return callCount % 2 === 1 ? ctx1 : ctx2;
      });

      await intelligence.executeSupernova("id1", "id2", "confirm-token");

      expect(capturedBody).not.toBeNull();
      // @canon: chittycanon://gov/governance#core-types
      // Supernova is a lifecycle operation on Person, not a separate entity type
      expect(capturedBody.entity_type).toBe("P");
      expect(capturedBody.entity_type).not.toBe("S");
      expect(capturedBody.metadata.lifecycle).toBe("supernova");
    });
  });

  describe("executeFission - canonical entity type", () => {
    it("should mint with entity type P and lifecycle fission metadata", async () => {
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-88" }),
          };
        }),
      );

      const ctx = {
        id: "ctx-001",
        chitty_id: "id1",
        context_hash: "h1",
        project_path: "/p",
        workspace: "dev",
        support_type: "development",
        organization: "org",
        trust_score: 80,
        trust_level: 3,
        status: "active",
        patterns: [],
        traits: [],
        competencies: ["ts"],
        expertise_domains: ["backend-development"],
        total_interactions: 10,
        total_decisions: 5,
        success_rate: 0.9,
        anomaly_count: 0,
        current_sessions: [],
      };

      intelligence.loadContextProfile = vi.fn(async () => ctx);

      const splitConfig = {
        splits: [
          {
            label: "dev",
            supportType: "development",
            competencies: ["ts"],
            domains: ["backend-development"],
          },
        ],
      };

      await intelligence.executeFission("id1", splitConfig, "confirm-token");

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.entity_type).toBe("P");
      expect(capturedBody.entity_type).not.toBe("F");
      expect(capturedBody.metadata.lifecycle).toBe("fission");
    });
  });

  describe("createDerivative - canonical entity type", () => {
    it("should mint with entity type P and lifecycle derivative metadata", async () => {
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-77" }),
          };
        }),
      );

      const ctx = {
        id: "ctx-001",
        chitty_id: "src-id",
        context_hash: "h1",
        project_path: "/p",
        workspace: "dev",
        support_type: "development",
        organization: "org",
        trust_score: 80,
        trust_level: 3,
        status: "active",
        patterns: [],
        traits: [],
        competencies: ["ts"],
        expertise_domains: ["backend-development"],
        total_interactions: 10,
        total_decisions: 5,
        success_rate: 0.9,
        anomaly_count: 0,
        current_sessions: [],
      };

      intelligence.loadContextProfile = vi.fn(async () => ctx);

      await intelligence.createDerivative("src-id", {
        label: "fork1",
        projectPath: "/fork/path",
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.entity_type).toBe("P");
      expect(capturedBody.entity_type).not.toBe("D");
      expect(capturedBody.metadata.lifecycle).toBe("derivative");
    });
  });

  describe("createSuspension - canonical entity type", () => {
    it("should mint with entity type P and lifecycle suspension metadata", async () => {
      let capturedBody = null;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ chitty_id: "03-1-USA-0001-P-2602-0-66" }),
          };
        }),
      );

      const ctx1 = {
        id: "ctx-001",
        chitty_id: "id1",
        context_hash: "h1",
        project_path: "/p",
        workspace: "dev",
        support_type: "development",
        organization: "org",
        trust_score: 80,
        trust_level: 3,
        status: "active",
        patterns: [],
        traits: [],
        competencies: ["ts"],
        expertise_domains: ["backend-development"],
        total_interactions: 10,
        total_decisions: 5,
        success_rate: 0.9,
        anomaly_count: 0,
        current_sessions: [],
      };
      const ctx2 = { ...ctx1, id: "ctx-002", chitty_id: "id2" };

      let callCount = 0;
      intelligence.loadContextProfile = vi.fn(async () => {
        callCount++;
        return callCount % 2 === 1 ? ctx1 : ctx2;
      });

      await intelligence.createSuspension(["id1", "id2"], {
        taskDescription: "test task",
        expiresIn: 3600,
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.entity_type).toBe("P");
      expect(capturedBody.entity_type).not.toBe("X");
      expect(capturedBody.metadata.lifecycle).toBe("suspension");
    });
  });
});
