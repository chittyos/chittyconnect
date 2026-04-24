import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub global fetch before importing the route module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock credential-helper so getCredential is controllable
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn(),
}));

import { getCredential } from "../../src/lib/credential-helper.js";

const { googleRoutes } = await import("../../src/api/routes/google.js");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: {
      get: vi.fn().mockResolvedValue(null),
    },
    GOOGLE_ACCESS_TOKEN: undefined,
    ...overrides,
  };
}

function makeRequest(path, { method = "GET", headers = {} } = {}) {
  return new Request(`http://localhost${path}`, { method, headers });
}

/** Simulate a successful JSON response from Google APIs */
function googleOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Simulate an error response from Google APIs */
function googleError(status, body = "error") {
  return new Response(body, { status });
}

// -----------------------------------------------------------------------
// getGoogleToken — token source priority
// -----------------------------------------------------------------------

describe("getGoogleToken (token source priority)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns KV-cached token when CREDENTIAL_CACHE has it", async () => {
    const env = makeEnv({
      CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue("kv-token") },
    });
    mockFetch.mockResolvedValueOnce(googleOk({ files: [] }));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), env);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("googleapis.com"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer kv-token" }),
      }),
    );
  });

  it("falls back to getCredential when KV returns null", async () => {
    const env = makeEnv({
      CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null) },
    });
    getCredential.mockResolvedValueOnce("broker-token");
    mockFetch.mockResolvedValueOnce(googleOk({ files: [] }));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), env);
    expect(res.status).toBe(200);
    expect(getCredential).toHaveBeenCalledWith(
      env,
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer broker-token" }),
      }),
    );
  });

  it("skips KV lookup when CREDENTIAL_CACHE is absent", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: null });
    getCredential.mockResolvedValueOnce("env-token");
    mockFetch.mockResolvedValueOnce(googleOk({ files: [] }));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), env);
    expect(res.status).toBe(200);
    expect(getCredential).toHaveBeenCalled();
  });

  it("returns 503 when no token is available", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null) } });
    getCredential.mockResolvedValueOnce(undefined);

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), env);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("Google access token not available");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// GET /gdrive/files
// -----------------------------------------------------------------------

describe("GET /gdrive/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("lists files and returns JSON from Google Drive", async () => {
    const driveData = { files: [{ id: "file1", name: "doc.pdf" }] };
    mockFetch.mockResolvedValueOnce(googleOk(driveData));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.files[0].id).toBe("file1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files?",
      expect.any(Object),
    );
  });

  it("passes q, fields, pageSize, pageToken as query params", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ files: [] }));

    const res = await googleRoutes.fetch(
      makeRequest("/gdrive/files?q=name%3D'test'&fields=id%2Cname&pageSize=10&pageToken=tok123"),
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("q=");
    expect(calledUrl).toContain("fields=");
    expect(calledUrl).toContain("pageSize=10");
    expect(calledUrl).toContain("pageToken=tok123");
  });

  it("forwards Google API error status", async () => {
    mockFetch.mockResolvedValueOnce(googleError(403, "Forbidden"));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Google API 403");
  });

  it("truncates long error body to 200 chars", async () => {
    const longBody = "x".repeat(500);
    mockFetch.mockResolvedValueOnce(googleError(500, longBody));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files"), makeEnv());
    const body = await res.json();

    expect(body.error.length).toBeLessThanOrEqual("Google API 500: ".length + 200);
  });
});

// -----------------------------------------------------------------------
// GET /gdrive/files/:fileId
// -----------------------------------------------------------------------

