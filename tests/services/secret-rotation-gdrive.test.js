import { describe, it, expect, vi, beforeEach } from "vitest";

// -----------------------------------------------------------------------
// Mock jwt-helper so _rotateViaServiceAccount doesn't need real crypto
// -----------------------------------------------------------------------
vi.mock("../../src/services/jwt-helper.js", () => ({
  createJwt: vi.fn().mockResolvedValue("signed.jwt.token"),
}));

import { createJwt } from "../../src/services/jwt-helper.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { SecretRotationService } = await import("../../src/services/secret-rotation.js");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeKV(kvValues = {}) {
  return {
    get: vi.fn().mockImplementation(async (key) => kvValues[key] ?? null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
  };
}

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: makeKV(),
    GDRIVE_CLIENT_ID: "client-id",
    GDRIVE_CLIENT_SECRET: "client-secret",
    ...overrides,
  };
}

function makeService(kvValues = {}, envOverrides = {}) {
  const kv = makeKV(kvValues);
  const env = { ...makeEnv(envOverrides), CREDENTIAL_CACHE: kv };
  const svc = new SecretRotationService(env);
  return { svc, kv, env };
}

const VALID_SA_JSON = JSON.stringify({
  client_email: "svc@project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIFake\n-----END PRIVATE KEY-----",
  impersonate: "user@domain.com",
  scopes: "https://www.googleapis.com/auth/drive",
});

function oauthOk(accessToken = "new-access-token", expiresIn = 3600) {
  return {
    ok: true,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
    text: async () => "",
  };
}

function oauthError(status, body = "OAuth error") {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  };
}

// -----------------------------------------------------------------------
// rotateGDriveToken — service account primary path
// -----------------------------------------------------------------------

describe("rotateGDriveToken — service account path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses service account when KV has secret:gdrive:service_account", async () => {
    const { svc, kv } = makeService({
      "secret:gdrive:service_account": VALID_SA_JSON,
    });
    mockFetch.mockResolvedValueOnce(oauthOk("sa-access-token", 3600));

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("service_account");
    // Should NOT look for refresh_token
    const getCalls = kv.get.mock.calls.map(([k]) => k);
    expect(getCalls).toContain("secret:gdrive:service_account");
    expect(getCalls).not.toContain("secret:gdrive:refresh_token");
  });

  it("does not fall back to refresh_token path when service_account is present", async () => {
    const { svc } = makeService({
      "secret:gdrive:service_account": VALID_SA_JSON,
      "secret:gdrive:refresh_token": "some-refresh-token",
    });
    mockFetch.mockResolvedValueOnce(oauthOk());

    const result = await svc.rotateGDriveToken();

    expect(result.method).toBe("service_account");
    // fetch should use jwt-bearer grant type, not refresh_token
    const body = mockFetch.mock.calls[0][1].body.toString();
    expect(body).toContain("jwt-bearer");
    expect(body).not.toContain("refresh_token");
  });
});

// -----------------------------------------------------------------------
// rotateGDriveToken — OAuth refresh token fallback path
// -----------------------------------------------------------------------

describe("rotateGDriveToken — refresh token path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses refresh_token when no service_account is configured", async () => {
    const { svc } = makeService(
      { "secret:gdrive:refresh_token": "rt-token" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );
    mockFetch.mockResolvedValueOnce(oauthOk("oauth-access-token", 3600));

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("refresh_token");
    expect(result.expiresIn).toBe(3600);
  });

  it("posts to Google OAuth2 token endpoint with correct params", async () => {
    const { svc } = makeService(
      { "secret:gdrive:refresh_token": "my-refresh-token" },
      { GDRIVE_CLIENT_ID: "my-client-id", GDRIVE_CLIENT_SECRET: "my-client-secret" },
    );
    mockFetch.mockResolvedValueOnce(oauthOk());

    await svc.rotateGDriveToken();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const reqBody = mockFetch.mock.calls[0][1].body.toString();
    expect(reqBody).toContain("grant_type=refresh_token");
    expect(reqBody).toContain("refresh_token=my-refresh-token");
    expect(reqBody).toContain("client_id=my-client-id");
    expect(reqBody).toContain("client_secret=my-client-secret");
  });

  it("caches access token in KV with TTL = expiresIn - 120", async () => {
    const { svc, kv } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );
    mockFetch.mockResolvedValueOnce(oauthOk("token-abc", 3600));

    await svc.rotateGDriveToken();

    expect(kv.put).toHaveBeenCalledWith("secret:gdrive:access_token", "token-abc", {
      expirationTtl: 3480, // 3600 - 120
    });
  });

  it("enforces minimum TTL of 300 when expiresIn is very short", async () => {
    const { svc, kv } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );
    // expiresIn=300 → 300-120=180, but min is 300
    mockFetch.mockResolvedValueOnce(oauthOk("short-token", 300));

    await svc.rotateGDriveToken();

    expect(kv.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "short-token",
      { expirationTtl: 300 },
    );
  });

  it("uses default expiresIn of 3600 when Google response omits expires_in", async () => {
    const { svc, kv } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok-no-expiry" }),
      text: async () => "",
    });

    const result = await svc.rotateGDriveToken();

    expect(result.expiresIn).toBe(3600);
    expect(kv.put).toHaveBeenCalledWith("secret:gdrive:access_token", "tok-no-expiry", {
      expirationTtl: 3480,
    });
  });

  it("returns error when refresh_token is missing", async () => {
    const { svc } = makeService(
      {}, // no service_account, no refresh_token
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing GDrive credentials");
    expect(result.error).toContain("service_account");
    expect(result.error).toContain("OAuth refresh_token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error when GDRIVE_CLIENT_ID is missing", async () => {
    const { svc } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: undefined, GDRIVE_CLIENT_SECRET: "csecret" },
    );

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing GDrive credentials");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error when GDRIVE_CLIENT_SECRET is missing", async () => {
    const { svc } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: undefined },
    );

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing GDrive credentials");
  });

  it("returns error on Google OAuth2 HTTP failure", async () => {
    const { svc } = makeService(
      { "secret:gdrive:refresh_token": "rt" },
      { GDRIVE_CLIENT_ID: "cid", GDRIVE_CLIENT_SECRET: "csecret" },
    );
    mockFetch.mockResolvedValueOnce(oauthError(401, "invalid_grant"));

    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Google OAuth2 error: 401");
    expect(result.error).toContain("invalid_grant");
  });
});

