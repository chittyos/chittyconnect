import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAppJWT,
  getInstallationToken,
} from "../../src/auth/github.js";

function toPem(label, bytes) {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function generatePkcs8Pem() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return toPem("PRIVATE KEY", new Uint8Array(pkcs8));
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("GitHub App authentication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T13:40:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("backdates iat by 60 seconds and keeps exp within GitHub's 10-minute limit", async () => {
    const pem = await generatePkcs8Pem();
    const jwt = await generateAppJWT("12345", pem);
    const [, payloadPart] = jwt.split(".");
    const payload = decodeJwtPart(payloadPart);
    const now = Math.floor(Date.now() / 1000);

    expect(payload.iat).toBe(now - 60);
    expect(payload.exp).toBe(now + 540);
    expect(payload.exp - payload.iat).toBe(600);
    expect(payload.iss).toBe("12345");
  });

  it("fails fast when a GitHub-generated PKCS#1 PEM is provisioned without conversion", async () => {
    await expect(
      generateAppJWT(
        "12345",
        "-----BEGIN RSA PRIVATE KEY-----\nZmFrZQ==\n-----END RSA PRIVATE KEY-----",
      ),
    ).rejects.toThrow("GITHUB_APP_KEY_FORMAT_PKCS1");
  });

  it("down-scopes installation access-token requests by repository and permissions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "ghs_test",
          expires_at: "2026-10-21T14:40:00Z",
          permissions: {
            contents: "write",
            pull_requests: "write",
          },
          repositories: [{ name: "chittyconfig" }],
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await getInstallationToken(77, "app-jwt", {
      repositories: ["chittyconfig"],
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      repositories: ["chittyconfig"],
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
    });
  });
});
