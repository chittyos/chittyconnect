/**
 * ajv schema compiler for v1 broker primitives.
 *
 * Schemas mirror the CHARTER "Git Broker Surface (REST, sensitive)" spec
 * exactly — input + output. The compiled validators are exported for use by
 * route handlers (`src/api/routes/broker-primitives.js`).
 *
 * @canon chittycanon://gov/governance#core-types
 * @canonical-uri chittycanon://core/services/chittyconnect/schemas/v1
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";

import capabilitiesMintInput from "./capabilities.mint.input.json";
import capabilitiesMintOutput from "./capabilities.mint.output.json";
import capabilitiesIntrospectInput from "./capabilities.introspect.input.json";
import capabilitiesIntrospectOutput from "./capabilities.introspect.output.json";
import capabilitiesConfirmInput from "./capabilities.confirm.input.json";
import capabilitiesConfirmOutput from "./capabilities.confirm.output.json";
import policyResolveInput from "./policy.resolve.input.json";
import policyResolveOutput from "./policy.resolve.output.json";
import ledgerEmitInput from "./ledger.emit.input.json";
import ledgerEmitOutput from "./ledger.emit.output.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export const validators = {
  "capabilities.mint.input": ajv.compile(capabilitiesMintInput),
  "capabilities.mint.output": ajv.compile(capabilitiesMintOutput),
  "capabilities.introspect.input": ajv.compile(capabilitiesIntrospectInput),
  "capabilities.introspect.output": ajv.compile(capabilitiesIntrospectOutput),
  "capabilities.confirm.input": ajv.compile(capabilitiesConfirmInput),
  "capabilities.confirm.output": ajv.compile(capabilitiesConfirmOutput),
  "policy.resolve.input": ajv.compile(policyResolveInput),
  "policy.resolve.output": ajv.compile(policyResolveOutput),
  "ledger.emit.input": ajv.compile(ledgerEmitInput),
  "ledger.emit.output": ajv.compile(ledgerEmitOutput),
};

export const schemaNames = Object.keys(validators);

/**
 * Validate `data` against the named schema. Returns `{ valid: true }` on
 * success, or `{ valid: false, errors: [...] }` with ajv error objects.
 */
export function validate(name, data) {
  const v = validators[name];
  if (!v) throw new Error(`Unknown schema: ${name}`);
  const valid = v(data);
  return valid ? { valid: true } : { valid: false, errors: v.errors };
}
