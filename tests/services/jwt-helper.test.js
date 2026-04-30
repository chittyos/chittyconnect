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

// A real 2048-bit RSA PKCS#8 private key for testing.
// Generated via: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048
// Safe to commit — test fixture only, not used in production.
const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDXjunqbuaQ94VR
UqfREUDQhkxaUcRTXV/bWDdp93Va4FW0mU+zKxUtrJsQCS8pBOqWosVWMQ1mcVGK
+g1hU7yKKii7GsKWCg8tKK9JL8ecdPEWRFBn3m8fwPT6di7itjPcnWh9jptyRnL+
gCXTb7gePnz2flWPq72eAr19CeFXPIGZBTaHK85pRX+/n/bcp4QbuXkieXkOdmN1
+YSqiIcQd+v8jt/TYI1SZqiwWCni31MK+XVAVU2SUWr9Jq3sCtPvjckags62THEN
S2qNP5zfiMECmTyWMFIJsPgLJRnugXXsTNkD+qfRjRYzm+NyLMaZR6Ns4Qf8yJzD
4ktLnR7RAgMBAAECggEAB7q6LIvZfK1DfI0IM3j46AFIz5xK++pHO6hIJGaZMK8G
o7kzoGsVEVQ1IzgRFtl0R/6CMPsFTf0WPXOF8017X0DvwPXOsG6f6LCiyG8MK1IO
Kww8Dd1uAqd6oViHid2asnh6fLYWYNyh1vplYNWKtprrBDO3gbVY0Uer38Xw7J3P
88Uy7ADsn3lxsT56xzILhUJ3evPUvQhPRCzSJVhNEXPtWNYxYrjlS1um54usQdN7
oBGtwLwlgGDZaDXmM9rJxf71SUg5S3U1DfVT5MrJp62t1eSA39BqG/VXsi8Lxo/3
ys7py9MGboBSLOTHXutDcy+J+PlL1LpHsm+Ayg1PWQKBgQD0PuHgAQkq/U87xCwl
kuaacesO/Ns0ZqdpoNbILW+8wylFoN03ft97z7gAOu38A7NBBRg4rD9im+lTD0iY
nhwgn2GHKhj30POaSCLAOAITH9PPPIDOFpi9R9Io/X8ikfk0wQEPbzoH4tMhrhMm
OcBnKIpklPSnImowkOTOJucxmwKBgQDh7poAxOY4L2LbVBuTqmYzKXsbVyZ42c4S
Zjqq0qwG5bWdxye4WlsoJD2Nv22vxzwI68+bvl0i5gcp5an3e5PjYKbHr8I7lmws
fCFGGUBSW8alISEQIAYM+3LIIgwnHj+qGVqJcj04RuH4T52gRrvbJJgUvPyhjvkQ
1SyiOuw+AwKBgQCI+eMPD0Wm+FzBNelUQShWoWCkDSaaIp/s2yjZJrIteH3i8K5f
eyW2d+3HI0VoOmMDKepFjkQV9z5JOJ8MCE/Z88hsVy2dfW/ArIfgqQhw1T6iUFok
OgP60xaHqnLsXlUWQs9naodu+MRTdR6EJ4tBzzid4/O479IB3qCTBLpP1QKBgD0/
+UIyHxOmTQ+W2q8KqBBAs54y3zwuF/7G9iqvWHG6PqVag3soC8RzJrjR58OaqLzm
aO8ZCZjXcaO7Hnv4ZZxj7HMARBDxc7wPntmpKNXrCYxk0djURa+pT3HQQSktuya7
Ht9aOByUotg1hU8ZPf5oCk68+WQ3JXCZyjLk9HzPAoGAS89CVDZtBt2iE3KCiOgK
YcVX4v0TABfDZAXyHUGYLbXpRBTn+aunZLZswRMrhNTk7o7LUC0d2QCfNF0nHMpr
UyfSnFIFfxg5OcqA+uXpgktIjgCc4b6bcUyen75sRg8OxrxFnUMlULEUVqHY0EVv
K+8E2ejLjSA/MTABCBhY62c=
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