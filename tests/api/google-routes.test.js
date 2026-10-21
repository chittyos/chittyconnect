import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockKV } from "../helpers/mocks.js";

// ----------------------------------------------------------------
// Mocks — must be defined before importing the route module
// ----------------------------------------------------------------

// Bypass the service-token middleware so route handlers execute unconditionally.
vi.mock("../../src/middleware/require-service-token.js", () => ({
  requireServiceToken: () => async (_c, next) => { await next(); },
}));

// Mock credential-helper so getCredential returns a predictable token.
const mockGetCredential = vi.fn().mockResolvedValue("test-google-token");
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: (...args) => mockGetCredential(...args),
}));

// ----------------------------------------------------------------
// Import route AFTER mocks are registered
// ----------------------------------------------------------------
const { googleRoutes } = await import("../../src/api/routes/google.js");

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(),
    ...overrides,
  };
}

/** Build a minimal successful fetch response returning JSON. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a fetch error response with plain text body. */
function errorResponse(status, text = "Error") {
  return new Response(text, { status });
}

/**
 * Issue a GET request directly to the googleRoutes Hono app.
 * @param {string} path  - e.g. "/gdrive/files"
 * @param {object} env   - Mock worker environment
 * @param {string} [query] - Optional query string (without leading "?")
 */
async function get(path, env, query = "") {
  const url = `http://localhost${path}${query ? `?${query}` : ""}`;
  return googleRoutes.fetch(new Request(url), env);
}

// ----------------------------------------------------------------
// getGoogleToken resolution
// ----------------------------------------------------------------

describe("getGoogleToken token resolution", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses KV-cached token when CREDENTIAL_CACHE has a value", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValueOnce("kv-cached-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));

    await get("/gdrive/files", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer kv-cached-token");
    expect(mockGetCredential).not.toHaveBeenCalled();
  });

  it("falls back to getCredential when KV returns null", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockGetCredential.mockResolvedValueOnce("broker-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));

    await get("/gdrive/files", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer broker-token");
  });

  it("Drive routes fall back to the app-only KV token when delegated is missing", async () => {
    env.CREDENTIAL_CACHE.get.mockImplementation((key) => {
      if (key === "secret:gdrive:access_token") return Promise.resolve(null);
      if (key === "secret:gdrive:access_token:app_only") return Promise.resolve("app-only-tok");
      return Promise.resolve(null);
    });
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));

    await get("/gdrive/files", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer app-only-tok");
    expect(mockGetCredential).not.toHaveBeenCalled();
  });

  it("Gmail routes do NOT use the app-only KV token; they fall through to broker/env", async () => {
    env.CREDENTIAL_CACHE.get.mockImplementation((key) => {
      if (key === "secret:gdrive:access_token") return Promise.resolve(null);
      if (key === "secret:gdrive:access_token:app_only") return Promise.resolve("app-only-tok");
      return Promise.resolve(null);
    });
    mockGetCredential.mockResolvedValueOnce("broker-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));

    await get("/email/messages", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer broker-token");
    expect(mockGetCredential).toHaveBeenCalled();
    // Ensure the app-only cached token was NOT used.
    expect(init.headers.Authorization).not.toBe("Bearer app-only-tok");
  });

  it("Gmail routes prefer the delegated KV token over broker/env", async () => {
    env.CREDENTIAL_CACHE.get.mockImplementation((key) => {
      if (key === "secret:gdrive:access_token") return Promise.resolve("delegated-tok");
      return Promise.resolve(null);
    });
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));

    await get("/email/messages", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer delegated-tok");
    expect(mockGetCredential).not.toHaveBeenCalled();
  });

  it("falls back to getCredential when CREDENTIAL_CACHE is absent from env", async () => {
    const envNoKV = makeEnv({ CREDENTIAL_CACHE: undefined });
    mockGetCredential.mockResolvedValueOnce("env-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));

    await get("/gdrive/files", envNoKV);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer env-token");
  });

  it("falls back to getCredential when KV read throws", async () => {
    env.CREDENTIAL_CACHE.get.mockRejectedValueOnce(new Error("KV unavailable"));
    mockGetCredential.mockResolvedValueOnce("fallback-token");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));

    await get("/gdrive/files", env);

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer fallback-token");
  });

  it("returns 503 when no token is available from any source", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValueOnce(null);
    mockGetCredential.mockResolvedValueOnce(undefined);

    const res = await get("/gdrive/files", env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Google access token not available");
  });
});

