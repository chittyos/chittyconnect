// Runtime credential custody regression: real loopback HTTP; no module mocks.
// The browser/Worker never persists source or broker credential values in KV.
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ChittyServClient } from "../../src/services/chittyserv-client.js";
import { OnePasswordConnectClient } from "../../src/services/chittysecrets-connect-client.js";

let server;
let endpoint;
const calls = { serv: 0, legacy: 0, health: 0, bearerReads: 0 };

function noCredentialCache() {
  const deny = () => { throw new Error("CREDENTIAL_CACHE MUST NOT be accessed"); };
  return { get: deny, put: deny, delete: deny };
}

async function openBackend() {
  server = createServer(async (req, res) => {
    const send = (code, body) => {
      res.statusCode = code;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };

    if (req.url === "/health") {
      calls.health++;
      return send(200, {
        status: "ok",
        service: "chittyserv",
        auth: "required",
        backend: { credentials: "configured" },
      });
    }

    if (req.url?.startsWith("/v1/credentials/")) {
      calls.serv++;
      if (req.headers.authorization !== "Bearer synthetic-runtime-token") {
        return send(401, { error: "bad bearer" });
      }
      if (req.url === "/v1/credentials/services/missing/token") {
        return send(404, { error: "sensitive-error-body-do-not-echo" });
      }
      if (req.url === "/v1/credentials/services/example/token") {
        return send(200, { success: true, value: "synthetic-secret-value" });
      }
      return send(404, { error: "missing" });
    }

    if (req.url === "/mcp?action=reveal") {
      calls.legacy++;
      if (req.headers["cf-access-client-id"] !== "synthetic-cf-client" ||
          req.headers["cf-access-client-secret"] !== "synthetic-cf-secret") {
        return send(403, { error: "bad Access credentials" });
      }
      if (req.method !== "POST") return send(405, { error: "use POST" });
      return send(200, { value: "synthetic-secret-value" });
    }

    return send(404, { error: "not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  calls.serv = calls.legacy = calls.health = calls.bearerReads = 0;
});

describe("ChittyServ runtime-only credentials", () => {
  it("uses a live broker call per operation and never accesses KV", async () => {
    await openBackend();
    const c = new ChittyServClient({
      CHITTYSERV_URL: endpoint + "/",
      CHITTY_SERV_TOKEN: {
        get: async () => {
          calls.bearerReads++;
          return "synthetic-runtime-token";
        },
      },
      CREDENTIAL_CACHE: noCredentialCache(),
    });

    expect(await c.get("services/example/token")).toBe("synthetic-secret-value");
    expect(await c.get("services/example/token")).toBe("synthetic-secret-value");
    expect(calls.serv).toBe(2);
    expect(calls.bearerReads).toBe(2);
    expect((await c.healthCheck()).status).toBe("healthy");
    expect(calls.health).toBe(1);
    await c.invalidateCache("services/example/token");
  });

  it("fails closed when the authentication binding is missing or malformed", async () => {
    await openBackend();
    for (const token of [undefined, { get: async () => ({ secret: "bad" }) }, ""]) {
      const c = new ChittyServClient({
        CHITTYSERV_URL: endpoint,
        CHITTY_SERV_TOKEN: token,
        CREDENTIAL_CACHE: noCredentialCache(),
      });
      await expect(c.get("services/example/token")).rejects.toThrow(/authentication binding/);
    }
    expect(calls.serv).toBe(0);
  });

  it("rejects lossy path segments before sending a request", async () => {
    await openBackend();
    const c = new ChittyServClient({
      CHITTYSERV_URL: endpoint,
      CHITTY_SERV_TOKEN: "synthetic-runtime-token",
      CREDENTIAL_CACHE: noCredentialCache(),
    });
    for (const p of ["../example/token", "services/one-two/token", "services//token", "services/example", "emergency/../token"]) {
      await expect(c.get(p)).rejects.toThrow(/credential reference/);
    }
    expect(calls.serv).toBe(0);
  });

  it("preserves 404 classification but never copies upstream error bodies", async () => {
    await openBackend();
    const c = new ChittyServClient({
      CHITTYSERV_URL: endpoint,
      CHITTY_SERV_TOKEN: "synthetic-runtime-token",
      CREDENTIAL_CACHE: noCredentialCache(),
    });
    try {
      await c.get("services/missing/token");
      throw new Error("expected failure");
    } catch (error) {
      expect(error.code).toBe("CREDENTIAL_NOT_FOUND");
      expect(error.message).not.toContain("sensitive-error-body-do-not-echo");
    }
    expect(calls.serv).toBe(1);
  });
});

describe("legacy ChittySecrets backend is runtime-only", () => {
  it("does not use encrypted or plaintext KV for repeated successful retrieval", async () => {
    await openBackend();
    const c = new OnePasswordConnectClient({
      CHITTYSECRETS_URL: endpoint,
      CF_ACCESS_CLIENT_ID: "synthetic-cf-client",
      CF_ACCESS_CLIENT_SECRET: "synthetic-cf-secret",
      CREDENTIAL_CACHE: noCredentialCache(),
      CREDENTIAL_FAILOVER_ENABLED: "false",
    });
    expect(await c.get("services/chittyid/service_token")).toBe("synthetic-secret-value");
    expect(await c.get("services/chittyid/service_token")).toBe("synthetic-secret-value");
    expect(calls.legacy).toBe(2);
    await c.invalidateCache("services/chittyid/service_token");
  });
});
