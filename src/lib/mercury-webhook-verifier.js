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