// ----------------------------------------------------------------
// GET /gdrive/files
// ----------------------------------------------------------------

describe("GET /gdrive/files", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 200 with file list from Google API", async () => {
    const driveFiles = { files: [{ id: "file-1", name: "doc.pdf" }], nextPageToken: null };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(driveFiles));

    const res = await get("/gdrive/files", env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].id).toBe("file-1");
  });

  it("calls the Drive files list endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
    await get("/gdrive/files", env);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
  });

  it("forwards q query parameter to Google API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
    await get("/gdrive/files", env, "q=name+contains+'report'");
    const [url] = globalThis.fetch.mock.calls[0];
    // URLSearchParams serializes spaces as '+', so use form-encoded parsing to read q.
    const qParam = new URL(url).searchParams.get("q");
    expect(qParam).toBe("name contains 'report'");
  });

  it("forwards fields, pageSize, and pageToken parameters", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
    await get("/gdrive/files", env, "fields=files(id,name)&pageSize=10&pageToken=tok123");
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("fields=");
    expect(url).toContain("pageSize=10");
    expect(url).toContain("pageToken=tok123");
  });

  it("returns 502 when Google API fetch throws a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
    const res = await get("/gdrive/files", env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Google API request failed");
  });

  it("returns upstream status code on non-2xx Google response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(403, "Forbidden"));
    const res = await get("/gdrive/files", env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("403");
  });

  it("returns 502 when Google API returns non-JSON body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const res = await get("/gdrive/files", env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("invalid JSON");
  });
});

// ----------------------------------------------------------------
// GET /gdrive/files/:fileId
// ----------------------------------------------------------------

describe("GET /gdrive/files/:fileId", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 200 with file metadata", async () => {
    const fileMeta = { id: "abc123", name: "report.pdf", mimeType: "application/pdf" };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(fileMeta));

    const res = await get("/gdrive/files/abc123", env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("abc123");
  });

  it("URL-encodes the fileId in the upstream request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "id with spaces" }));
    await get("/gdrive/files/id%20with%20spaces", env);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("id%20with%20spaces");
  });

  it("forwards fields query parameter", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }));
    await get("/gdrive/files/f1", env, "fields=id,name,mimeType");
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("fields=");
  });

  it("returns 404 when Google returns 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(404, "File not found"));
    const res = await get("/gdrive/files/missing", env);
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------
// GET /gdrive/files/:fileId/content
// ----------------------------------------------------------------

describe("GET /gdrive/files/:fileId/content", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports Google Docs files as PDF via the export endpoint", async () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "application/vnd.google-apps.document" })) // metadata
      .mockResolvedValueOnce(
        new Response(pdfBytes, {
          status: 200,
          headers: { "Content-Type": "application/pdf", "Content-Length": "4" },
        }),
      ); // export

    const res = await get("/gdrive/files/doc-id/content", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Verify the second fetch was to the export endpoint
    const [exportUrl] = globalThis.fetch.mock.calls[1];
    expect(exportUrl).toContain("/export?mimeType=");
    expect(exportUrl).toContain("application%2Fpdf");
  });

  it("exports Google Sheets files as PDF", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "application/vnd.google-apps.spreadsheet" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "application/pdf" } }));

    const res = await get("/gdrive/files/sheet-id/content", env);
    expect(res.status).toBe(200);
    const [exportUrl] = globalThis.fetch.mock.calls[1];
    expect(exportUrl).toContain("/export");
  });

  it("exports Google Slides files as PDF", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "application/vnd.google-apps.presentation" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "application/pdf" } }));

    const res = await get("/gdrive/files/slide-id/content", env);
    expect(res.status).toBe(200);
    const [exportUrl] = globalThis.fetch.mock.calls[1];
    expect(exportUrl).toContain("/export");
  });

  it("downloads binary files using alt=media", async () => {
    const fileBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "image/png" }))
      .mockResolvedValueOnce(
        new Response(fileBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      );

    const res = await get("/gdrive/files/img-id/content", env);
    expect(res.status).toBe(200);
    const [downloadUrl] = globalThis.fetch.mock.calls[1];
    expect(downloadUrl).toContain("alt=media");
  });

  it("returns 503 when no token is available", async () => {
    // Override the describe-level default so both delegated and app-only KV lookups miss.
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockGetCredential.mockResolvedValueOnce(undefined);

    const res = await get("/gdrive/files/any-id/content", env);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Google access token not available");
  });

  it("returns upstream status when metadata fetch fails", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(errorResponse(404, "Not found")); // metadata

    const res = await get("/gdrive/files/bad-id/content", env);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Failed to fetch file metadata");
  });

  it("returns upstream status when download fails", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "image/jpeg" })) // metadata OK
      .mockResolvedValueOnce(errorResponse(403, "Forbidden")); // download fails

    const res = await get("/gdrive/files/locked-id/content", env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Drive download failed");
  });

  it("propagates Content-Disposition header from Google when present", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "application/pdf" }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="file.pdf"',
          },
        }),
      );

    const res = await get("/gdrive/files/f1/content", env);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="file.pdf"');
  });

  it("falls back to application/octet-stream when Content-Type is missing", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "application/octet-stream" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0]), { status: 200 }));

    const res = await get("/gdrive/files/bin-id/content", env);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

