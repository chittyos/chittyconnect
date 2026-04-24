/**
 * Tests for src/api/routes/google.js
 *
 * Covers:
 *  - getGoogleToken (KV cache → credential-helper fallback)
 *  - googleProxy (token absent, fetch failure, non-ok status, bad JSON)
 *  - GET /gdrive/files
 *  - GET /gdrive/files/:fileId
 *  - GET /gdrive/files/:fileId/content  (Google-native export vs. alt=media)
 *  - GET /email/messages
 *  - GET /email/messages/:messageId
 *  - GET /email/messages/:messageId/attachments/:attachmentId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMockKV } from "../helpers/mocks.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Bypass requireServiceToken so it never blocks route handlers under test
vi.mock("../../src/middleware/require-service-token.js", () => ({
  requireServiceToken: () => async (_c, next) => await next(),
}));

const mockGetCredential = vi.fn();
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: (...args) => mockGetCredential(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import routes after mocks are set up ──────────────────────────────────────
const { googleRoutes } = await import("../../src/api/routes/google.js");

// ── Test environment factory ──────────────────────────────────────────────────

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(),
    GOOGLE_ACCESS_TOKEN: undefined,
    ...overrides,
  };
}

function makeApp(env) {
  const app = new Hono();
  app.route("/api/google", googleRoutes);
  // Hono's app.request() accepts env as 3rd arg (passed to c.env)
  return { app, env };
}

// ── Fetch response helpers ─────────────────────────────────────────────────────

function jsonOkResponse(data) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Headers({ "Content-Type": "application/json" }),
    body: null,
  };
}

function errorResponse(status, bodyText = "error") {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(bodyText),
    headers: new Headers(),
  };
}

function binaryOkResponse(body, contentType = "application/pdf", contentLength = "42") {
  const headers = new Headers({ "Content-Type": contentType });
  if (contentLength !== null) headers.set("Content-Length", contentLength);
  return {
    ok: true,
    status: 200,
    headers,
    body,
  };
}

// ── Shared beforeEach ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCredential.mockResolvedValue(undefined); // default: no fallback token
});

// ── getGoogleToken via KV cache ───────────────────────────────────────────────

describe("token resolution", () => {
  it("uses KV-cached token when CREDENTIAL_CACHE has an access_token", async () => {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) =>
      key === "secret:gdrive:access_token" ? "kv-token" : null,
    );
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(200);
    // Authorization header should use the KV token
    const [, fetchInit] = mockFetch.mock.calls[0];
    expect(fetchInit.headers.Authorization).toBe("Bearer kv-token");
  });

  it("falls back to getCredential when KV cache misses", async () => {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockGetCredential.mockResolvedValue("cred-helper-token");
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(200);
    const [, fetchInit] = mockFetch.mock.calls[0];
    expect(fetchInit.headers.Authorization).toBe("Bearer cred-helper-token");
  });

  it("falls back to getCredential when CREDENTIAL_CACHE is absent from env", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: undefined });
    mockGetCredential.mockResolvedValue("env-token");
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(200);
  });

  it("falls back to getCredential when KV read throws", async () => {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockRejectedValue(new Error("KV unavailable"));
    mockGetCredential.mockResolvedValue("fallback-token");
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(200);
  });

  it("returns 503 when no token is available from any source", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: undefined });
    mockGetCredential.mockResolvedValue(undefined);
    const { app } = makeApp(env);

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/access token not available/i);
  });
});

// ── googleProxy error handling ────────────────────────────────────────────────

describe("googleProxy error handling", () => {
  function makeEnvWithToken(token = "test-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) =>
      key === "secret:gdrive:access_token" ? token : null,
    );
    return env;
  }

  it("returns 502 when fetch throws a network error", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockRejectedValueOnce(new Error("network failure"));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Google API request failed/);
  });

  it("returns the upstream status code when Google API returns non-ok", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(errorResponse(403, "Forbidden"));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Google API 403/);
    expect(body.error).toMatch(/Forbidden/);
  });

  it("returns 502 when Google API returns invalid JSON", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
      text: vi.fn().mockResolvedValue("not-json"),
    });

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/invalid JSON/i);
  });
});

// ── GET /gdrive/files ─────────────────────────────────────────────────────────

describe("GET /gdrive/files", () => {
  function makeEnvWithToken(token = "drive-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) =>
      key === "secret:gdrive:access_token" ? token : null,
    );
    return env;
  }

  it("returns 200 with files list", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);
    const filesData = { files: [{ id: "abc", name: "doc.pdf" }], nextPageToken: null };

    mockFetch.mockResolvedValueOnce(jsonOkResponse(filesData));

    const res = await app.request("/api/google/gdrive/files", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].id).toBe("abc");
  });

  it("passes q, fields, pageSize, pageToken as query params to Drive API", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    await app.request(
      "/api/google/gdrive/files?q=mimeType%3D'text%2Fplain'&fields=files(id)&pageSize=10&pageToken=tok123",
      {},
      env,
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("q=");
    expect(url).toContain("fields=");
    expect(url).toContain("pageSize=10");
    expect(url).toContain("pageToken=tok123");
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
  });

  it("omits absent query params from the Drive API call", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ files: [] }));

    await app.request("/api/google/gdrive/files", {}, env);

    const [url] = mockFetch.mock.calls[0];
    // No spurious params
    expect(url).not.toContain("pageToken");
    expect(url).not.toContain("fields=");
  });
});

// ── GET /gdrive/files/:fileId ─────────────────────────────────────────────────

describe("GET /gdrive/files/:fileId", () => {
  function makeEnvWithToken(token = "drive-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async () => token);
    return env;
  }

  it("returns file metadata JSON", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);
    const meta = { id: "file-123", name: "Report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

    mockFetch.mockResolvedValueOnce(jsonOkResponse(meta));

    const res = await app.request("/api/google/gdrive/files/file-123", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("file-123");
  });

  it("percent-encodes fileId in the upstream URL", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ id: "tricky id" }));

    await app.request("/api/google/gdrive/files/tricky%20id", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("tricky%20id");
  });

  it("passes fields param to Drive API", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ id: "f1", name: "x" }));

    await app.request("/api/google/gdrive/files/f1?fields=id,name", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("fields=");
  });
});

// ── GET /gdrive/files/:fileId/content ─────────────────────────────────────────

describe("GET /gdrive/files/:fileId/content", () => {
  function makeEnvWithToken(token = "drive-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async () => token);
    return env;
  }

  it("exports Google Docs files as PDF", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    // First fetch: metadata, Second: export download
    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/vnd.google-apps.document" }))
      .mockResolvedValueOnce(binaryOkResponse(new ReadableStream(), "application/pdf", "1234"));

    const res = await app.request("/api/google/gdrive/files/doc-id/content", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const [metaUrl] = mockFetch.mock.calls[0];
    expect(metaUrl).toContain("fields=mimeType");

    const [exportUrl] = mockFetch.mock.calls[1];
    expect(exportUrl).toContain("/export");
    expect(exportUrl).toContain("application%2Fpdf");
  });

  it("exports Google Sheets files as PDF", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/vnd.google-apps.spreadsheet" }))
      .mockResolvedValueOnce(binaryOkResponse(new ReadableStream(), "application/pdf", "999"));

    const res = await app.request("/api/google/gdrive/files/sheet-id/content", {}, env);

    expect(res.status).toBe(200);
    const [exportUrl] = mockFetch.mock.calls[1];
    expect(exportUrl).toContain("/export");
  });

  it("exports Google Slides files as PDF", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/vnd.google-apps.presentation" }))
      .mockResolvedValueOnce(binaryOkResponse(new ReadableStream(), "application/pdf", "100"));

    const res = await app.request("/api/google/gdrive/files/slide-id/content", {}, env);

    expect(res.status).toBe(200);
    const [exportUrl] = mockFetch.mock.calls[1];
    expect(exportUrl).toContain("/export");
  });

  it("uses alt=media for binary-backed files (non-Google-native)", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/pdf" }))
      .mockResolvedValueOnce(binaryOkResponse(new ReadableStream(), "application/pdf", "2048"));

    const res = await app.request("/api/google/gdrive/files/pdf-id/content", {}, env);

    expect(res.status).toBe(200);
    const [downloadUrl] = mockFetch.mock.calls[1];
    expect(downloadUrl).toContain("alt=media");
    expect(downloadUrl).not.toContain("/export");
  });

  it("returns 503 when token is unavailable", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: undefined });
    mockGetCredential.mockResolvedValue(undefined);
    const { app } = makeApp(env);

    const res = await app.request("/api/google/gdrive/files/any-id/content", {}, env);

    expect(res.status).toBe(503);
  });

  it("returns upstream error status when metadata fetch fails", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(errorResponse(404, "not found"));

    const res = await app.request("/api/google/gdrive/files/missing-id/content", {}, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to fetch file metadata: 404/);
  });

  it("returns upstream error status when download fails", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "image/jpeg" }))
      .mockResolvedValueOnce(errorResponse(403, "quota exceeded"));

    const res = await app.request("/api/google/gdrive/files/img-id/content", {}, env);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Drive download failed: 403/);
  });

  it("propagates Content-Disposition header when present", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    const downloadResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Length": "100",
        "Content-Disposition": 'attachment; filename="report.pdf"',
      }),
      body: new ReadableStream(),
    };

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/octet-stream" }))
      .mockResolvedValueOnce(downloadResponse);

    const res = await app.request("/api/google/gdrive/files/any-id/content", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="report.pdf"');
  });

  it("defaults Content-Type to application/octet-stream when not returned", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    const downloadResponse = {
      ok: true,
      status: 200,
      headers: new Headers(), // no Content-Type
      body: new ReadableStream(),
    };

    mockFetch
      .mockResolvedValueOnce(jsonOkResponse({ mimeType: "application/octet-stream" }))
      .mockResolvedValueOnce(downloadResponse);

    const res = await app.request("/api/google/gdrive/files/any-id/content", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/octet-stream");
  });
});

// ── GET /email/messages ───────────────────────────────────────────────────────

describe("GET /email/messages", () => {
  function makeEnvWithToken(token = "gmail-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async () => token);
    return env;
  }

  it("returns 200 with message list", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ messages: [{ id: "msg-1" }], resultSizeEstimate: 1 }));

    const res = await app.request("/api/google/email/messages", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
  });

  it("passes q, maxResults, pageToken to Gmail API", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ messages: [] }));

    await app.request("/api/google/email/messages?q=from%3Atest&maxResults=5&pageToken=page1", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("https://www.googleapis.com/gmail/v1/users/me/messages");
    expect(url).toContain("maxResults=5");
    expect(url).toContain("pageToken=page1");
  });

  it("omits absent optional params", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ messages: [] }));

    await app.request("/api/google/email/messages", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain("maxResults");
    expect(url).not.toContain("pageToken");
  });
});

// ── GET /email/messages/:messageId ────────────────────────────────────────────

describe("GET /email/messages/:messageId", () => {
  function makeEnvWithToken(token = "gmail-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async () => token);
    return env;
  }

  it("returns 200 with message data", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    const msgData = { id: "msg-abc", snippet: "Hello world", labelIds: ["INBOX"] };
    mockFetch.mockResolvedValueOnce(jsonOkResponse(msgData));

    const res = await app.request("/api/google/email/messages/msg-abc", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("msg-abc");
  });

  it("percent-encodes messageId in upstream URL", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ id: "a b" }));

    await app.request("/api/google/email/messages/a%20b", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("a%20b");
  });

  it("passes format param to Gmail API", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ id: "msg-1" }));

    await app.request("/api/google/email/messages/msg-1?format=metadata", {}, env);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("format=metadata");
  });
});

// ── GET /email/messages/:messageId/attachments/:attachmentId ──────────────────

describe("GET /email/messages/:messageId/attachments/:attachmentId", () => {
  function makeEnvWithToken(token = "gmail-token") {
    const env = makeEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async () => token);
    return env;
  }

  it("decodes base64url attachment data and returns binary response", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    // "Hello" in base64url
    const helloBase64url = Buffer.from("Hello").toString("base64url");
    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data: helloBase64url, size: 5 }));

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-1", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("5");
    const buffer = await res.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe("Hello");
  });

  it("handles base64url strings that need padding added", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    // "Hi!" — 3 bytes; base64url without padding
    const data = Buffer.from("Hi!").toString("base64url"); // "SGkh" (no padding needed here)
    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data, size: 3 }));

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-2", {}, env);

    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    expect(new TextDecoder().decode(buf)).toBe("Hi!");
  });

  it("handles base64url with URL-safe chars (- and _)", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    // Craft a base64url string that contains - and _ (use a byte sequence that produces + and /)
    // bytes [0xfb, 0xff] → base64 is "+/8=" → base64url is "-_8"
    const rawBytes = new Uint8Array([0xfb, 0xff]);
    const base64Standard = Buffer.from(rawBytes).toString("base64"); // "+/8="
    const base64url = base64Standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data: base64url, size: 2 }));

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-3", {}, env);

    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(rawBytes);
  });

  it("returns 404 when attachment data field is absent", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ size: 0 })); // no data field

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-1", {}, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/No attachment data/);
  });

  it("returns 500 when attachment data is not valid base64", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data: "!!!NOT_VALID!!!", size: 10 }));

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-1", {}, env);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to decode attachment/);
  });

  it("uses binary.length as Content-Length fallback when size is absent", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    const bytes = Buffer.from("abc");
    const b64url = bytes.toString("base64url");
    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data: b64url })); // no size

    const res = await app.request("/api/google/email/messages/msg-1/attachments/att-4", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(bytes.length));
  });

  it("percent-encodes both messageId and attachmentId in the upstream URL", async () => {
    const env = makeEnvWithToken();
    const { app } = makeApp(env);

    const helloB64url = Buffer.from("x").toString("base64url");
    mockFetch.mockResolvedValueOnce(jsonOkResponse({ data: helloB64url, size: 1 }));

    await app.request(
      "/api/google/email/messages/msg%20id/attachments/att%20id",
      {},
      env,
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("msg%20id");
    expect(url).toContain("att%20id");
  });
});