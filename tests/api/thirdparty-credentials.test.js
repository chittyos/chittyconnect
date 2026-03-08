import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CREDENTIAL_PATHS } from "../../src/lib/credential-paths.js";

const helperMocks = vi.hoisted(() => ({
  getCredential: vi.fn(),
}));

vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: helperMocks.getCredential,
}));

const { thirdpartyRoutes } = await import("../../src/api/routes/thirdparty.js");

describe("thirdparty credential paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses canonical Neon credential path on /neon/query", async () => {
    helperMocks.getCredential.mockResolvedValue("https://neon.example/sql");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{ ok: 1 }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const env = {};
    const req = new Request("http://localhost/neon/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "SELECT 1" }),
    });

    const res = await thirdpartyRoutes.fetch(req, env);
    expect(res.status).toBe(200);

    expect(helperMocks.getCredential).toHaveBeenCalledWith(
      env,
      CREDENTIAL_PATHS.infrastructure.neonDatabaseUrl,
      "NEON_DATABASE_URL",
      "ThirdParty",
    );
  });
});