// ----------------------------------------------------------------
// GET /email/messages
// ----------------------------------------------------------------

describe("GET /email/messages", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 200 with message list", async () => {
    const messages = { messages: [{ id: "msg-1" }, { id: "msg-2" }], resultSizeEstimate: 2 };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(messages));

    const res = await get("/email/messages", env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
  });

  it("calls the Gmail messages list endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));
    await get("/email/messages", env);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("https://www.googleapis.com/gmail/v1/users/me/messages");
  });

  it("forwards q, maxResults, and pageToken query parameters", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));
    await get("/email/messages", env, "q=from%3Aboss&maxResults=5&pageToken=nextTok");
    const [url] = globalThis.fetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain("from:boss");
    expect(url).toContain("maxResults=5");
    expect(url).toContain("pageToken=nextTok");
  });

  it("returns 503 when no token available", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValueOnce(null);
    mockGetCredential.mockResolvedValueOnce(undefined);

    const res = await get("/email/messages", env);
    expect(res.status).toBe(503);
  });

  it("returns upstream error code on Gmail API failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(429, "Rate limit exceeded"));
    const res = await get("/email/messages", env);
    expect(res.status).toBe(429);
  });
});

// ----------------------------------------------------------------
// GET /email/messages/:messageId
// ----------------------------------------------------------------

describe("GET /email/messages/:messageId", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 200 with message details", async () => {
    const message = { id: "msg-abc", threadId: "thread-1", snippet: "Hello world" };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(message));

    const res = await get("/email/messages/msg-abc", env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("msg-abc");
  });

  it("URL-encodes the messageId in the upstream request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "msg+special" }));
    await get("/email/messages/msg%2Bspecial", env);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("msg%2Bspecial");
  });

  it("forwards format query parameter", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "m1" }));
    await get("/email/messages/m1", env, "format=metadata");
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("format=metadata");
  });

  it("returns 404 when message is not found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(404, "Not Found"));
    const res = await get("/email/messages/nonexistent", env);
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------
// GET /email/messages/:messageId/attachments/:attachmentId
// ----------------------------------------------------------------

describe("GET /email/messages/:messageId/attachments/:attachmentId", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns binary content decoded from base64url data", async () => {
    // "Hello" in base64url is "SGVsbG8"
    const helloBytes = new TextEncoder().encode("Hello");
    const base64url = btoa(String.fromCharCode(...helloBytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ data: base64url, size: helloBytes.length }),
    );

    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    const buffer = await res.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(helloBytes);
  });

  it("sets Content-Length from size field in Gmail response", async () => {
    const bytes = new Uint8Array([65, 66, 67]); // "ABC"
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: b64, size: 3 }));

    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.headers.get("Content-Length")).toBe("3");
  });

  it("handles base64url with URL-safe characters (- and _)", async () => {
    // Create a byte sequence that would produce + and / in standard base64
    // 0xFB = 11111011 → in base64 would produce characters with + or /
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
    const standard = btoa(String.fromCharCode(...bytes));
    // standard base64 will have + and /; convert to base64url
    const b64url = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: b64url, size: 3 }));

    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.status).toBe(200);
    const buffer = await res.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  it("returns 404 when Gmail returns no data field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ size: 0 })); // no data
    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("No attachment data returned");
  });

  it("returns 500 when attachment data is corrupted (invalid base64)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: "!!!invalid!!!", size: 10 }));
    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Failed to decode attachment data");
  });

  it("returns upstream error when Gmail API fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(503, "Service Unavailable"));
    const res = await get("/email/messages/msg-1/attachments/att-1", env);
    expect(res.status).toBe(503);
  });

  it("URL-encodes both messageId and attachmentId in the upstream request", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: b64, size: 3 }));

    await get("/email/messages/msg%2B1/attachments/att%2F2", env);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("msg%2B1");
    expect(url).toContain("att%2F2");
  });
});

