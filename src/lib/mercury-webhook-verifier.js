/**
 * ChittyConnect broker projection for canonical ChittyFinance Mercury webhooks.
 * Pure function for testability: caller only gets a boolean, not credentials.
 */
const PROVIDER_ORG_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export async function verifyFinanceMercuryWebhook(env, input) {
  const organizationId = String(input?.organizationId ?? "").toLowerCase();
  if (!PROVIDER_ORG_UUID.test(organizationId)) {
    return { verified: false, organizationId, reason: "invalid_provider_organization" };
  }
  if (env?.ENVIRONMENT !== "production") {
    return { verified: false, organizationId, reason: "nonproduction_scope_denied" };
  }
  const secrets = env?.SVC_SECRETS;
  if (!secrets || typeof secrets.verifyMercuryWebhookSignature !== "function") {
    return { verified: false, organizationId, reason: "secrets_broker_not_deployed" };
  }
  if (typeof input?.rawBody !== "string" || input.rawBody.length > 524288 ||
      typeof input?.signatureHeader !== "string") {
    return { verified: false, organizationId, reason: "invalid_signed_payload" };
  }
  try {
    const result = await secrets.verifyMercuryWebhookSignature({
      organizationId, rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
    });
    return { verified: result?.verified === true, organizationId };
  } catch {
    // Only the private ChittySecrets service-binding sees secret material.
    return { verified: false, organizationId, reason: "broker_verification_unavailable" };
  }
}


/**
 * Brokered durable dispatch of an already signature-verified Mercury event.
 * This does not reconcile a ledger transaction or authorize provider writes.
 * Reuses the production github-events queue and its configured dead-letter queue.
 */
const EVENT_IDENTIFIER = /^[A-Za-z0-9_-]{1,160}$/;
const FINANCE_BROKER_CALLER = "chittyconnect";
const CONSUMER_BASE_URL = "https://internal/internal/chittyconnect/mercury-reconciliation";

function checkedFinanceEvent(input) {
  const organizationId = input?.organizationId;
  const providerEventId = input?.providerEventId;
  const idempotencyKey = input?.idempotencyKey;
  if (typeof organizationId !== "string" ||
      !PROVIDER_ORG_UUID.test(organizationId) ||
      typeof providerEventId !== "string" ||
      !EVENT_IDENTIFIER.test(providerEventId) ||
      idempotencyKey !== "webhook:mercury:org:" + organizationId + ":" + providerEventId ||
      !["transaction", "account"].includes(input?.resourceType) ||
      typeof input?.resourceId !== "string" ||
      !EVENT_IDENTIFIER.test(input.resourceId) ||
      !["create", "update", "delete"].includes(input?.operationType) ||
      (input.resourceVersion != null &&
        (typeof input.resourceVersion !== "string" ||
          input.resourceVersion.length > 160)) ||
      (input.occurredAt != null &&
        (typeof input.occurredAt !== "string" ||
          !Number.isFinite(Date.parse(input.occurredAt))))) {
    throw new Error("invalid_mercury_reconciliation_intent");
  }
  return {
    organizationId,
    providerEventId,
    idempotencyKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    operationType: input.operationType,
    resourceVersion: input.resourceVersion ?? null,
    occurredAt: input.occurredAt ?? null,
  };
}

function retryableConsumerError(reason) {
  const err = new Error(reason);
  err.retryable = true;
  return err;
}

export async function acceptFinanceMercuryReconciliationIntent(env, input) {
  const event = checkedFinanceEvent(input);
  if (env?.ENVIRONMENT !== "production") {
    throw new Error("nonproduction_scope_denied");
  }
  const finance = env?.SVC_FINANCE;
  if (typeof finance?.fetch !== "function" ||
      typeof env?.EVENT_Q?.send !== "function") {
    throw new Error("mercury_reconciliation_consumer_unavailable");
  }

  // A 200 healthcheck, a merged PR, or a KV marker is insufficient.
  const readiness = await finance.fetch(
    CONSUMER_BASE_URL + "/readiness?organizationId=" + encodeURIComponent(event.organizationId),
    { headers: { "X-ChittyOS-Caller": FINANCE_BROKER_CALLER } },
  );
  if (!readiness.ok) {
    throw new Error("mercury_reconciliation_consumer_unavailable");
  }
  const readinessReceipt = await readiness.json().catch(() => null);
  if (readinessReceipt?.ready !== true ||
      readinessReceipt?.consumer !== "chittyconnect-finance" ||
      readinessReceipt?.organizationId !== event.organizationId ||
      readinessReceipt?.durable !== true) {
    throw new Error("mercury_reconciliation_consumer_not_ready");
  }

  // Queue acknowledgement means durably enqueued, not ledger reconciliation.
  await env.EVENT_Q.send({ kind: "mercury.reconciliation", ...event });
  return {
    accepted: true,
    durable: true,
    organizationId: event.organizationId,
    idempotencyKey: event.idempotencyKey,
    receiptId: "queue:" + event.idempotencyKey,
  };
}

export async function consumeFinanceMercuryReconciliationMessage(env, message) {
  if (message?.kind !== "mercury.reconciliation") {
    throw retryableConsumerError("mercury_queue_message_type_mismatch");
  }
  let event;
  try {
    event = checkedFinanceEvent(message);
  } catch {
    // Invalid queue events must remain inspectable in the existing DLQ.
    throw retryableConsumerError("invalid_mercury_queue_message");
  }
  if (env?.ENVIRONMENT !== "production" ||
      typeof env?.SVC_FINANCE?.fetch !== "function") {
    throw retryableConsumerError("mercury_consumer_binding_unavailable");
  }
  let response;
  try {
    response = await env.SVC_FINANCE.fetch(CONSUMER_BASE_URL + "/consume", {
      method: "POST",
      headers: {
        "X-ChittyOS-Caller": FINANCE_BROKER_CALLER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch {
    throw retryableConsumerError("mercury_consumer_dispatch_unavailable");
  }
  if (!response.ok) {
    throw retryableConsumerError("mercury_consumer_dispatch_not_accepted");
  }
  const receipt = await response.json().catch(() => null);
  if (receipt?.processed !== true ||
      receipt?.consumer !== "chittyconnect-finance" ||
      receipt?.organizationId !== event.organizationId ||
      receipt?.idempotencyKey !== event.idempotencyKey) {
    throw retryableConsumerError("mercury_consumer_completion_not_verified");
  }
}
