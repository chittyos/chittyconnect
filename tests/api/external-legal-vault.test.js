import { describe, it, expect } from "vitest";
import {
  LegalVaultConnectorError,
  buildLegalVaultReadUrl,
  getLegalVaultConfig,
  legalVaultPrincipalAuthorized,
  proxyLegalVaultResponse,
  readLegalVault,
  resolveLegalVaultPassword,
} from "../../src/integrations/external-legal-vault.js";

function baseEnv(overrides = {}) {
  const brokerCalls = [];
  const env = {
    LEGAL_VAULT_BASE_URL: "https://vault.example.test",
    LEGAL_VAULT_PATH_PREFIX: "/client",
    LEGAL_VAULT_ALLOWED_HOSTS: "vault.example.test,auth.example.test",
    LEGAL_VAULT_ALLOWED_PRINCIPALS: "user:test",
    LEGAL_VAULT_LOGIN_EMAIL: "user@example.test",
    LEGAL_VAULT_LOGIN_MODE: "auto",
    LEGAL_VAULT_PASSWORD_SECRET_NAME: "EXTERNAL_LEGAL_VAULT_PASSWORD",
    LEGAL_VAULT_PASSWORD_CREDENTIAL_REF:
      "chittysecrets://legal-vault/example/password",
    SVC_SECRETS: {
      async resolveReference(input) {
        brokerCalls.push({ ...input });
        return {
          credentialRef: input.credentialRef,
          value: "synthetic-password",
        };
      },
    },
    ...overrides,
  };
  return { env, brokerCalls };
}

describe("external legal-vault configuration", () => {
  it("confines reads to the configured host and path prefix", () => {
    const { env } = baseEnv();
    const config = getLegalVaultConfig(env);

    expect(buildLegalVaultReadUrl(config, "documents/1").href).toBe(
      "https://vault.example.test/client/documents/1",
    );
    expect(() =>
      buildLegalVaultReadUrl(config, "https://other.example.test/client"),
    ).toThrow(/allowlisted/);
    expect(() => buildLegalVaultReadUrl(config, "/outside")).toThrow(
      /outside the configured vault path/,
    );
  });

  it("requires an HTTPS base URL without embedded credentials", () => {
    const { env } = baseEnv({
      LEGAL_VAULT_BASE_URL: "http://vault.example.test",
    });
    expect(() => getLegalVaultConfig(env)).toThrow(/HTTPS URL/);
  });

  it("authorizes only runtime-configured principals", () => {
    const { env } = baseEnv();
    expect(
      legalVaultPrincipalAuthorized({ userId: "user:test" }, env),
    ).toBe(true);
    expect(
      legalVaultPrincipalAuthorized({ userId: "user:other" }, env),
    ).toBe(false);
    expect(legalVaultPrincipalAuthorized({ name: "user:test" }, env)).toBe(false);
    expect(legalVaultPrincipalAuthorized({ type: "oauth" }, env)).toBe(false);
  });
});

