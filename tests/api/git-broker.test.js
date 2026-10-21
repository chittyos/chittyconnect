
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitBrokerRoutes } from "../../src/api/routes/git-broker.js";

const CALLER = "03-1-USA-1234-P-2601-3-42";

function makeKv() {
  const store = new Map();
  return {
    store,
    put: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key) => store.get(key) ?? null),
  };
}

function makeDb({
  repos = [{ path_prefix: "chittyos/", access: "readwrite" }],
  remotes = [
    {
      pattern: "github.com/CHITTYOS/*",
      match_type: "glob",
      allow_force: 0,
    },
  ],
  authors = [],
} = {}) {
  return {
    prepare: vi.fn((sql) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => {
          if (sql.includes("git_repo_allowlist")) return { results: repos };
          if (sql.includes("git_remote_allowlist")) return { results: remotes };
          if (sql.includes("git_author_allowlist")) return { results: authors };
          return { results: [] };
        }),
      })),
    })),
  };
}

async function post(path, env, body) {
  return gitBrokerRoutes.fetch(
    new Request("https://internal" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("git broker capability admission", () => {
  let env;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
    env = { TOKEN_KV: makeKv(), DB: makeDb() };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mints one opaque read capability and stores only a hash-keyed record", async () => {
    const res = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "read",
      repo_path: "chittyos/chittyconfig",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^cap_[a-f0-9]{32}$/);
    expect(body.scope.operation).toBe("read");
    expect(body.scope.repo_path).toBe("chittyos/chittyconfig");

    const keys = [...env.TOKEN_KV.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^gitcap:[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain(body.token);
  });

  it("introspects an active capability then fails closed after expiry", async () => {
    const mint = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "commit",
      repo_path: "chittyos/chittyconfig",
      ref: "refs/heads/p/verify",
    });
    const minted = await mint.json();

    let res = await post("/capabilities/introspect", env, {
      token: minted.token,
    });
    let body = await res.json();
    expect(body.active).toBe(true);
    expect(body.scope.operation).toBe("commit");

    vi.advanceTimersByTime(301_000);
    res = await post("/capabilities/introspect", env, {
      token: minted.token,
    });
    body = await res.json();
    expect(body).toEqual({ active: false });
  });

  it("rejects raw provider credentials as capabilities", async () => {
    const res = await post("/capabilities/introspect", env, {
      token: "ghs_SimulatedRawProviderCredential",
    });
    expect(await res.json()).toEqual({ active: false });
  });

  it("rejects a multi-operation request", async () => {
    const res = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: ["read", "commit"],
      repo_path: "chittyos/chittyconfig",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_operation");
  });

  it("fails closed for a repo outside the tenant allowlist", async () => {
    const res = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "read",
      repo_path: "other/repo",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "POLICY_BLOCKED_REPO_NOT_ALLOWED",
    );
  });

  it("down-binds push to an allowlisted remote and concrete ref", async () => {
    const res = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "push",
      repo_path: "chittyos/chittyconfig",
      remote: "https://github.com/CHITTYOS/chittyconfig.git",
      ref: "refs/heads/p/verify",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope.remote).toBe("github.com/CHITTYOS/chittyconfig");
    expect(body.scope.ref).toBe("refs/heads/p/verify");
  });

  it("keeps force push unavailable until confirmation is implemented", async () => {
    const res = await post("/capabilities/mint", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "push",
      repo_path: "chittyos/chittyconfig",
      remote: "https://github.com/CHITTYOS/chittyconfig.git",
      ref: "refs/heads/p/verify",
      force_class: "force",
      confirmation_token: "confirm_fake",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "POLICY_BLOCKED_CONFIRMATION_REQUIRED",
    );
  });

  it("returns provider-native policy values", async () => {
    const res = await post("/policy/resolve", env, {
      caller_chittyid: CALLER,
      tenant_id: "chittyos-default",
      operation: "commit",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed_repos).toEqual(["chittyos/"]);
    expect(body.allowed_remotes).toEqual(["github.com/CHITTYOS/*"]);
    expect(body.force_push_allowed).toBe(false);
  });
});
