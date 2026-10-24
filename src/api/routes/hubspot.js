/**
 * HubSpot read-only CRM proxy.
 * HubSpot remains the source of truth; no local persistence or CRM writes.
 * Auth is enforced by the parent /api/* middleware.
 */
import { Hono } from "hono";
import { getCredentialResult } from "../../lib/credential-helper.js";

export const hubspotRoutes = new Hono();
export const HUBSPOT_OBJECTS = Object.freeze({
  contacts: ["firstname", "lastname", "email", "hs_object_id"],
  companies: ["name", "domain", "hs_object_id"],
  deals: ["dealname", "dealstage", "pipeline", "hs_object_id"],
  tickets: ["subject", "hs_pipeline_stage", "hs_object_id"],
});

export function parseHubspotPage(query) {
  const rawLimit = query("limit");
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  const after = query("after");
  if (after !== undefined && (!/^[0-9]+$/.test(after) || after.length > 32)) return null;
  return { limit, ...(after === undefined ? {} : { after }) };
}

hubspotRoutes.get("/:type", async (c) => {
  const type = c.req.param("type");
  if (!Object.hasOwn(HUBSPOT_OBJECTS, type)) {
    return c.json({ error: "UNSUPPORTED_OBJECT" }, 400);
  }
  const page = parseHubspotPage((key) => c.req.query(key));
  if (!page) return c.json({ error: "INVALID_PAGINATION" }, 400);

  const credential = await getCredentialResult(
    c.env,
    "integrations/hubspot/api_key",
    "HUBSPOT_API_KEY",
    "hubspot",
  );
  if (!credential.value) {
    return c.json({ error: credential.errorClass || "MISSING_CREDENTIAL_MATERIAL" }, 503);
  }
  try {
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/${type}`);
    url.searchParams.set("limit", String(page.limit));
    if (page.after) url.searchParams.set("after", page.after);
    for (const property of HUBSPOT_OBJECTS[type]) url.searchParams.append("properties", property);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${credential.value}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // Do not forward provider response bodies: they could contain sensitive data.
      return c.json({ error: "HUBSPOT_UPSTREAM_ERROR", upstreamStatus: response.status },
        response.status === 429 ? 429 : 502);
    }
    const data = await response.json();
    return c.json({
      source: "hubspot",
      objectType: type,
      results: data.results || [],
      paging: data.paging || null,
    });
  } catch {
    return c.json({ error: "HUBSPOT_UNAVAILABLE" }, 502);
  }
});
