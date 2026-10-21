import { describe, expect, it } from "vitest";
import { validateCanonBindingsAndTemporalBounds } from "../../src/validators/pltea-contract.js";

describe("PLTEA contract validator", () => {
  it("accepts structurally valid P/L/T/E/A bindings and temporal bounds", () => {
    const result = validateCanonBindingsAndTemporalBounds(
      {
        persons_p: ["P:LEGAL_01"],
        locations_l: ["L:JURISDICTION_US_IL_COOK"],
        things_t: ["T:SOP_LEGAL_EVIDENTIARY_DOC"],
        events_e: ["E:COURT_FILING_01"],
        authorities_a: ["A:STATUTE_750_ILCS_5_503"],
      },
      {
        effective_from: "2026-10-21T00:00:00Z",
        effective_until: null,
      },
      { unresolved_queries: [], conflicts: [] },
    );

    expect(result).toEqual({
      valid: true,
      approval_gate_state: "READY_FOR_APPROVAL",
      violations: [],
    });
  });

  it("blocks prefix inversions locally", () => {
    const result = validateCanonBindingsAndTemporalBounds({
      persons_p: ["E:LEGAL_LLC"],
      things_t: ["A:EXHIBIT_01"],
      authorities_a: ["T:COURT_ORDER_01"],
    });

    expect(result.valid).toBe(false);
    expect(result.approval_gate_state).toBe("BLOCKED_ONTOLOGY_VIOLATION");
    expect(result.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining([
        "PLTEA_INVALID_PERSON",
        "PLTEA_INVALID_THING",
        "PLTEA_INVALID_AUTHORITY",
      ]),
    );
  });

  it("holds approval pending when Canon reports unresolved or conflicting semantics", () => {
    const result = validateCanonBindingsAndTemporalBounds(
      { authorities_a: ["A:EXHIBIT_01"] },
      undefined,
      {
        unresolved_queries: [{ token: "A:EXHIBIT_01", reason: "TYPE_UNRESOLVED" }],
        conflicts: [],
      },
    );

    expect(result.valid).toBe(false);
    expect(result.approval_gate_state).toBe("PENDING_CANON_RESOLUTION");
    expect(result.violations[0].code).toBe("CANON_102_UNRESOLVED_OR_CONFLICT");
  });

  it("rejects non-ISO temporal fields without treating time as T", () => {
    const result = validateCanonBindingsAndTemporalBounds(
      { things_t: ["T:DOCUMENT_01"] },
      { effective_from: "10/21/2026", effective_until: null },
    );

    expect(result.valid).toBe(false);
    expect(result.violations[0].code).toBe("INVALID_TEMPORAL_BOUND");
  });
});
