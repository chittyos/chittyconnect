import { describe, it, expect } from "vitest";
import {
  resolveEgressProfile,
  buildEgressRequest,
} from "../../src/api/routes/thirdparty.js";

// Mercury egress profile — static-IP relay indirection.
// These are pure-function unit tests: profile selection, header construction,
// and fail-closed behavior. No mocks (per repo policy: no vi.mock on service
// modules / no fetch stubbing). The relay HTTP round-trip is an integration
// concern, deferred until the egress node exists (see note at bottom).

const MERCURY_API = "https://api.mercury.com/api/v1";

describe("resolveEgressProfile", () => {
  it("defaults to 'direct' when nothing is configured", () => {
    const r = resolveEgressProfile({}, "aribia-llc");
    expect(r.profile).toBe("direct");
  });

  it("defaults to 'direct' when env is undefined", () => {
    expect(resolveEgressProfile(undefined, "aribia-llc").profile).toBe(
      "direct",
    );
  });

  it("honors the global MERCURY_EGRESS_PROFILE", () => {
    const r = resolveEgressProfile(
      { MERCURY_EGRESS_PROFILE: "relay" },
      "aribia-llc",
    );
    expect(r.profile).toBe("relay");
  });

  it("per-slug override beats the global default", () => {
    const env = {
      MERCURY_EGRESS_PROFILE: "direct",
      MERCURY_EGRESS_PROFILE_IT_CAN_BE_LLC: "relay",
    };
    expect(resolveEgressProfile(env, "it-can-be-llc").profile).toBe("relay");
    // a different slug is unaffected and stays on the global default
    expect(resolveEgressProfile(env, "aribia-llc").profile).toBe("direct");
  });

  it("normalizes profile case-insensitively (RELAY / Relay / ' relay ' → relay)", () => {
    for (const raw of ["RELAY", "Relay", " relay ", "ReLaY"]) {
      expect(
        resolveEgressProfile({ MERCURY_EGRESS_PROFILE: raw }, "aribia-llc")
          .profile,
      ).toBe("relay");
    }
    expect(
      resolveEgressProfile({ MERCURY_EGRESS_PROFILE: "DIRECT" }, "aribia-llc")
        .profile,
    ).toBe("direct");
  });

  it("normalizes per-slug overrides case-insensitively too", () => {
    expect(
      resolveEgressProfile(
        { MERCURY_EGRESS_PROFILE_IT_CAN_BE_LLC: "Relay" },
        "it-can-be-llc",
      ).profile,
    ).toBe("relay");
  });

  it("rejects an unknown profile value early (fail closed)", () => {
    expect(() =>
      resolveEgressProfile({ MERCURY_EGRESS_PROFILE: "proxy" }, "aribia-llc"),
    ).toThrow(/Unknown Mercury egress profile/);
    // unknown per-slug override also throws
    expect(() =>
      resolveEgressProfile(
        { MERCURY_EGRESS_PROFILE_ARIBIA_LLC: "tunnel" },
        "aribia-llc",
      ),
    ).toThrow(/Unknown Mercury egress profile/);
  });

  it("surfaces relay url + Access creds from env", () => {
    const r = resolveEgressProfile(
      {
        MERCURY_EGRESS_PROFILE: "relay",
        MERCURY_EGRESS_URL: "https://egress.chitty.cc/mercury",
        MERCURY_EGRESS_ACCESS_CLIENT_ID: "cid.access",
        MERCURY_EGRESS_ACCESS_CLIENT_SECRET: "csecret.access",
      },
      "aribia-llc",
    );
    expect(r).toMatchObject({
      profile: "relay",
      relayUrl: "https://egress.chitty.cc/mercury",
      accessClientId: "cid.access",
      accessClientSecret: "csecret.access",
    });
  });
});

describe("buildEgressRequest — direct (preserves legacy behavior)", () => {
  it("targets api.mercury.com with Bearer auth, byte-for-byte legacy shape", () => {
    const req = buildEgressRequest({
      profile: "direct",
      token: "mercury_secret_token",
      path: "/accounts",
    });
    expect(req.url).toBe(`${MERCURY_API}/accounts`);
    expect(req.method).toBe("GET");
    expect(req.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer mercury_secret_token",
    });
  });

  it("defaults to direct when no profile is given", () => {
    const req = buildEgressRequest({ token: "t", path: "/accounts" });
    expect(req.url).toBe(`${MERCURY_API}/accounts`);
    expect(req.headers.Authorization).toBe("Bearer t");
  });

  it("preserves caller method/headers/body for direct (e.g. keepalive POST)", () => {
    const req = buildEgressRequest({
      profile: "direct",
      token: "t",
      path: "/account/abc/transactions?limit=10",
      options: { method: "POST", headers: { "X-Trace": "1" }, body: "{}" },
    });
    expect(req.method).toBe("POST");
    expect(req.headers["X-Trace"]).toBe("1");
    expect(req.body).toBe("{}");
    expect(req.url).toBe(`${MERCURY_API}/account/abc/transactions?limit=10`);
  });
});

