import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EnhancedCredentialProvisioner } from "../../src/services/credential-provisioner-enhanced.js";
import { createMockKV } from "../helpers/mocks.js";

describe("EnhancedCredentialProvisioner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to baseline validation when ContextConsciousness is unavailable", async () => {
    const env = {
      RATE_LIMIT: createMockKV(),
    };
    const provisioner = new EnhancedCredentialProvisioner(env);

    const result = await provisioner.analyzeContext(
      "openai_api_key",
      { purpose: "unit-test" },
      "chittyconnect",
    );

    expect(result.approved).toBe(true);
    expect(result.recommendations).toContain(
      "ContextConsciousness unavailable; using baseline validation only",
    );
    expect(env.RATE_LIMIT.put).toHaveBeenCalledTimes(1);
  });

  it("merges dynamic Cloudflare permissions with fallback set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: [
            {
              id: "perm-write",
              name: "Workers Scripts Write",
            },
          ],
        }),
      }),
    );

    const provisioner = new EnhancedCredentialProvisioner({
      RATE_LIMIT: createMockKV(),
    });
    const permissions = await provisioner.fetchCloudflarePermissions(
      "fake-api-key",
    );

    expect(permissions.workersScriptsWrite.id).toBe("perm-write");
    expect(permissions.workersKVWrite).toBeDefined();
    expect(permissions.accountSettingsRead).toBeDefined();
  });
});