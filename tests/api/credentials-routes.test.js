import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValidateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockProvision = vi.fn();

vi.mock("../../src/services/credential-provisioner-enhanced.js", () => ({
  EnhancedCredentialProvisioner: class MockEnhancedCredentialProvisioner {
    constructor() {}

    validateRequest(...args) {
      return mockValidateRequest(...args);
    }

    checkRateLimit(...args) {
      return mockCheckRateLimit(...args);
    }

    provision(...args) {
      return mockProvision(...args);
    }
  },
}));

const { credentialsRoutes } = await import("../../src/api/routes/credentials.js");

describe("credentialsRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvision.mockResolvedValue({
      success: true,
      credential: { type: "openai_api_key", value: "redacted" },
    });
  });

  it("delegates rate limiting to provisioner internals (no route-level call)", async () => {
    const req = new Request("http://localhost/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai_api_key",
        context: { purpose: "test" },
      }),
    });

    const res = await credentialsRoutes.fetch(req, {});
    expect(res.status).toBe(200);
    expect(mockValidateRequest).toHaveBeenCalledTimes(1);
    expect(mockProvision).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("does not expose stack traces in provisioning errors", async () => {
    mockProvision.mockRejectedValue(new Error("boom"));

    const req = new Request("http://localhost/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai_api_key",
        context: { purpose: "test" },
      }),
    });

    const res = await credentialsRoutes.fetch(req, {});
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("PROVISION_FAILED");
    expect(body.error.details).toBeUndefined();
  });
});
