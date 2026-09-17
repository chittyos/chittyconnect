/**
 * These tests exist because of a LIVE production defect, not a hypothetical:
 * `src/intelligence/context-resolver.js` interpolated a Secrets Store binding
 * into a template literal, producing `Bearer [object Object]`, and the `||`
 * chain never reached the string fallbacks because a binding object is always
 * truthy.
 *
 * So the load-bearing assertion here is not "normalizeEnv returns strings" —
 * it is "a normalized env can no longer produce [object Object], and || chains
 * recover their intended semantics". A test that only checked the happy path
 * would have passed against the buggy code too.
 *
 * No mocks of our own modules: these drive the real exported functions. The
 * fake bindings stand in for the Cloudflare runtime object, which is the
 * boundary we do not own — they implement the same `.get()` contract that
 * `resolveBinding()` in src/services/cloudflare-secrets-client.js detects.
 */
import { describe, it, expect, vi } from "vitest";
import {
  normalizeEnv,
  isSecretsStoreBinding,
  secretsStoreBindingNames,
} from "../../src/lib/normalize-env.js";

/** A stand-in for a Cloudflare secrets_store_secret binding. */
const binding = (value) => ({ get: async () => value });
const failingBinding = (message) => ({
  get: async () => {
    throw new Error(message);
  },
});

describe("isSecretsStoreBinding", () => {
  it("detects an object with .get() and rejects strings and nullish", () => {
    expect(isSecretsStoreBinding(binding("x"))).toBe(true);
    expect(isSecretsStoreBinding("a-plain-secret_text-value")).toBe(false);
    expect(isSecretsStoreBinding(null)).toBe(false);
    expect(isSecretsStoreBinding(undefined)).toBe(false);
    expect(isSecretsStoreBinding({})).toBe(false);
    // A KV namespace also has .get(), so name-based selection would be unsound;
    // we only ever consult keys we then overwrite with the resolved string.
    expect(isSecretsStoreBinding({ get: () => {} })).toBe(true);
  });
});

describe("secretsStoreBindingNames", () => {
  it("lists only binding-shaped keys", () => {
    const env = { A: binding("1"), B: "plain", C: undefined, D: binding("2") };
    expect(secretsStoreBindingNames(env).sort()).toEqual(["A", "D"]);
  });

  it("tolerates a nullish env", () => {
    expect(secretsStoreBindingNames(null)).toEqual([]);
    expect(secretsStoreBindingNames(undefined)).toEqual([]);
  });
});

describe("normalizeEnv", () => {
  it("replaces bindings with their string values and leaves other keys alone", async () => {
    const env = {
      STORE_ONE: binding("resolved-one"),
      PLAIN: "already-a-string",
      NUMBERISH: "7",
    };
    const out = await normalizeEnv(env);
    expect(out.STORE_ONE).toBe("resolved-one");
    expect(out.PLAIN).toBe("already-a-string");
    expect(out.NUMBERISH).toBe("7");
  });

  it("does NOT mutate the platform env object", async () => {
    const original = binding("v");
    const env = { S: original };
    const out = await normalizeEnv(env);
    expect(env.S).toBe(original);
    expect(out).not.toBe(env);
    expect(out.S).toBe("v");
  });

  it("is idempotent, so nested entry points are safe", async () => {
    const env = { S: binding("v"), P: "p" };
    const once = await normalizeEnv(env);
    const twice = await normalizeEnv(once);
    expect(twice.S).toBe("v");
    expect(twice.P).toBe("p");
  });

  it("returns env untouched when there are no bindings at all", async () => {
    const env = { A: "1", B: "2" };
    expect(await normalizeEnv(env)).toBe(env);
  });

  // ---- the regression this module was written for -------------------------

  it("a normalized env can no longer interpolate to [object Object]", async () => {
    const env = { TOKEN: binding("real-token") };

    // Before normalization this is the production bug, verbatim.
    expect(`Bearer ${env.TOKEN}`).toBe("Bearer [object Object]");

    const out = await normalizeEnv(env);
    expect(`Bearer ${out.TOKEN}`).toBe("Bearer real-token");
    expect(`Bearer ${out.TOKEN}`).not.toContain("[object Object]");
  });

  it("restores || fallback semantics that a truthy binding object defeats", async () => {
    // Mirrors context-resolver.js:529-535 — three Store bindings ahead of two
    // working secret_text strings.
    const env = {
      CHITTYAUTH_ISSUED_MINT_API_KEY: failingBinding("not configured"),
      CHITTYAUTH_ISSUED_MINT_TOKEN: failingBinding("not configured"),
      MINT_API_KEY: failingBinding("not configured"),
      CHITTYMINT_SECRET: "working-secret-text-value",
      CHITTY_ID_TOKEN: "another-working-value",
    };

    const pick = (e) =>
      e.CHITTYAUTH_ISSUED_MINT_API_KEY ||
      e.CHITTYAUTH_ISSUED_MINT_TOKEN ||
      e.MINT_API_KEY ||
      e.CHITTYMINT_SECRET ||
      e.CHITTY_ID_TOKEN ||
      "";

    // The bug: short-circuits on an unresolvable binding object.
    expect(`${pick(env)}`).toBe("[object Object]");

    const out = await normalizeEnv(env, { onError: () => {} });
    // Unresolvable bindings become undefined, so the chain reaches a real value.
    expect(pick(out)).toBe("working-secret-text-value");
  });

  it("prefers a resolvable binding over the later string fallbacks", async () => {
    const env = {
      PRIMARY: binding("from-store"),
      FALLBACK: "from-secret-text",
    };
    const out = await normalizeEnv(env);
    expect(out.PRIMARY || out.FALLBACK).toBe("from-store");
  });

  // ---- failure posture ----------------------------------------------------

  it("sets an unresolvable binding to undefined rather than throwing", async () => {
    const env = { BROKEN: failingBinding("store unavailable"), OK: binding("v") };
    const out = await normalizeEnv(env, { onError: () => {} });
    expect(out.BROKEN).toBeUndefined();
    // One bad secret must not take down every other binding.
    expect(out.OK).toBe("v");
  });

  it("treats an empty or non-string resolution as absent", async () => {
    const env = {
      EMPTY: binding(""),
      NOT_A_STRING: binding({ nested: true }),
      GOOD: binding("v"),
    };
    const out = await normalizeEnv(env, { onError: () => {} });
    expect(out.EMPTY).toBeUndefined();
    expect(out.NOT_A_STRING).toBeUndefined();
    expect(out.GOOD).toBe("v");
  });

  it("reports the binding NAME on failure and never the value", async () => {
    const onError = vi.fn();
    await normalizeEnv({ SECRETS_PORTAL_AES_KEY: failingBinding("boom") }, { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    const [name, error] = onError.mock.calls[0];
    expect(name).toBe("SECRETS_PORTAL_AES_KEY");
    expect(String(error.message)).toBe("boom");
  });

  it("does not log secret values through the default error path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await normalizeEnv({ TOK: binding("super-secret-value-abc123") });
      // resolved fine, so nothing logged
      expect(warn).not.toHaveBeenCalled();

      await normalizeEnv({ TOK: binding("") });
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("TOK");
      expect(logged).not.toContain("super-secret-value-abc123");
    } finally {
      warn.mockRestore();
    }
  });

  it("resolves bindings concurrently rather than serially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = () => ({
      get: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return "v";
      },
    });
    await normalizeEnv({ A: slow(), B: slow(), C: slow() });
    // Serial resolution would never exceed 1; ~22 bindings serially would add
    // 22 round-trips to every invocation.
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
