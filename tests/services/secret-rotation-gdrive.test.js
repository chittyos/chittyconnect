/**
 * Tests for the GDrive rotation logic added/changed in this PR:
 *   - SecretRotationService.rotateGDriveToken  (primary-path change + error msg change)
 *   - SecretRotationService._rotateViaServiceAccount  (new method)
 *
 * Out of scope: rotateNeonPassword, runDueRotations, forceRotate, getStatus
 * (those were not touched in this PR).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockKV } from "../helpers/mocks.js";

// ── Mock jwt-helper so we can control JWT output ──────────────────────────────
const mockCreateJwt = vi.fn().mockResolvedValue("mock.signed.jwt");

vi.mock("../../src/services/jwt-helper.js", () => ({
  createJwt: (...args) => mockCreateJwt(...args),
}));

// ── Mock fetch globally ───────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import after mocks are registered ────────────────────────────────────────
const { SecretRotationService } = await import("../../src/services/secret-rotation.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(),
    GDRIVE_CLIENT_ID: "test-client-id",
    GDRIVE_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  };
}

function makeService(envOverrides = {}) {
  const env = makeEnv(envOverrides);
  return { service: new SecretRotationService(env), env };
}

function makeOAuthSuccessResponse(accessToken = "new-access-token", expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ access_token: accessToken, expires_in: expiresIn }),
    text: vi.fn().mockResolvedValue(""),
  };
}

function makeErrorResponse(status, body = "error body") {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue({}),
  };
}

const VALID_SA_JSON = JSON.stringify({
  client_email: "sa@project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----\n",
  scopes: "https://www.googleapis.com/auth/drive.readonly",
  impersonate: "user@example.com",
});

// ── rotateGDriveToken ─────────────────────────────────────────────────────────

describe("SecretRotationService.rotateGDriveToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJwt.mockResolvedValue("mock.signed.jwt");
  });

  it("delegates to _rotateViaServiceAccount when service_account KV key is present", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:service_account") return VALID_SA_JSON;
      return null;
    });

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("sa-token", 3600));

    const result = await service.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("service_account");
  });

  it("falls through to refresh_token flow when service_account is absent", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "my-refresh-token";
      return null; // no service_account
    });

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("oauth-token", 3600));

    const result = await service.rotateGDriveToken();

    expect(result.ok).toBe(true);
    expect(result.method).toBe("refresh_token");
  });

  it("returns error when both service_account and refresh_token are absent", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null); // nothing in KV

    const result = await service.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/neither service_account nor OAuth refresh_token/);
  });

  it("returns the updated error message (not the old one) when credentials are missing", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);

    const result = await service.rotateGDriveToken();

    // New error message introduced in this PR
    expect(result.error).toBe(
      "Missing GDrive credentials: neither service_account nor OAuth refresh_token configured in CREDENTIAL_CACHE KV",
    );
    // Old error message must NOT be present
    expect(result.error).not.toMatch(/Missing GDrive OAuth credentials/);
  });

  it("returns error when refresh_token present but client_id/secret missing", async () => {
    const env = makeEnv({ GDRIVE_CLIENT_ID: undefined, GDRIVE_CLIENT_SECRET: undefined });
    const service = new SecretRotationService(env);
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "tok";
      return null;
    });

    const result = await service.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/neither service_account nor OAuth refresh_token/);
  });

  it("refresh_token flow stores token with TTL and returns method:refresh_token", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "rt-value";
      return null;
    });

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("fresh-token", 3600));

    const result = await service.rotateGDriveToken();

    expect(result).toEqual({ ok: true, expiresIn: 3600, method: "refresh_token" });
    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "fresh-token",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("refresh_token flow: TTL is expiresIn - 120, minimum 300", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "rt";
      return null;
    });

    // expiresIn = 200, so Math.max(200-120, 300) = 300
    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("t", 200));
    const r1 = await service.rotateGDriveToken();
    expect(r1.ok).toBe(true);
    const call1 = env.CREDENTIAL_CACHE.put.mock.calls[0];
    expect(call1[2].expirationTtl).toBe(300);

    vi.clearAllMocks();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "rt";
      return null;
    });

    // expiresIn = 3600, so Math.max(3600-120, 300) = 3480
    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("t2", 3600));
    const r2 = await service.rotateGDriveToken();
    expect(r2.ok).toBe(true);
    const call2 = env.CREDENTIAL_CACHE.put.mock.calls[0];
    expect(call2[2].expirationTtl).toBe(3480);
  });

  it("refresh_token flow: returns error on Google API failure", async () => {
    const { service, env } = makeService();
    env.CREDENTIAL_CACHE.get.mockImplementation(async (key) => {
      if (key === "secret:gdrive:refresh_token") return "rt";
      return null;
    });

    mockFetch.mockResolvedValueOnce(makeErrorResponse(401, "invalid_grant"));

    const result = await service.rotateGDriveToken();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});

// ── _rotateViaServiceAccount ──────────────────────────────────────────────────

describe("SecretRotationService._rotateViaServiceAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJwt.mockResolvedValue("mock.signed.jwt");
  });

  // ── JSON parsing ───────────────────────────────────────────────────────────

  it("returns error when saJson is invalid JSON", async () => {
    const { service } = makeService();
    const result = await service._rotateViaServiceAccount("not-json{{{");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid service_account JSON in KV");
  });

  // ── Field validation ───────────────────────────────────────────────────────

  it("returns error when client_email is missing", async () => {
    const { service } = makeService();
    const sa = { private_key: "key", scopes: "scope1" };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing service-account field: client_email or private_key");
  });

  it("returns error when private_key is missing", async () => {
    const { service } = makeService();
    const sa = { client_email: "sa@test.com", scopes: "scope1" };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing service-account field: client_email or private_key");
  });

  it("returns error when scopes field is absent", async () => {
    const { service } = makeService();
    const sa = { client_email: "sa@test.com", private_key: "key" };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing service-account field: scopes");
  });

  it("returns error when scopes is a number", async () => {
    const { service } = makeService();
    const sa = { client_email: "sa@test.com", private_key: "key", scopes: 42 };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid scopes: must be string or array of strings");
  });

  it("returns error when scopes is an empty array", async () => {
    const { service } = makeService();
    const sa = { client_email: "sa@test.com", private_key: "key", scopes: [] };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid scopes: must be string or array of strings");
  });

  it("returns error when scopes array contains non-string values", async () => {
    const { service } = makeService();
    const sa = { client_email: "sa@test.com", private_key: "key", scopes: ["valid", 123] };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid scopes: must be string or array of strings");
  });

  // ── Scopes normalization ───────────────────────────────────────────────────

  it("accepts scopes as a space-delimited string", async () => {
    const { service, env } = makeService();
    const sa = {
      client_email: "sa@test.com",
      private_key: "key",
      scopes: "https://www.googleapis.com/auth/drive.readonly https://mail.google.com/",
    };

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));

    expect(result.ok).toBe(true);
    // Verify the JWT was constructed with the string scopes intact
    const [, claimsArg] = mockCreateJwt.mock.calls[0];
    expect(claimsArg).toBeUndefined(); // createJwt is (claims, pem) — first arg is claims
    // Actually check first argument which is claims
    const claimsPassedToJwt = mockCreateJwt.mock.calls[0][0];
    expect(claimsPassedToJwt.scope).toBe(
      "https://www.googleapis.com/auth/drive.readonly https://mail.google.com/",
    );
  });

  it("joins scopes array with space when scopes is an array of strings", async () => {
    const { service } = makeService();
    const sa = {
      client_email: "sa@test.com",
      private_key: "key",
      scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://mail.google.com/"],
    };

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    await service._rotateViaServiceAccount(JSON.stringify(sa));

    const claimsPassedToJwt = mockCreateJwt.mock.calls[0][0];
    expect(claimsPassedToJwt.scope).toBe(
      "https://www.googleapis.com/auth/drive.readonly https://mail.google.com/",
    );
  });

  // ── JWT claims construction ────────────────────────────────────────────────

  it("builds correct JWT claims including iss, scope, aud, iat, exp", async () => {
    const { service } = makeService();
    const sa = {
      client_email: "sa@project.iam.gserviceaccount.com",
      private_key: "key",
      scopes: "https://www.googleapis.com/auth/drive.readonly",
    };

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    const before = Math.floor(Date.now() / 1000);
    await service._rotateViaServiceAccount(JSON.stringify(sa));
    const after = Math.floor(Date.now() / 1000);

    const claims = mockCreateJwt.mock.calls[0][0];
    expect(claims.iss).toBe("sa@project.iam.gserviceaccount.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    expect(claims.exp).toBe(claims.iat + 3600);
  });

  it("omits sub claim when impersonate is not set", async () => {
    const { service } = makeService();
    const sa = {
      client_email: "sa@test.com",
      private_key: "key",
      scopes: "https://www.googleapis.com/auth/drive.readonly",
      // no impersonate
    };

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    await service._rotateViaServiceAccount(JSON.stringify(sa));

    const claims = mockCreateJwt.mock.calls[0][0];
    expect(claims.sub).toBeUndefined();
  });

  it("sets sub claim to impersonate value when impersonate is present", async () => {
    const { service } = makeService();
    const sa = {
      client_email: "sa@test.com",
      private_key: "key",
      scopes: "scope",
      impersonate: "user@example.com",
    };

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    await service._rotateViaServiceAccount(JSON.stringify(sa));

    const claims = mockCreateJwt.mock.calls[0][0];
    expect(claims.sub).toBe("user@example.com");
  });

  // ── Token exchange request ─────────────────────────────────────────────────

  it("POSTs to https://oauth2.googleapis.com/token with jwt-bearer grant", async () => {
    const { service } = makeService();

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    await service._rotateViaServiceAccount(VALID_SA_JSON);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");

    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("assertion")).toBe("mock.signed.jwt");
  });

  it("returns error when Google token endpoint responds with non-ok status", async () => {
    const { service } = makeService();

    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, '{"error":"invalid_grant"}'));

    const result = await service._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Service account JWT error: 400/);
    expect(result.error).toMatch(/invalid_grant/);
  });

  // ── Caching ────────────────────────────────────────────────────────────────

  it("caches the access token in KV with TTL (expiresIn - 120)", async () => {
    const { service, env } = makeService();

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("sa-token", 3600));

    await service._rotateViaServiceAccount(VALID_SA_JSON);

    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "sa-token",
      { expirationTtl: 3480 },
    );
  });

  it("enforces minimum TTL of 300 when expiresIn is very small", async () => {
    const { service, env } = makeService();

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("sa-token", 100));

    await service._rotateViaServiceAccount(VALID_SA_JSON);

    const ttl = env.CREDENTIAL_CACHE.put.mock.calls[0][2].expirationTtl;
    expect(ttl).toBe(300);
  });

  it("defaults expiresIn to 3600 when Google response omits the field", async () => {
    const { service, env } = makeService();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "sa-tok" }), // no expires_in
    });

    const result = await service._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result.ok).toBe(true);
    expect(result.expiresIn).toBe(3600);
    const ttl = env.CREDENTIAL_CACHE.put.mock.calls[0][2].expirationTtl;
    expect(ttl).toBe(3480); // 3600 - 120
  });

  // ── Return shape ───────────────────────────────────────────────────────────

  it("returns { ok: true, expiresIn, method: 'service_account' } on success", async () => {
    const { service } = makeService();

    mockFetch.mockResolvedValueOnce(makeOAuthSuccessResponse("tok", 3600));

    const result = await service._rotateViaServiceAccount(VALID_SA_JSON);

    expect(result).toEqual({ ok: true, expiresIn: 3600, method: "service_account" });
  });
});
