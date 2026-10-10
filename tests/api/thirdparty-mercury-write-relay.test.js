import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MERCURY_WRITE_REFERENCES,
  resolveWriteCredentialReference,
  resolveEgressProfile,
  buildEgressRequest,
  mercuryWrite,
} from "../../src/api/routes/thirdparty.js";

const CODES = ["ARIBIA", "APT", "CITY", "FC", "CHIT", "ICB", "JAVL", "MNW", "NAJB"];

function brokerEnv() {
  const calls = [];
  const values = new Map([
    ["MERCURY_WRITE_TOKEN_FC", "synthetic-write-fc"],
    ["MERCURY_EGRESS_PROXY_TOKEN", "synthetic-proxy"],
    ["MERCURY_EGRESS_ACCESS_CLIENT_ID", "synthetic-access-id"],
    ["MERCURY_EGRESS_ACCESS_CLIENT_SECRET", "synthetic-access-secret"],
  ]);
  const env = {
    MERCURY_EGRESS_PROFILE: "direct",
    MERCURY_EGRESS_URL: "https://mercury-proxy.chitty.cc/proxy",
    SVC_SECRETS: {
      async resolveReference(input) {
        calls.push({ ...input });
        const value = values.get(input.secretName);
        if (!value) throw new Error(`missing synthetic fixture ${input.secretName}`);
        return { credentialRef: input.credentialRef, value };
      },
    },
  };
  return { env, calls };
}

describe("Mercury write credential references", () => {
  it("maps exactly the nine canonical codes to stable ChittySecrets references", () => {
    expect(Object.keys(MERCURY_WRITE_REFERENCES).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      const ref = resolveWriteCredentialReference(code);
      expect(ref.secretName).toBe(`MERCURY_WRITE_TOKEN_${code}`);
      expect(ref.credentialRef).toMatch(/^chittysecrets:\/\/mercury\/[a-z]+\/write$/);
    }
  });

  it("is case-insensitive on the code", () => {
    expect(resolveWriteCredentialReference(" icb ")).toBe(MERCURY_WRITE_REFERENCES.ICB);
  });

  it("fails closed on unknown codes, including APTA and prototype keys", () => {
    for (const bad of ["APTA", "", undefined, null, "constructor", "__proto__", "ARIBIA_LLC"]) {
      expect(() => resolveWriteCredentialReference(bad)).toThrow(/Unknown Mercury write code/);
    }
  });
});

describe("brokered write execution", () => {
  it("rejects every method outside the explicit mutation allowlist before broker/network I/O", async () => {
    const { env, calls } = brokerEnv();
    for (const method of ["GET", "HEAD", "OPTIONS", "TRACE", "CONNECT"]) {
      await expect(mercuryWrite(env, "FC", "/accounts", { method })).rejects.toThrow(/only permits/);
    }
    expect(calls).toHaveLength(0);
  });

  it("hydrates all credentials through SVC_SECRETS and immediately inserts them into the relay request", async () => {
    const { env, calls } = brokerEnv();
    const requests = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await expect(
        mercuryWrite(env, "FC", "/account/abc/transactions", {
          method: "POST",
          body: { amount: 1 },
        }),
      ).resolves.toEqual({ ok: true });
    } finally {
      globalThis.fetch = priorFetch;
    }

    expect(calls).toEqual([
      {
        secretName: "MERCURY_WRITE_TOKEN_FC",
        credentialRef: "chittysecrets://mercury/fc/write",
      },
      {
        secretName: "MERCURY_EGRESS_ACCESS_CLIENT_ID",
        credentialRef: "chittysecrets://mercury/egress/access-client-id",
      },
      {
        secretName: "MERCURY_EGRESS_ACCESS_CLIENT_SECRET",
        credentialRef: "chittysecrets://mercury/egress/access-client-secret",
      },
      {
        secretName: "MERCURY_EGRESS_PROXY_TOKEN",
        credentialRef: "chittysecrets://mercury/egress/proxy-token",
      },
    ]);

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.url).toBe("https://mercury-proxy.chitty.cc/proxy");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers.Authorization).toBe("Bearer synthetic-proxy");
    expect(req.init.headers["CF-Access-Client-Id"]).toBe("synthetic-access-id");
    expect(req.init.headers["CF-Access-Client-Secret"]).toBe("synthetic-access-secret");
    expect(req.init.headers["X-Mercury-Token"]).toBe("synthetic-write-fc");
  });

  it("fails closed if the private ChittySecrets broker binding is unavailable", async () => {
    await expect(
      mercuryWrite(
        { MERCURY_EGRESS_URL: "https://mercury-proxy.chitty.cc/proxy" },
        "FC",
        "/webhooks",
        { method: "POST", body: {} },
      ),
    ).rejects.toThrow(/POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE/);
  });
});

describe("egress request construction", () => {
  it("relay request keeps the static-egress and Access layers", () => {
    const req = buildEgressRequest({
      profile: "relay",
      relayUrl: "https://mercury-proxy.chitty.cc/proxy",
      accessClientId: "synthetic-access-id",
      accessClientSecret: "synthetic-access-secret",
      proxyToken: "synthetic-proxy",
      token: "synthetic-write-fc",
      path: "/account/abc/transactions",
      options: { method: "POST", body: { amount: 1 } },
    });
    expect(req.headers.Authorization).toBe("Bearer synthetic-proxy");
    expect(req.headers["CF-Access-Client-Id"]).toBe("synthetic-access-id");
    expect(req.headers["CF-Access-Client-Secret"]).toBe("synthetic-access-secret");
    expect(req.headers["X-Mercury-Token"]).toBe("synthetic-write-fc");
  });

  it("read egress profile carries config only, never credential material", () => {
    const profile = resolveEgressProfile(
      {
        MERCURY_EGRESS_PROFILE: "direct",
        MERCURY_EGRESS_ACCESS_CLIENT_ID: "must-not-be-read",
        MERCURY_EGRESS_PROXY_TOKEN: "must-not-be-read",
      },
      "fc",
    );
    expect(profile).toEqual({ profile: "direct", relayUrl: undefined });
  });
});

describe("wrangler Mercury credential isolation", () => {
  const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  const envStart = wrangler.indexOf('"env": {');
  const devStart = wrangler.indexOf('"dev": {', envStart);
  const stagingStart = wrangler.indexOf('"staging": {', devStart);
  const productionStart = wrangler.indexOf('"production": {', stagingStart);

  const top = wrangler.slice(0, envStart);
  const dev = wrangler.slice(devStart, stagingStart);
  const staging = wrangler.slice(stagingStart, productionStart);
  const production = wrangler.slice(productionStart);

  it("declares no direct Mercury secret-store bindings anywhere in ChittyConnect", () => {
    expect(wrangler).not.toMatch(/"binding":\s*"MERCURY_/);
  });

  it("binds only production to the verified ChittySecrets RPC target", () => {
    expect(top).not.toContain('"binding": "SVC_SECRETS"');
    expect(dev).not.toContain('"binding": "SVC_SECRETS"');
    expect(staging).not.toContain('"binding": "SVC_SECRETS"');
    expect(production).toContain(
      '{ "binding": "SVC_SECRETS", "service": "chittysecrets", "entrypoint": "ChittyConnectInjectionBroker" }',
    );
  });

  it("does not route dev or staging to the production Mercury relay", () => {
    const productionRelay = '"MERCURY_EGRESS_URL": "https://mercury-proxy.chitty.cc/proxy"';
    expect(dev).not.toContain(productionRelay);
    expect(staging).not.toContain(productionRelay);
    expect(production).toContain(productionRelay);
  });
});
