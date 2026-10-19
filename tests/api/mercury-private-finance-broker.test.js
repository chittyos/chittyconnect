import { describe, it, expect, vi } from "vitest";
import { verifyFinanceMercuryWebhook, acceptFinanceMercuryReconciliationIntent, consumeFinanceMercuryReconciliationMessage } from "../../src/lib/mercury-webhook-verifier.js";
import { queueConsumer } from "../../src/handlers/queue.js";

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


const reconciliationEvent = {
  organizationId: org,
  providerEventId: "provider-event-1",
  idempotencyKey: "webhook:mercury:org:" + org + ":provider-event-1",
  resourceType: "transaction",
  resourceId: "provider-tx-1",
  operationType: "update",
  resourceVersion: null,
  occurredAt: "2026-10-11T13:00:00Z",
};

function readinessResponse(organizationId = org, ready = true) {
  return new Response(JSON.stringify({
    ready, consumer: "chittyconnect-finance", organizationId, durable: true,
  }), { status: 200 });
}

describe("durable Mercury intent dispatch through existing ChittyConnect queue", () => {
  it("refuses dispatch when consumer readiness is missing or mismatched", async () => {
    const send = vi.fn();
    for (const response of [
      new Response("not found", { status: 404 }),
      readinessResponse(org, false),
      readinessResponse("e15f4a46-e328-11ee-9e22-5f2c16c0b48b"),
      new Response(JSON.stringify({ ready: true, organizationId: org, durable: true }), { status: 200 }),
    ]) {
      await expect(acceptFinanceMercuryReconciliationIntent({
        ENVIRONMENT: "production",
        EVENT_Q: { send },
        SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(response) },
      }, reconciliationEvent)).rejects.toThrow(/consumer/);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("never queues invalid org, idempotency, source identity or staging traffic", async () => {
    const send = vi.fn();
    const fetch = vi.fn().mockResolvedValue(readinessResponse());
    const env = { ENVIRONMENT: "production", EVENT_Q: { send }, SVC_FINANCE: { fetch } };
    for (const event of [
      { ...reconciliationEvent, organizationId: "APTA" },
      { ...reconciliationEvent, idempotencyKey: "wrong" },
      { ...reconciliationEvent, resourceId: "malformed secret/token" },
      { ...reconciliationEvent, operationType: "unsafe" },
    ]) {
      await expect(acceptFinanceMercuryReconciliationIntent(env, event))
        .rejects.toThrow("invalid_mercury_reconciliation_intent");
    }
    await expect(acceptFinanceMercuryReconciliationIntent({
      ...env, ENVIRONMENT: "staging",
    }, reconciliationEvent)).rejects.toThrow("nonproduction_scope_denied");
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a durable dispatch receipt only after existing queue accepts the event", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue(readinessResponse());
    const receipt = await acceptFinanceMercuryReconciliationIntent({
      ENVIRONMENT: "production", EVENT_Q: { send }, SVC_FINANCE: { fetch },
    }, reconciliationEvent);
    expect(receipt).toEqual({
      accepted: true, durable: true, organizationId: org,
      idempotencyKey: reconciliationEvent.idempotencyKey,
      receiptId: "queue:" + reconciliationEvent.idempotencyKey,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ kind: "mercury.reconciliation", ...reconciliationEvent });
    expect(fetch).toHaveBeenCalledWith(
      "https://internal/internal/chittyconnect/mercury-reconciliation/readiness?organizationId=" + org,
      { headers: { "X-ChittyOS-Caller": "chittyconnect" } },
    );
  });

  it("refuses receipt if Queue.send rejects, even after ready consumer attestation", async () => {
    await expect(acceptFinanceMercuryReconciliationIntent({
      ENVIRONMENT: "production",
      EVENT_Q: { send: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
      SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(readinessResponse()) },
    }, reconciliationEvent)).rejects.toThrow("queue unavailable");
  });

  it("marks consumer failure retryable instead of treating an event as GitHub traffic", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const bad = await consumeFinanceMercuryReconciliationMessage({
      ENVIRONMENT: "production",
      SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(new Response("missing", { status: 404 })) },
    }, event).then(() => null, (error) => error);
    expect(bad?.retryable).toBe(true);

    const ack = vi.fn();
    const retry = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await queueConsumer({
        queue: "github-events",
        messages: [{ body: event, ack, retry }],
      }, {
        ENVIRONMENT: "production",
        SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(new Response("missing", { status: 503 })) },
      });
    } finally {
      log.mockRestore();
    }
    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });

  it("rejects impossible calendar timestamps before readiness or queueing", async () => {
    const send = vi.fn();
    const fetch = vi.fn().mockResolvedValue(readinessResponse());
    for (const occurredAt of ["2026-02-30T13:00:00Z", "2026-04-31T13:00:00Z", "2026-10-11T25:00:00Z", "2026-10-11", "2026-10-11T13:00:00+15:00"]) {
      await expect(acceptFinanceMercuryReconciliationIntent({
        ENVIRONMENT: "production", EVENT_Q: { send }, SVC_FINANCE: { fetch },
      }, { ...reconciliationEvent, occurredAt })).rejects.toThrow("invalid_mercury_reconciliation_intent");
    }
    expect(send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects all mismatched or malformed 200 Finance completion receipts", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const malformed = [
      null, {},
      { processed: false, consumer: "chittyconnect-finance", organizationId: org, idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "wrong-consumer", organizationId: org, idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "chittyconnect-finance", organizationId: "e15f4a46-e328-11ee-9e22-5f2c16c0b48b", idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "chittyconnect-finance", organizationId: org, idempotencyKey: "wrong-event" },
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const receipt of malformed) {
        const ack = vi.fn();
        const retry = vi.fn();
        const response = new Response(receipt === null ? "" : JSON.stringify(receipt), { status: 200 });
        await queueConsumer({
          queue: "github-events", messages: [{ body: event, ack, retry }],
        }, { ENVIRONMENT: "production", SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(response) } });
        expect(retry).toHaveBeenCalledOnce();
        expect(ack).not.toHaveBeenCalled();
      }
    } finally {
      log.mockRestore();
    }
  });

  it("rejects impossible Mercury dates before readiness and queueing", async () => {
    const send = vi.fn();
    const fetch = vi.fn().mockResolvedValue(readinessResponse());
    for (const occurredAt of ["2026-02-30T13:00:00Z", "2026-04-31T13:00:00Z", "2026-10-11T25:00:00Z", "2026-10-11T13:00:00+15:00"]) {
      await expect(acceptFinanceMercuryReconciliationIntent({
        ENVIRONMENT: "production", EVENT_Q: { send }, SVC_FINANCE: { fetch },
      }, { ...reconciliationEvent, occurredAt })).rejects.toThrow("invalid_mercury_reconciliation_intent");
    }
    expect(send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries rather than acks malformed or mismatched successful consumer receipts", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const responses = [
      null,
      {},
      { processed: false, consumer: "chittyconnect-finance", organizationId: org, idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "unknown-consumer", organizationId: org, idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "chittyconnect-finance", organizationId: "e15f4a46-e328-11ee-9e22-5f2c16c0b48b", idempotencyKey: event.idempotencyKey },
      { processed: true, consumer: "chittyconnect-finance", organizationId: org, idempotencyKey: "another-event" },
    ];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const receipt of responses) {
        const ack = vi.fn();
        const retry = vi.fn();
        const response = new Response(receipt === null ? "" : JSON.stringify(receipt), { status: 200 });
        await queueConsumer({
          queue: "github-events",
          messages: [{ body: event, ack, retry }],
        }, {
          ENVIRONMENT: "production",
          SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(response) },
        });
        expect(ack).not.toHaveBeenCalled();
        expect(retry).toHaveBeenCalledOnce();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("acknowledges only a verified completed downstream reconciliation result", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      processed: true, consumer: "chittyconnect-finance",
      organizationId: org, idempotencyKey: reconciliationEvent.idempotencyKey,
    }), { status: 200 }));
    const ack = vi.fn();
    const retry = vi.fn();
    await queueConsumer({
      queue: "github-events",
      messages: [{ body: event, ack, retry }],
    }, { ENVIRONMENT: "production", SVC_FINANCE: { fetch } });
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://internal/internal/chittyconnect/mercury-reconciliation/consume",
      {
        method: "POST",
        headers: {
          "X-ChittyOS-Caller": "chittyconnect",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reconciliationEvent),
      },
    );
  });
});
