import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockD1 } from "../helpers/mocks.js";

const { credentialsRoutes } = await import("../../src/api/routes/credentials.js");

const SERVICE_TOKEN = "test-svc-token-xyz";
const CONN_STRING = "postgresql://user:s3cr3t@ep-test-123.us-east-2.aws.neon.tech/dbname?sslmode=require";

function makeEnv(overrides = {}) {
  return {
    CHITTYCONNECT_SERVICE_TOKEN: SERVICE_TOKEN,
    NEON_API_KEY: "neon-api-key-abc",
    ONEPASSWORD_CONNECT_URL: "https://op.example.com",
    ONEPASSWORD_CONNECT_TOKEN: "op-connect-token",
    ONEPASSWORD_VAULT_INFRASTRUCTURE: "vault-infra-uuid",
    ONEPASSWORD_VAULT_SERVICES: "vault-services-uuid",
    ONEPASSWORD_VAULT_INTEGRATIONS: "vault-integrations-uuid",
    ONEPASSWORD_VAULT_EMERGENCY: "vault-emergency-uuid",
    CREDENTIAL_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    DB: createMockD1(),
    ...overrides,
  };
}

function makeRequest(body = {}, authToken = SERVICE_TOKEN) {
  const headers = { "Content-Type": "application/json" };
  if (authToken !== null) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return new Request("http://localhost/backfill-from-neon", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  neonProjectId: "proj-xyz-123",
  neonRole: "neondb_owner",
  pooled: true,
  targetVault: "infrastructure",
  targetItem: "neon",
  targetField: "neon_auth_database_url",
  category: "LOGIN",
  notes: "Backfilled for neon-auth RLS",
};

function make1PFetch({ existing = false, category = undefined } = {}) {
  let capturedCreateBody = null;

  const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
    const method = opts?.method ?? "GET";

    if (url.includes("console.neon.tech")) {
      return new Response(JSON.stringify({ uri: CONN_STRING }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/v1/vaults") && url.endsWith("/items") && method === "GET") {
      const items = existing
        ? [{ id: "existing-item-id", title: "neon" }]
        : [];
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/items/existing-item-id") && method === "GET") {
      return new Response(
        JSON.stringify({ id: "existing-item-id", title: "neon", fields: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/items/existing-item-id") && method === "PUT") {
      return new Response(
        JSON.stringify({ id: "existing-item-id", title: "neon" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/v1/vaults") && url.endsWith("/items") && method === "POST") {
      capturedCreateBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({ id: "new-item-id", title: capturedCreateBody.title }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  });

  mockFetch.getCreateBody = () => capturedCreateBody;
  return mockFetch;
}

describe("POST /backfill-from-neon", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = makeRequest(VALID_BODY, null);
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header carries the wrong token", async () => {
    const req = makeRequest(VALID_BODY, "wrong-token");
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    globalThis.fetch = make1PFetch();
    const req = makeRequest({ neonProjectId: "proj-123" });
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(400);
  });

  it("returns 503 when NEON_API_KEY is not configured", async () => {
    const req = makeRequest(VALID_BODY);
    const res = await credentialsRoutes.fetch(req, makeEnv({ NEON_API_KEY: undefined }));

    expect(res.status).toBe(503);
  });

  it("returns stored:true and NEVER includes the connection string in the response body", async () => {
    const mockFetch = make1PFetch();
    globalThis.fetch = mockFetch;

    const req = makeRequest(VALID_BODY);
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(201);

    const text = await res.text();
    expect(text).not.toContain(CONN_STRING);
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("postgresql://");

    const body = JSON.parse(text);
    expect(body.stored).toBe(true);
    expect(body.vault).toBe("infrastructure");
    expect(body.item).toBe("neon");
    expect(body.action).toBe("created");
    expect(body).not.toHaveProperty("uri");
    expect(body).not.toHaveProperty("value");
    expect(body).not.toHaveProperty("connectionString");
  });

  it("passes category to the 1Password put() call when creating a new item", async () => {
    const mockFetch = make1PFetch();
    globalThis.fetch = mockFetch;

    const req = makeRequest({ ...VALID_BODY, category: "LOGIN" });
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(201);

    const createBody = mockFetch.getCreateBody();
    expect(createBody).not.toBeNull();
    expect(createBody.category).toBe("LOGIN");
  });

  it("uses LOGIN as default category when category is omitted from the request body", async () => {
    const mockFetch = make1PFetch();
    globalThis.fetch = mockFetch;

    const bodyWithoutCategory = { ...VALID_BODY };
    delete bodyWithoutCategory.category;
    const req = makeRequest(bodyWithoutCategory);
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(201);

    const createBody = mockFetch.getCreateBody();
    expect(createBody).not.toBeNull();
    expect(createBody.category).toBe("LOGIN");
  });

  it("returns 200 (not 201) and action=updated when item already exists in 1Password", async () => {
    const mockFetch = make1PFetch({ existing: true });
    globalThis.fetch = mockFetch;

    const req = makeRequest(VALID_BODY);
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored).toBe(true);
    expect(body.action).toBe("updated");
  });

  it("returns 502 when Neon API fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("project not found", { status: 404 }),
    );

    const req = makeRequest(VALID_BODY);
    const res = await credentialsRoutes.fetch(req, makeEnv());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Neon API error/);
  });
});
