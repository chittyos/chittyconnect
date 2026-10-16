import { describe, it, expect, vi } from "vitest";
import { verifyFinanceMercuryWebhook, acceptFinanceMercuryReconciliationIntent, consumeFinanceMercuryReconciliationMessage, startFinanceMercuryWorkflow, executeFinanceMercuryWorkflow } from "../../src/lib/mercury-webhook-verifier.js";
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

  it("rejects impossible calendar timestamps before readiness or queueing", async () => {
    const send = vi.fn();
    const fetch = vi.fn().mockResolvedValue(readinessResponse());
    for (const occurredAt of ["2026-02-30T13:00:00Z", "2026-04-31T13:00:00Z",
      "2026-10-11T25:00:00Z", "2026-10-11", "2026-10-11T13:00:00+15:00"]) {
      await expect(acceptFinanceMercuryReconciliationIntent({
        ENVIRONMENT: "production", EVENT_Q: { send }, SVC_FINANCE: { fetch },
      }, { ...reconciliationEvent, occurredAt })).rejects.toThrow("invalid_mercury_reconciliation_intent");
    }
    expect(send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the durable Workflow binding and retries instead of acknowledging", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const ack = vi.fn();
    const retry = vi.fn();
    const fetch = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await queueConsumer({
        queue: "github-events", messages: [{ body: event, ack, retry }],
      }, { ENVIRONMENT: "production", SVC_FINANCE: { fetch } });
    } finally {
      log.mockRestore();
    }
    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects forged source identity and staging even if Workflow binding exists", async () => {
    const create = vi.fn();
    const get = vi.fn();
    const env = {
      ENVIRONMENT: "production",
      MERCURY_RECONCILIATION_WORKFLOW: { create, get },
    };
    for (const message of [
      { kind: "mercury.reconciliation", ...reconciliationEvent, organizationId: "APTA" },
      { kind: "mercury.reconciliation", ...reconciliationEvent, idempotencyKey: "forged" },
      { kind: "other", ...reconciliationEvent },
    ]) {
      await expect(startFinanceMercuryWorkflow(env, message)).rejects.toMatchObject({
        retryable: true,
      });
    }
    await expect(startFinanceMercuryWorkflow(
      { ...env, ENVIRONMENT: "staging" },
      { kind: "mercury.reconciliation", ...reconciliationEvent },
    )).rejects.toMatchObject({ retryable: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("forwards only whitelisted nonsecret identifiers and records durable acceptance", async () => {
    const create = vi.fn().mockImplementation(async ({ id }) => ({ id }));
    const env = {
      ENVIRONMENT: "production",
      MERCURY_RECONCILIATION_WORKFLOW: { create, get: vi.fn() },
    };
    const message = {
      kind: "mercury.reconciliation", ...reconciliationEvent,
      rawProviderPayload: "MUST_NOT_PERSIST", authorization: "MUST_NOT_PERSIST",
      credentialRef: "MUST_NOT_PERSIST",
    };
    const result = await startFinanceMercuryWorkflow(env, message);
    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.instanceId).toMatch(/^mercury-[0-9a-f]{64}$/);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].params).toEqual(reconciliationEvent);
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("MUST_NOT_PERSIST");

    const again = await startFinanceMercuryWorkflow(env, message);
    expect(again.instanceId).toBe(result.instanceId);
    const otherOrg = "da9e0582-9b2e-11ed-ba2f-ef72030b5034";
    const other = await startFinanceMercuryWorkflow(env, {
      ...message, organizationId: otherOrg,
      idempotencyKey: "webhook:mercury:org:" + otherOrg + ":" + message.providerEventId,
    });
    expect(other.instanceId).not.toBe(result.instanceId);
  });

  it("acknowledges existing Queue message only when Workflow creation is durably accepted", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const create = vi.fn().mockImplementation(async ({ id }) => ({ id }));
    const ack = vi.fn();
    const retry = vi.fn();
    await queueConsumer({
      queue: "github-events", messages: [{ body: event, ack, retry }],
    }, {
      ENVIRONMENT: "production",
      MERCURY_RECONCILIATION_WORKFLOW: { create, get: vi.fn() },
      SVC_FINANCE: { fetch: vi.fn(() => { throw new Error("Finance must not be called at Queue admission"); }) },
    });
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it("recognizes only readable duplicate Workflow receipts; a failed instance is never acknowledged", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const create = vi.fn().mockRejectedValue(new Error("duplicate ID or timeout"));
    const env = {
      ENVIRONMENT: "production",
      MERCURY_RECONCILIATION_WORKFLOW: {
        create,
        get: vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: "waiting" }) }),
      },
    };
    const accepted = await startFinanceMercuryWorkflow(env, event);
    expect(accepted).toMatchObject({ accepted: true, duplicate: true, state: "waiting" });
    for (const status of ["errored", "terminated", "unknown"]) {
      env.MERCURY_RECONCILIATION_WORKFLOW.get = vi.fn().mockResolvedValue({
        status: vi.fn().mockResolvedValue({ status }),
      });
      await expect(startFinanceMercuryWorkflow(env, event))
        .rejects.toMatchObject({ retryable: true });
    }
    env.MERCURY_RECONCILIATION_WORKFLOW.get = vi.fn().mockRejectedValue(new Error("service unavailable"));
    await expect(startFinanceMercuryWorkflow(env, event))
      .rejects.toMatchObject({ retryable: true });
  });

  it("retains the native Finance consumer completion receipt contract", async () => {
    const event = { kind: "mercury.reconciliation", ...reconciliationEvent };
    const valid = {
      processed: true, consumer: "chittyconnect-finance",
      organizationId: org, idempotencyKey: event.idempotencyKey,
    };
    const responses = [
      null, {},
      { ...valid, processed: false },
      { ...valid, consumer: "wrong-consumer" },
      { ...valid, organizationId: "e15f4a46-e328-11ee-9e22-5f2c16c0b48b" },
      { ...valid, idempotencyKey: "wrong" },
    ];
    for (const receipt of responses) {
      const response = new Response(receipt == null ? "" : JSON.stringify(receipt), { status: 200 });
      await expect(consumeFinanceMercuryReconciliationMessage({
        ENVIRONMENT: "production", SVC_FINANCE: { fetch: vi.fn().mockResolvedValue(response) },
      }, event)).rejects.toMatchObject({ retryable: true });
    }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid), { status: 200 }));
    await consumeFinanceMercuryReconciliationMessage({
      ENVIRONMENT: "production", SVC_FINANCE: { fetch },
    }, event);
    expect(fetch).toHaveBeenCalledWith(
      "https://internal/internal/chittyconnect/mercury-reconciliation/consume",
      {
        method: "POST",
        headers: { "X-ChittyOS-Caller": "chittyconnect", "Content-Type": "application/json" },
        body: JSON.stringify(reconciliationEvent),
      },
    );
  });

  it("verifies Finance readiness and then downstream consumer inside durable Workflow", async () => {
    const calls = [];
    const step = {
      do: vi.fn(async (label, optionOrFn, maybeFn) => {
        calls.push(label);
        return await (typeof optionOrFn === "function" ? optionOrFn : maybeFn)();
      }),
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(readinessResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        processed: true, consumer: "chittyconnect-finance",
        organizationId: org, idempotencyKey: reconciliationEvent.idempotencyKey,
      }), { status: 200 }));
    const result = await executeFinanceMercuryWorkflow({
      ENVIRONMENT: "production", SVC_FINANCE: { fetch },
    }, { payload: reconciliationEvent }, step);
    expect(calls).toEqual([
      "validate-queued-mercury-source-activity",
      "verify-canonical-finance-consumer-readiness",
      "deliver-to-canonical-finance-consumer",
    ]);
    expect(result).toMatchObject({
      status: "finance_consumer_delivery_verified",
      ledgerReconciled: false, organizationId: org,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fail-closes before consumer delivery if readiness is missing or scope is nonproduction", async () => {
    const step = { do: vi.fn(async (_, optionOrFn, fn) => (typeof optionOrFn === "function" ? optionOrFn : fn)()) };
    const unavailable = vi.fn().mockResolvedValue(new Response("missing", { status: 503 }));
    await expect(executeFinanceMercuryWorkflow({
      ENVIRONMENT: "production", SVC_FINANCE: { fetch: unavailable },
    }, { payload: reconciliationEvent }, step)).rejects.toThrow("consumer_unavailable");
    expect(unavailable).toHaveBeenCalledOnce();
    const fetch = vi.fn();
    await expect(executeFinanceMercuryWorkflow({
      ENVIRONMENT: "staging", SVC_FINANCE: { fetch },
    }, { payload: reconciliationEvent }, step)).rejects.toThrow("nonproduction_scope_denied");
    expect(fetch).not.toHaveBeenCalled();
  });
});
