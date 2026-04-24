/**
 * Tests for SecretRotationService — scoped to changes introduced in this PR:
 *   • rotateGDriveToken() — new service account primary path + updated error message
 *   • _rotateViaServiceAccount() — new method
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock jwt-helper so we don't need a real RSA key in these unit tests
// ---------------------------------------------------------------------------

vi.mock("../../src/services/jwt-helper.js", () => ({
  createJwt: vi.fn().mockResolvedValue("mock.signed.jwt"),
}));

import { createJwt } from "../../src/services/jwt-helper.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import the class under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { SecretRotationService } from "../../src/services/secret-rotation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockKV(overrides = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    ...overrides,
  };
}

function createMockEnv(kvOverrides = {}, envOverrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(kvOverrides),
    GDRIVE_CLIENT_ID: "test-client-id",
    GDRIVE_CLIENT_SECRET: "test-client-secret",
    ...envOverrides,
  };
}

const VALID_SA_JSON = JSON.stringify({
  client_email: "sa@project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIFake\n-----END PRIVATE KEY-----",
  impersonate: "admin@example.com",
  scopes: "https://www.googleapis.com/auth/drive",
});

// ---------------------------------------------------------------------------
// rotateGDriveToken — new service account primary path
// ---------------------------------------------------------------------------

describe("rotateGDriveToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the service account path when service_account JSON is in KV", async () => {
    const env = createMockEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:service_account") return VALID_SA_JSON;
      return null;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "sa-access-token", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("service_account");
    expect(result.expiresIn).toBe(3600);
  });

  it("falls back to OAuth2 refresh token path when service_account is absent", async () => {
    const env = createMockEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "refresh-tok";
      return null; // no service_account
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "oauth-access-token", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("refresh_token");
  });

  it("returns updated error message when neither credential is configured", async () => {
    const env = createMockEnv({}, { GDRIVE_CLIENT_ID: undefined, GDRIVE_CLIENT_SECRET: undefined });
    // KV returns null for everything
    const svc = new SecretRotationService(env);
    const result = await svc.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/service_account/);
    expect(result.error).toMatch(/refresh_token/);
  });

  it("prefers service account over refresh token when both are present", async () => {
    const env = createMockEnv();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:service_account") return VALID_SA_JSON;
      if (key === "secret:gdrive:refresh_token") return "should-not-be-used";
      return null;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "sa-token", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const result = await svc.rotateGDriveToken();

    expect(result.method).toBe("service_account");
    // Verify the grant_type sent was jwt-bearer not refresh_token
    const callArgs = mockFetch.mock.calls[0];
    const body = callArgs[1].body.toString();
    expect(body).toContain("jwt-bearer");
    expect(body).not.toContain("refresh_token");
  });
});

// ---------------------------------------------------------------------------
// _rotateViaServiceAccount — new method
// ---------------------------------------------------------------------------

describe("_rotateViaServiceAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error for invalid JSON input", async () => {
    const env = createMockEnv();
    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount("not-valid-json{{{");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid service_account JSON in KV");
  });

  it("calls createJwt with correct claims derived from service account JSON", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-token", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const beforeCall = Math.floor(Date.now() / 1000);
    await svc._rotateViaServiceAccount(VALID_SA_JSON);
    const afterCall = Math.floor(Date.now() / 1000);

    expect(createJwt).toHaveBeenCalledOnce();
    const [claims, privateKey] = createJwt.mock.calls[0];

    expect(claims.iss).toBe("sa@project.iam.gserviceaccount.com");
    expect(claims.sub).toBe("admin@example.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.iat).toBeGreaterThanOrEqual(beforeCall);
    expect(claims.iat).toBeLessThanOrEqual(afterCall);
    expect(claims.exp).toBe(claims.iat + 3600);
    expect(privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("POSTs the signed JWT assertion to Google token endpoint", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = options.body.toString();
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(body).toContain("assertion=mock.signed.jwt");
  });

  it("stores the access token in KV with correct TTL on success", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "stored-token", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "stored-token",
      { expirationTtl: 3480 }, // 3600 - 120
    );
  });

  it("returns ok:true with method:'service_account' and expiresIn on success", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result).toEqual({ ok: true, expiresIn: 3600, method: "service_account" });
  });

  it("defaults expiresIn to 3600 when Google response omits it", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok" }), // no expires_in
    });

    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(true);
    expect(result.expiresIn).toBe(3600);
    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "tok",
      { expirationTtl: 3480 },
    );
  });

  it("enforces minimum TTL of 300s when expires_in is very short", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "short-lived", expires_in: 300 }),
    });

    const svc = new SecretRotationService(env);
    await svc._rotateViaServiceAccount(VALID_SA_JSON);

    const [, , { expirationTtl }] = env.CREDENTIAL_CACHE.put.mock.calls[0];
    // Math.max(300 - 120, 300) = Math.max(180, 300) = 300
    expect(expirationTtl).toBe(300);
  });

  it("returns error without storing token when Google returns non-ok response", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("unauthorized");
    expect(env.CREDENTIAL_CACHE.put).not.toHaveBeenCalled();
  });

  it("includes the HTTP status code in the error message", async () => {
    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "permission denied",
    });

    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.error).toMatch(/Service account JWT error: 403/);
    expect(result.error).toContain("permission denied");
  });

  it("handles service account JSON missing optional fields gracefully", async () => {
    // impersonate and scopes may be absent
    const minimalSa = JSON.stringify({
      client_email: "sa@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIFake\n-----END PRIVATE KEY-----",
    });

    const env = createMockEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    });

    const svc = new SecretRotationService(env);
    const result = await svc._rotateViaServiceAccount(minimalSa);

    // Should still attempt rotation (claims will have undefined sub/scope)
    expect(result.ok).toBe(true);
    const [claims] = createJwt.mock.calls[0];
    expect(claims.sub).toBeUndefined();
    expect(claims.scope).toBeUndefined();
  });
});
