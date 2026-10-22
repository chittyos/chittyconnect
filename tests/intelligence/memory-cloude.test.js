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

  it("converges repeated idempotency keys on one interaction", async () => {
    const interaction = {
      userId: "user-1",
      type: "memory",
      content: "queue-safe memory payload",
    };

    const first = await memory.persistInteraction(
      "session-idem",
      interaction,
      { idempotencyKey: "task-123" },
    );
    const second = await memory.persistInteraction(
      "session-idem",
      interaction,
      { idempotencyKey: "task-123" },
    );

    expect(first.interactionId).toBe(second.interactionId);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);

    const sessionIndex = await kv.get("session:session-idem:index", "json");
    expect(sessionIndex.interactions).toEqual([first.interactionId]);

    const userIndex = await kv.get("user:user-1:index", "json");
    expect(userIndex.interactions).toHaveLength(1);
    expect(userIndex.interactions[0].id).toBe(first.interactionId);

    const rawKeys = [...kv.store.keys()].filter(
      (key) => key.startsWith("session:session-idem:id:"),
    );
    expect(rawKeys).toHaveLength(1);
    expect(rawKeys[0]).toBe(
      memory.interactionStorageKey("session-idem", first.interactionId),
    );
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

describe("MemoryCloude Experience Projection scoping", () => {
  const build = (env = {}) =>
    new MemoryCloude({ TOKEN_KV: new MockKV(), ...env });

  it("derives one provider-safe instance per canonical Synthetic Person", () => {
    const m = build();
    expect(m.memoryInstanceFor("03-1-USA-0650-P-2606-1-24")).toBe(
      "memory-03-1-usa-0650-p-2606-1-24",
    );
  });

  it("gives two Synthetic Persons two different instances", () => {
    const m = build();
    const a = m.memoryInstanceFor("03-1-USA-0650-P-2606-1-24");
    const b = m.memoryInstanceFor("03-1-USA-0651-P-2606-1-25");
    expect(a).not.toBe(b);
  });

  it("rejects non-P identities and malformed identifiers", () => {
    const m = build();
    expect(m.memoryInstanceFor("03-1-USA-0650-T-2606-1-24")).toBeNull();
    expect(m.memoryInstanceFor("not-a-chittyid")).toBeNull();
    expect(m.memoryInstanceFor(null)).toBeNull();
  });

  it("resolves memory scope from the active session binding, not caller fields", async () => {
    const expected = "03-1-USA-0650-P-2606-1-24";
    const db = {
      prepare() {
        return {
          bind(sessionId) {
            expect(sessionId).toBe("session-bound");
            return {
              async first() {
                return { context_chitty_id: expected };
              },
            };
          },
        };
      },
    };
    const m = build({ DB: db });
    await expect(m.resolveSessionSyntheticPerson("session-bound")).resolves.toBe(
      expected,
    );
  });

  it("fails closed for semantic recall when no Synthetic Person scope resolves", async () => {
    const m = build({
      AI_SEARCH: {
        get() {
          throw new Error("must not touch namespace without scope");
        },
      },
    });

    await expect(
      m.recallContext("session-unbound", "anything", { semantic: true }),
    ).rejects.toMatchObject({ code: "MEMORY_SCOPE_UNRESOLVED" });
  });

  it("fails closed before persistence when AI Search is active but scope is unresolved", async () => {
    const kv = new MockKV();
    const m = new MemoryCloude({
      TOKEN_KV: kv,
      AI_SEARCH: {},
    });

    await expect(
      m.persistInteraction("session-unbound", {
        type: "request",
        content: "must not persist unscoped",
      }),
    ).rejects.toMatchObject({ code: "MEMORY_SCOPE_UNRESOLVED" });

    expect([...kv.store.keys()]).toHaveLength(0);
  });

  it("lazy-provisions a missing per-P AI Search instance", async () => {
    let createdId = null;
    const created = { items: { upload: async () => {} } };
    const m = build({
      AI_SEARCH: {
        get(id) {
          return {
            async info() {
              const err = new Error("404 not found");
              err.status = 404;
              throw err;
            },
          };
        },
        async create({ id }) {
          createdId = id;
          return created;
        },
      },
    });

    const instance = await m.getOrCreateMemoryInstance(
      "memory-03-1-usa-0650-p-2606-1-24",
    );
    expect(createdId).toBe("memory-03-1-usa-0650-p-2606-1-24");
    expect(instance).toBe(created);
  });

  it("stores Experience Projection items under experiences/", async () => {
    const uploaded = [];
    const instance = {
      async info() {
        return { id: "memory-03-1-usa-0650-p-2606-1-24" };
      },
      items: {
        async upload(key, content) {
          uploaded.push({ key, content });
        },
      },
    };
    const m = build({
      AI_SEARCH: {
        get() {
          return instance;
        },
      },
    });

    const indexed = await m.storeEmbedding(
      "interaction-1",
      "session-a",
      { content: "retained experience" },
      "03-1-USA-0650-P-2606-1-24",
    );

    expect(indexed).toBe(true);
    expect(uploaded).toEqual([
      {
        key: "experiences/session-a/interaction-1.txt",
        content: "retained experience",
      },
    ]);
  });

  it("recalls relevant experiences across sessions inside the same P instance", async () => {
    const kv = new MockKV();
    await kv.put(
      "session:session-a:1",
      JSON.stringify({
        id: "session-a-1",
        content: "older cross-session experience",
      }),
    );
    await kv.put(
      "session:session-b:2",
      JSON.stringify({
        id: "session-b-2",
        content: "current session experience",
      }),
    );

    const instance = {
      async info() {
        return { id: "memory-03-1-usa-0650-p-2606-1-24" };
      },
      async search() {
        return {
          chunks: [
            {
              score: 0.95,
              item: { key: "experiences/session-a/session-a-1.txt" },
            },
            {
              score: 0.80,
              item: { key: "experiences/session-b/session-b-2.txt" },
            },
          ],
        };
      },
    };

    const m = new MemoryCloude({
      TOKEN_KV: kv,
      AI_SEARCH: {
        get() {
          return instance;
        },
      },
    });

    const out = await m.semanticRecall(
      "session-b",
      "experience",
      5,
      "memory-03-1-usa-0650-p-2606-1-24",
    );

    expect(out).toHaveLength(2);
    expect(out.map((x) => x.sourceSessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("has AI Search state before initialize() is awaited", () => {
    const m = new MemoryCloude({ TOKEN_KV: new MockKV(), AI_SEARCH: {} });
    expect(m.hasAiSearch).toBe(true);
    const off = new MemoryCloude({ TOKEN_KV: new MockKV() });
    expect(off.hasAiSearch).toBe(false);
  });
});
