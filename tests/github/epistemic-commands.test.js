import { describe, expect, it } from "vitest";
import { extractProjectionContract } from "../../src/github/epistemic-commands.js";

describe("epistemic command projection parsing", () => {
  it("extracts PLTEA bindings separately from temporal bounds", () => {
    const parsed = extractProjectionContract(`---
config_version: "3.1.0"
Canon_Bindings:
  persons_p: ["P:LEGAL_01"]
  locations_l: ["L:JURISDICTION_US_IL_COOK"]
  things_t: ["T:SOP_LEGAL_EVIDENTIARY_DOC"]
  events_e: ["E:FILING_01"]
  authorities_a: ["A:COURT_ORDER_01"]
Temporal_Bounds:
  effective_from: "2026-10-21T00:00:00Z"
  effective_until: null
---
# Body
`);

    expect(parsed).toEqual({
      bindings: {
        persons_p: ["P:LEGAL_01"],
        locations_l: ["L:JURISDICTION_US_IL_COOK"],
        things_t: ["T:SOP_LEGAL_EVIDENTIARY_DOC"],
        events_e: ["E:FILING_01"],
        authorities_a: ["A:COURT_ORDER_01"],
      },
      temporalBounds: {
        effective_from: "2026-10-21T00:00:00Z",
        effective_until: null,
      },
    });
  });

  it("returns null when there is no YAML frontmatter", () => {
    expect(extractProjectionContract("# no frontmatter")).toBeNull();
  });

  it("does not reinterpret temporal values as Thing bindings", () => {
    const parsed = extractProjectionContract(`---
Canon_Bindings:
  things_t: ["T:DOCUMENT_01"]
Temporal_Bounds:
  effective_from: "2026-10-21"
  effective_until: null
---
`);

    expect(parsed.bindings.things_t).toEqual(["T:DOCUMENT_01"]);
    expect(parsed.bindings).not.toHaveProperty("time_t");
    expect(parsed.temporalBounds.effective_from).toBe("2026-10-21");
  });
});
