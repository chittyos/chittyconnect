import { describe, it, expect, beforeEach } from "vitest";
import { MemoryCloude } from "../../src/intelligence/memory-cloude.js";

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

class MockAgentMemoryProfile {
  constructor(id) {
    this.id = id;
    this.ingested = [];
    this.remembered = [];
    this.recalls = [];
    this.summaries = [];
  }

  async ingest(messages, options) {
    this.ingested.push({ messages, options });
  }

  async remember(facts) {
    this.remembered.push(facts);
  }

  async recall(query, options) {
    this.recalls.push({ query, options });
    return {
      candidates: [
        { summary: "recalled fact", score: 0.9, sessionId: this.id }
      ]
    };
  }

  async getSummary(options) {
    this.summaries.push(options);
    return {
      summary: "session summary text"
    };
  }
}

class MockAgentMemory {
  constructor() {
    this.profiles = new Map();
  }

  async getProfile(id) {
    if (!this.profiles.has(id)) {
      this.profiles.set(id, new MockAgentMemoryProfile(id));
    }
    return this.profiles.get(id);
  }

  async deleteProfile(id) {
    this.profiles.delete(id);
  }
}

describe("MemoryCloude user history", () => {
  let kv;
  let memory;
  let mockMemory;

  beforeEach(async () => {
    kv = new MockKV();
    mockMemory = new MockAgentMemory();
    memory = new MemoryCloude({ TOKEN_KV: kv, MEMORY: mockMemory });
    await memory.initialize();
  });

  it("persists a user index and recalls cross-session history", async () => {
    await memory.persistInteraction("session-a", {
      userId: "user-1",
      type: "request",
      content: "first message",
    });

    await memory.persistInteraction("session-b", {
      userId: "user-1",
      type: "request",
      content: "second message",
    });

    const history = await memory.getUserHistory("user-1", 10);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("second message");
    expect(history[1].content).toBe("first message");

    const index = await kv.get("user:user-1:index", "json");
    expect(index.sessions).toEqual(expect.arrayContaining(["session-a", "session-b"]));
    expect(index.interactions.length).toBe(2);
  });

  it("supports legacy string interaction index entries", async () => {
    const legacyId = "legacy-session-1700000000000";
    await kv.put(
      "user:user-legacy:index",
      JSON.stringify({
        sessions: ["legacy-session"],
        interactions: [legacyId],
      }),
    );
    await kv.put(
      "session:legacy-session:1700000000000",
      JSON.stringify({
        id: legacyId,
        userId: "user-legacy",
        content: "legacy payload",
      }),
    );

    const history = await memory.getUserHistory("user-legacy", 5);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("legacy payload");
  });

  it("uses the native agent_memory binding for persistence and recall", async () => {
    await memory.persistInteraction("session-test", {
      userId: "user-test",
      type: "request",
      content: "hello memory",
    });

    const profile = await mockMemory.getProfile("user-test");
    expect(profile.ingested.length).toBe(1);
    expect(profile.ingested[0].messages[0].content).toContain("hello memory");

    // Test recallContext
    const recallResults = await memory.recallContext("session-test", "hello");
    expect(profile.recalls.length).toBe(1);
    expect(profile.recalls[0].query).toBe("hello");
    expect(recallResults).toHaveLength(1);
    expect(recallResults[0].content).toBe("recalled fact");

    // Test getSessionSummary
    const summary = await memory.getSessionSummary("session-test");
    expect(summary).toBe("session summary text");
  });
});
