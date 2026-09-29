import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the network boundary, matching tests/api/cert-routes.test.js. This is a
// fetch stub, not a vi.mock() of a service module.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { registryRoutes } = await import("../../src/api/routes/registry.js");

const REGISTER_URL = "https://register.chitty.cc/api/v1/register";

// No audit DB configured -> auditRegistrationAttempt returns recorded:false
// without throwing, which is the documented degraded behaviour.
const ENV = {};

function post(body, env = ENV) {
  return registryRoutes.fetch(
    new Request("http://localhost/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

const VALID = {
  entity_type: "T",
  subtype: "service",
  name: "chittyexample",
  description: "An example service for broker route tests",
  version: "1.0.0",
  endpoints: { health: "https://example.chitty.cc/health" },
  schema: { type: "object" },
};

describe("POST /register — broker validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects __proto__ entity_type with a validation error, not a 500", async () => {
    const res = await post({ ...VALID, entity_type: "__proto__", subtype: "service" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty entity_type rather than defaulting to T", async () => {
    const res = await post({ ...VALID, entity_type: "" });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-string entity_type", async () => {
    const res = await post({ ...VALID, entity_type: { evil: true } });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an agent-like subtype declared as a Thing", async () => {
    const res = await post({ ...VALID, entity_type: "T", subtype: "synthetic" });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /register — downstream passthrough", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves a non-OK downstream status instead of collapsing it", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "proof of control failed" }), { status: 412 }),
    );
    const res = await post(VALID);
    expect(res.status).toBe(412);
    expect((await res.json()).error).toBe("proof of control failed");
  });

  it("does not flatten a non-object downstream body into index keys", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200 }),
    );
    const body = await (await post(VALID)).json();
    expect(Array.isArray(body.result)).toBe(true);
    expect(body.result).toHaveLength(2);
    expect(body["0"]).toBeUndefined();
  });

  it("returns 502 with an audit record when the downstream is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const res = await post(VALID);
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.stage).toBe("downstream_unreachable");
    expect(body.audit).toBeDefined();
  });

  it("bounds the upstream call with an abort signal", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await post(VALID);
    expect(mockFetch).toHaveBeenCalledWith(
      REGISTER_URL,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});

describe("POST /register — credential handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a Secrets Store binding instead of sending 'Bearer [object Object]'", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await post(VALID, { CHITTY_REGISTRY_TOKEN: { get: async () => "real-token-value" } });
    const { headers } = mockFetch.mock.calls[0][1];
    expect(headers.Authorization).toBe("Bearer real-token-value");
  });

  it("omits Authorization entirely when the binding resolves to a non-string", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await post(VALID, { CHITTY_REGISTRY_TOKEN: { get: async () => ({ nope: true }) } });
    const { headers } = mockFetch.mock.calls[0][1];
    expect(headers.Authorization).toBeUndefined();
  });
});