describe("GET /gdrive/files/:fileId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("fetches file metadata by fileId", async () => {
    const meta = { id: "abc123", name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    mockFetch.mockResolvedValueOnce(googleOk(meta));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/abc123"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/files/abc123"),
      expect.any(Object),
    );
  });

  it("URL-encodes special characters in fileId", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ id: "id with spaces" }));

    await googleRoutes.fetch(makeRequest("/gdrive/files/id%20with%20spaces"), makeEnv());

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("id%20with%20spaces");
  });

  it("passes fields query param", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ id: "abc123", name: "doc" }));

    await googleRoutes.fetch(makeRequest("/gdrive/files/abc123?fields=id%2Cname"), makeEnv());

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("fields=");
  });

  it("returns error from Google API", async () => {
    mockFetch.mockResolvedValueOnce(googleError(404, "File not found"));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/no-such-file"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("404");
  });
});

// -----------------------------------------------------------------------
// GET /gdrive/files/:fileId/content
// -----------------------------------------------------------------------

describe("GET /gdrive/files/:fileId/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("returns 503 when no token is available", async () => {
    const env = makeEnv({ CREDENTIAL_CACHE: { get: vi.fn().mockResolvedValue(null) } });
    getCredential.mockResolvedValueOnce(undefined);

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/f1/content"), env);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("Google access token not available");
  });

  it("returns metadata fetch error status", async () => {
    // First fetch: metadata call fails
    mockFetch.mockResolvedValueOnce(googleError(403, "Forbidden"));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/f1/content"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Failed to fetch file metadata");
  });

  it("uses export endpoint for Google Docs (Google-native type)", async () => {
    // First fetch: metadata returns Google Doc mimeType
    mockFetch.mockResolvedValueOnce(
      googleOk({ mimeType: "application/vnd.google-apps.document" }),
    );
    // Second fetch: export PDF
    const pdfBody = new Uint8Array([37, 80, 68, 70]); // %PDF bytes
    mockFetch.mockResolvedValueOnce(
      new Response(pdfBody, {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Length": "4" },
      }),
    );

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/doc123/content"), makeEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const calledUrl = mockFetch.mock.calls[1][0];
    expect(calledUrl).toContain("/export");
    expect(calledUrl).toContain("application%2Fpdf");
  });

  it("uses export endpoint for Google Sheets", async () => {
    mockFetch.mockResolvedValueOnce(
      googleOk({ mimeType: "application/vnd.google-apps.spreadsheet" }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/sheet1/content"), makeEnv());

    expect(res.status).toBe(200);
    const calledUrl = mockFetch.mock.calls[1][0];
    expect(calledUrl).toContain("/export");
  });

  it("uses export endpoint for Google Slides", async () => {
    mockFetch.mockResolvedValueOnce(
      googleOk({ mimeType: "application/vnd.google-apps.presentation" }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/slide1/content"), makeEnv());

    expect(res.status).toBe(200);
    const calledUrl = mockFetch.mock.calls[1][0];
    expect(calledUrl).toContain("/export");
  });

  it("uses alt=media for binary-backed files (non-Google-native)", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ mimeType: "application/pdf" }));
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Length": "4" },
      }),
    );

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/bin1/content"), makeEnv());

    expect(res.status).toBe(200);
    const calledUrl = mockFetch.mock.calls[1][0];
    expect(calledUrl).toContain("alt=media");
    expect(calledUrl).not.toContain("/export");
  });

  it("falls back to application/octet-stream when Content-Type is missing", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ mimeType: "image/png" }));
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0, 1, 2]), { status: 200 }),
    );

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/img1/content"), makeEnv());

    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("returns download error status from Google", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ mimeType: "application/pdf" }));
    mockFetch.mockResolvedValueOnce(googleError(404, "Not found"));

    const res = await googleRoutes.fetch(makeRequest("/gdrive/files/missing/content"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Drive download failed");
  });
});

// -----------------------------------------------------------------------
// GET /email/messages
// -----------------------------------------------------------------------

