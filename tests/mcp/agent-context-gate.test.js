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

  it("rejects legacy unscoped agent prompts rather than treating absent grants as public", async () => {
    const legacy = { ...BASE, consumer_gate: "{}" };
    const env = envFor(legacy, null);
    const result = await dispatchToolCall("agent_context", { agent_id: ID }, env);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(legacy.base);
  });

  it("rejects wildcard service grants even when the requested agent ID matches", async () => {
    const wildcard = {
      ...BASE,
      consumer_gate: JSON.stringify({ allowedServices: ["*"], allowedAgents: [ID] }),
    };
    const env = envFor(wildcard);
    const result = await dispatchToolCall("agent_context", { agent_id: ID },
      env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(wildcard.base);
  });
  it("never composes a legacy litigation prompt through a Storage agent", async () => {
    const legacy = { domain: "litigation", base: "SENSITIVE LITIGATION PROMPT", consumer_gate: "{}" };
    const env = envFor();
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === BASE.id ? BASE : legacy }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["litigation.synthesize"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
    expect(result.content[0].text).not.toContain(legacy.base);
    expect(result.content[0].text).not.toContain(BASE.base);
  });

  it("rejects same-domain legacy prompt layers without explicit service grants", async () => {
    const legacy = { domain: "agents", base: "UNSCOPED LEGACY PROMPT", consumer_gate: "{}" };
    const env = envFor();
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === BASE.id ? BASE : legacy }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["legacy.agents.context"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(legacy.base);
  });

  it("rejects a cross-domain layer even when its service is explicitly permitted", async () => {
    const layer = {
      domain: "litigation", base: "LITIGATION CROSS-DOMAIN",
      consumer_gate: JSON.stringify({
        allowedServices: ["chittystorage"], allowedAgents: [ID],
      }),
    };
    const env = envFor();
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === BASE.id ? BASE : layer }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["litigation.allowed-by-service"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(layer.base);
  });

  it("permits authorized same-domain, same-scope Storage layers", async () => {
    const base = {
      ...BASE,
      consumer_gate: JSON.stringify({
        allowedServices: ["chittystorage"], allowedAgents: [ID], scopeBoundaries: ["storage"],
      }),
    };
    const layer = {
      domain: "agents", base: "STORAGE-COMPATIBLE LAYER",
      consumer_gate: JSON.stringify({
        allowedServices: ["chittystorage"], allowedAgents: [ID], scopeBoundaries: ["storage"],
      }),
    };
    const env = envFor(base);
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === base.id ? base : layer }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["storage.authorized-layer"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.systemPrompt).toContain(base.base);
    expect(payload.systemPrompt).toContain(layer.base);
    expect(payload.resolvedLayers).toContain("storage.authorized-layer");
  });

  it("denies a layer with missing Storage scope boundary", async () => {
    const base = {
      ...BASE,
      consumer_gate: JSON.stringify({
        allowedServices: ["chittystorage"], allowedAgents: [ID], scopeBoundaries: ["storage"],
      }),
    };
    const layer = {
      domain: "agents", base: "INCOMPATIBLE SCOPE LAYER",
      consumer_gate: JSON.stringify({
        allowedServices: ["chittystorage"], allowedAgents: [ID], scopeBoundaries: ["legal"],
      }),
    };
    const env = envFor(base);
    env.DB.prepare = vi.fn(() => ({
      bind: (id) => ({ first: async () => id === base.id ? base : layer }),
    }));
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: ["legal-in-storage-domain"],
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(layer.base);
  });

  it("caps caller-supplied layer count before querying any layer", async () => {
    const env = envFor();
    const result = await dispatchToolCall("agent_context", {
      agent_id: ID, additional_layers: Array.from({ length: 9 }, (_, i) => "layer-" + i),
    }, env, { authToken: "valid-key" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid additional prompt layers");
    expect(env.DB.prepare).toHaveBeenCalledTimes(1);
  });

});
