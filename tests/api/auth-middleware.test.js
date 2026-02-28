import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticate } from "../../src/api/middleware/auth.js";
import { createMockContext } from "../helpers/mocks.js";

function headerMap(headers) {
  return (name) => headers[name] ?? headers[name.toLowerCase()] ?? null;
}

describe("authenticate middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid API key", async () => {
    const c = createMockContext({
      req: {
        header: headerMap({ "X-ChittyOS-API-Key": "valid_key" }),
      },
    });

    c.env.API_KEYS.get.mockResolvedValueOnce(
      JSON.stringify({ status: "active", userId: "user_123", rateLimit: 1000 }),
    );

    const next = vi.fn(async () => {});

    await authenticate(c, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(c.set).toHaveBeenCalledWith(
      "apiKey",
      expect.objectContaining({ status: "active", userId: "user_123" }),
    );
  });

  it("rejects an invalid API key when OAuth fallback is unavailable", async () => {
    const c = createMockContext({
      req: {
        header: headerMap({ "X-ChittyOS-API-Key": "invalid_key" }),
      },
    });

    c.env.API_KEYS.get.mockResolvedValueOnce(null);
    c.env.OAUTH_PROVIDER = undefined;

    const next = vi.fn(async () => {});

    const response = await authenticate(c, next);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid OAuth bearer token when API key lookup misses", async () => {
    const c = createMockContext({
      req: {
        header: headerMap({ Authorization: "Bearer oauth_access_token" }),
      },
    });

    c.env.API_KEYS.get.mockResolvedValueOnce(null);
    c.env.OAUTH_PROVIDER = {
      unwrapToken: vi.fn(async () => ({ userId: "oauth_user", scope: ["mcp:read", "mcp:write"] })),
    };

    const next = vi.fn(async () => {});

    await authenticate(c, next);

    expect(c.env.OAUTH_PROVIDER.unwrapToken).toHaveBeenCalledWith("oauth_access_token");
    expect(c.set).toHaveBeenCalledWith(
      "apiKey",
      expect.objectContaining({ type: "oauth", userId: "oauth_user", status: "active" }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accepts lowercase bearer scheme for OAuth fallback", async () => {
    const c = createMockContext({
      req: {
        header: headerMap({ authorization: "bearer oauth_access_token" }),
      },
    });

    c.env.API_KEYS.get.mockResolvedValueOnce(null);
    c.env.OAUTH_PROVIDER = {
      unwrapToken: vi.fn(async () => ({ userId: "oauth_user", scope: ["mcp:read"] })),
    };

    const next = vi.fn(async () => {});

    await authenticate(c, next);

    expect(c.env.OAUTH_PROVIDER.unwrapToken).toHaveBeenCalledWith("oauth_access_token");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid OAuth bearer token", async () => {
    const c = createMockContext({
      req: {
        header: headerMap({ Authorization: "Bearer bad_token" }),
      },
    });

    c.env.API_KEYS.get.mockResolvedValueOnce(null);
    c.env.OAUTH_PROVIDER = {
      unwrapToken: vi.fn(async () => null),
    };

    const next = vi.fn(async () => {});

    const response = await authenticate(c, next);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
    expect(next).not.toHaveBeenCalled();
  });
});
