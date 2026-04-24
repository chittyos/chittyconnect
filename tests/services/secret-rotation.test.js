import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockKV } from "../helpers/mocks.js";

// ----------------------------------------------------------------
// Mock jwt-helper (dynamic import inside _rotateViaServiceAccount)
// ----------------------------------------------------------------
const mockCreateJwt = vi.fn().mockResolvedValue("mock.signed.jwt");
vi.mock("../../src/services/jwt-helper.js", () => ({
  createJwt: (...args) => mockCreateJwt(...args),
}));

// ----------------------------------------------------------------
// Import after mocks
// ----------------------------------------------------------------
const { SecretRotationService } = await import("../../src/services/secret-rotation.js");

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const VALID_SA = {
  client_email: "sa@project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n",
  impersonate: "user@example.com",
  scopes: "https://www.googleapis.com/auth/drive.readonly",
};

function makeEnv(overrides = {}) {
  return {
    CREDENTIAL_CACHE: createMockKV(),
    GDRIVE_CLIENT_ID: "client-id",
    GDRIVE_CLIENT_SECRET: "client-secret",
    ...overrides,
  };
}

function makeFetchOk(body = { access_token: "new-access-token", expires_in: 3600 }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

function makeFetchError(status = 401, text = "Unauthorized") {
  return vi.fn().mockResolvedValue(
    new Response(text, { status }),
  );
}

// ----------------------------------------------------------------
// rotateGDriveToken — routing logic (new in this PR)
// ----------------------------------------------------------------

describe("SecretRotationService.rotateGDriveToken", () => {
  let env;
  let service;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    service = new SecretRotationService(env);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("delegates to _rotateViaServiceAccount when service_account key is present in KV", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValueOnce(JSON.stringify(VALID_SA));

    globalThis.fetch = makeFetchOk();

    const result = await service.rotateGDriveToken();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("service_account");
  });

  it("falls back to refresh_token path when service_account key is absent", async () => {
    // First KV read (service_account) → null; second (refresh_token) → token string
    env.CREDENTIAL_CACHE.get
      .mockResolvedValueOnce(null) // service_account
      .mockResolvedValueOnce("my-refresh-token"); // refresh_token

    globalThis.fetch = makeFetchOk();

    const result = await service.rotateGDriveToken();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("refresh_token");
  });

  it("returns error when neither service_account nor refresh_token credentials are available", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    env = makeEnv({ GDRIVE_CLIENT_ID: undefined, GDRIVE_CLIENT_SECRET: undefined });
    service = new SecretRotationService(env);
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);

    const result = await service.rotateGDriveToken();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("neither service_account nor OAuth refresh_token");
  });

  it("error message references CREDENTIAL_CACHE KV", async () => {
    env.CREDENTIAL_CACHE.get.mockResolvedValue(null);
    const result = await service.rotateGDriveToken();
    expect(result.error).toContain("CREDENTIAL_CACHE KV");
  });
});

// ----------------------------------------------------------------
// rotateGDriveToken — refresh_token path (updated return value)
// ----------------------------------------------------------------

describe("SecretRotationService.rotateGDriveToken (refresh_token path)", () => {
  let env;
  let service;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    service = new SecretRotationService(env);
    originalFetch = globalThis.fetch;
    // service_account not present; refresh_token present
    env.CREDENTIAL_CACHE.get
      .mockResolvedValueOnce(null)            // service_account
      .mockResolvedValueOnce("refresh-tok");  // refresh_token
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns method:'refresh_token' on success", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "tok", expires_in: 3600 });
    const result = await service.rotateGDriveToken();
    expect(result.ok).toBe(true);
    expect(result.method).toBe("refresh_token");
    expect(result.expiresIn).toBe(3600);
  });

  it("stores access token in KV with TTL on refresh_token success", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "new-tok", expires_in: 3600 });
    await service.rotateGDriveToken();
    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "new-tok",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("returns error when Google OAuth2 returns non-2xx", async () => {
    globalThis.fetch = makeFetchError(400, "invalid_grant");
    const result = await service.rotateGDriveToken();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("400");
  });
});

// ----------------------------------------------------------------
// _rotateViaServiceAccount — validation
// ----------------------------------------------------------------

