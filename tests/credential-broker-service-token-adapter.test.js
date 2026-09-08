// Regression: every credential broker must also answer the provisioner's legacy
// getServiceToken(service) call shape.
//
// The infrastructure adapter (see credential-broker-infrastructure-adapter.test.js)
// covered getInfrastructureCredential, but provisionServiceToken — credential type
// `chittyos_service_token` — calls this.onePassword.getServiceToken(target_service).
// Only OnePasswordConnectClient implemented that, so with any broker configuration
// POST /api/credentials/provision threw
// `TypeError: this.onePassword.getServiceToken is not a function` at call time.
//
// Real env bindings, no mocked broker: CloudflareSecretsBroker reads from env, so
// a plain object with the mapped binding IS the real backend here.

import { describe, it, expect } from "vitest";
import { createCredentialBroker } from "../src/lib/credential-broker.js";
import { EnhancedCredentialProvisioner } from "../src/services/credential-provisioner-enhanced.js";

const BROKER_TYPES = [
  "cloudflare-secrets",
  "chittyserv",
  "chittysecrets",
  "auto",
];

describe("getServiceToken adapter", () => {
  it("exists on every broker type, not just the 1Password client", () => {
    for (const type of BROKER_TYPES) {
      const broker = createCredentialBroker({ CREDENTIAL_BROKER_TYPE: type });
      expect(typeof broker.getServiceToken).toBe("function");
    }
  });

  it("resolves the services/{service}/service_token spelling", async () => {
    const broker = createCredentialBroker({
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      // PATH_TO_ENV maps services/chittyconnect/service_token
      CHITTYCONNECT_SERVICE_TOKEN: "test-binding-value-not-a-real-credential",
    });

    const value = await broker.getServiceToken("chittyconnect", {
      service: "chittyrouter",
      purpose: "inter-service-call",
    });
    expect(value).toBe("test-binding-value-not-a-real-credential");
  });

  it("falls back to the services/{service}/token spelling", async () => {
    const broker = createCredentialBroker({
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      // chittyledger has no service_token entry, only services/chittyledger/token
      CHITTYLEDGER_TOKEN: "test-binding-value-not-a-real-credential",
    });

    const value = await broker.getServiceToken("chittyledger");
    expect(value).toBe("test-binding-value-not-a-real-credential");
  });

  it("rejects a malformed reference instead of building services/undefined/token", async () => {
    const broker = createCredentialBroker({
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
    });
    await expect(broker.getServiceToken(undefined)).rejects.toThrow(
      /E_CREDENTIAL_BAD_REF/,
    );
  });

  it("an unbound service fails loudly rather than returning undefined", async () => {
    const broker = createCredentialBroker({
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
    });
    await expect(broker.getServiceToken("chittyledger")).rejects.toThrow(
      /E_CREDENTIAL_NOT_FOUND/,
    );
  });
});

describe("provisionServiceToken dispatch", () => {
  // The bug was a method-dispatch failure, so what this asserts is that the
  // provisioner reaches the broker at all. With no binding present the call must
  // surface the broker's own lookup error — never a TypeError about the method
  // being missing.
  it("reaches the broker instead of throwing TypeError on the call itself", async () => {
    const provisioner = new EnhancedCredentialProvisioner({
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
    });

    const attempt = provisioner.provisionServiceToken(
      { source_service: "chittyrouter", target_service: "chittyledger" },
      "chittyrouter",
    );

    await expect(attempt).rejects.toThrow(/E_CREDENTIAL_NOT_FOUND/);
    await expect(attempt).rejects.not.toThrow(TypeError);
  });
});
