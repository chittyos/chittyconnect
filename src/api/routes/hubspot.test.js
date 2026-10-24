import { describe, expect, it } from "vitest";
import { HUBSPOT_OBJECTS, parseHubspotPage } from "./hubspot.js";

describe("HubSpot read-only request boundaries", () => {
  it("allows only explicitly supported CRM collections", () => {
    expect(Object.keys(HUBSPOT_OBJECTS)).toEqual(["contacts", "companies", "deals", "tickets"]);
    expect(Object.hasOwn(HUBSPOT_OBJECTS, "owners")).toBe(false);
  });
  it("uses bounded pagination", () => {
    expect(parseHubspotPage(() => undefined)).toEqual({ limit: 25 });
    expect(parseHubspotPage((key) => ({ limit: "100", after: "123" })[key])).toEqual({ limit: 100, after: "123" });
    for (const limit of ["0", "101", "-1", "1.5", "NaN"]) {
      expect(parseHubspotPage((key) => key === "limit" ? limit : undefined)).toBeNull();
    }
    expect(parseHubspotPage((key) => key === "after" ? "../bad" : undefined)).toBeNull();
  });
});
