/**
 * Real-crypto tests for the Cloudflare Access assertion verifier (AUTH-001).
 *
 * No mocks: an ES256 keypair is generated with `jose`, real assertion JWTs are
 * signed with it, and verification runs against a locally built JWKS injected
 * via `opts.jwks`. This exercises the same `jose.jwtVerify` path used in
 * production (issuer + audience pinning, signature check) without network.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as jose from "jose";
import {
  verifyCfAccessAssertion,
  isCfAccessVerificationConfigured,
} from "../../src/auth/cf-access-verify.js";

const TEAM = "chittyos"; // normalizes to chittyos.cloudflareaccess.com
const ISSUER = "https://chittyos.cloudflareaccess.com";
const AUD = "test-access-app-aud-tag";
const ENV = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };

let privateKey;
let localJwks;

beforeAll(async () => {
  const { publicKey, privateKey: priv } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  privateKey = priv;
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = "test-kid";
  jwk.alg = "ES256";
  // Build a key resolver equivalent to a remote JWKS, from local public key.
  localJwks = jose.createLocalJWKSet({ keys: [jwk] });
});

async function sign(claims = {}, { aud = AUD, iss = ISSUER } = {}) {
  return new jose.SignJWT({ email: "operator@chitty.cc", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("isCfAccessVerificationConfigured", () => {
  it("false when team domain or aud missing", () => {
    expect(isCfAccessVerificationConfigured({})).toBe(false);
    expect(isCfAccessVerificationConfigured({ CF_ACCESS_TEAM_DOMAIN: TEAM })).toBe(false);
    expect(isCfAccessVerificationConfigured({ CF_ACCESS_AUD: AUD })).toBe(false);
  });
  it("true when both configured", () => {
    expect(isCfAccessVerificationConfigured(ENV)).toBe(true);
  });
});

describe("verifyCfAccessAssertion", () => {
  it("accepts a validly signed assertion and returns the email claim", async () => {
    const token = await sign();
    const res = await verifyCfAccessAssertion(token, ENV, { jwks: localJwks });
    expect(res.valid).toBe(true);
    expect(res.email).toBe("operator@chitty.cc");
  });

  it("rejects a missing assertion (forged header, no JWT)", async () => {
    const res = await verifyCfAccessAssertion("", ENV, { jwks: localJwks });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("no_assertion");
  });

  it("rejects when verification is not configured", async () => {
    const token = await sign();
    const res = await verifyCfAccessAssertion(token, {}, { jwks: localJwks });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("not_configured");
  });

  it("rejects an assertion with the wrong audience", async () => {
    const token = await sign({}, { aud: "some-other-app" });
    const res = await verifyCfAccessAssertion(token, ENV, { jwks: localJwks });
    expect(res.valid).toBe(false);
  });

  it("rejects an assertion from the wrong issuer", async () => {
    const token = await sign({}, { iss: "https://evil.cloudflareaccess.com" });
    const res = await verifyCfAccessAssertion(token, ENV, { jwks: localJwks });
    expect(res.valid).toBe(false);
  });

  it("rejects an assertion signed by an unknown key", async () => {
    const { privateKey: otherPriv } = await jose.generateKeyPair("ES256", {
      extractable: true,
    });
    const token = await new jose.SignJWT({ email: "operator@chitty.cc" })
      .setProtectedHeader({ alg: "ES256", kid: "other-kid" })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(otherPriv);
    const res = await verifyCfAccessAssertion(token, ENV, { jwks: localJwks });
    expect(res.valid).toBe(false);
  });

  it("rejects an assertion with no email claim", async () => {
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const res = await verifyCfAccessAssertion(token, ENV, { jwks: localJwks });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("no_email_claim");
  });
});
