/**
 * Structural P/L/T/E/A validation for ChittyConnect #361.
 *
 * Canon semantics:
 *   P = Person
 *   L = Location
 *   T = Thing
 *   E = Event
 *   A = Authority
 *
 * This module intentionally does NOT infer semantic type from identifier words
 * such as LLC, EXHIBIT, DOC, or STATEMENT. Semantic classification belongs to
 * ChittyCanon #102. Local validation checks identifier class/shape and temporal
 * fields; unresolved/conflicting Canon results hold approval pending.
 */

const ID_PATTERNS = Object.freeze({
  persons_p: /^P:[A-Z0-9_-]+$/,
  locations_l: /^L:[A-Z0-9_-]+$/,
  things_t: /^T:[A-Z0-9_-]+$/,
  events_e: /^E:[A-Z0-9_-]+$/,
  authorities_a: /^A:[A-Z0-9_-]+$/,
});

const FIELD_META = Object.freeze({
  persons_p: { code: "PLTEA_INVALID_PERSON", label: "Person", prefix: "P:" },
  locations_l: { code: "PLTEA_INVALID_LOCATION", label: "Location", prefix: "L:" },
  things_t: { code: "PLTEA_INVALID_THING", label: "Thing", prefix: "T:" },
  events_e: { code: "PLTEA_INVALID_EVENT", label: "Event", prefix: "E:" },
  authorities_a: { code: "PLTEA_INVALID_AUTHORITY", label: "Authority", prefix: "A:" },
});

function validIso8601(value) {
  if (typeof value !== "string") return false;
  // Require an ISO-like date/timestamp shape before Date.parse so permissive
  // host parsing cannot accept locale-specific dates.
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function validateCanonBindingsAndTemporalBounds(
  bindings = {},
  temporalBounds,
  canonResolutionDiagnostics,
) {
  const violations = [];

  for (const [field, pattern] of Object.entries(ID_PATTERNS)) {
    const values = bindings[field] ?? [];
    if (!Array.isArray(values)) {
      violations.push({
        code: "PLTEA_BINDING_NOT_ARRAY",
        field: `Canon_Bindings.${field}`,
        message: `Canon_Bindings.${field} must be an array.`,
      });
      continue;
    }

    const meta = FIELD_META[field];
    for (const value of values) {
      if (typeof value !== "string" || !pattern.test(value)) {
        violations.push({
          code: meta.code,
          field: `Canon_Bindings.${field}`,
          message: `Invalid ${meta.label} ID "${String(value)}". Expected prefix "${meta.prefix}" and canonical identifier characters.`,
        });
      }
    }
  }

  if (temporalBounds !== undefined && temporalBounds !== null) {
    if (typeof temporalBounds !== "object" || Array.isArray(temporalBounds)) {
      violations.push({
        code: "INVALID_TEMPORAL_BOUNDS",
        field: "Temporal_Bounds",
        message: "Temporal_Bounds must be an object when present.",
      });
    } else {
      for (const key of ["effective_from", "effective_until"]) {
        const value = temporalBounds[key];
        if (value !== null && value !== undefined && !validIso8601(value)) {
          violations.push({
            code: "INVALID_TEMPORAL_BOUND",
            field: `Temporal_Bounds.${key}`,
            message: `Value "${String(value)}" is not a valid ISO-8601 date/timestamp or null.`,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    return {
      valid: false,
      approval_gate_state: "BLOCKED_ONTOLOGY_VIOLATION",
      violations,
    };
  }

  const unresolvedCount =
    canonResolutionDiagnostics?.unresolved_queries?.length ?? 0;
  const conflictCount = canonResolutionDiagnostics?.conflicts?.length ?? 0;

  if (unresolvedCount > 0 || conflictCount > 0) {
    return {
      valid: false,
      approval_gate_state: "PENDING_CANON_RESOLUTION",
      violations: [
        {
          code: "CANON_102_UNRESOLVED_OR_CONFLICT",
          field: "resolution_diagnostics",
          message: `ChittyCanon #102 returned ${unresolvedCount} unresolved reference(s) and ${conflictCount} conflict(s). /chitty-approve remains pending until canonical resolution is clean.`,
        },
      ],
    };
  }

  return {
    valid: true,
    approval_gate_state: "READY_FOR_APPROVAL",
    violations: [],
  };
}