// ----------------------------------------------------------------
// googleProxy — shared error handling
// ----------------------------------------------------------------

describe("googleProxy shared error handling", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("truncates long Google error bodies in error messages (max 200 chars)", async () => {
    const longError = "x".repeat(500);
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(400, longError));

    const res = await get("/gdrive/files", env);
    const body = await res.json();
    // The error message includes up to 200 chars of the upstream body
    expect(body.error.length).toBeLessThan(400);
  });

  it("returns 502 on network-level error (fetch throws)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const res = await get("/email/messages", env);
    expect(res.status).toBe(502);
  });
});
// ----------------------------------------------------------------
// Shared-drive passthrough — gated authorization
//
// Drive v3 omits shared-drive content unless the request declares support for it,
// returning HTTP 200 with zero files — indistinguishable from an empty folder.
// Sending the parameters unconditionally would let any holder of any active API key
// read every shared drive the service account can see, so they are gated on an
// allowlist of API-key `userId` values held in worker config.
//
// These assert what ChittyConnect EMITS upstream. They cannot and do not verify
// Google's behaviour, which needs a live call against a real shared drive.
// ----------------------------------------------------------------

const { Hono: HonoForAuth } = await import("hono");

const AUTHORIZED_USER = "user_evidence_ingress";

/**
 * Wrap the real routes in an app that seeds `apiKey` the way `authenticate` does.
 * No mocking: the gate runs its real code path against a real record shape.
 */
function appAs(keyInfo) {
  const app = new HonoForAuth();
  app.use("*", async (c, next) => {
    if (keyInfo !== undefined) c.set("apiKey", keyInfo);
    await next();
  });
  app.route("/", googleRoutes);
  return app;
}

/** A KV-backed key record as generateAPIKey() writes it — note: no `type` field. */
function kvKeyRecord(overrides = {}) {
  return {
    status: "active",
    name: "evidence ingress",
    userId: AUTHORIZED_USER,
    scopes: ["mcp:read", "mcp:write"],
    rateLimit: 1000,
    ...overrides,
  };
}

