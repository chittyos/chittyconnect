import { describe, it, expect, vi, beforeEach } from "vitest";
import { createJwt } from "../../src/services/jwt-helper.js";

// ---------------------------------------------------------------------------
// Helpers — generate a real RSA-2048 key pair once per suite
// ---------------------------------------------------------------------------

let testPrivateKeyPem;
let testPublicKey;

/**
 * Generate an RSA-2048 key pair using Web Crypto and export the private key
 * as a PKCS8 PEM string (same format google.js service account JSON uses).
 */
async function generateTestKeyPair() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const pem = [
    "-----BEGIN PRIVATE KEY-----",
    ...b64.match(/.{1,64}/g),
    "-----END PRIVATE KEY-----",
  ].join("\n");

  testPrivateKeyPem = pem;
  testPublicKey = publicKey;
}

// ---------------------------------------------------------------------------
// Helpers — decode a JWT without verifying (for inspecting structure)
// ---------------------------------------------------------------------------

function decodeJwtParts(jwt) {
  const [headerB64, payloadB64, signatureB64] = jwt.split(".");
  const decode = (b64url) => {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  };
  return {
    header: decode(headerB64),
    payload: decode(payloadB64),
    rawHeader: headerB64,
    rawPayload: payloadB64,
    rawSignature: signatureB64,
  };
}

async function verifyJwt(jwt, publicKey) {
  const [rawHeader, rawPayload, rawSignature] = jwt.split(".");
  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const b64 = rawSignature.replace(/-/g, "+").replace(/_/g, "/");
  const sigBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, sigBytes, signingInput);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createJwt", () => {
  beforeEach(async () => {
    if (!testPrivateKeyPem) {
      await generateTestKeyPair();
    }
  });

  it("returns a string with three dot-separated segments", async () => {
    const jwt = await createJwt({ sub: "test" }, testPrivateKeyPem);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });

  it("encodes the RS256 + JWT header correctly", async () => {
    const jwt = await createJwt({ iss: "sa@example.iam.gserviceaccount.com" }, testPrivateKeyPem);
    const { header } = decodeJwtParts(jwt);
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
  });

  it("encodes all provided claims into the payload", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "sa@project.iam.gserviceaccount.com",
      sub: "user@example.com",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const jwt = await createJwt(claims, testPrivateKeyPem);
    const { payload } = decodeJwtParts(jwt);

    expect(payload.iss).toBe(claims.iss);
    expect(payload.sub).toBe(claims.sub);
    expect(payload.scope).toBe(claims.scope);
    expect(payload.aud).toBe(claims.aud);
    expect(payload.iat).toBe(claims.iat);
    expect(payload.exp).toBe(claims.exp);
  });

  it("produces a cryptographically valid RS256 signature", async () => {
    const jwt = await createJwt({ iss: "sa@example.iam.gserviceaccount.com", exp: 9999999999 }, testPrivateKeyPem);
    const valid = await verifyJwt(jwt, testPublicKey);
    expect(valid).toBe(true);
  });

  it("uses base64url encoding (no + / = characters in any segment)", async () => {
    const jwt = await createJwt({ iss: "sa@example.iam.gserviceaccount.com" }, testPrivateKeyPem);
    for (const segment of jwt.split(".")) {
      expect(segment).not.toMatch(/[+/=]/);
    }
  });

  it("accepts RSA PRIVATE KEY PEM header (legacy format)", async () => {
    // Re-wrap the PEM body with the legacy header/footer
    const legacyPem = testPrivateKeyPem
      .replace("BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY")
      .replace("END PRIVATE KEY", "END RSA PRIVATE KEY");

    // The importPrivateKey function strips both header variants
    const jwt = await createJwt({ sub: "test" }, legacyPem);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("produces different signatures for different claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt1 = await createJwt({ iss: "user1@example.com", iat: now }, testPrivateKeyPem);
    const jwt2 = await createJwt({ iss: "user2@example.com", iat: now }, testPrivateKeyPem);

    const [, , sig1] = jwt1.split(".");
    const [, , sig2] = jwt2.split(".");
    // Different payloads → different signing inputs → different signatures
    expect(sig1).not.toBe(sig2);
  });

  it("produces different tokens for different timestamps (iat/exp)", async () => {
    const jwt1 = await createJwt({ iss: "sa@example.com", iat: 1000, exp: 4600 }, testPrivateKeyPem);
    const jwt2 = await createJwt({ iss: "sa@example.com", iat: 2000, exp: 5600 }, testPrivateKeyPem);
    expect(jwt1).not.toBe(jwt2);
  });

  it("rejects an invalid PEM (throws an error)", async () => {
    await expect(createJwt({ sub: "test" }, "not-a-valid-pem")).rejects.toThrow();
  });

  it("encodes an empty claims object without error", async () => {
    const jwt = await createJwt({}, testPrivateKeyPem);
    const { payload } = decodeJwtParts(jwt);
    expect(payload).toEqual({});
  });
});