describe("buildEgressRequest — relay", () => {
  const relay = {
    profile: "relay",
    relayUrl: "https://egress.chitty.cc/mercury",
    accessClientId: "cid.access",
    accessClientSecret: "csecret.access",
  };

  it("POSTs to the relay URL with token + Access headers", () => {
    const req = buildEgressRequest({
      ...relay,
      token: "mercury_tok",
      path: "/accounts",
    });
    expect(req.url).toBe("https://egress.chitty.cc/mercury");
    expect(req.method).toBe("POST");
    expect(req.headers["X-Mercury-Token"]).toBe("mercury_tok");
    expect(req.headers["CF-Access-Client-Id"]).toBe("cid.access");
    expect(req.headers["CF-Access-Client-Secret"]).toBe("csecret.access");
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("forwards method + RELATIVE path + body in the relay envelope (host allowlist)", () => {
    const req = buildEgressRequest({
      ...relay,
      token: "t",
      path: "/account/xyz/transactions",
      options: { method: "GET" },
    });
    const env = JSON.parse(req.body);
    expect(env).toEqual({
      method: "GET",
      path: "/account/xyz/transactions",
      body: null,
    });
    // path is relative — relay re-hosts onto api.mercury.com; no caller host leaks
    expect(env.path.startsWith("/")).toBe(true);
    expect(JSON.stringify(env)).not.toContain("mercury.com");
  });

  it("does NOT leak the Mercury token into the body — header only", () => {
    const req = buildEgressRequest({
      ...relay,
      token: "secret_tok",
      path: "/accounts",
    });
    expect(req.body).not.toContain("secret_tok");
    expect(req.headers["X-Mercury-Token"]).toBe("secret_tok");
  });

  it("rejects an absolute URL as path (host/URL injection guard)", () => {
    expect(() =>
      buildEgressRequest({ ...relay, token: "t", path: "https://evil.com/x" }),
    ).toThrow(/relative API path/);
  });

  it("rejects a protocol-relative (//host) path", () => {
    expect(() =>
      buildEgressRequest({ ...relay, token: "t", path: "//evil.com/accounts" }),
    ).toThrow(/relative API path/);
  });

  it("rejects a path-traversal (..) path", () => {
    expect(() =>
      buildEgressRequest({ ...relay, token: "t", path: "/a/../../b" }),
    ).toThrow(/relative API path/);
  });

  it("rejects a non-string / schemed path", () => {
    expect(() =>
      buildEgressRequest({ ...relay, token: "t", path: "accounts" }),
    ).toThrow(/relative API path/);
    expect(() =>
      buildEgressRequest({ ...relay, token: "t", path: 42 }),
    ).toThrow(/relative API path/);
  });

  it("still accepts a legitimate relative path with query string", () => {
    const req = buildEgressRequest({
      ...relay,
      token: "t",
      path: "/account/abc/transactions?limit=10",
    });
    expect(JSON.parse(req.body).path).toBe(
      "/account/abc/transactions?limit=10",
    );
  });

  it("fails closed when relay is selected but MERCURY_EGRESS_URL is unset", () => {
    expect(() =>
      buildEgressRequest({ profile: "relay", token: "t", path: "/accounts" }),
    ).toThrow(/MERCURY_EGRESS_URL is not configured/);
  });

  it("does NOT silently fall back to direct on missing relay url", () => {
    let url;
    try {
      url = buildEgressRequest({
        profile: "relay",
        token: "t",
        path: "/accounts",
      }).url;
    } catch {
      url = undefined;
    }
    expect(url).toBeUndefined();
  });

  it("omits Access headers when they are not configured (relay may be Access-optional in test envs)", () => {
    const req = buildEgressRequest({
      profile: "relay",
      relayUrl: "https://egress.chitty.cc/mercury",
      token: "t",
      path: "/accounts",
    });
    expect(req.headers["CF-Access-Client-Id"]).toBeUndefined();
    expect(req.headers["CF-Access-Client-Secret"]).toBeUndefined();
    expect(req.headers["X-Mercury-Token"]).toBe("t");
  });
});

// INTEGRATION NOTE (deferred):
// The relay HTTP round-trip (POST to MERCURY_EGRESS_URL → forward → Mercury)
// cannot be exercised mock-free until the egress node exists. When the
// reserved-IP app-connector is provisioned, add an integration test that
// POSTs a real /accounts call through MERCURY_EGRESS_URL with valid
// CF-Access-Client-Id/Secret and asserts a 200 + accounts payload. Until then
// the pure request-construction logic above is fully covered.
