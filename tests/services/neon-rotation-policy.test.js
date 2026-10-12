import { describe, it, expect } from "vitest";
import { SecretRotationService, getCachedNeonUri } from "../../src/services/secret-rotation.js";

// An in-memory KV implementation records actual operations. No provider mocks.
function kvStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const operations = [];
  return {
    operations,
    get: async (key) => { operations.push({ method: "get", key }); return rows.get(key) ?? null; },
    put: async (key, value) => { operations.push({ method: "put", key }); rows.set(key, value); },
    delete: async (key) => { operations.push({ method: "delete", key }); rows.delete(key); },
  };
}

async function prohibitProviderNetwork(run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Provider network access was attempted"); };
  try { return await run(); } finally { globalThis.fetch = original; }
}

describe("Neon password rotation custody gate", () => {
  it("refuses direct rotation even when Neon API identifiers exist", async () => {
    const kv = kvStore();
    const rotation = new SecretRotationService({
      CREDENTIAL_CACHE: kv, NEON_API_KEY: "synthetic",
      NEON_PROJECT_ID: "test-project", NEON_BRANCH_ID: "test-branch",
      NEON_HOST: "example.invalid",
    });
    const outcome = await prohibitProviderNetwork(() => rotation.rotateNeonPassword());
    expect(outcome).toEqual({ ok: false, error: "POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED" });
    expect(kv.operations).toEqual([]);
  });

  it("rejects forceRotate before any KV access or provider call", async () => {
    const kv = kvStore();
    const rotation = new SecretRotationService({ CREDENTIAL_CACHE: kv });
    const outcome = await prohibitProviderNetwork(() => rotation.forceRotate("neon_password"));
    expect(outcome).toEqual({ ok: false, error: "POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED" });
    expect(kv.operations).toEqual([]);
  });

  it("skips Neon on the hourly rotation path without modifying its prior metadata", async () => {
    const prev = JSON.stringify({ lastRotatedAt: "2026-10-07T16:00:57.705Z", lastResult: "error" });
    const kv = kvStore({
      "secret:gdrive:meta": JSON.stringify({ lastRotatedAt: new Date().toISOString(), lastResult: "success" }),
      "secret:neon:meta": prev,
    });
    const rotation = new SecretRotationService({ CREDENTIAL_CACHE: kv });
    const result = await prohibitProviderNetwork(() => rotation.runDueRotations());
    expect(result.failed).toEqual([]);
    expect(result.rotated).toEqual([]);
    expect(result.skipped).toContainEqual({ name: "neon_password", reason: "policy_blocked_credential_custody" });
    expect(kv.operations.filter(x => x.method === "put")).toHaveLength(0);
    expect(kv.operations.some(x => x.key === "secret:neon:connection_uri")).toBe(false);
    expect(await kv.get("secret:neon:meta")).toBe(prev);
  });

  it("does not report a blocked rotation as due or healthy despite stale metadata", async () => {
    const kv = kvStore({ "secret:neon:meta": JSON.stringify({ lastRotatedAt: new Date().toISOString(), lastResult: "success" }) });
    const { secrets } = await new SecretRotationService({ CREDENTIAL_CACHE: kv }).getStatus();
    expect(secrets.neon_password.enabled).toBe(false);
    expect(secrets.neon_password.isDue).toBe(false);
    expect(secrets.neon_password.fresh).toBe(false);
    expect(secrets.neon_password.blockedReason).toBe("POLICY_BLOCKED_CHITTYSECRETS_ROTATION_NOT_BROKERED");
  });

  it("never exposes a historical KV-resident Neon connection URI", async () => {
    const kv = kvStore({ "secret:neon:connection_uri": "synthetic-not-a-real-credential" });
    expect(await getCachedNeonUri(kv)).toBeNull();
    expect(kv.operations).toEqual([]);
  });
});
