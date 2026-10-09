import { describe, expect, it, vi } from "vitest";
import { authorizeAgentContext } from "../../src/mcp/agent-context-auth.js";
import { dispatchToolCall } from "../../src/mcp/tool-dispatcher.js";

const ID = "chittystorage-sasquatch";
const BASE = {
  id: "agent:" + ID,
  version: 1,
  domain: "agents",
  updated_at: "2026-10-09",
  base: "SECRET STORAGE AGENT PROMPT",
  layers: "[]",
  consumer_gate: JSON.stringify({
    allowedServices: ["chittystorage", "chittyagent-storage"],
    allowedAgents: [ID],
  }),
};

function envFor(prompt = BASE, keyData = { status: "active", service: "chittystorage" }) {
  const get = vi.fn(async () => keyData === null ? null : JSON.stringify(keyData));
  const first = vi.fn(async () => prompt);
  return {
    DB: { prepare: vi.fn(() => ({ bind: () => ({ first }) })) },
    API_KEYS: { get },
    _get: get,
    _first: first,
  };
}

describe("MCP agent_context consumer authorization", () => {
  it("valid service-scoped key receives exactly its versioned prompt", async () => {
    const env = envFor();
    const result = await dispatchToolCall("agent_context", { agent_id: ID }, env, { authToken: "valid-key" });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.systemPrompt).toBe(BASE.base);
    expect(payload.version).toBe(1);
    expect(env._get).toHaveBeenCalledWith("key:valid-key");
  });

  it.each([
    ["missing token", undefined, undefined],
    ["user-only key", "user-key", { status: "active", userId: "user-123" }],
    ["wrong service", "wrong", { status: "active", service: "unrelated-service" }],
    ["revoked", "revoked", { status: "revoked", service: "chittystorage" }],
    ["expired", "expired", { status: "active", service: "chittystorage", expiresAt: "2020-01-01" }],
    ["invalid key", "invalid", null],
  ])("denies %s without leaking base content", async (_name, token, keyData) => {
    const env = envFor(BASE, keyData);
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID,
      service: "chittystorage",
      consumer_service: "chittystorage",
    }, env, { authToken: token, context: { service: "chittystorage", apiKey: "spoof" } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
    expect(result.content[0].text).not.toContain(BASE.base);
  });

  it("denies when the auth KV backend is absent even with a supplied session service", async () => {
    const env = envFor();
    delete env.API_KEYS;
    const result = await dispatchToolCall("agent_context", { agent_id: ID },
      env, { context: { service: "chittystorage" }, authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(BASE.base);
  });

  it("denies appended layer when the layer consumer gate excludes this service", async () => {
    const layer = { base: "SECRET UNRELATED LAYER", consumer_gate: JSON.stringify({ allowedServices: ["legal"] }) };
    const env = envFor();
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === "agent:" + ID ? BASE : layer }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["legal-restricted"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(layer.base);
    expect(result.content[0].text).not.toContain(BASE.base);
  });

  it("fails closed when allowedServices is present but malformed", async () => {
    const prompt = { ...BASE, consumer_gate: '{"allowedServices":"chittystorage"}' };
    const access = await authorizeAgentContext(prompt, ID, "valid-key", envFor(prompt));
    expect(access.allowed).toBe(false);
  });

  it("honors restricted agent ID even with wildcard service access", async () => {
    const prompt = {
      ...BASE,
      consumer_gate: JSON.stringify({ allowedServices: ["*"], allowedAgents: ["another-agent"] }),
    };
    const access = await authorizeAgentContext(prompt, ID, undefined, envFor(prompt));
    expect(access.allowed).toBe(false);
  });

  it("preserves legacy behavior only for prompts without an explicit allowlist", async () => {
    const env = envFor({ ...BASE, consumer_gate: "{}" }, null);
    const result = await dispatchToolCall("agent_context", { agent_id: ID }, env);
    expect(result.isError).toBeFalsy();
  });
});
