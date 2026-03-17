/**
 * Cloudflare API Helper Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn(),
}));

import { getCredential } from "../../src/lib/credential-helper.js";
import {
  parseTimeframe,
  getCloudflareApiCredentials,
} from "../../src/lib/cloudflare-api-helper.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseTimeframe", () => {
  it("parses minutes correctly", () => {
    const before = Date.now();
    const { since, before: b } = parseTimeframe("15m");
    const sinceMs = new Date(since).getTime();
    const beforeMs = new Date(b).getTime();

    // Duration should be ~15 minutes (900_000ms)
    const duration = beforeMs - sinceMs;
    expect(duration).toBeGreaterThanOrEqual(900_000 - 100);
    expect(duration).toBeLessThanOrEqual(900_000 + 100);
  });

  it("parses hours correctly", () => {
    const { since, before } = parseTimeframe("1h");
    const duration = new Date(before).getTime() - new Date(since).getTime();
    expect(duration).toBeGreaterThanOrEqual(3_600_000 - 100);
    expect(duration).toBeLessThanOrEqual(3_600_000 + 100);
  });

  it("parses days correctly", () => {
    const { since, before } = parseTimeframe("7d");
    const duration = new Date(before).getTime() - new Date(since).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(duration).toBeGreaterThanOrEqual(sevenDaysMs - 100);
    expect(duration).toBeLessThanOrEqual(sevenDaysMs + 100);
  });

  it("returns ISO 8601 strings", () => {
    const { since, before } = parseTimeframe("1h");
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws on invalid format", () => {
    expect(() => parseTimeframe("abc")).toThrow('Invalid timeframe "abc"');
    expect(() => parseTimeframe("10x")).toThrow('Invalid timeframe "10x"');
    expect(() => parseTimeframe("")).toThrow('Invalid timeframe ""');
  });
});

describe("getCloudflareApiCredentials", () => {
  it("returns token from 1Password and accountId from env", async () => {
    getCredential.mockResolvedValue("op-api-token");
    const env = { CF_ACCOUNT_ID: "acct-123" };

    const { apiToken, accountId } = await getCloudflareApiCredentials(env);

    expect(apiToken).toBe("op-api-token");
    expect(accountId).toBe("acct-123");
  });

  it("falls back to CLOUDFLARE_ACCOUNT_ID", async () => {
    getCredential.mockResolvedValue("op-api-token");
    const env = { CLOUDFLARE_ACCOUNT_ID: "acct-456" };

    const { accountId } = await getCloudflareApiCredentials(env);
    expect(accountId).toBe("acct-456");
  });

  it("prefers CF_ACCOUNT_ID over CLOUDFLARE_ACCOUNT_ID", async () => {
    getCredential.mockResolvedValue("op-api-token");
    const env = { CF_ACCOUNT_ID: "primary", CLOUDFLARE_ACCOUNT_ID: "fallback" };

    const { accountId } = await getCloudflareApiCredentials(env);
    expect(accountId).toBe("primary");
  });
});
