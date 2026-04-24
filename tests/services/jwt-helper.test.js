import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// -----------------------------------------------------------------------
// Mock crypto.subtle so tests don't require real RSA key material.
// We use a fixed 3-byte "signature" to keep assertions predictable.
// -----------------------------------------------------------------------

const MOCK_SIGNATURE = new Uint8Array([0xde, 0xad, 0xbe]).buffer; // ArrayBuffer
const mockCryptoSubtle = {
  importKey: vi.fn(),
  sign: vi.fn(),
};

vi.stubGlobal("crypto", { subtle: mockCryptoSubtle });

const { createJwt } = await import("../../src/services/jwt-helper.js");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC7
-----END PRIVATE KEY-----`;

const FAKE_RSA_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC7
-----END RSA PRIVATE KEY-----`;

function decodeBase64url(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (s.length % 4)) % 4;
  s += "=".repeat(pad);
  return JSON.parse(atob(s));
}

function decodeBase64urlRaw(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (s.length % 4)) % 4;
  s += "=".repeat(pad);
  return atob(s);
}

// -----------------------------------------------------------------------
// createJwt
// -----------------------------------------------------------------------

describe("createJwt", () => {
  let mockKeyHandle;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKeyHandle = { type: "private", algorithm: { name: "RSASSA-PKCS1-v1_5" } };
    mockCryptoSubtle.importKey.mockResolvedValue(mockKeyHandle);
    mockCryptoSubtle.sign.mockResolvedValue(MOCK_SIGNATURE);
  });

  it("returns a string with three dot-separated segments", async () => {
    const jwt = await createJwt({ iss: "svc@example.iam.gserviceaccount.com" }, FAKE_PEM);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("encodes header as { alg: 'RS256', typ: 'JWT' }", async () => {
    const jwt = await createJwt({ iss: "svc@test.iam" }, FAKE_PEM);
    const [headerPart] = jwt.split(".");
    const header = decodeBase64url(headerPart);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("encodes the provided claims as the payload", async () => {
    const claims = {
      iss: "svc@example.iam.gserviceaccount.com",
      sub: "user@domain.com",
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1700000000,
      exp: 1700003600,
    };

    const jwt = await createJwt(claims, FAKE_PEM);
    const parts = jwt.split(".");
    const payload = decodeBase64url(parts[1]);

    expect(payload.iss).toBe(claims.iss);
    expect(payload.sub).toBe(claims.sub);
    expect(payload.scope).toBe(claims.scope);
    expect(payload.aud).toBe(claims.aud);
    expect(payload.iat).toBe(claims.iat);
    expect(payload.exp).toBe(claims.exp);
  });

  it("calls crypto.subtle.sign with RSASSA-PKCS1-v1_5 and the imported key", async () => {
    const jwt = await createJwt({ iss: "svc" }, FAKE_PEM);
    const [h, p] = jwt.split(".");
    const signingInput = `${h}.${p}`;

    expect(mockCryptoSubtle.sign).toHaveBeenCalledWith(
      { name: "RSASSA-PKCS1-v1_5" },
      mockKeyHandle,
      expect.any(Uint8Array),
    );

    // The data signed must be the exact signingInput
    const signedData = mockCryptoSubtle.sign.mock.calls[0][2];
    expect(new TextDecoder().decode(signedData)).toBe(signingInput);
  });

  it("base64url-encodes the signature (no +, /, or = characters)", async () => {
    const jwt = await createJwt({ iss: "svc" }, FAKE_PEM);
    const sig = jwt.split(".")[2];
    expect(sig).not.toMatch(/[+/=]/);
  });

  it("calls importKey with pkcs8 format for standard PEM header", async () => {
    await createJwt({ iss: "svc" }, FAKE_PEM);

    expect(mockCryptoSubtle.importKey).toHaveBeenCalledWith(
      "pkcs8",
      expect.any(Uint8Array),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  });

  it("strips RSA PRIVATE KEY PEM headers as well as PRIVATE KEY headers", async () => {
    // Both PEM styles should work without throwing
    await createJwt({ iss: "svc" }, FAKE_RSA_PEM);
    expect(mockCryptoSubtle.importKey).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from crypto.subtle.importKey", async () => {
    mockCryptoSubtle.importKey.mockRejectedValueOnce(new Error("Invalid key format"));

    await expect(createJwt({ iss: "svc" }, FAKE_PEM)).rejects.toThrow("Invalid key format");
  });

  it("propagates errors from crypto.subtle.sign", async () => {
    mockCryptoSubtle.sign.mockRejectedValueOnce(new Error("Signing failed"));

    await expect(createJwt({ iss: "svc" }, FAKE_PEM)).rejects.toThrow("Signing failed");
  });

  it("handles empty claims object", async () => {
    const jwt = await createJwt({}, FAKE_PEM);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const payload = decodeBase64url(parts[1]);
    expect(payload).toEqual({});
  });

  it("handles claims with numeric and array values", async () => {
    const claims = { iat: 0, exp: 9999, scopes: ["drive", "gmail"] };
    const jwt = await createJwt(claims, FAKE_PEM);
    const payload = decodeBase64url(jwt.split(".")[1]);

    expect(payload.iat).toBe(0);
    expect(payload.exp).toBe(9999);
    expect(payload.scopes).toEqual(["drive", "gmail"]);
  });

  it("produces consistent output for the same input (deterministic encoding)", async () => {
    const claims = { iss: "svc", iat: 1000 };
    const jwt1 = await createJwt(claims, FAKE_PEM);
    const jwt2 = await createJwt(claims, FAKE_PEM);
    expect(jwt1).toBe(jwt2);
  });
});

// -----------------------------------------------------------------------
// base64url encoding — tested indirectly through the JWT header/payload
// -----------------------------------------------------------------------

describe("base64url encoding (via JWT header and payload)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCryptoSubtle.importKey.mockResolvedValue({});
    mockCryptoSubtle.sign.mockResolvedValue(new Uint8Array([]).buffer);
  });

  it("JWT header and payload segments contain no padding characters", async () => {
    const jwt = await createJwt({ iss: "test@service.account", exp: 9999 }, FAKE_PEM);
    const [header, payload] = jwt.split(".");
    expect(header).not.toContain("=");
    expect(payload).not.toContain("=");
  });

  it("JWT header and payload use URL-safe characters only", async () => {
    // base64url uses - and _ instead of + and /
    const jwt = await createJwt({ iss: "test@service.account.iam.gserviceaccount.com" }, FAKE_PEM);
    const [header, payload] = jwt.split(".");
    expect(header).not.toMatch(/[+/]/);
    expect(payload).not.toMatch(/[+/]/);
  });
});