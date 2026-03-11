import { describe, it, expect, beforeEach } from "vitest";
import { LearningEngine } from "../../src/intelligence/learning-engine.js";

class MockKV {
  constructor() {
    this.store = new Map();
  }

  async put(key, value) {
    this.store.set(key, String(value));
  }

  async get(key, type) {
    const value = this.store.get(key);
    if (value == null) return null;
    if (type === "json") return JSON.parse(value);
    return value;
  }
}

class MockMemory {
  async getUserHistory() {
    return [
      {
        content: "review evidence and verify ledger contradictions",
        actions: [{ type: "evidence_search" }],
        entities: [{ type: "case" }],
        status: "success",
      },
      {
        content: "analyze finance transactions and cash flow",
        actions: [{ type: "finance_analyze" }],
        entities: [{ type: "account" }],
        status: "success",
      },
    ];
  }
}

describe("LearningEngine", () => {
  let kv;
  let learning;

  beforeEach(async () => {
    kv = new MockKV();
    learning = new LearningEngine(
      {
        TOKEN_KV: kv,
      },
      { memory: new MockMemory() },
    );
    await learning.initialize();
  });

  it("learns from interactions and persists profile", async () => {
    const profile = await learning.learnFromInteraction("user-1", {
      sessionId: "s-1",
      content: "retrieve evidence from ledger and verify proof",
      actions: [{ type: "evidence_search" }, { type: "ledger_query" }],
      entities: [{ type: "case" }],
      status: "success",
      timestamp: Date.now(),
    });

    expect(profile.userId).toBe("user-1");
    expect(profile.totalInteractions).toBe(1);
    expect(profile.serviceUsage.chittyevidence).toBeGreaterThan(0);
    expect(profile.successRate).toBeGreaterThanOrEqual(0);

    const stored = await learning.getProfile("user-1");
    expect(stored.userId).toBe("user-1");
  });

  it("identifies patterns and returns preferences", async () => {
    await learning.learnFromInteraction("user-2", {
      sessionId: "s-2",
      content: "analyze transactions and cash flow",
      actions: [{ type: "finance_analyze" }],
      entities: [{ type: "account" }],
      status: "success",
      timestamp: Date.now(),
    });

    const patterns = await learning.identifyPatterns("user-2");
    expect(patterns.available).toBe(true);
    expect(patterns.preferences.servicePriority.length).toBeGreaterThan(0);
  });

  it("returns personalization defaults and suggestions", async () => {
    await learning.learnFromInteraction("user-3", {
      sessionId: "s-3",
      content: "relationship graph and dependency analysis",
      actions: [{ type: "relationship_discover" }],
      entities: [{ type: "context" }],
      status: "success",
      timestamp: Date.now(),
    });

    const personalization = await learning.personalizeExperience("user-3", {
      project_path: "/repo/chittyconnect",
    });

    expect(personalization.available).toBe(true);
    expect(Array.isArray(personalization.defaults.preferred_services)).toBe(true);
    expect(personalization.suggestions.length).toBeGreaterThan(0);
  });
});
