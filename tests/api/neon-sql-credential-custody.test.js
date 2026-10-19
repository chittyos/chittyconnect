import { describe, expect, it } from "vitest";
import { resolveNeonConnection } from "../../src/api/routes/execute.js";

// Integration with the existing ChittyConnect credential-helper and
// Cloudflare Secrets Store binding adapter. No database is opened.
describe("Neon SQL executor custody", () => {
  it("uses brokered hot-tier binding and never consults KV for connection URI", async () => {
    const kv = {
      async get() { throw new Error("Forbidden credential KV read"); },
      async put() { throw new Error("Forbidden credential KV write"); },
      async delete() { throw new Error("Forbidden credential KV delete"); },
    };
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CREDENTIAL_CACHE: kv,
      NEON_CHITTYOS_CORE_URL: {
        get: async () => "synthetic-test-only-bound-credential",
      },
    };
    const credential = await resolveNeonConnection(env, "chittyos-core");
    expect(credential).toBe("synthetic-test-only-bound-credential");
  });

  it("unknown databases do not fall back to untrusted KV keys", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CREDENTIAL_CACHE: {
        async get() { throw new Error("Should not read KV"); },
      },
    };
    expect(await resolveNeonConnection(env, "unknown-database")).toBeNull();
  });
});
