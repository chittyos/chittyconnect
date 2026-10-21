import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKV } from "../helpers/mocks.js";

const mockGetCredential = vi.fn().mockResolvedValue("test-google-token");
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: (...args) => mockGetCredential(...args),
}));

const { googleRoutes } = await import("../../src/api/routes/google.js");

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(),
    GDRIVE_SHARED_DRIVE_USER_IDS: "svc:chittyconfig",
    ...overrides,
  };
}

async function getText(fileId, env) {
  const req = new Request(`http://localhost/gdrive/files/${fileId}/text`);
  return googleRoutes.fetch(req, env);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /gdrive/files/:fileId/text", () => {
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

  it("exports a native Google Doc as text/plain without returning the provider token", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "doc-1",
          name: "SOP",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-10-21T18:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        new Response("hello\r\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );

    const res = await getText("doc-1", env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("X-Chitty-Drive-File-Id")).toBe("doc-1");
    expect(await res.text()).toBe("hello\r\n");

    const [exportUrl, init] = globalThis.fetch.mock.calls[1];
    expect(exportUrl).toContain("/export?mimeType=text%2Fplain");
    expect(init.headers.Authorization).toBe("Bearer test-token");

    const serializedHeaders = JSON.stringify([...res.headers.entries()]);
    expect(serializedHeaders).not.toContain("test-token");
  });

  it("rejects non-Doc native/binary files rather than guessing a text representation", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "sheet-1",
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
    );

    const res = await getText("sheet-1", env);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain("native Google Doc");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no Google credential is available", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockGetCredential.mockResolvedValueOnce(undefined);

    const res = await getText("doc-1", env);
    expect(res.status).toBe(503);
  });

  it("propagates export failure without exposing the upstream body", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "doc-1",
          mimeType: "application/vnd.google-apps.document",
        }),
      )
      .mockResolvedValueOnce(new Response("sensitive upstream detail", { status: 403 }));

    const res = await getText("doc-1", env);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Drive text export failed: 403");
    expect(JSON.stringify(body)).not.toContain("sensitive upstream detail");
  });
});
