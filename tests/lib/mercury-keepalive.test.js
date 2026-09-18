/**
 * Mercury keepalive tests.
 *
 * No module mocking: runMercuryKeepalive takes its I/O as injected functions, so
 * these exercise the real scheduling, reporting and failure-classification logic
 * with real in-memory doubles for the two external boundaries (KV and Mercury).
 */
import { describe, it, expect } from "vitest";
import {
  runMercuryKeepalive,
  mercuryTokenBindings,
  bindingToSlug,
  isDue,
  __testing,
} from "../../src/services/mercury-keepalive.js";

const { DAY_MS } = __testing;

/** In-memory KV with the subset of the Workers KV surface this module uses. */
function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    },
  };
}

const NOW = Date.parse("2026-09-18T00:00:00.000Z");

function envWithTokens(names, extra = {}) {
  const env = { TOKEN_KV: makeKV(), ...extra };
  for (const n of names) env[n] = `token-value-for-${n}`;
  return env;
}

const deps = (over = {}) => ({
  resolveBinding: async (b) => (typeof b === "string" ? b : undefined),
  mercuryFetch: async () => ({ accounts: [] }),
  resolveEgressProfile: () => ({ profile: "direct" }),
  now: NOW,
  ...over,
});

describe("binding discovery", () => {
  it("finds per-entity token bindings and ignores unrelated Mercury secrets", () => {
    const env = envWithTokens(
      ["MERCURY_TOKEN_ARIBIA_LLC", "MERCURY_TOKEN_IT_CAN_BE_LLC"],
      {
        MERCURY_OIDC_CLIENT_ID: "x",
        MERCURY_WRITE_TOKEN_ARIBIA_LLC: "x",
        MERCURY_EGRESS_ACCESS_CLIENT_ID: "x",
        MERCURY_API_TOKEN: "x",
      },
    );
    expect(mercuryTokenBindings(env)).toEqual([
      "MERCURY_TOKEN_ARIBIA_LLC",
      "MERCURY_TOKEN_IT_CAN_BE_LLC",
    ]);
  });

  it("skips bindings that are present but null", () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    env.MERCURY_TOKEN_CHITTY_SERVICES = null;
    expect(mercuryTokenBindings(env)).toEqual(["MERCURY_TOKEN_ARIBIA_LLC"]);
  });

  it("returns a stable sorted order regardless of env key insertion order", () => {
    const a = envWithTokens(["MERCURY_TOKEN_B_LLC", "MERCURY_TOKEN_A_LLC"]);
    const b = envWithTokens(["MERCURY_TOKEN_A_LLC", "MERCURY_TOKEN_B_LLC"]);
    expect(mercuryTokenBindings(a)).toEqual(mercuryTokenBindings(b));
  });

  it("finds a NON-ENUMERABLE Secrets Store binding — the production shape", () => {
    // A secrets_store_secret binding is not guaranteed to appear in
    // Object.keys(env); chittyagent-finance documents exactly that. A prefix
    // scan alone would discover nothing here and the sweep would ping no token
    // while reporting a clean run.
    const env = { TOKEN_KV: makeKV() };
    Object.defineProperty(env, "MERCURY_TOKEN_ARIBIA_LLC", {
      enumerable: false,
      value: { get: async () => "secret-value" },
    });

    expect(Object.keys(env)).not.toContain("MERCURY_TOKEN_ARIBIA_LLC");
    expect(mercuryTokenBindings(env)).toEqual(["MERCURY_TOKEN_ARIBIA_LLC"]);
  });

  it("sweeps a non-enumerable binding end to end", async () => {
    const env = { TOKEN_KV: makeKV() };
    Object.defineProperty(env, "MERCURY_TOKEN_CHITTY_SERVICES", {
      enumerable: false,
      value: { get: async () => "secret-value" },
    });

    const report = await runMercuryKeepalive(
      env,
      deps({ resolveBinding: async (b) => (b?.get ? await b.get() : b) }),
    );
    expect(report).toMatchObject({ checked: 1, pinged: 1, failed: 0 });
  });

  it("unions canonical names with prefix-discovered ones, without duplicates", () => {
    const env = envWithTokens([
      "MERCURY_TOKEN_ARIBIA_LLC", // canonical AND enumerable
      "MERCURY_TOKEN_ARIBIA", // ad-hoc inline name, prefix only
    ]);
    const found = mercuryTokenBindings(env);
    expect(found).toContain("MERCURY_TOKEN_ARIBIA_LLC");
    expect(found).toContain("MERCURY_TOKEN_ARIBIA");
    expect(new Set(found).size).toBe(found.length);
  });

  it("maps binding names to Mercury org slugs", () => {
    expect(bindingToSlug("MERCURY_TOKEN_ARIBIA_LLC_CITY_STUDIO")).toBe(
      "aribia-llc-city-studio",
    );
    expect(bindingToSlug("MERCURY_TOKEN_CHICAGO_FURNISHED_CONDOS")).toBe(
      "chicago-furnished-condos",
    );
  });
});