describe("shared-drive parameters are gated on an allowlisted principal", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv({ GDRIVE_SHARED_DRIVE_USER_IDS: AUTHORIZED_USER });
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function queryOf(callIndex = 0) {
    const [url] = globalThis.fetch.mock.calls[callIndex];
    return new URL(url).searchParams;
  }

  function urlOf(callIndex = 0) {
    return globalThis.fetch.mock.calls[callIndex][0];
  }

  const req = (path, query = "") =>
    new Request(`http://localhost${path}${query ? `?${query}` : ""}`);

  /** Drive the /content route, which fetches metadata then the bytes. */
  async function content(app, e, fileId = "img-id", mimeType = "image/png") {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    return app.fetch(req(`/gdrive/files/${fileId}/content`), e);
  }

  // ---------------- authorized ----------------

  describe("an allowlisted caller", () => {
    const app = () => appAs(kvKeyRecord());

    it("files.list declares support and includes shared-drive items", async () => {
      await app().fetch(req("/gdrive/files", "q=%27folder%27+in+parents"), env);
      const p = queryOf();
      expect(p.get("supportsAllDrives")).toBe("true");
      expect(p.get("includeItemsFromAllDrives")).toBe("true");
      expect(p.get("q")).toBe("'folder' in parents");
    });

    it("files.get metadata declares support but sends no list-only filter", async () => {
      await app().fetch(req("/gdrive/files/abc123", "fields=id,name"), env);
      const p = queryOf();
      expect(p.get("supportsAllDrives")).toBe("true");
      // includeItemsFromAllDrives is files.list-only; files.get does not accept it.
      expect(p.has("includeItemsFromAllDrives")).toBe(false);
    });

    it("the content route's metadata probe declares support", async () => {
      await content(app(), env);
      expect(queryOf(0).get("supportsAllDrives")).toBe("true");
      expect(queryOf(0).get("fields")).toBe("mimeType");
    });

    it("the alt=media download declares support", async () => {
      await content(app(), env);
      expect(queryOf(1).get("alt")).toBe("media");
      expect(queryOf(1).get("supportsAllDrives")).toBe("true");
    });

    it("files.export is left alone — it documents only mimeType", async () => {
      await content(app(), env, "doc-id", "application/vnd.google-apps.document");
      expect(queryOf(0).get("supportsAllDrives")).toBe("true");
      expect(queryOf(1).get("mimeType")).toBe("application/pdf");
      expect(queryOf(1).has("supportsAllDrives")).toBe(false);
    });

    it("forwards corpora and driveId for a search scoped to one shared drive", async () => {
      await app().fetch(req("/gdrive/files", "corpora=drive&driveId=0ABCdef"), env);
      expect(queryOf().get("corpora")).toBe("drive");
      expect(queryOf().get("driveId")).toBe("0ABCdef");
    });
  });

  // ---------------- unauthorized ----------------

  describe("a caller who is not allowlisted", () => {
    /** Every principal that must NOT reach shared drives, and why. */
    const denied = [
      ["no apiKey in context at all", undefined],
      ["a key whose userId is not on the list", kvKeyRecord({ userId: "user_someone_else" })],
      ["a key with no userId (generateAPIKey's default)", kvKeyRecord({ userId: null })],
      // name and scopes come verbatim from the POST /api/auth/keys body, so a grant
      // carried in either would be self-servable in one request.
      ["a key that named itself the ingress", kvKeyRecord({ userId: "u_x", name: "evidence ingress" })],
      ["a key that granted itself a drive scope", kvKeyRecord({ userId: "u_x", scopes: ["drive:shared"] })],
      // Synthetic principals: middleware invents these for callers with no API_KEYS
      // record. Each is given the allowlisted userId to prove the type check, not the
      // absent userId, is what refuses them.
      ["the oauth principal (auth.js:121)", { type: "oauth", userId: AUTHORIZED_USER, status: "active" }],
      ["the cloudflare-access principal (auth.js:86)", { type: "cloudflare-access", userId: AUTHORIZED_USER, status: "active" }],
      ["the public policy-bundle principal (auth.js:79)", { type: "public", userId: AUTHORIZED_USER, status: "active" }],
      ["the github-oidc principal (github-oidc.js:215)", { type: "oidc", userId: AUTHORIZED_USER, status: "active" }],
    ];

    for (const [label, keyInfo] of denied) {
      it(`gets no shared-drive parameters: ${label}`, async () => {
        const app = appAs(keyInfo);

        await app.fetch(req("/gdrive/files", "q=x"), env);
        expect(queryOf().has("supportsAllDrives")).toBe(false);
        expect(queryOf().has("includeItemsFromAllDrives")).toBe(false);

        vi.clearAllMocks();
        globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: "x" }));
        await app.fetch(req("/gdrive/files/abc123"), env);
        expect(queryOf().has("supportsAllDrives")).toBe(false);

        await content(app, env);
        expect(queryOf(0).has("supportsAllDrives")).toBe(false);
        expect(queryOf(1).has("supportsAllDrives")).toBe(false);
      });
    }

    it("is denied when the allowlist is unset, empty, or whitespace", async () => {
      for (const value of [undefined, "", "   ", ",,"]) {
        vi.clearAllMocks();
        globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
        const e = makeEnv({ GDRIVE_SHARED_DRIVE_USER_IDS: value });
        e.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
        await appAs(kvKeyRecord()).fetch(req("/gdrive/files", "q=x"), e);
        expect(queryOf().has("supportsAllDrives")).toBe(false);
      }
    });

    it("does not forward corpora or driveId — they are part of the gated feature", async () => {
      await appAs(kvKeyRecord({ userId: "nope" })).fetch(
        req("/gdrive/files", "corpora=drive&driveId=0ABCdef"), env);
      expect(queryOf().has("corpora")).toBe(false);
      expect(queryOf().has("driveId")).toBe(false);
    });

    it("sends a request byte-identical to the pre-change behaviour", async () => {
      // The exact URL /gdrive/files built before this change existed.
      await appAs(undefined).fetch(
        req("/gdrive/files", "q=x&fields=files(id)&pageSize=10&pageToken=t"), env);
      expect(urlOf()).toBe(
        "https://www.googleapis.com/drive/v3/files?q=x&fields=files%28id%29&pageSize=10&pageToken=t",
      );
    });
  });

  // ---------------- allowlist parsing ----------------

  it("authorizes a principal listed among several, with untidy spacing", async () => {
    const e = makeEnv({ GDRIVE_SHARED_DRIVE_USER_IDS: ` other_user , ${AUTHORIZED_USER} ,, third ` });
    e.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    await appAs(kvKeyRecord()).fetch(req("/gdrive/files", "q=x"), e);
    expect(queryOf().get("supportsAllDrives")).toBe("true");
  });

  it("matches the userId exactly — no prefix or substring match", async () => {
    const e = makeEnv({ GDRIVE_SHARED_DRIVE_USER_IDS: AUTHORIZED_USER });
    e.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    await appAs(kvKeyRecord({ userId: `${AUTHORIZED_USER}_evil` })).fetch(req("/gdrive/files", "q=x"), e);
    expect(queryOf().has("supportsAllDrives")).toBe(false);
  });

  it("Gmail routes are untouched by the Drive parameters", async () => {
    await appAs(kvKeyRecord()).fetch(req("/email/messages", "q=from:nobody"), env);
    expect(queryOf().has("supportsAllDrives")).toBe(false);
    expect(queryOf().has("includeItemsFromAllDrives")).toBe(false);
  });
});

