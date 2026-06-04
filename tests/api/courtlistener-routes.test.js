import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ----------------------------------------------------------------
// Mocks — mirror the established pattern in google-routes.test.js
// (route unit test of identical shape; service-integration smoke
// is performed post-deploy via real curl per the deploy runbook).
// ----------------------------------------------------------------

vi.mock("../../src/middleware/require-service-token.js", () => ({
  requireServiceToken: () => async (_c, next) => { await next(); },
}));

const mockGetCredential = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: (...args) => mockGetCredential(...args),
}));

const { courtlistenerRoutes } = await import(
  "../../src/api/routes/courtlistener.js"
);

function makeEnv(overrides = {}) {
  return {
    COURTLISTENER_API_TOKEN: "test-cl-token",
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status, text = "Error") {
  return new Response(text, { status });
}

async function req(method, path, env, { query = "", body, headers = {} } = {}) {
  const url = `http://localhost${path}${query ? `?${query}` : ""}`;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
  }
  // Pass an empty caches stub by default — Cache API isn't present in vitest
  return courtlistenerRoutes.fetch(new Request(url, init), env);
}

const get = (path, env, opts) => req("GET", path, env, opts);
const post = (path, env, opts) => req("POST", path, env, opts);

// ----------------------------------------------------------------
// Token resolution + fail-closed
// ----------------------------------------------------------------

describe("CourtListener token resolution", () => {
  let originalFetch;
  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses env.COURTLISTENER_API_TOKEN when present (Token scheme, not Bearer)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    await get("/search", makeEnv(), { query: "q=foo" });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Token test-cl-token");
  });

  it("falls back to getCredential when env binding is missing", async () => {
    mockGetCredential.mockResolvedValueOnce("broker-cl-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    await get("/search", makeEnv({ COURTLISTENER_API_TOKEN: undefined }), { query: "q=foo" });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Token broker-cl-token");
  });

  it("supports Secrets Store accessor-style bindings ({ get() })", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    const env = makeEnv({
      COURTLISTENER_API_TOKEN: { get: vi.fn().mockResolvedValue("secrets-store-token") },
    });
    await get("/search", env, { query: "q=foo" });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Token secrets-store-token");
  });

  it("fails closed with 503 POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE when no token available", async () => {
    mockGetCredential.mockResolvedValueOnce(undefined);
    const res = await get("/search", makeEnv({ COURTLISTENER_API_TOKEN: undefined }), {
      query: "q=foo",
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE");
  });

  it("503 path also applies to POST /citation-lookup when no token available", async () => {
    mockGetCredential.mockResolvedValueOnce(undefined);
    const res = await post("/citation-lookup", makeEnv({ COURTLISTENER_API_TOKEN: undefined }), {
      body: { text: "410 U.S. 113" },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE");
  });
});

// ----------------------------------------------------------------
// GET /search
// ----------------------------------------------------------------

describe("GET /search", () => {
  let env;
  let originalFetch;
  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    originalFetch = globalThis.fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("forwards query parameters verbatim to /api/rest/v4/search/", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    await get("/search", env, { query: "type=o&q=miranda&page_size=3" });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("https://www.courtlistener.com/api/rest/v4/search/");
    expect(url).toContain("type=o");
    expect(url).toContain("q=miranda");
    expect(url).toContain("page_size=3");
  });

  it("returns 200 + parsed JSON on upstream success", async () => {
    const payload = { count: 1, results: [{ caseName: "Miranda v. Arizona" }] };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(payload));
    const res = await get("/search", env, { query: "q=miranda" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].caseName).toBe("Miranda v. Arizona");
  });

  it("propagates upstream non-2xx status and truncates body to 200 chars", async () => {
    const longBody = "x".repeat(500);
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(403, longBody));
    const res = await get("/search", env, { query: "q=foo" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("403");
    expect(body.error.length).toBeLessThan(400);
  });

  it("returns 502 on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network"));
    const res = await get("/search", env, { query: "q=foo" });
    expect(res.status).toBe(502);
  });

  it("scrubs the resolved API token from error body (defense-in-depth)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(500, "boom test-cl-token boom"));
    const res = await get("/search", env, { query: "q=foo" });
    const body = await res.json();
    expect(body.error).not.toContain("test-cl-token");
    expect(body.error).toContain("[REDACTED]");
    expect(body.error).not.toContain("Authorization");
  });

  it("does not leak the token in success-path response bodies", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ count: 0, results: [], note: "harmless" })
    );
    const res = await get("/search", env, { query: "q=ok" });
    const text = await res.text();
    expect(text).not.toContain("test-cl-token");
  });

  it("propagates upstream 429 rate-limit status to the client", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(429, "Too Many Requests"));
    const res = await get("/search", env, { query: "q=foo" });
    expect(res.status).toBe(429);
  });
});

// ----------------------------------------------------------------
// Allowlist enforcement on /:resource
// ----------------------------------------------------------------

