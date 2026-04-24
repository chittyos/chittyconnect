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

// A minimal (but real) 2048-bit RSA PKCS#8 private key for testing.
// Generated offline — safe to commit as a test fixture.
const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7o4qne60TB3wo
pCa3oi1R5PCJIX6aPHlgFEy8Qkq3cjxbpnTTl5x3A5mS3i0IiLe3uyHdKI7Kx
V70p+Ul2E1SzSkiAl5LiI8fBVBlHHG2JxSZJ3WM7b3BQCWW0Bj5pJSlMVXfk
h6DVhJzqbOg/IhqIvFZkGNAFQnBMI4D1YvSKz9VeTB9HdYbG3UVzh+9m9h1p
Jp3GXIJhBDqD3UUUl7gIxIDGMVzJ9XxGUc1IuYAH3KNFCL/V7gQz9u4x5+k6
T0sKXv3OLJiI+pmOW0h0pZ0k5UrSRu3q0h6HXvPSH1F0RYuW5jPovHxZf3qU
9JKsovA1AgMBAAECggEABquweWyNFKE4JNkFbBrW0zFTePqhVqDm2U+fGNxYe0B
xW3N6/ICvCimWQKjCe8lYCi1N4gzHjh2JEKIJBiE5tnmJLkC0M/0rEbJOF2g
JRzI/6UL4tTuOlwnr43lmF+VdlxFU/O6e2r7SocEOXGqkCAOLmBx93S8YD0h
kwBpNbdL+LHlV0bHBm9xt0Z1KEdVq4bqL7i3cT3kDoBmPRGfXi7/pJD7GKzY
7r0KhJlGG5WNVZQ2B3B7x8mq/R4GWrFIhp8VW4aBvL8lKb8pL1GEqz7k23GQ
NyCYSWg8z3JQJ9qJElI0RpK3pVJtFLuMsYk9Gq2HwQKBgQDzphQaH8OBxz1e
EMVzJRRJhZBb7SiTxCbRQTtABV2m8lXIk2j3rAiuiFgxIHBLjIMtILolh5Ls
eLO/y7TJl3a+HjBuN5kQ0fz2LpH7C1nmJ6S5b8e0bLrBxLF3n2CpY3+oTpZY
UT3i+i+5h6YGS0xVwQCMqnPvqAH+Fy0emQKBgQDGAXOzSvM0nB4TBQWJJvFr
b4WrHXlAKULGFzMZaMVFEGhKB9bONFJCstUa2UYDI7r7KFO1vlsX4bBRN9lB
3pJFqq9UuTg/3A+I5d6q0i3oJ7tqieSFMR7BVzAT7Z3IyY7oj4mhCpLsMIBC
MpPzrjS5IevE2kNM6Yw5b4UBaQKBgEFMKx/zH2W7IVqeFRnp9rF5XJuQDgF3
9qEdKFz8B0d1JmhzBkN6Tg+AVGIaOXAkfPBpXBnX8iHVIRmrlB0kUZMB3I9p
6aDQ8J1tF0pQ1KkV+pC3W8N2K/LIi0Lrqa11aYH6zJYLdR9FhgMiStSbwGe4
R+LtC3klMZYrIFhXnH2RAoGBAMWLwuNHYOzKhGY8ZI5bLhpn0f8VoIDlCWFS
RMJ/t0WDL6c/k3zBqfX3CeNdkR1UDJl7h1PnUPfqpqB6UjTmEgNjS8Kj6pK9
d4OlqfIYHsH5pEHPXmm/xTLdXzrfQMVHdFrxBaAX6AKcCVoAMEblGMiRkpO+
LJKM1JKHQMSxAoGBANeH9VaRLXNw3Uqhwp+vFNcn8HGo5G4s0nFrIF8c2Zqg
UXqJnWLRtk9KMXp4V3DV7R3oYqBXKF1z7N5A8c1EKb4Yn7wH0JI06PoEcaJD
FxF9PXjvn+SY1bD+1MF9j0k7r4nFJxLBb8M8X3L0FDXY8FI7mXW0n7dTOXQm
BPYZ
-----END PRIVATE KEY-----`;

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
