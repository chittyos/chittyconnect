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

describe("MemoryCloude session summary — blank-envelope guard", () => {
  // Regression for the silent failure this whole change exists to close: a
  // summary that is empty (or only whitespace) must never reach KV, because the
  // retention TTL would keep a blank string standing as a valid summary for 90
  // days. `if (!summary)` alone let " " through.
  async function summarizeWith(aiResponse) {
    const kv = new MockKV();
    const memory = new MemoryCloude({
      TOKEN_KV: kv,
      AI: { run: async () => aiResponse },
    });
    await memory.initialize();
    await memory.persistInteraction("session-blank", {
      userId: "user-1",
      type: "request",
      content: "anything",
    });
    const summary = await memory.summarizeSession("session-blank");
    return { summary, cached: await kv.get("session:session-blank:summary") };
  }

  it("refuses to cache a whitespace-only summary", async () => {
    const { summary, cached } = await summarizeWith({ response: "   \n\t " });
    expect(summary).toBe("Failed to generate summary.");
    expect(cached).toBeNull();
  });

  it("refuses to cache an empty summary", async () => {
    const { summary, cached } = await summarizeWith({ response: "" });
    expect(summary).toBe("Failed to generate summary.");
    expect(cached).toBeNull();
  });

  it("still caches a real summary", async () => {
    const { summary, cached } = await summarizeWith({
      response: "The session covered credential provisioning.",
    });
    expect(summary).toBe("The session covered credential provisioning.");
    expect(cached).toBe("The session covered credential provisioning.");
  });
});

describe("MemoryCloude entity scoping", () => {
  // Scope is the instance, never a filter. These assert the boundary itself, so they
  // are written to FAIL if the resolver ever falls back to a shared instance.
  const build = (env = {}) => new MemoryCloude({ TOKEN_KV: new MockKV(), ...env });

  it("derives one instance per primary synthetic entity", () => {
    const m = build();
    expect(m.memoryInstanceFor({ entityId: "03-1-USA-0650-P-2606-1-24" })).toBe(
      "memory-03-1-USA-0650-P-2606-1-24",
    );
  });

  it("gives two entities two different instances", () => {
    const m = build();
    const a = m.memoryInstanceFor({ entityId: "03-1-USA-0650-P-2606-1-24" });
    const b = m.memoryInstanceFor({ entityId: "03-1-USA-0651-P-2606-1-25" });
    expect(a).not.toBe(b);
  });

  it("returns null rather than a shared instance when no entity is identifiable", () => {
    const m = build();
    for (const input of [{}, undefined, null, { entityId: "" }, { entityId: 42 }]) {
      expect(m.memoryInstanceFor(input)).toBeNull();
    }
  });

  it("does not let a non-string entity id coerce into an instance name", () => {
    const m = build();
    // `memory-[object Object]` would be a single shared bucket every caller lands in.
    expect(m.memoryInstanceFor({ entityId: { toString: () => "x" } })).toBeNull();
  });

  it("refuses the legacy shared instances a caller could name directly", () => {
    const m = build();
    // entityId "cloude" would otherwise resolve to `memory-cloude`, the pre-scoping
    // everyone-bucket. Naming it must not be a way back into shared memory.
    expect(m.memoryInstanceFor({ entityId: "cloude" })).toBeNull();
    expect(m.memoryInstanceFor({ entityId: "context-embeddings" })).toBeNull();
  });

  it("rejects entity ids that are not plain identifiers", () => {
    const m = build();
    for (const bad of ["../evidence", "a/b", "x y", "a".repeat(80), "ab", "-lead", "has.dot"]) {
      expect(m.memoryInstanceFor({ entityId: bad })).toBeNull();
    }
  });

  it("has AI Search state before initialize() is awaited", () => {
    // src/index.js calls initialize() without awaiting it. If hasAiSearch were only
    // set there, a request arriving first would silently skip indexing — exactly the
    // dead-flag bug this file's fix removed. Derive it in the constructor.
    const m = new MemoryCloude({ TOKEN_KV: new MockKV(), AI_SEARCH: {} });
    expect(m.hasAiSearch).toBe(true);
    const off = new MemoryCloude({ TOKEN_KV: new MockKV() });
    expect(off.hasAiSearch).toBe(false);
  });

  it("falls back to keyword recall — not a shared instance — when unscoped", async () => {
    const m = build();
    m.hasAiSearch = true;
    m.searchNamespace = {
      get() {
        throw new Error("semantic path must not be reached without an entity");
      },
    };
    // No entityId in options => must take the KV keyword path, which cannot cross
    // an entity boundary because it reads session:{id}:* directly.
    const out = await m.recallContext("session-1", "anything", { limit: 1 });
    expect(Array.isArray(out)).toBe(true);
  });
});
