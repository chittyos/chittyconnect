/**
 * Mercury Token Resolution Tests
 *
 * Exercises the real getMercuryToken / resolveBinding functions, including the
 * per-entity Cloudflare Secrets Store binding path (MERCURY_TOKEN_<SLUG>), whose
 * bindings expose an async get() rather than a plain string value.
 */

import { describe, it, expect } from "vitest";
import { getMercuryToken, resolveBinding } from "../../src/api/routes/thirdparty.js";

// Faithful stand-in for a Cloudflare Secrets Store binding: an object exposing
// an async get() that returns the secret string. This mirrors the runtime shape
// — it is the real binding contract, not a stubbed datastore.
function secretsStoreBinding(value) {
  return { get: async () => value };
}

// Minimal Hono-style context exposing only what getMercuryToken reads.
function ctx(env, header) {
  return {
    env,
    req: { header: (name) => (name === "X-Mercury-Token" ? header : undefined) },
  };
}

describe("resolveBinding", () => {
  it("returns undefined for absent bindings", async () => {
    expect(await resolveBinding(undefined)).toBeUndefined();
    expect(await resolveBinding(null)).toBeUndefined();
  });

  it("returns plain string bindings as-is", async () => {
    expect(await resolveBinding("plain-token")).toBe("plain-token");
  });

  it("awaits get() on Secrets Store bindings", async () => {
    expect(await resolveBinding(secretsStoreBinding("store-token"))).toBe("store-token");
  });

  it("treats an empty Secrets Store value as undefined", async () => {
    expect(await resolveBinding(secretsStoreBinding(""))).toBeUndefined();
  });

  it("degrades to undefined when get() throws (store unreachable)", async () => {
    const throwing = { get: async () => { throw new Error("store unreachable"); } };
    expect(await resolveBinding(throwing)).toBeUndefined();
  });
});

describe("getMercuryToken", () => {
  it("prefers the X-Mercury-Token header over all bindings", async () => {
    const env = { MERCURY_TOKEN_ARIBIA_LLC: secretsStoreBinding("store"), MERCURY_API_TOKEN: "fallback" };
    expect(await getMercuryToken(ctx(env, "header-token"), "aribia-llc")).toBe("header-token");
  });

  it("resolves the per-entity Secrets Store binding for a kebab slug", async () => {
    const env = { MERCURY_TOKEN_ARIBIA_LLC: secretsStoreBinding("aribia-token"), MERCURY_API_TOKEN: "fallback" };
    expect(await getMercuryToken(ctx(env), "aribia-llc")).toBe("aribia-token");
  });

  it("resolves a multi-segment slug to the right binding", async () => {
    const env = {
      MERCURY_TOKEN_CHICAGO_FURNISHED_CONDOS: secretsStoreBinding("chicago-token"),
      MERCURY_API_TOKEN: "fallback",
    };
    expect(await getMercuryToken(ctx(env), "chicago-furnished-condos")).toBe("chicago-token");
  });

  it("isolates entities — slug B does not receive entity A's token", async () => {
    const env = {
      MERCURY_TOKEN_ARIBIA_LLC: secretsStoreBinding("aribia-token"),
      MERCURY_TOKEN_IT_CAN_BE_LLC: secretsStoreBinding("itcanbe-token"),
    };
    expect(await getMercuryToken(ctx(env), "it-can-be-llc")).toBe("itcanbe-token");
    expect(await getMercuryToken(ctx(env), "aribia-llc")).toBe("aribia-token");
  });

  it("falls back to the legacy MERCURY_API_KEY_<SLUG> env var", async () => {
    const env = { MERCURY_API_KEY_ARIBIA_LLC: "legacy-token", MERCURY_API_TOKEN: "fallback" };
    expect(await getMercuryToken(ctx(env), "aribia-llc")).toBe("legacy-token");
  });

  it("falls back to the single MERCURY_API_TOKEN when no per-entity binding exists", async () => {
    const env = { MERCURY_API_TOKEN: "single-fallback" };
    expect(await getMercuryToken(ctx(env), "unknown-entity")).toBe("single-fallback");
  });

  it("prefers Secrets Store over the legacy env var for the same slug", async () => {
    const env = {
      MERCURY_TOKEN_ARIBIA_LLC: secretsStoreBinding("store-token"),
      MERCURY_API_KEY_ARIBIA_LLC: "legacy-token",
    };
    expect(await getMercuryToken(ctx(env), "aribia-llc")).toBe("store-token");
  });
});
