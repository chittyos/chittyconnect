import { describe, it, expect } from "vitest";
import {
  MERCURY_WRITE_BINDINGS,
  resolveWriteBindingName,
  resolveWriteToken,
  resolveWriteEgress,
  buildEgressRequest,
} from "../../src/api/routes/thirdparty.js";

// #328: Mercury writes go through the mercury-proxy relay. Pure-function tests
// (no mocks). Secrets Store bindings are shaped as { get(): Promise<string> }
// using obviously synthetic values.

const CODES = ["ARIBIA", "APT", "CITY", "FC", "CHIT", "ICB", "JAVL", "MNW", "NAJB"];

describe("write token code map", () => {
  it("maps exactly the nine codes to MERCURY_WRITE_TOKEN_<CODE>", () => {
    expect(Object.keys(MERCURY_WRITE_BINDINGS).sort()).toEqual([...CODES].sort());
    for (const c of CODES) {
      expect(resolveWriteBindingName(c)).toBe(`MERCURY_WRITE_TOKEN_${c}`);
    }
  });

  it("is case-insensitive on the code", () => {
    expect(resolveWriteBindingName(" icb ")).toBe("MERCURY_WRITE_TOKEN_ICB");
  });

  it("fails closed on unknown codes, including APTA and prototype keys", () => {
    for (const bad of ["APTA", "", undefined, null, "constructor", "__proto__", "ARIBIA_LLC", "MERCURY_TOKEN_ARIBIA_LLC"]) {
      expect(() => resolveWriteBindingName(bad)).toThrow(/Unknown Mercury write code/);
    }
  });

  it("resolves the token from a Secrets Store style binding", async () => {
    const env = { MERCURY_WRITE_TOKEN_FC: { get: async () => "write-token-fc" } };
    expect(await resolveWriteToken(env, "fc")).toBe("write-token-fc");
  });

  it("does not fall back to another code's binding or the read token", async () => {
    const env = {
      MERCURY_WRITE_TOKEN_FC: { get: async () => "write-token-fc" },
      MERCURY_TOKEN_ARIBIA_LLC: { get: async () => "read-token" },
    };
    await expect(resolveWriteToken(env, "ARIBIA")).rejects.toThrow(/not available/);
    await expect(resolveWriteToken(env, "NOPE")).rejects.toThrow(/Unknown/);
  });
});

describe("write egress + bearer header", () => {
  const env = {
    MERCURY_EGRESS_PROFILE: "direct", // reads stay direct; writes ignore this
    MERCURY_EGRESS_URL: "https://mercury-proxy.chitty.cc/proxy",
    MERCURY_EGRESS_PROXY_TOKEN: { get: async () => "proxy-bearer" },
    MERCURY_EGRESS_ACCESS_CLIENT_ID: { get: async () => "access-id" },
    MERCURY_EGRESS_ACCESS_CLIENT_SECRET: { get: async () => "access-secret" },
  };

  it("always selects the relay for writes even when profile is direct", async () => {
    const eg = await resolveWriteEgress(env);
    expect(eg.profile).toBe("relay");
    expect(eg.relayUrl).toBe("https://mercury-proxy.chitty.cc/proxy");
  });

  it("fails closed when MERCURY_EGRESS_URL is unset", async () => {
    await expect(resolveWriteEgress({ ...env, MERCURY_EGRESS_URL: "" })).rejects.toThrow(/relay/);
  });

  it("sends Authorization: Bearer proxy token plus CF-Access headers and X-Mercury-Token", async () => {
    const eg = await resolveWriteEgress(env);
    const req = buildEgressRequest({
      ...eg,
      token: "write-token-fc",
      path: "/account/abc/transactions",
      options: { method: "POST", body: { amount: 1 } },
    });
    expect(req.url).toBe("https://mercury-proxy.chitty.cc/proxy");
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bearer proxy-bearer");
    expect(req.headers["CF-Access-Client-Id"]).toBe("access-id");
    expect(req.headers["CF-Access-Client-Secret"]).toBe("access-secret");
    expect(req.headers["X-Mercury-Token"]).toBe("write-token-fc");
    expect(JSON.parse(req.body)).toEqual({
      method: "POST",
      path: "/account/abc/transactions",
      body: { amount: 1 },
    });
  });

  it("direct reads never carry the proxy bearer", () => {
    const req = buildEgressRequest({
      profile: "direct",
      proxyToken: "proxy-bearer",
      token: "read-token",
      path: "/accounts",
    });
    expect(req.headers.Authorization).toBe("Bearer read-token");
  });
});
