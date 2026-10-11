import { describe, it, expect, vi } from "vitest";
import { verifyFinanceMercuryWebhook } from "../../src/lib/mercury-webhook-verifier.js";

const org = "9082ea0c-07a8-11ef-b331-734021561438";
const body = JSON.stringify({ id: "event", resourceType: "transaction" });
const signature = "t=1791234000,v1=" + "a".repeat(64);

describe("ChittyConnect private Mercury signature broker", () => {
  it("forwards only provider-organization context to existing private ChittySecrets RPC", async () => {
    const call = vi.fn().mockResolvedValue({
      verified: true, credentialRef: "chittysecrets://mercury/webhook/" + org,
      value: "SHOULD_NEVER_REACH_FINANCE",
    });
    const result = await verifyFinanceMercuryWebhook({
      ENVIRONMENT: "production",
      SVC_SECRETS: { verifyMercuryWebhookSignature: call },
    }, { organizationId: org, rawBody: body, signatureHeader: signature });
    expect(result).toEqual({ verified: true, organizationId: org });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NEVER_REACH_FINANCE");
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith({ organizationId: org, rawBody: body, signatureHeader: signature });
  });

  it("fails closed if staging could otherwise access production Secrets", async () => {
    const call = vi.fn().mockResolvedValue({ verified: true });
    const result = await verifyFinanceMercuryWebhook({
      ENVIRONMENT: "staging",
      SVC_SECRETS: { verifyMercuryWebhookSignature: call },
    }, { organizationId: org, rawBody: body, signatureHeader: signature });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("nonproduction_scope_denied");
    expect(call).not.toHaveBeenCalled();
  });

  it("requires exact known RPC capability and provider UUID", async () => {
    expect((await verifyFinanceMercuryWebhook({
      ENVIRONMENT: "production",
    }, { organizationId: org, rawBody: body, signatureHeader: signature })).verified).toBe(false);
    expect((await verifyFinanceMercuryWebhook({
      ENVIRONMENT: "production",
      SVC_SECRETS: { verifyMercuryWebhookSignature: vi.fn() },
    }, { organizationId: "APTA", rawBody: body, signatureHeader: signature })).verified).toBe(false);
  });

  it("does not propagate private Secrets RPC exception or raw body", async () => {
    const result = await verifyFinanceMercuryWebhook({
      ENVIRONMENT: "production",
      SVC_SECRETS: {
        verifyMercuryWebhookSignature: vi.fn().mockRejectedValue(new Error("SHOULD_NOT_LOG_SECRET")),
      },
    }, { organizationId: org, rawBody: body, signatureHeader: signature });
    expect(result).toEqual({
      verified: false, organizationId: org, reason: "broker_verification_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_LOG_SECRET");
  });
});
