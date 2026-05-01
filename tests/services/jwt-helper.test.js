import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createJwt } from "../../src/services/jwt-helper.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function parseJwtParts(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error(`Expected 3 parts, got ${parts.length}`);
  const [headerB64, payloadB64, signatureB64] = parts;

  const decode = (b64) => {
    // base64url → base64 → JSON
    let s = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return JSON.parse(atob(s));
  };

  return {
    header: decode(headerB64),
    payload: decode(payloadB64),
    signatureB64,
  };
}

const TEST_PEM = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("createJwt", () => {
  it("returns a three-part dot-separated string", async () => {
    const claims = { iss: "sa@project.iam.gserviceaccount.com", sub: "user@example.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, TEST_PEM);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("header encodes alg:RS256 and typ:JWT", async () => {
    const claims = { iss: "sa@project.iam.gserviceaccount.com", sub: "user@example.com", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 };
    const jwt = await createJwt(claims, TEST_PEM);
    const { header } = parseJwtParts(jwt);
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
  });

  it("payload encodes all provided claims verbatim", async () => {
    const claims = {
      iss: "sa@project.iam.gserviceaccount.com",
      sub: "user@example.com",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1700000000,
      exp: 1700003600,
    };
    const jwt = await createJwt(claims, TEST_PEM);
    const { payload } = parseJwtParts(jwt);
    expect(payload).toMatchObject(claims);
  });

  it("signature segment is non-empty base64url", async () => {
    const claims = { iss: "sa@p.iam", sub: "u@e.com", aud: "https://oauth2.googleapis.com/token", iat: 1, exp: 2 };
    const jwt = await createJwt(claims, TEST_PEM);
    const sig = jwt.split(".")[2];
    expect(sig.length).toBeGreaterThan(0);
    // base64url chars only (no +, /, =)
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces the same header and payload for the same claims (deterministic encoding)", async () => {
    const claims = { iss: "sa@p.iam", sub: "u@e.com", aud: "https://oauth2.googleapis.com/token", iat: 999, exp: 4599 };
    const jwt1 = await createJwt(claims, TEST_PEM);
    const jwt2 = await createJwt(claims, TEST_PEM);
    const [h1, p1] = jwt1.split(".");
    const [h2, p2] = jwt2.split(".");
    expect(h1).toBe(h2);
    expect(p1).toBe(p2);
  });

  it("accepts a PEM with RSA PRIVATE KEY header/footer", async () => {
    // Some tools emit "RSA PRIVATE KEY" instead of "PRIVATE KEY" —
    // importPrivateKey should strip both variants.
    // We just check it does NOT throw when given a wrapped variant header;
    // the actual key body is still PKCS#8 so we re-wrap with RSA header.
    const rsaHeaderPem = TEST_PEM
      .replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----")
      .replace("-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----");
    const claims = { iss: "sa@p.iam", sub: "u@e.com", aud: "https://oauth2.googleapis.com/token", iat: 1, exp: 2 };
    // createJwt strips both header variants in importPrivateKey; the underlying
    // key bytes are unchanged, so this must succeed.
    await expect(createJwt(claims, rsaHeaderPem)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("rejects when privateKeyPem is an invalid PEM (throws)", async () => {
    const claims = { iss: "sa@p.iam", sub: "u@e.com", aud: "https://oauth2.googleapis.com/token", iat: 1, exp: 2 };
    await expect(createJwt(claims, "not-a-pem")).rejects.toThrow();
  });

  it("JWT header and payload segments use base64url encoding (no +, /, =)", async () => {
    const claims = {
      iss: "sa@project.iam.gserviceaccount.com",
      sub: "user+name@example.com",
      scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1700000000,
      exp: 1700003600,
    };
    const jwt = await createJwt(claims, TEST_PEM);
    const [headerB64, payloadB64] = jwt.split(".");
    expect(headerB64).not.toMatch(/[+/=]/);
    expect(payloadB64).not.toMatch(/[+/=]/);
  });
});
