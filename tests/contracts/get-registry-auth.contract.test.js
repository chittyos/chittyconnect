import { describe, it, expect } from "vitest";

const RUN_LIVE = process.env.RUN_LIVE_CONTRACT_TESTS === "1";

const maybeDescribe = RUN_LIVE ? describe : describe.skip;

maybeDescribe("get.chitty.cc -> registry auth contract (live)", () => {
  it("exposes discovery/onboard links but does not allow unauthenticated registry writes", async () => {
    const discoverResp = await fetch("https://get.chitty.cc/discover");
    expect(discoverResp.ok).toBe(true);
    const discoverJson = await discoverResp.json();
    expect(discoverJson).toBeTypeOf("object");

    const healthResp = await fetch("https://api.chitty.cc/registry/health");
    expect(healthResp.ok).toBe(true);
    const healthJson = await healthResp.json();
    expect(healthJson.status).toBe("ok");

    const unauthCreateResp = await fetch(
      "https://api.chitty.cc/registry/v0.1/servers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "contract-test-noauth-should-fail",
          version: "0.0.0-test",
          description: "Contract test for unauthenticated write rejection",
          transport: "http",
          endpoints: {
            health: "https://example.invalid/health",
            mcp: "https://example.invalid/mcp",
          },
          metadata: {
            owner: "contract-test",
            status: "inactive",
          },
        }),
      },
    );

    expect(unauthCreateResp.status).toBe(401);
    const unauthJson = await unauthCreateResp.json();
    expect(unauthJson).toBeTypeOf("object");
    expect(String(unauthJson.error || "")).toMatch(/auth/i);
  });
});

