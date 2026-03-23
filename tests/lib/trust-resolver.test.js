import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTrustLevel, TRUST_LEVELS } from "../../src/lib/trust-resolver.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv = {
  CREDENTIAL_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
  },
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
      JSON.stringify({ trust_level: 3, entity_type: "P", ty: 0.8, vy: 0.7, ry: 0.5 })
    );
    const result = await resolveTrustLevel("01-P-USA-1234-P-2601-A-X", mockEnv);
    expect(result).toEqual({ trust_level: 3, entity_type: "P", ty: 0.8, vy: 0.7, ry: 0.5 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches from ChittyScore DRL when cache is empty", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ty: 0.9, vy: 0.8, ry: 0.7 }),
    });
    // ChittyID segment 4 = "A" (Authority entity type)
    const result = await resolveTrustLevel("01-A-USA-5678-A-2601-B-X", mockEnv);
    // deriveTrustLevel: floor((0.9+0.8+0.7)/3 * 5) = floor(0.8 * 5) = floor(4.0) = 4
    expect(result).toEqual({ trust_level: 4, entity_type: "A", ty: 0.9, vy: 0.8, ry: 0.7 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://score.chitty.cc/v1/reckon/01-A-USA-5678-A-2601-B-X",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    expect(mockEnv.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "trust:01-A-USA-5678-A-2601-B-X",
      expect.any(String),
      { expirationTtl: 300 }
    );
  });

  it("returns ANONYMOUS trust level on fetch failure (fail-closed)", async () => {
    mockEnv.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await resolveTrustLevel("bad-id", mockEnv);
    expect(result).toEqual({ trust_level: 0, entity_type: "P", ty: 0, vy: 0, ry: 0 });
  });
});
