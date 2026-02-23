import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTrustLevel, TRUST_LEVELS } from "../../src/lib/trust-resolver.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CREDENTIAL_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
  },
  CHITTY_TRUST_TOKEN: "test-trust-token",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TRUST_LEVELS", () => {
  it("exports canonical trust level constants", () => {
    expect(TRUST_LEVELS.ANONYMOUS).toBe(0);
    expect(TRUST_LEVELS.BASIC).toBe(1);
    expect(TRUST_LEVELS.ENHANCED).toBe(2);
    expect(TRUST_LEVELS.PROFESSIONAL).toBe(3);
    expect(TRUST_LEVELS.INSTITUTIONAL).toBe(4);
    expect(TRUST_LEVELS.OFFICIAL).toBe(5);
  });
});

describe("resolveTrustLevel", () => {
  it("returns cached trust level when available", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(
      JSON.stringify({ trust_level: 3, entity_type: "P" })
    );
    const result = await resolveTrustLevel("01-P-USA-1234-P-2601-A-X", mockEnv);
    expect(result).toEqual({ trust_level: 3, entity_type: "P" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches from ChittyTrust when cache is empty", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ trust_level: 4, entity_type: "A" }),
    });
    const result = await resolveTrustLevel("01-A-USA-5678-A-2601-B-X", mockEnv);
    expect(result).toEqual({ trust_level: 4, entity_type: "A" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://trust.chitty.cc/api/v1/trust/01-A-USA-5678-A-2601-B-X",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-trust-token",
        }),
      })
    );
    expect(mockEnv.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "trust:01-A-USA-5678-A-2601-B-X",
      expect.any(String),
      { expirationTtl: 300 }
    );
  });

  it("returns BASIC trust level on fetch failure", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await resolveTrustLevel("bad-id", mockEnv);
    expect(result).toEqual({ trust_level: 1, entity_type: "P" });
  });
});