describe("SecretRotationService._rotateViaServiceAccount", () => {
  let env;
  let service;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    service = new SecretRotationService(env);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error for invalid (non-JSON) service_account string", async () => {
    const result = await service._rotateViaServiceAccount("not-json{");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid service_account JSON");
  });

  it("returns error when impersonate field is missing", async () => {
    const sa = { ...VALID_SA };
    delete sa.impersonate;
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("impersonate");
  });

  it("returns error when impersonate is an empty string", async () => {
    const sa = { ...VALID_SA, impersonate: "" };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("impersonate");
  });

  it("returns error when impersonate is whitespace-only", async () => {
    const sa = { ...VALID_SA, impersonate: "   " };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("impersonate");
  });

  it("returns error when impersonate is not a string", async () => {
    const sa = { ...VALID_SA, impersonate: 42 };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("impersonate");
  });

  it("returns error when scopes field is missing", async () => {
    const sa = { ...VALID_SA };
    delete sa.scopes;
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scopes");
  });

  it("returns error when scopes is an empty array", async () => {
    const sa = { ...VALID_SA, scopes: [] };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scopes");
  });

  it("returns error when scopes array contains non-string items", async () => {
    const sa = { ...VALID_SA, scopes: ["valid-scope", 123] };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scopes");
  });

  it("returns error when scopes is a number (not string or array)", async () => {
    const sa = { ...VALID_SA, scopes: 42 };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scopes");
  });

  it("returns error when scopes is an object (not string or array)", async () => {
    const sa = { ...VALID_SA, scopes: { drive: true } };
    const result = await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scopes");
  });

  it("passes string scopes through unchanged to JWT claims", async () => {
    globalThis.fetch = makeFetchOk();
    const sa = { ...VALID_SA, scopes: "scope1 scope2" };
    await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(mockCreateJwt).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "scope1 scope2" }),
      VALID_SA.private_key,
    );
  });

  it("joins array scopes with a space when building JWT claims", async () => {
    globalThis.fetch = makeFetchOk();
    const sa = { ...VALID_SA, scopes: ["scope-a", "scope-b", "scope-c"] };
    await service._rotateViaServiceAccount(JSON.stringify(sa));
    expect(mockCreateJwt).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "scope-a scope-b scope-c" }),
      VALID_SA.private_key,
    );
  });

  it("builds correct JWT claims (iss, sub, aud, scope)", async () => {
    globalThis.fetch = makeFetchOk();
    await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(mockCreateJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        iss: VALID_SA.client_email,
        sub: VALID_SA.impersonate,
        aud: "https://oauth2.googleapis.com/token",
        scope: VALID_SA.scopes,
      }),
      VALID_SA.private_key,
    );
  });

  it("JWT claims include iat and exp set ~1 hour apart", async () => {
    globalThis.fetch = makeFetchOk();
    const before = Math.floor(Date.now() / 1000);
    await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    const after = Math.floor(Date.now() / 1000);

    const [[claimsArg]] = mockCreateJwt.mock.calls;
    expect(claimsArg.iat).toBeGreaterThanOrEqual(before);
    expect(claimsArg.iat).toBeLessThanOrEqual(after);
    expect(claimsArg.exp - claimsArg.iat).toBe(3600);
  });

  it("posts JWT-bearer grant_type to Google token endpoint", async () => {
    const mockFetch = makeFetchOk();
    globalThis.fetch = mockFetch;

    await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.body.toString()).toContain("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(init.body.toString()).toContain("mock.signed.jwt");
  });

  it("returns { ok: true, expiresIn, method:'service_account' } on success", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "new-tok", expires_in: 3600 });
    const result = await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(result).toEqual({ ok: true, expiresIn: 3600, method: "service_account" });
  });

  it("defaults expiresIn to 3600 when Google response omits expires_in", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "tok" }); // no expires_in
    const result = await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(result.ok).toBe(true);
    expect(result.expiresIn).toBe(3600);
  });

  it("stores new access token in KV with correct TTL (expiresIn - 120, min 300)", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "sa-tok", expires_in: 3600 });
    await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "sa-tok",
      { expirationTtl: 3480 }, // 3600 - 120
    );
  });

  it("enforces minimum TTL of 300 when expires_in is very small", async () => {
    globalThis.fetch = makeFetchOk({ access_token: "short-lived-tok", expires_in: 200 });
    await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(env.CREDENTIAL_CACHE.put).toHaveBeenCalledWith(
      "secret:gdrive:access_token",
      "short-lived-tok",
      { expirationTtl: 300 }, // Math.max(200-120, 300) = 300
    );
  });

  it("returns error when Google token endpoint returns non-2xx", async () => {
    globalThis.fetch = makeFetchError(401, "invalid_grant: Invalid JWT");
    const result = await service._rotateViaServiceAccount(JSON.stringify(VALID_SA));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Service account JWT error");
    expect(result.error).toContain("401");
  });
});

// ----------------------------------------------------------------
// Constructor guard (pre-existing but covers integration with new paths)
// ----------------------------------------------------------------

describe("SecretRotationService constructor", () => {
  it("throws when CREDENTIAL_CACHE is not provided", () => {
    expect(() => new SecretRotationService({})).toThrow("CREDENTIAL_CACHE");
  });
});