describe("due calculation", () => {
  it("treats never-pinged as due", () => {
    expect(isDue(null, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as due rather than fresh", () => {
    // Failing the other way silently stops pinging a token until Mercury deletes it.
    expect(isDue("not-a-date", NOW)).toBe(true);
  });

  it("is not due inside the interval, due at the boundary and beyond", () => {
    const iso = (d) => new Date(NOW - d * DAY_MS).toISOString();
    expect(isDue(iso(19), NOW, 20)).toBe(false);
    expect(isDue(iso(20), NOW, 20)).toBe(true);
    expect(isDue(iso(60), NOW, 20)).toBe(true);
  });
});

describe("keepalive sweep", () => {
  it("pings every token on a cold start and records the timestamp", async () => {
    const env = envWithTokens([
      "MERCURY_TOKEN_ARIBIA_LLC",
      "MERCURY_TOKEN_CHITTY_SERVICES",
    ]);
    const paths = [];
    const report = await runMercuryKeepalive(
      env,
      deps({
        mercuryFetch: async (_t, path) => {
          paths.push(path);
          return {};
        },
      }),
    );

    expect(report).toMatchObject({ checked: 2, pinged: 2, skipped: 0, failed: 0 });
    expect(paths).toEqual(["/accounts", "/accounts"]);
    expect(await env.TOKEN_KV.get("mercury:keepalive:aribia-llc")).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it("skips tokens pinged inside the interval", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    await env.TOKEN_KV.put(
      "mercury:keepalive:aribia-llc",
      new Date(NOW - 5 * DAY_MS).toISOString(),
    );

    let called = 0;
    const report = await runMercuryKeepalive(
      env,
      deps({
        mercuryFetch: async () => {
          called++;
          return {};
        },
      }),
    );

    expect(called).toBe(0);
    expect(report).toMatchObject({ checked: 1, pinged: 0, skipped: 1 });
  });

  it("classifies a 401 as reissue-required and names the slug", async () => {
    const env = envWithTokens([
      "MERCURY_TOKEN_CHICAGO_FURNISHED_CONDOS",
      "MERCURY_TOKEN_ARIBIA_LLC",
    ]);
    const report = await runMercuryKeepalive(
      env,
      deps({
        mercuryFetch: async (token) => {
          if (token.includes("CHICAGO")) throw new Error("Mercury API 401");
          return {};
        },
      }),
    );

    expect(report.unauthorized).toEqual(["chicago-furnished-condos"]);
    expect(report.pinged).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it("separates transient errors from dead tokens", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    const report = await runMercuryKeepalive(
      env,
      deps({
        mercuryFetch: async () => {
          throw new Error("Mercury API 503");
        },
      }),
    );

    expect(report.unauthorized).toEqual([]);
    expect(report.errors).toEqual([
      { slug: "aribia-llc", error: "Mercury API 503" },
    ]);
  });

  it("keeps sweeping after one token fails", async () => {
    const env = envWithTokens([
      "MERCURY_TOKEN_A_LLC",
      "MERCURY_TOKEN_B_LLC",
      "MERCURY_TOKEN_C_LLC",
    ]);
    const report = await runMercuryKeepalive(
      env,
      deps({
        mercuryFetch: async (token) => {
          if (token.includes("_B_")) throw new Error("boom");
          return {};
        },
      }),
    );

    expect(report).toMatchObject({ checked: 3, pinged: 2, failed: 1 });
  });

  it("treats a KV read failure as due instead of skipping the ping", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    env.TOKEN_KV = {
      async get() {
        throw new Error("KV unavailable");
      },
      async put() {},
    };

    const report = await runMercuryKeepalive(env, deps());
    expect(report.pinged).toBe(1);
  });

  it("still counts the ping when the bookkeeping write fails", async () => {
    // The ping is what keeps the token alive; a failed KV write only costs an
    // extra ping next run and must not be reported as a failure.
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    env.TOKEN_KV = {
      async get() {
        return null;
      },
      async put() {
        throw new Error("KV write failed");
      },
    };

    const report = await runMercuryKeepalive(env, deps());
    expect(report).toMatchObject({ pinged: 1, failed: 0 });
  });

  it("reports a resolved-empty binding as a failure, not a silent skip", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    const report = await runMercuryKeepalive(
      env,
      deps({ resolveBinding: async () => undefined }),
    );

    expect(report).toMatchObject({ checked: 1, pinged: 0, failed: 1 });
    expect(report.errors[0].slug).toBe("aribia-llc");
  });

  it("reports checked:0 when no bindings exist — an empty sweep is not a clean one", async () => {
    const report = await runMercuryKeepalive({ TOKEN_KV: makeKV() }, deps());
    expect(report).toMatchObject({ checked: 0, pinged: 0, failed: 0 });
  });

  it("runs without a KV binding at all, pinging every time", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    delete env.TOKEN_KV;
    const report = await runMercuryKeepalive(env, deps());
    expect(report.pinged).toBe(1);
  });

  it("honours MERCURY_KEEPALIVE_INTERVAL_DAYS from env", async () => {
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"], {
      MERCURY_KEEPALIVE_INTERVAL_DAYS: "3",
    });
    await env.TOKEN_KV.put(
      "mercury:keepalive:aribia-llc",
      new Date(NOW - 5 * DAY_MS).toISOString(),
    );

    const report = await runMercuryKeepalive(env, deps());
    expect(report.pinged).toBe(1);
  });

  it("passes the per-slug egress profile through to the fetch", async () => {
    // A keepalive on the wrong egress path fails against IP-allowlisted tokens.
    const env = envWithTokens(["MERCURY_TOKEN_ARIBIA_LLC"]);
    const seen = [];
    await runMercuryKeepalive(
      env,
      deps({
        resolveEgressProfile: (_e, slug) => ({ profile: "relay", slug }),
        mercuryFetch: async (_t, _p, _o, egress) => {
          seen.push(egress);
          return {};
        },
      }),
    );

    expect(seen).toEqual([{ profile: "relay", slug: "aribia-llc" }]);
  });
});
