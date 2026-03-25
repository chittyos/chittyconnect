import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCredential = vi.fn();

vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: (...args) => mockGetCredential(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { thirdpartyRoutes } = await import("../../src/api/routes/thirdparty.js");

function jsonResponse(data, ok = true, status = 200, text = JSON.stringify(data)) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(text),
  };
}

describe("thirdparty notion compatibility routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCredential.mockResolvedValue("notion-token");
  });

  it("supports legacy POST /notion/pages alias", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "page-123" }));

    const req = new Request("http://localhost/notion/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent: { database_id: "db-1" }, properties: {} }),
    });

    const res = await thirdpartyRoutes.fetch(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("page-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/pages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports POST /notion/comments", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "comment-123" }));

    const req = new Request("http://localhost/notion/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent: { page_id: "page-1" },
        rich_text: [{ type: "text", text: { content: "hello" } }],
      }),
    });

    const res = await thirdpartyRoutes.fetch(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("comment-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/comments",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports legacy PATCH /notion/pages/:pageId alias", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "page-123", object: "page" }));

    const req = new Request("http://localhost/notion/pages/page-123", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { Status: { select: { name: "Done" } } } }),
    });

    const res = await thirdpartyRoutes.fetch(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("page-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.notion.com/v1/pages/page-123",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