describe("GET /email/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("lists Gmail messages", async () => {
    const gmailData = { messages: [{ id: "msg1", threadId: "thread1" }] };
    mockFetch.mockResolvedValueOnce(googleOk(gmailData));

    const res = await googleRoutes.fetch(makeRequest("/email/messages"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages[0].id).toBe("msg1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/gmail/v1/users/me/messages?",
      expect.any(Object),
    );
  });

  it("passes q, maxResults, pageToken params", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ messages: [] }));

    await googleRoutes.fetch(
      makeRequest("/email/messages?q=from%3Atest%40example.com&maxResults=20&pageToken=tok"),
      makeEnv(),
    );

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("q=");
    expect(calledUrl).toContain("maxResults=20");
    expect(calledUrl).toContain("pageToken=tok");
  });

  it("forwards 401 from Gmail", async () => {
    mockFetch.mockResolvedValueOnce(googleError(401, "Unauthorized"));

    const res = await googleRoutes.fetch(makeRequest("/email/messages"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("401");
  });
});

// -----------------------------------------------------------------------
// GET /email/messages/:messageId
// -----------------------------------------------------------------------

describe("GET /email/messages/:messageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("fetches a single Gmail message", async () => {
    const msg = { id: "msg123", payload: { headers: [] } };
    mockFetch.mockResolvedValueOnce(googleOk(msg));

    const res = await googleRoutes.fetch(makeRequest("/email/messages/msg123"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("msg123");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/messages/msg123"),
      expect.any(Object),
    );
  });

  it("passes format param", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ id: "m1" }));

    await googleRoutes.fetch(makeRequest("/email/messages/m1?format=minimal"), makeEnv());

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("format=minimal");
  });

  it("returns 404 when message not found", async () => {
    mockFetch.mockResolvedValueOnce(googleError(404, "Message not found"));

    const res = await googleRoutes.fetch(makeRequest("/email/messages/no-such-msg"), makeEnv());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("404");
  });
});

// -----------------------------------------------------------------------
// GET /email/messages/:messageId/attachments/:attachmentId
// -----------------------------------------------------------------------

describe("GET /email/messages/:messageId/attachments/:attachmentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredential.mockResolvedValue("test-token");
  });

  it("decodes base64url attachment and returns binary", async () => {
    // "Hello" encoded as base64url
    const plainText = "Hello";
    const base64url = btoa(plainText).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockFetch.mockResolvedValueOnce(googleOk({ data: base64url, size: 5 }));

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/msg1/attachments/att1"),
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("5");

    const buf = await res.arrayBuffer();
    expect(new TextDecoder().decode(buf)).toBe("Hello");
  });

  it("handles base64url with padding required (length not multiple of 4)", async () => {
    // "Hi!" is 3 bytes — base64url will need padding
    const text = "Hi!";
    const b64 = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockFetch.mockResolvedValueOnce(googleOk({ data: b64, size: 3 }));

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/msg2/attachments/att2"),
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    expect(new TextDecoder().decode(buf)).toBe("Hi!");
  });

  it("returns 404 when response has no data field", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ size: 100 })); // no data

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/msg1/attachments/att1"),
      makeEnv(),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("No attachment data returned");
  });

  it("returns 500 when base64 data is corrupt", async () => {
    mockFetch.mockResolvedValueOnce(googleOk({ data: "!!!invalid!!!", size: 10 }));

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/msg1/attachments/att1"),
      makeEnv(),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to decode attachment data");
  });

  it("uses binary.length as Content-Length when size is missing", async () => {
    const text = "test data";
    const b64 = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockFetch.mockResolvedValueOnce(googleOk({ data: b64 })); // no size

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/msg1/attachments/att1"),
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(text.length));
  });

  it("URL-encodes messageId and attachmentId", async () => {
    const b64 = btoa("data").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    mockFetch.mockResolvedValueOnce(googleOk({ data: b64, size: 4 }));

    await googleRoutes.fetch(
      makeRequest("/email/messages/msg%20one/attachments/att%20two"),
      makeEnv(),
    );

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("msg%20one");
    expect(calledUrl).toContain("att%20two");
  });

  it("forwards Google API errors", async () => {
    mockFetch.mockResolvedValueOnce(googleError(403, "Access denied"));

    const res = await googleRoutes.fetch(
      makeRequest("/email/messages/m1/attachments/a1"),
      makeEnv(),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("403");
  });
});