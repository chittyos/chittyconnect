import { describe, it, expect, vi } from "vitest";
import { OnePasswordConnectClient } from "../../src/services/1password-connect-client.js";

describe("OnePasswordConnectClient", () => {
  it("builds canonical paths for helper methods", async () => {
    const client = new OnePasswordConnectClient({});
    const getSpy = vi.spyOn(client, "get").mockResolvedValue("ok");

    await client.getInfrastructureCredential("cloudflare", "make_api_key", {
      bypassCache: true,
    });
    await client.getServiceToken("chittyauth");
    await client.getIntegrationCredential("openai");

    expect(getSpy).toHaveBeenNthCalledWith(
      1,
      "infrastructure/cloudflare/make_api_key",
      { bypassCache: true },
    );
    expect(getSpy).toHaveBeenNthCalledWith(
      2,
      "services/chittyauth/service_token",
      {},
    );
    expect(getSpy).toHaveBeenNthCalledWith(3, "integrations/openai/api_key", {});
  });

  it("allows known vault parsing in failover mode without vault IDs", () => {
    const client = new OnePasswordConnectClient({
      CREDENTIAL_FAILOVER_ENABLED: "true",
    });

    const parsed = client.parseCredentialPath("services/chittyauth/service_token");
    expect(parsed).not.toBeNull();
    expect(parsed.vault).toBe("services");
  });

  it("uses CHITTY_{SERVICE}_TOKEN alias for service-token failover", async () => {
    const client = new OnePasswordConnectClient({
      CHITTY_AUTH_TOKEN: "service-token",
    });

    const value = await client.failoverToEnvironment({
      vault: "services",
      item: "chittyauth",
      field: "service_token",
      fullPath: "services/chittyauth/service_token",
    });

    expect(value).toBe("service-token");
  });

  it("uses *_TOKEN alias for integration api-key failover", async () => {
    const client = new OnePasswordConnectClient({
      NOTION_TOKEN: "notion-token",
    });

    const value = await client.failoverToEnvironment({
      vault: "integrations",
      item: "notion",
      field: "api_key",
      fullPath: "integrations/notion/api_key",
    });

    expect(value).toBe("notion-token");
  });
});