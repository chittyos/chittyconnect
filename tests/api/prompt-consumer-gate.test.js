import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { promptRoutes } from "../../src/api/routes/prompts.js";

const RECORD = {
  id: "agent:chittystorage-sasquatch",
  domain: "agents",
  base: "RESTRICTED CANONICAL STORAGE CONTEXT",
  version: 1,
  layers: "[]",
  fallback: "passthrough",
  env_gate: "{}",
  author_gate: "{}",
  consumer_gate: JSON.stringify({ allowedServices: ["chittystorage"] }),
};

function appAs(identity, prompt = RECORD) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (identity) c.set("apiKey", identity); // mock upstream auth middleware
    await next();
  });
  app.route("/prompts", promptRoutes);
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => prompt,
        all: async () => ({ results: [prompt] }),
      }),
      all: async () => ({ results: [prompt] }),
    }),
  };
  return { app, env: { DB: db } };
}

describe("Prompt Registry authenticated consumer scope", () => {
  it("ignores spoofed X-Source-Service for single-record GET", async () => {
    const { app, env } = appAs({ type: "oauth", userId: "another-person" });
    const res = await app.request("/prompts/agent%3Achittystorage-sasquatch", {
      headers: { "X-Source-Service": "chittystorage" },
    }, env);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(RECORD.base);
  });

  it("does not leak scoped prompt via list API even with spoofed service", async () => {
    const { app, env } = appAs({ type: "oauth", userId: "another-person" });
    const res = await app.request("/prompts?domain=agents", {
      headers: { "X-Source-Service": "chittystorage" },
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("rejects prompt resolution before executing or logging when caller is not scoped", async () => {
    const { app, env } = appAs({ type: "oauth", userId: "another-person" });
    const res = await app.request("/prompts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Source-Service": "chittystorage" },
      body: JSON.stringify({ promptId: RECORD.id }),
    }, env);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(RECORD.base);
  });

  it("allows trusted middleware identity for the authorized service", async () => {
    const { app, env } = appAs({ status: "active", service: "chittystorage" });
    const res = await app.request("/prompts/agent%3Achittystorage-sasquatch", {}, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(RECORD.id);
  });

  it("fails closed on malformed explicit service allowlist", async () => {
    const { app, env } = appAs({ service: "chittystorage" }, {
      ...RECORD,
      consumer_gate: '{"allowedServices":"chittystorage"}',
    });
    const res = await app.request("/prompts/agent%3Achittystorage-sasquatch", {}, env);
    expect(res.status).toBe(403);
  });
});