// ----------------------------------------------------------------
// Hand-written service key records
//
// Production API_KEYS holds records written directly into KV, outside
// generateAPIKey, carrying `type: "service"` — chittystorage among them, a
// consumer this proxy's own header names. An earlier revision rejected any record
// with a truthy `type`, so the gate could never open for them. The check is against
// the fabricated type names, not against the presence of a type.
// ----------------------------------------------------------------

describe("a hand-written service key record", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv({ GDRIVE_SHARED_DRIVE_USER_IDS: AUTHORIZED_USER });
    env.CREDENTIAL_CACHE.get.mockResolvedValue("test-token");
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const queryOf = (i = 0) => new URL(globalThis.fetch.mock.calls[i][0]).searchParams;
  const req = (path, query = "") =>
    new Request(`http://localhost${path}${query ? `?${query}` : ""}`);

  /** Shaped like the production records: a `type` generateAPIKey never writes. */
  const serviceRecord = (userId) => ({
    status: "active",
    type: "service",
    name: "chittystorage",
    userId,
    scopes: ["mcp:read"],
  });

  it("is authorized when its userId is allowlisted", async () => {
    await appAs(serviceRecord(AUTHORIZED_USER)).fetch(req("/gdrive/files", "q=x"), env);
    expect(queryOf().get("supportsAllDrives")).toBe("true");
    expect(queryOf().get("includeItemsFromAllDrives")).toBe("true");
  });

  it("reaches file metadata and content, not just the listing", async () => {
    const app = appAs(serviceRecord(AUTHORIZED_USER));

    await app.fetch(req("/gdrive/files/abc123"), env);
    expect(queryOf().get("supportsAllDrives")).toBe("true");

    vi.clearAllMocks();
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ mimeType: "image/png" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    await app.fetch(req("/gdrive/files/img-id/content"), env);
    expect(queryOf(0).get("supportsAllDrives")).toBe("true");
    expect(queryOf(1).get("supportsAllDrives")).toBe("true");
  });

  it("is still refused when its userId is not allowlisted", async () => {
    await appAs(serviceRecord("user_not_listed")).fetch(req("/gdrive/files", "q=x"), env);
    expect(queryOf().has("supportsAllDrives")).toBe(false);
  });

  it("an unfamiliar type is not by itself a reason to refuse a real record", async () => {
    const rec = { status: "active", type: "daemon", userId: AUTHORIZED_USER };
    await appAs(rec).fetch(req("/gdrive/files", "q=x"), env);
    expect(queryOf().get("supportsAllDrives")).toBe("true");
  });

  it("a record with no type at all is still authorized (mcp-auth.js:107 shape)", async () => {
    const rec = { name: "k", userId: AUTHORIZED_USER, scopes: [], rateLimit: 1000 };
    await appAs(rec).fetch(req("/gdrive/files", "q=x"), env);
    expect(queryOf().get("supportsAllDrives")).toBe("true");
  });
});