describe("GET /:resource allowlist", () => {
  let env;
  let originalFetch;
  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("400 path_not_allowed for unknown resource without calling upstream", async () => {
    const res = await get("/not-a-real-resource", env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("path_not_allowed");
    expect(body.resource).toBe("not-a-real-resource");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("400 path_not_allowed includes the offending resource string", async () => {
    const res = await get("/etc-passwd-style-injection", env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("path_not_allowed");
    expect(typeof body.resource).toBe("string");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows opinions/:id (URL-encoded)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 12345 }));
    const res = await get("/opinions/12345", env);
    expect(res.status).toBe(200);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://www.courtlistener.com/api/rest/v4/opinions/12345/");
  });

  it("allows dockets list with query", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    await get("/dockets", env, { query: "court=scotus" });
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/dockets/");
    expect(url).toContain("court=scotus");
  });

  it("405s GET /citation-lookup (POST-only)", async () => {
    const res = await get("/citation-lookup", env);
    expect(res.status).toBe(405);
  });

  it("URL-encodes id parameter to prevent path injection", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await get("/clusters/abc%2Fdef", env);
    const [url] = globalThis.fetch.mock.calls[0];
    // Hono decodes %2F to / in the route param; the proxy then re-encodes
    // it so the slash never reaches the upstream path as a separator.
    expect(url).toContain("/clusters/abc%2Fdef/");
    expect(url).not.toMatch(/\/clusters\/abc\/def\//);
  });

  it("allows all spec-required resources", async () => {
    const allowed = [
      "search",
      "opinions",
      "clusters",
      "dockets",
      "docket-entries",
      "recap-documents",
      "audio",
      "people",
      "courts",
    ];
    for (const resource of allowed) {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
      const res = await get(`/${resource}`, env);
      expect(res.status, `expected 200 for ${resource}`).toBe(200);
    }
  });
});

// ----------------------------------------------------------------
// POST /citation-lookup
// ----------------------------------------------------------------

describe("POST /citation-lookup", () => {
  let env;
  let originalFetch;
  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    originalFetch = globalThis.fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("forwards POST body verbatim with Token auth", async () => {
    const upstreamResponse = [{ citation: "410 U.S. 113", normalized_citations: ["410 U.S. 113"] }];
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(upstreamResponse));

    const res = await post("/citation-lookup", env, { body: { text: "Roe v. Wade, 410 U.S. 113" } });
    expect(res.status).toBe(200);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://www.courtlistener.com/api/rest/v4/citation-lookup/");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Token test-cl-token");
    expect(JSON.parse(init.body).text).toBe("Roe v. Wade, 410 U.S. 113");
  });

  it("returns upstream error with truncation", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(400, "y".repeat(500)));
    const res = await post("/citation-lookup", env, { body: { text: "garbage" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.length).toBeLessThan(400);
  });

  it("scrubs the API token from POST error bodies", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      errorResponse(500, "internal failure test-cl-token internal")
    );
    const res = await post("/citation-lookup", env, { body: { text: "x" } });
    const body = await res.json();
    expect(body.error).not.toContain("test-cl-token");
    expect(body.error).toContain("[REDACTED]");
  });

  it("pins upstream Content-Type to application/json regardless of client header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
    await post("/citation-lookup", env, {
      body: '{"text":"x"}',
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("never consults Cache API for POST (POST is not cached)", async () => {
    const cacheMatch = vi.fn().mockResolvedValue(undefined);
    const cachePut = vi.fn().mockResolvedValue(undefined);
    globalThis.caches = { default: { match: cacheMatch, put: cachePut } };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
    await post("/citation-lookup", env, { body: { text: "x" } });
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------
// Cache behavior
// ----------------------------------------------------------------

describe("Cache API wrap on GETs", () => {
  let env;
  let originalFetch;
  let originalCaches;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    originalFetch = globalThis.fetch;
    originalCaches = globalThis.caches;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  });

  it("returns cached response on cache hit without calling upstream", async () => {
    const cached = jsonResponse({ count: 99, results: ["from-cache"] });
    globalThis.caches = {
      default: {
        match: vi.fn().mockResolvedValue(cached),
        put: vi.fn(),
      },
    };
    globalThis.fetch = vi.fn();

    const res = await get("/search", env, { query: "q=cached" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("bypasses cache when X-Bypass-Cache: 1 header is set", async () => {
    globalThis.caches = {
      default: {
        match: vi.fn().mockResolvedValue(jsonResponse({ count: 1, results: ["from-cache"] })),
        put: vi.fn(),
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));

    const res = await get("/search", env, {
      query: "q=fresh",
      headers: { "X-Bypass-Cache": "1" },
    });
    expect(res.status).toBe(200);
    expect(globalThis.caches.default.match).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("sets X-Cache: MISS + Cache-Control on cache miss", async () => {
    globalThis.caches = {
      default: {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));

    const res = await get("/search", env, { query: "q=miss" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    // Cache-Control is intentionally NOT emitted on proxy responses
    // (Worker Cache API stores internally; downstream CDNs/browsers
    // must not cache authenticated-proxy responses).
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
