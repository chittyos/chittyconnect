import { describe, it, expect, afterEach } from "vitest";
import {
  thirdpartyRoutes,
  brokerMercuryFetch,
  resolveMercuryReadCredential,
  WRITE_TOKEN_READ_CODES,
  MERCURY_READ_REFERENCES,
  MERCURY_WRITE_REFERENCES,
} from "../../src/api/routes/thirdparty.js";

// MNW and NAJB have no read token, so their read routes use the WRITE token,
// which is IP-allowlisted to the mercury-proxy relay. No network: the broker is
// a synthetic SVC_SECRETS fixture and fetch is replaced to record the request.

const RELAY = "https://mercury-proxy.chitty.cc/proxy";

function brokerEnv(overrides = {}) {
  const calls = [];
  const values = new Map([
    ["MERCURY_WRITE_TOKEN_MNW", "wt-mnw"],
    ["MERCURY_WRITE_TOKEN_NAJB", "wt-najb"],
    ["MERCURY_TOKEN_ARIBIA_LLC", "rt-aribia"],
    ["MERCURY_EGRESS_PROXY_TOKEN", "px"],
    ["MERCURY_EGRESS_ACCESS_CLIENT_ID", "aid"],
    ["MERCURY_EGRESS_ACCESS_CLIENT_SECRET", "as"],
  ]);
  const env = {
    MERCURY_EGRESS_PROFILE: "direct",
    MERCURY_EGRESS_URL: RELAY,
    SVC_SECRETS: {
      async resolveReference(input) {
        calls.push({ ...input });
        const value = values.get(input.secretName);
        if (!value) throw new Error(`missing synthetic fixture ${input.secretName}`);
        return { credentialRef: input.credentialRef, value };
      },
    },
    ...overrides,
  };
  return { env, calls };
}

const priorFetch = globalThis.fetch;
let requests;
function recordFetch() {
  requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ accounts: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
afterEach(() => {
  globalThis.fetch = priorFetch;
});

describe("write-token read codes", () => {
  it("is exactly MNW and NAJB", () => {
    expect([...WRITE_TOKEN_READ_CODES].sort()).toEqual(["MNW", "NAJB"]);
  });

  it("resolves MNW and NAJB read routes to the WRITE descriptor", () => {
    expect(resolveMercuryReadCredential("mnw")).toBe(MERCURY_WRITE_REFERENCES.MNW);
    expect(resolveMercuryReadCredential("NAJB")).toBe(MERCURY_WRITE_REFERENCES.NAJB);
  });

  it("leaves codes that have a read token on their read descriptor", () => {
    expect(resolveMercuryReadCredential("aribia-llc")).toBe(MERCURY_READ_REFERENCES.ARIBIA);
  });
});

describe("MNW / NAJB read routes", () => {
  for (const [code, token] of [["MNW", "wt-mnw"], ["NAJB", "wt-najb"]]) {
    it(`${code}: direct profile still goes via relay, GET envelope with /api/v1 path`, async () => {
      const { env, calls } = brokerEnv();
      recordFetch();
      const res = await thirdpartyRoutes.request(
        `/mercury/accounts?slug=${code.toLowerCase()}`, {}, env,
      );
      expect(res.status).toBe(200);

      expect(calls.find((c) => c.secretName.startsWith("MERCURY_WRITE_TOKEN_"))).toEqual({
        secretName: `MERCURY_WRITE_TOKEN_${code}`,
        credentialRef: `chittysecrets://mercury/${code.toLowerCase()}/write`,
      });
      expect(requests).toHaveLength(1);
      const req = requests[0];
      expect(req.url).toBe(RELAY);
      expect(req.init.method).toBe("POST");
      expect(req.init.headers["X-Mercury-Token"]).toBe(token);
      expect(req.init.headers.Authorization).toBe("Bearer px");
      expect(JSON.parse(req.init.body)).toEqual({
        method: "GET",
        path: "/api/v1/accounts",
        body: null,
      });
    });
  }

  it("a per-slug direct override does not pull the write token off the relay", async () => {
    const { env } = brokerEnv({ MERCURY_EGRESS_PROFILE_MNW: "direct" });
    recordFetch();
    const res = await thirdpartyRoutes.request("/mercury/organization?slug=mnw", {}, env);
    expect(res.status).toBe(200);
    expect(requests[0].url).toBe(RELAY);
    expect(JSON.parse(requests[0].init.body).path).toBe("/api/v1/organization");
  });

  it("fails closed with no relay URL configured — no fetch, no token hydration", async () => {
    const { env, calls } = brokerEnv({ MERCURY_EGRESS_URL: undefined });
    recordFetch();
    const res = await thirdpartyRoutes.request("/mercury/accounts?slug=najb", {}, env);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/MERCURY_EGRESS_URL is not configured/);
    expect(requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("GET-only guard on write-token reads", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    it(`rejects ${method} before any broker or network I/O`, async () => {
      const { env, calls } = brokerEnv();
      recordFetch();
      await expect(
        brokerMercuryFetch(env, MERCURY_WRITE_REFERENCES.MNW, "/accounts", { method }),
      ).rejects.toThrow(/permit only GET/);
      expect(calls).toHaveLength(0);
      expect(requests).toHaveLength(0);
    });
  }
});

describe("codes with a read token are unchanged", () => {
  it("ARIBIA reads with its read token on the direct profile", async () => {
    const { env, calls } = brokerEnv();
    recordFetch();
    const res = await thirdpartyRoutes.request("/mercury/accounts?slug=aribia", {}, env);
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        secretName: "MERCURY_TOKEN_ARIBIA_LLC",
        credentialRef: "chittysecrets://mercury/aribia/read",
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.mercury.com/api/v1/accounts");
    expect(requests[0].init.method).toBe("GET");
    expect(requests[0].init.headers.Authorization).toBe("Bearer rt-aribia");
  });
});
