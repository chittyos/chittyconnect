/**
 * CloudflareSecretsClient — binding resolution.
 *
 * Regression cover for a dormant defect: every lookup in get() was
 * `if (this.env[X]) return this.env[X]`. Two binding shapes land on `env`:
 *
 *   wrangler secret put   -> a plain string
 *   secrets_store_secrets -> an object with an async .get()
 *
 * A binding object is truthy, so the old code returned the BINDING where
 * callers expect the secret — no type error, just "[object Object]" wherever
 * the value was interpolated into a header or a connection string.
 *
 * It never fired in production because no consumer binds Secrets Store (0 of
 * 51 tracked wrangler configs in chittyentity at the time of writing). It
 * fires on the first worker to adopt the documented policy, which is why it
 * had to be fixed before any migration, not during one.
 *
 * On fixtures: the Secrets Store binding here is a real object with a real
 * async get(), which is the actual runtime contract — not a mocked module.
 * There is no way to exercise a genuine Secrets Store binding outside the
 * Workers runtime with a provisioned store, and provisioning one requires
 * credential access this suite does not and should not have. The shape is
 * the contract; that is what is asserted.
 */
import { describe, it, expect } from "vitest";
import { CloudflareSecretsClient } from "../../src/services/cloudflare-secrets-client.js";

/** Mimics a secrets_store_secrets binding: object, async get(). */
const storeBinding = (value) => ({ get: async () => value });

describe("CloudflareSecretsClient.get — string bindings (wrangler secret put)", () => {
  it("returns the value for a directly-named env var", async () => {
    const c = new CloudflareSecretsClient({ NEON_DATABASE_URL: "conn-string-value" });
    await expect(c.get("NEON_DATABASE_URL")).resolves.toBe("conn-string-value");
  });

  it("treats an empty string as absent rather than returning it", async () => {
    // An empty secret is a misconfiguration; returning "" silently produces an
    // unauthenticated call downstream instead of a loud failure.
    const c = new CloudflareSecretsClient({ SOME_TOKEN: "" });
    await expect(c.get("SOME_TOKEN")).rejects.toThrow(/not found/i);
  });
});

describe("CloudflareSecretsClient.get — Secrets Store bindings", () => {
  it("returns the VALUE, not the binding object — the regression", async () => {
    const c = new CloudflareSecretsClient({ MY_SECRET: storeBinding("resolved-secret") });
    const got = await c.get("MY_SECRET");
    expect(got).toBe("resolved-secret");
    expect(typeof got).toBe("string");
  });

  it("never yields something that stringifies to [object Object]", async () => {
    // The precise production symptom the old code produced. Asserted directly
    // because it is what a reviewer would actually have seen in a log.
    const c = new CloudflareSecretsClient({ MY_SECRET: storeBinding("resolved-secret") });
    const got = await c.get("MY_SECRET");
    expect(`Bearer ${got}`).toBe("Bearer resolved-secret");
    expect(`${got}`).not.toContain("[object Object]");
  });

  it("resolves a Secrets Store binding reached via a derived name", async () => {
    // path -> ITEM_FIELD derivation must go through the same resolver; the old
    // code had four independent return sites and each had the bug.
    const c = new CloudflareSecretsClient({ MERCURY_API_TOKEN: storeBinding("mercury-value") });
    await expect(c.get("integrations/mercury/api_token")).resolves.toBe("mercury-value");
  });

  it("treats a Secrets Store binding resolving to empty as absent", async () => {
    const c = new CloudflareSecretsClient({ MY_SECRET: storeBinding("") });
    await expect(c.get("MY_SECRET")).rejects.toThrow(/not found/i);
  });
});

describe("CloudflareSecretsClient.get — mixed and missing", () => {
  it("supports both shapes side by side during a migration", async () => {
    // The realistic mid-migration state: some workers moved, some not.
    const c = new CloudflareSecretsClient({
      OLD_STYLE: "plain-string",
      NEW_STYLE: storeBinding("store-value"),
    });
    await expect(c.get("OLD_STYLE")).resolves.toBe("plain-string");
    await expect(c.get("NEW_STYLE")).resolves.toBe("store-value");
  });

  it("throws a named error when nothing matches", async () => {
    const c = new CloudflareSecretsClient({});
    await expect(c.get("nothing/here/at_all")).rejects.toThrow(/nothing\/here\/at_all/);
  });
});

describe("CloudflareSecretsClient.prefetch", () => {
  it("resolves Secrets Store bindings in bulk, skipping misses", async () => {
    const c = new CloudflareSecretsClient({
      A_TOKEN: storeBinding("a-value"),
      B_TOKEN: "b-value",
    });
    const got = await c.prefetch(["A_TOKEN", "B_TOKEN", "MISSING_TOKEN"]);
    expect(got.get("A_TOKEN")).toBe("a-value");
    expect(got.get("B_TOKEN")).toBe("b-value");
    expect(got.has("MISSING_TOKEN")).toBe(false);
  });
});
