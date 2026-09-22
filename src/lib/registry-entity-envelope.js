/**
 * Registry entity-envelope validation — mirrors the authoritative contract
 * enforced by chittyregister (CHITTYFOUNDATION/chittyregister,
 * chittyregister-worker.js:817-838, `VALID_ENTITY_TYPES` /
 * `VALID_SUBTYPES_BY_ENTITY`).
 *
 * Why this exists: the sensitive-intent contract
 * (~/.ch1tty/canon/system-wide-sensitive-intent-contract-v1.md) mandates that
 * registry writes route through ChittyConnect as a policy/audit broker. A
 * broker that only forwards adds no policy value — it must reject malformed
 * envelopes BEFORE spending a network round-trip (and chittyregister's
 * 10/hour/IP rate-limit budget) on garbage. This module is the broker-side
 * mirror of that contract so bad payloads fail fast, at the broker.
 *
 * This is deliberately a MIRROR, not a fork: chittyregister remains the
 * authority. If the two drift, chittyregister wins — see
 * tests/lib/registry-entity-envelope.test.js for a live drift check against
 * `GET register.chitty.cc/api/v1/requirements`.
 *
 * @canon: chittycanon://gov/governance#core-types — all five entity types
 * (Person/Location/Thing/Event/Authority) MUST be present. Never omit
 * Authority (A).
 */

// @canon: chittycanon://gov/governance#core-types
export const VALID_ENTITY_TYPES = ["P", "L", "T", "E", "A"];

// Source: chittyregister-worker.js:818-825
export const VALID_SUBTYPES_BY_ENTITY = {
  P: ["natural", "synthetic", "legal", "agent", "subagent", "channel", "user"],
  L: ["domain", "hostname", "node", "region", "venue"],
  T: ["service", "mcp-server", "skill", "plugin", "command", "library", "script", "document", "schema"],
  E: ["registration", "revocation", "certification", "deployment"],
  A: ["certificate", "manifest", "token", "badge"],
};

// Source: chittyregister-worker.js:864 (AGENT_ENTITY_CLASSES)
export const AGENT_ENTITY_CLASSES = ["Advocate", "Context", "Coordinator", "Agent"];

// Subtypes that go through the agent (P) KYA profile — mirrors
// chittyregister-worker.js:908-910.
const AGENT_LIKE_SUBTYPES = ["synthetic", "agent", "subagent", "channel"];

/**
 * Validate the entity envelope (entity_type / subtype) of a registration
 * submission against the canonical P/L/T/E/A contract.
 *
 * Pure function: no I/O, no mutation of `submission`. Mirrors
 * `validateEntityEnvelope()` in chittyregister-worker.js:826-839.
 *
 * @param {object} submission
 * @returns {{ entityType: string, subtype: string|null, errors: string[] }}
 */
export function validateEntityEnvelope(submission) {
  const errors = [];
  const entityType = submission?.entity_type || "T";
  const subtype = submission?.subtype || (entityType === "T" ? "service" : null);

  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    errors.push(
      `entity_type must be one of P/L/T/E/A (got '${entityType}'). See chittycanon://gov/governance#core-types`,
    );
  }
  if (subtype && VALID_SUBTYPES_BY_ENTITY[entityType] && !VALID_SUBTYPES_BY_ENTITY[entityType].includes(subtype)) {
    errors.push(
      `subtype '${subtype}' not valid for entity_type '${entityType}'. Allowed: ${VALID_SUBTYPES_BY_ENTITY[entityType].join(", ")}`,
    );
  }
  if (AGENT_LIKE_SUBTYPES.includes(subtype) && entityType !== "P") {
    errors.push(
      `subtype '${subtype}' requires entity_type='P' (Person/Synthetic). Agents are actors with agency, not Things.`,
    );
  }

  return { entityType, subtype: subtype ?? null, errors };
}

/**
 * Minimal per-subtype envelope checks that are cheap to run at the broker
 * (name/description/maintainer + the handful of structurally required
 * fields chittyregister itself demands before it will even attempt
 * proof-of-control). This intentionally does NOT re-implement every branch
 * of chittyregister's `validateService()` — that would drift. It exists to
 * catch the common "forgot a required field" case before spending a network
 * round-trip; chittyregister remains authoritative for the full contract.
 *
 * @param {object} submission
 * @param {string} entityType
 * @param {string|null} subtype
 * @returns {string[]} errors (empty when the cheap checks pass)
 */
export function validateEnvelopeBasics(submission, entityType, subtype) {
  const errors = [];
  const isServiceProfile = entityType === "T" && (subtype === "service" || !subtype);

  if (!isServiceProfile) {
    if (!submission.name) errors.push("name is required");
    if (!submission.description) errors.push("description is required");
    if (!submission?.metadata?.maintainer) errors.push("metadata.maintainer is required");

    if (AGENT_LIKE_SUBTYPES.includes(subtype)) {
      if (!submission.entity_class) {
        errors.push(`P/${subtype}: entity_class is required (${AGENT_ENTITY_CLASSES.join(" | ")})`);
      } else if (!AGENT_ENTITY_CLASSES.includes(submission.entity_class)) {
        errors.push(
          `P/${subtype}: entity_class must be one of ${AGENT_ENTITY_CLASSES.join(", ")} (got '${submission.entity_class}')`,
        );
      }
      if (!submission.capability) {
        errors.push(`P/${subtype}: capability is required — the canonical capability this agent projects`);
      }
      if (!Array.isArray(submission.owns) || submission.owns.length === 0) {
        errors.push(`P/${subtype}: owns[] is required — the work this agent is the owner of`);
      }
      if (submission.trust_score !== undefined || submission.trust_level !== undefined) {
        errors.push(`P/${subtype}: trust is not self-declared — remove trust_score/trust_level`);
      }
      if (subtype === "subagent" && !submission.parent_chitty_id) {
        errors.push("P/subagent: parent_chitty_id is required");
      }
    }
  } else {
    if (!submission.name) errors.push("Service name is required");
    if (!submission.description) errors.push("Service description is required");
    if (!submission.version) errors.push("Service version is required");
    if (!submission.endpoints) errors.push("Service endpoints are required");
    if (!submission.schema) errors.push("Service schema is required");
    if (submission.name && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(submission.name)) {
      errors.push("Service name must be kebab-case (lowercase letters, numbers, hyphens only)");
    }
    if (submission.version && !/^\d+\.\d+\.\d+$/.test(submission.version)) {
      errors.push("Version must be semver format (e.g., 1.0.0)");
    }
  }

  return errors;
}

/**
 * Full broker-side validation: entity envelope + cheap per-subtype basics.
 * Returns `{ valid, entityType, subtype, errors }`.
 */
export function validateRegistrationEnvelope(submission) {
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
    return { valid: false, entityType: null, subtype: null, errors: ["submission must be a JSON object"] };
  }
  const { entityType, subtype, errors } = validateEntityEnvelope(submission);
  if (errors.length === 0) {
    errors.push(...validateEnvelopeBasics(submission, entityType, subtype));
  }
  return { valid: errors.length === 0, entityType, subtype, errors };
}
