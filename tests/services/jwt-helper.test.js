/**
 * Tests for src/services/jwt-helper.js
 *
 * createJwt uses the Web Crypto API (RS256/RSASSA-PKCS1-v1_5), which is
 * available natively in Node 18+.  Vitest runs in Node, so no stubs needed
 * for the crypto global — we generate a real RSA-2048 key pair in beforeAll
 * and use it throughout.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createJwt } from "../../src/services/jwt-helper.js";
import { generateKeyPairSync } from "node:crypto";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode a base64url string (no padding required).
 */
function decodeBase64url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

/**
 * Verify an RS256 JWT using the Web Crypto API.
 * Returns true if the signature is valid.
 */
async function verifyJwtSignature(jwt, publicKeyPem) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import public key
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(Buffer.from(pemBody, "base64"));
  const pubKey = await crypto.subtle.importKey(
    "spki",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Decode signature
  let sigBase64 = sigB64.replace(/-/g, "+").replace(/_/g, "/");
  sigBase64 = sigBase64.padEnd(sigBase64.length + ((4 - (sigBase64.length % 4)) % 4), "=");
  const sigBytes = Uint8Array.from(Buffer.from(sigBase64, "base64"));

  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    pubKey,
    sigBytes,
    new TextEncoder().encode(signingInput),
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let privateKeyPem;
let publicKeyPem;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKeyPem = privateKey;
  publicKeyPem = publicKey;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createJwt", () => {
  it("returns a three-part dot-separated JWT string", async () => {
    const claims = { iss: "sa@project.iam.gserviceaccount.com", aud: "https://example.com", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, privateKeyPem);

    expect(typeof jwt).toBe("string");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("encodes the RS256 header correctly", async () => {
    const claims = { iss: "test@sa.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, privateKeyPem);

    const header = decodeBase64url(jwt.split(".")[0]);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("encodes the payload claims verbatim", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "sa@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      sub: "user@example.com",
    };

    const jwt = await createJwt(claims, privateKeyPem);
    const payload = decodeBase64url(jwt.split(".")[1]);

    expect(payload).toEqual(claims);
  });

  it("produces a signature that verifies with the corresponding public key", async () => {
    const claims = { iss: "sa@project.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, privateKeyPem);

    const valid = await verifyJwtSignature(jwt, publicKeyPem);
    expect(valid).toBe(true);
  });

  it("produces a different signature for different claims (not deterministic collision)", async () => {
    const claimsA = { iss: "a@example.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const claimsB = { iss: "b@example.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };

    const jwtA = await createJwt(claimsA, privateKeyPem);
    const jwtB = await createJwt(claimsB, privateKeyPem);

    expect(jwtA).not.toBe(jwtB);
    // Both payloads should still verify
    expect(await verifyJwtSignature(jwtA, publicKeyPem)).toBe(true);
    expect(await verifyJwtSignature(jwtB, publicKeyPem)).toBe(true);
  });

  it("rejects a tampered payload (signature mismatch)", async () => {
    const claims = { iss: "sa@project.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, privateKeyPem);

    // Tamper with the payload portion
    const parts = jwt.split(".");
    const tamperedPayloadB64 = Buffer.from(JSON.stringify({ iss: "attacker@evil.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 99999999 })).toString("base64url");
    const tamperedJwt = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

    const valid = await verifyJwtSignature(tamperedJwt, publicKeyPem);
    expect(valid).toBe(false);
  });

  it("accepts a PKCS8-format PEM without RSA prefix in header/footer", async () => {
    // Already pkcs8 format from generateKeyPairSync — just verify it works
    const claims = { iss: "sa@test.com", aud: "https://example.com", iat: 1000, exp: 4600 };
    await expect(createJwt(claims, privateKeyPem)).resolves.toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("encodes claims with no sub field when impersonation is absent", async () => {
    const claims = {
      iss: "sa@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1000,
      exp: 4600,
      // no sub
    };
    const jwt = await createJwt(claims, privateKeyPem);
    const payload = decodeBase64url(jwt.split(".")[1]);

    expect(payload.sub).toBeUndefined();
  });

  it("throws when the private key PEM is garbage", async () => {
    const claims = { iss: "sa@test.com", aud: "https://example.com", iat: 1000, exp: 4600 };
    await expect(createJwt(claims, "not-a-pem")).rejects.toThrow();
  });
});