describe("external legal-vault secret broker", () => {
  it("resolves only the configured ChittySecrets reference", async () => {
    const { env, brokerCalls } = baseEnv();
    const config = getLegalVaultConfig(env);
    const value = await resolveLegalVaultPassword(env, config);

    expect(value).toBe("synthetic-password");
    expect(brokerCalls).toEqual([
      {
        secretName: "EXTERNAL_LEGAL_VAULT_PASSWORD",
        credentialRef: "chittysecrets://legal-vault/example/password",
      },
    ]);
  });

  it("fails closed when the broker returns a different reference", async () => {
    const { env } = baseEnv({
      SVC_SECRETS: {
        async resolveReference() {
          return {
            credentialRef: "chittysecrets://wrong/reference",
            value: "synthetic-password",
          };
        },
      },
    });
    await expect(resolveLegalVaultPassword(env)).rejects.toMatchObject({
      code: "LEGAL_VAULT_CREDENTIAL_UNAVAILABLE",
      status: 503,
    });
  });

  it("validates the target before broker or network I/O", async () => {
    const { env, brokerCalls } = baseEnv();
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    };

    await expect(
      readLegalVault(env, {
        path: "https://evil.example/client",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(LegalVaultConnectorError);

    expect(brokerCalls).toHaveLength(0);
    expect(fetchCalls).toBe(0);
  });
});

describe("external legal-vault authentication", () => {
  it("detects HTTP Basic and retries without exposing the password", async () => {
    const { env, brokerCalls } = baseEnv();
    const requests = [];
    const fetchImpl = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return new Response("auth required", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="vault"' },
        });
      }
      return new Response("document-index", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    };

    const response = await readLegalVault(env, { fetchImpl });
    expect(await response.text()).toBe("document-index");
    expect(brokerCalls).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[0].init.headers?.Authorization).toBeUndefined();
    expect(requests[1].init.headers.get("Authorization")).toMatch(/^Basic /);
    expect(requests[1].url).toBe("https://vault.example.test/client");
  });

  it("supports configured form login with request-local cookies", async () => {
    const { env } = baseEnv({
      LEGAL_VAULT_LOGIN_MODE: "form",
      LEGAL_VAULT_LOGIN_URL: "https://auth.example.test/login",
      LEGAL_VAULT_LOGIN_POST_URL: "https://auth.example.test/session",
      LEGAL_VAULT_USERNAME_FIELD: "login",
      LEGAL_VAULT_PASSWORD_FIELD: "password",
      LEGAL_VAULT_CSRF_FIELD: "csrf",
      LEGAL_VAULT_LOGIN_EXTRA_FIELDS: JSON.stringify({ action: "signin" }),
    });

    const requests = [];
    const fetchImpl = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return new Response(
          '<form><input type="hidden" name="csrf" value="token-1"><input type="password" name="password"></form>',
          {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              "Set-Cookie": "preauth=one; Path=/; Secure",
            },
          },
        );
      }
      if (requests.length === 2) {
        const body = new URLSearchParams(init.body);
        expect(body.get("login")).toBe("user@example.test");
        expect(body.get("password")).toBe("synthetic-password");
        expect(body.get("csrf")).toBe("token-1");
        expect(body.get("action")).toBe("signin");
        expect(init.headers.get("Cookie")).toContain("preauth=one");
        return new Response(null, {
          status: 204,
          headers: {
            "Set-Cookie": "session=two; Domain=example.test; Path=/; Secure",
          },
        });
      }
      expect(init.headers.get("Cookie")).toContain("session=two");
      return new Response("private-index", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    };

    const response = await readLegalVault(env, { fetchImpl });
    expect(await response.text()).toBe("private-index");
    expect(requests).toHaveLength(3);
    expect(requests[2].url).toBe("https://vault.example.test/client");
  });

  it("blocks cross-host redirects that would replay an authentication POST", async () => {
    const { env } = baseEnv({
      LEGAL_VAULT_LOGIN_MODE: "form",
      LEGAL_VAULT_LOGIN_URL: "https://auth.example.test/login",
      LEGAL_VAULT_LOGIN_POST_URL: "https://auth.example.test/session",
      LEGAL_VAULT_USERNAME_FIELD: "login",
      LEGAL_VAULT_PASSWORD_FIELD: "password",
    });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('<form><input type="password" name="password"></form>', {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(null, {
        status: 307,
        headers: { Location: "https://vault.example.test/session-continue" },
      });
    };

    await expect(readLegalVault(env, { fetchImpl })).rejects.toMatchObject({
      code: "LEGAL_VAULT_REDIRECT_BLOCKED",
      status: 502,
    });
    expect(calls).toBe(2);
  });

  it("does not allow extra form fields to override credential fields", async () => {
    const { env } = baseEnv({
      LEGAL_VAULT_LOGIN_MODE: "form",
      LEGAL_VAULT_LOGIN_URL: "https://auth.example.test/login",
      LEGAL_VAULT_USERNAME_FIELD: "login",
      LEGAL_VAULT_PASSWORD_FIELD: "password",
      LEGAL_VAULT_LOGIN_EXTRA_FIELDS: JSON.stringify({
        password: "not-allowed",
      }),
    });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('<form><input type="password" name="password"></form>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    await expect(readLegalVault(env, { fetchImpl })).rejects.toMatchObject({
      code: "LEGAL_VAULT_CONFIG_INVALID",
      status: 503,
    });
    expect(calls).toBe(1);
  });

  it("blocks redirects to a host outside the runtime allowlist", async () => {
    const { env } = baseEnv({ LEGAL_VAULT_LOGIN_MODE: "basic" });
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/steal" },
      });
    };

    await expect(readLegalVault(env, { fetchImpl })).rejects.toMatchObject({
      code: "LEGAL_VAULT_DESTINATION_BLOCKED",
    });
    expect(calls).toBe(1);
  });

  it("fails closed when auto-detection finds an unconfigured form protocol", async () => {
    const { env } = baseEnv();
    const fetchImpl = async () =>
      new Response('<form><input type="password" name="pw"></form>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    await expect(readLegalVault(env, { fetchImpl })).rejects.toMatchObject({
      code: "LEGAL_VAULT_PROTOCOL_UNCONFIGURED",
      status: 503,
    });
  });
});

describe("external legal-vault response boundary", () => {
  it("strips provider cookies and auth-adjacent headers", async () => {
    const source = new Response("ok", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Set-Cookie": "session=secret",
        "X-Provider-Session": "hidden",
        ETag: '"abc"',
      },
    });

    const proxied = proxyLegalVaultResponse(source);
    expect(proxied.headers.get("content-type")).toContain("text/plain");
    expect(proxied.headers.get("etag")).toBe('"abc"');
    expect(proxied.headers.get("set-cookie")).toBeNull();
    expect(proxied.headers.get("x-provider-session")).toBeNull();
    expect(proxied.headers.get("cache-control")).toBe("no-store");
  });
});
