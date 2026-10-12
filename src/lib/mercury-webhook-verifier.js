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

/** Reject impossible RFC 3339 dates instead of Date.parse calendar normalization. */
function validMercuryTimestamp(value) {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):([0-5]\d))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const zoneHour = parts[8] === undefined ? 0 : Number(parts[8]);
  const zoneMinute = parts[9] === undefined ? 0 : Number(parts[9]);
  if (zoneHour > 14 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return year >= 2000 && year <= 2999 &&
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day &&
    roundTrip.getUTCHours() === hour &&
    roundTrip.getUTCMinutes() === minute &&
    roundTrip.getUTCSeconds() === second;
}

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
        (typeof input.resourceVersion !== "number" ||
          !Number.isSafeInteger(input.resourceVersion) ||
          input.resourceVersion < 0)) ||
      (input.occurredAt != null &&
        !validMercuryTimestamp(input.occurredAt))) {
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
/**
 * Cloudflare Workflow bridge for the existing signed-webhook Queue path.
 *
 * The private ChittyConnect verifier and Finance readiness gate precede Queue
 * insertion. Here we validate and whitelist the nonsecret envelope again.
 * No access token, Mercury payload, counterparty data or signing secret enters
 * Workflow instance parameters or its persisted steps.
 */
export async function startFinanceMercuryWorkflow(env, message) {
  if (message?.kind !== "mercury.reconciliation") {
    throw retryableConsumerError("mercury_queue_message_type_mismatch");
  }

  let event;
  try {
    event = checkedFinanceEvent(message);
  } catch {
    throw retryableConsumerError("invalid_mercury_queue_message");
  }

  const workflow = env?.MERCURY_RECONCILIATION_WORKFLOW;
  if (env?.ENVIRONMENT !== "production" ||
      typeof workflow?.create !== "function" ||
      typeof workflow?.get !== "function") {
    // Never silently fall back to the former direct Finance call.
    throw retryableConsumerError("mercury_workflow_binding_unavailable");
  }

  // Deterministic ID fits Cloudflare's 100-character Workflow ID limit.
  // Provider event IDs may be long; hashing preserves org-scoped idempotency.
  const identity = new TextEncoder().encode(
    "mercury:organization:" + event.organizationId + ":event:" + event.providerEventId,
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", identity));
  const instanceId = "mercury-" + Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");

  let instance;
  try {
    instance = await workflow.create({ id: instanceId, params: event });
  } catch {
    // create() may time out after durable creation, or reject a duplicate ID.
    // A caught exception is NOT success without an independent readback.
    try {
      const prior = await workflow.get(instanceId);
      const state = await prior.status();
      if (!["queued", "running", "paused", "waiting", "waitingForPause", "complete"].includes(state?.status)) {
        throw new Error("unverified_workflow_instance");
      }
      return { accepted: true, instanceId, state: state.status, duplicate: true };
    } catch {
      throw retryableConsumerError("mercury_workflow_durable_acceptance_unverified");
    }
  }
  if (instance?.id !== instanceId) {
    throw retryableConsumerError("mercury_workflow_create_receipt_mismatch");
  }
  return { accepted: true, instanceId, state: "created", duplicate: false };
}

/**
 * Pure Workflow runner (extracted for unit testing without Workers runtime).
 * A queued, previously broker-verified provider webhook is positive activity;
 * absence of an event never launches a Workflow or wakes Finance/Neon.
 *
 * This only proves Finance consumer completion under its private contract.
 * It does NOT claim that the accounting ledger has been reconciled.
 */
export async function executeFinanceMercuryWorkflow(env, workflowEvent, step) {
  if (env?.ENVIRONMENT !== "production") {
    throw new Error("nonproduction_scope_denied");
  }

  const event = checkedFinanceEvent(workflowEvent?.payload);
  const source = await step.do("validate-queued-mercury-source-activity", async () => ({
    ...event,
    activitySource: "broker_verified_mercury_webhook",
  }));

  await step.do("verify-canonical-finance-consumer-readiness", {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "30 seconds",
  }, async () => {
    if (typeof env?.SVC_FINANCE?.fetch !== "function") {
      throw new Error("mercury_reconciliation_consumer_unavailable");
    }
    const response = await env.SVC_FINANCE.fetch(
      CONSUMER_BASE_URL + "/readiness?organizationId=" + encodeURIComponent(source.organizationId),
      { headers: { "X-ChittyOS-Caller": FINANCE_BROKER_CALLER } },
    );
    if (!response.ok) throw new Error("mercury_reconciliation_consumer_unavailable");
    const receipt = await response.json().catch(() => null);
    if (receipt?.ready !== true ||
        receipt?.consumer !== "chittyconnect-finance" ||
        receipt?.durable !== true ||
        receipt?.organizationId !== source.organizationId) {
      throw new Error("mercury_reconciliation_consumer_not_ready");
    }
    return { consumer: "chittyconnect-finance", ready: true };
  });

  await step.do("deliver-to-canonical-finance-consumer", {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "30 seconds",
  }, async () => {
    await consumeFinanceMercuryReconciliationMessage(env, {
      kind: "mercury.reconciliation",
      ...event,
    });
    return { consumer: "chittyconnect-finance", processed: true, organizationId: event.organizationId };
  });

  // Deliberately distinguish Workflow delivery completion from verified ledger
  // reconciliation; canonical Finance must independently provide ledger receipts.
  return {
    status: "finance_consumer_delivery_verified",
    ledgerReconciled: false,
    organizationId: event.organizationId,
    providerEventId: event.providerEventId,
    idempotencyKey: event.idempotencyKey,
  };
}
