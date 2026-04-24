/**
 * Tests for Google API Proxy Routes (src/api/routes/google.js)
 *
 * Covers:
 *   - GET /gdrive/files
 *   - GET /gdrive/files/:fileId
 *   - GET /gdrive/files/:fileId/content
 *   - GET /email/messages
 *   - GET /email/messages/:messageId
 *   - GET /email/messages/:messageId/attachments/:attachmentId
 *   - Token resolution (KV → credential-helper fallback)
 *   - Error propagation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Mock getCredential before importing the route module
// ---------------------------------------------------------------------------

const mockGetCredential = vi.fn();

vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: mockGetCredential,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { googleRoutes } = await import("../../src/api/routes/google.js");

// ---------------------------------------------------------------------------
// App factory — recreated in beforeEach to reset route state
// ---------------------------------------------------------------------------

function createApp(envOverrides = {}) {
  const app = new Hono();

  // Inject env via middleware (mimics Cloudflare Worker binding)
  app.use("*", async (c, next) => {
    Object.assign(c.env, {
      CREDENTIAL_CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
      GOOGLE_ACCESS_TOKEN: "env-fallback-token",
      ...envOverrides,
    });
    await next();
  });

  app.route("/", googleRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mockGoogleSuccess(data) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockGoogleError(status, body = "error body") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  });
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

describe("token resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue(null);
  });

  it("uses KV-cached token when available (fast path)", async () => {
    const kvGet = vi.fn().mockResolvedValue("kv-cached-token");
    const app = createApp({ CREDENTIAL_CACHE: { get: kvGet, put: vi.fn() } });

    mockGoogleSuccess({ files: [] });

    await app.request("/gdrive/files");

    expect(kvGet).toHaveBeenCalledWith("secret:gdrive:access_token");
    const authHeader = mockFetch.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe("Bearer kv-cached-token");
    // getCredential should NOT be called when KV hit
    expect(mockGetCredential).not.toHaveBeenCalled();
  });

  it("falls back to getCredential when KV returns null", async () => {
    mockGetCredential.mockResolvedValue("broker-token");
    const app = createApp();
    mockGoogleSuccess({ files: [] });

    await app.request("/gdrive/files");

    expect(mockGetCredential).toHaveBeenCalledWith(
      expect.anything(),
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );
    const authHeader = mockFetch.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe("Bearer broker-token");
  });

  it("returns 503 when no token is available", async () => {
    mockGetCredential.mockResolvedValue(null);
    const app = createApp({ CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } });

    const res = await app.request("/gdrive/files");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("access token not available");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /gdrive/files
// ---------------------------------------------------------------------------

describe("GET /gdrive/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("returns file list from Google Drive", async () => {
    const files = [{ id: "file1", name: "doc.pdf" }];
    mockGoogleSuccess({ files });

    const app = createApp();
    const res = await app.request("/gdrive/files");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual(files);
  });

  it("forwards q, fields, pageSize, pageToken query params to Google API", async () => {
    mockGoogleSuccess({ files: [] });

    const app = createApp();
    await app.request("/gdrive/files?q=name+contains+%27report%27&fields=nextPageToken,files(id,name)&pageSize=10&pageToken=abc123");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("q")).toBe("name contains 'report'");
    expect(calledUrl.searchParams.get("fields")).toBe("nextPageToken,files(id,name)");
    expect(calledUrl.searchParams.get("pageSize")).toBe("10");
    expect(calledUrl.searchParams.get("pageToken")).toBe("abc123");
  });

  it("calls the Drive v3 /files endpoint", async () => {
    mockGoogleSuccess({ files: [] });

    const app = createApp();
    await app.request("/gdrive/files");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toMatch(/https:\/\/www\.googleapis\.com\/drive\/v3\/files/);
  });

  it("returns upstream error status and message on Google API failure", async () => {
    mockGoogleError(403, "quota exceeded");

    const app = createApp();
    const res = await app.request("/gdrive/files");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("403");
  });

  it("works with no query parameters", async () => {
    mockGoogleSuccess({ files: [] });

    const app = createApp();
    const res = await app.request("/gdrive/files");

    expect(res.status).toBe(200);
    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.toString()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// GET /gdrive/files/:fileId
// ---------------------------------------------------------------------------

describe("GET /gdrive/files/:fileId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("returns file metadata for the given fileId", async () => {
    const metadata = { id: "abc123", name: "report.pdf", mimeType: "application/pdf" };
    mockGoogleSuccess(metadata);

    const app = createApp();
    const res = await app.request("/gdrive/files/abc123");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("abc123");
  });

  it("passes fileId in the URL path to Google Drive API", async () => {
    mockGoogleSuccess({ id: "xyz789" });

    const app = createApp();
    await app.request("/gdrive/files/xyz789");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("/files/xyz789");
  });

  it("forwards fields query param", async () => {
    mockGoogleSuccess({ id: "f1", name: "file.txt" });

    const app = createApp();
    await app.request("/gdrive/files/f1?fields=id,name");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("fields")).toBe("id,name");
  });

  it("returns 404 when Google Drive returns 404", async () => {
    mockGoogleError(404, "file not found");

    const app = createApp();
    const res = await app.request("/gdrive/files/nonexistent");

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /gdrive/files/:fileId/content
// ---------------------------------------------------------------------------

describe("GET /gdrive/files/:fileId/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("streams file content with correct Content-Type", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(pdfBytes);
          controller.close();
        },
      }),
      headers: new Headers({ "Content-Type": "application/pdf", "Content-Length": "4" }),
    });

    const app = createApp();
    const res = await app.request("/gdrive/files/doc123/content");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe("4");
  });

  it("requests the file with alt=media query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
      headers: new Headers({}),
    });

    const app = createApp();
    await app.request("/gdrive/files/doc123/content");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("alt")).toBe("media");
    expect(calledUrl.pathname).toContain("/files/doc123");
  });

  it("returns 503 when no token is available", async () => {
    mockGetCredential.mockResolvedValue(null);
    const app = createApp({ CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } });

    const res = await app.request("/gdrive/files/doc123/content");

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns upstream error status on Google failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 410 });

    const app = createApp();
    const res = await app.request("/gdrive/files/gone-file/content");

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("410");
  });

  it("defaults Content-Type to application/octet-stream when absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({ start(c) { c.close(); } }),
      headers: new Headers({}),
    });

    const app = createApp();
    const res = await app.request("/gdrive/files/bin-file/content");

    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

// ---------------------------------------------------------------------------
// GET /email/messages
// ---------------------------------------------------------------------------

describe("GET /email/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("returns list of Gmail messages", async () => {
    const messages = [{ id: "msg1" }, { id: "msg2" }];
    mockGoogleSuccess({ messages, nextPageToken: null });

    const app = createApp();
    const res = await app.request("/email/messages");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toEqual(messages);
  });

  it("calls the Gmail messages list endpoint", async () => {
    mockGoogleSuccess({ messages: [] });

    const app = createApp();
    await app.request("/email/messages");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toMatch(/https:\/\/www\.googleapis\.com\/gmail\/v1\/users\/me\/messages/);
  });

  it("forwards q, maxResults, pageToken to Gmail API", async () => {
    mockGoogleSuccess({ messages: [] });

    const app = createApp();
    await app.request("/email/messages?q=from%3Aboss%40corp.com&maxResults=25&pageToken=tok999");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("q")).toBe("from:boss@corp.com");
    expect(calledUrl.searchParams.get("maxResults")).toBe("25");
    expect(calledUrl.searchParams.get("pageToken")).toBe("tok999");
  });

  it("returns upstream error on Gmail API failure", async () => {
    mockGoogleError(429, "rate limit exceeded");

    const app = createApp();
    const res = await app.request("/email/messages");

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("429");
  });
});

// ---------------------------------------------------------------------------
// GET /email/messages/:messageId
// ---------------------------------------------------------------------------

describe("GET /email/messages/:messageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("returns a single Gmail message by ID", async () => {
    const message = { id: "msg42", snippet: "Hello there", payload: {} };
    mockGoogleSuccess(message);

    const app = createApp();
    const res = await app.request("/email/messages/msg42");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("msg42");
  });

  it("passes messageId in the URL path", async () => {
    mockGoogleSuccess({ id: "msg99" });

    const app = createApp();
    await app.request("/email/messages/msg99");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("/messages/msg99");
  });

  it("forwards format query param to Gmail API", async () => {
    mockGoogleSuccess({ id: "msg1", raw: "base64data" });

    const app = createApp();
    await app.request("/email/messages/msg1?format=raw");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("format")).toBe("raw");
  });

  it("returns 404 on missing message", async () => {
    mockGoogleError(404, "message not found");

    const app = createApp();
    const res = await app.request("/email/messages/gone-msg");

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /email/messages/:messageId/attachments/:attachmentId
// ---------------------------------------------------------------------------

describe("GET /email/messages/:messageId/attachments/:attachmentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("test-token");
  });

  it("returns decoded attachment bytes", async () => {
    // Encode "Hello" as base64url
    const original = "Hello";
    const b64 = btoa(original).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockGoogleSuccess({ data: b64, size: 5 });

    const app = createApp();
    const res = await app.request("/email/messages/msg1/attachments/att1");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("5");

    const buffer = await res.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    expect(text).toBe("Hello");
  });

  it("calls the correct Gmail attachment endpoint", async () => {
    const b64 = btoa("data").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockGoogleSuccess({ data: b64, size: 4 });

    const app = createApp();
    await app.request("/email/messages/msgABC/attachments/attXYZ");

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("/messages/msgABC/attachments/attXYZ");
  });

  it("returns 404 when attachment data field is missing", async () => {
    mockGoogleSuccess({ size: 100 }); // no 'data' field

    const app = createApp();
    const res = await app.request("/email/messages/msg1/attachments/att1");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No attachment data returned");
  });

  it("correctly converts base64url to binary (- and _ characters)", async () => {
    // Binary data that produces + and / in standard base64 when encoded
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe]); // encodes to +//+
    const stdB64 = btoa(String.fromCharCode(...bytes));
    const b64url = stdB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    mockGoogleSuccess({ data: b64url, size: 3 });

    const app = createApp();
    const res = await app.request("/email/messages/msg2/attachments/att2");

    expect(res.status).toBe(200);
    const buffer = await res.arrayBuffer();
    const result = new Uint8Array(buffer);
    expect(result).toEqual(bytes);
  });

  it("falls back to binary.length when size is absent", async () => {
    const b64 = btoa("abc").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockGoogleSuccess({ data: b64 }); // no size

    const app = createApp();
    const res = await app.request("/email/messages/msg3/attachments/att3");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("3");
  });

  it("returns upstream error when Gmail API fails", async () => {
    mockGoogleError(500, "internal error");

    const app = createApp();
    const res = await app.request("/email/messages/msg1/attachments/att1");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("500");
  });
});

// ---------------------------------------------------------------------------
// router.js — googleRoutes registration
// ---------------------------------------------------------------------------

describe("router — /api/google route registration", () => {
  it("googleRoutes exports a Hono instance", () => {
    expect(googleRoutes).toBeDefined();
    expect(typeof googleRoutes.fetch).toBe("function");
  });
});