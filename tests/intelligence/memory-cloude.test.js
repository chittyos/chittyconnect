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

describe("MemoryCloude user history", () => {
  let kv;
  let memory;

  beforeEach(async () => {
    kv = new MockKV();
    memory = new MemoryCloude({ TOKEN_KV: kv });
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
});