// -----------------------------------------------------------------------
// _rotateViaServiceAccount
// -----------------------------------------------------------------------

describe("_rotateViaServiceAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJwt.mockResolvedValue("signed.jwt.token");
  });

  it("returns error for invalid JSON input", async () => {
    const { svc } = makeService();

    const result = await svc._rotateViaServiceAccount("this is not JSON{{{");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid service_account JSON in KV");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls createJwt with correct claims from service account", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce(oauthOk("sa-token", 3600));

    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(createJwt).toHaveBeenCalledTimes(1);
    const [claims, privateKey] = createJwt.mock.calls[0];

    expect(claims.iss).toBe("svc@project.iam.gserviceaccount.com");
    expect(claims.sub).toBe("user@domain.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(privateKey).toContain("PRIVATE KEY");
  });

  it("posts signed JWT to Google OAuth2 token endpoint", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce(oauthOk("sa-token", 3600));

    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = mockFetch.mock.calls[0][1].body.toString();
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(body).toContain("assertion=signed.jwt.token");
  });

  it("caches access token in KV with TTL on success", async () => {
    const { svc, kv } = makeService();
    mockFetch.mockResolvedValueOnce(oauthOk("sa-access-token", 3600));

    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(kv.put).toHaveBeenCalledWith("secret:gdrive:access_token", "sa-access-token", {
      expirationTtl: 3480, // 3600 - 120
    });
  });

  it("returns ok:true with method:service_account on success", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce(oauthOk("sa-token", 3600));

    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(true);
    expect(result.method).toBe("service_account");
    expect(result.expiresIn).toBe(3600);
  });

  it("returns error when Google OAuth2 responds with error", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce(oauthError(400, "invalid_grant: Service account not found"));

    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Service account JWT error: 400");
    expect(result.error).toContain("invalid_grant");
  });

  it("enforces minimum TTL of 300 for short-lived service account tokens", async () => {
    const { svc, kv } = makeService();
    // expiresIn=200 → 200-120=80, min is 300
    mockFetch.mockResolvedValueOnce(oauthOk("short-sa-token", 200));

    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(kv.put).toHaveBeenCalledWith("secret:gdrive:access_token", "short-sa-token", {
      expirationTtl: 300,
    });
  });

  it("uses default expiresIn of 3600 when Google response omits expires_in", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
      text: async () => "",
    });

    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.expiresIn).toBe(3600);
  });

  it("includes Content-Type: application/x-www-form-urlencoded in request", async () => {
    const { svc } = makeService();
    mockFetch.mockResolvedValueOnce(oauthOk());

    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("handles service account JSON with missing fields gracefully", async () => {
    const { svc } = makeService();
    // Minimal SA JSON — missing impersonate, scopes
    const minimalSa = JSON.stringify({ client_email: "svc@proj.iam", private_key: "key" });
    mockFetch.mockResolvedValueOnce(oauthOk("tok", 3600));

    const result = await svc._rotateViaServiceAccount(minimalSa);

    // Should still call createJwt and return ok if Google responds ok
    expect(createJwt).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Constructor
// -----------------------------------------------------------------------

describe("SecretRotationService constructor", () => {
  it("throws when CREDENTIAL_CACHE is not bound", () => {
    expect(() => new SecretRotationService({})).toThrow(
      "CREDENTIAL_CACHE KV binding is not configured",
    );
  });

  it("constructs successfully when CREDENTIAL_CACHE is present", () => {
    const env = { CREDENTIAL_CACHE: makeKV() };
    expect(() => new SecretRotationService(env)).not.toThrow();
  });
});
