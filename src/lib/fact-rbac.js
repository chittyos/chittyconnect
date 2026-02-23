// src/lib/fact-rbac.js
/**
 * Fact Governance RBAC
 *
 * Access control for fact lifecycle operations using ChittyID
 * entity types and ChittyTrust levels.
 *
 * @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
 * @canon: chittycanon://gov/governance#core-types
 *
 * @module lib/fact-rbac
 */

import { resolveTrustLevel, TRUST_LEVELS } from "./trust-resolver.js";

/**
 * Fact governance action definitions.
 * Each action specifies required entity types and minimum trust level.
 */
export const FACT_ACTIONS = {
  SEAL: {
    name: "seal",
    entity_types: ["A"],       // Authority only
    min_trust: TRUST_LEVELS.INSTITUTIONAL,
  },
  DISPUTE: {
    name: "dispute",
    entity_types: ["P", "A"],  // Person or Authority
    min_trust: TRUST_LEVELS.ENHANCED,
  },
  EXPORT: {
    name: "export",
    entity_types: null,        // Any authenticated entity
    min_trust: TRUST_LEVELS.BASIC,
  },
};

/**
 * Check if an entity has permission for a fact governance action.
 *
 * @param {string} chittyId - Actor ChittyID
 * @param {object} action - FACT_ACTIONS member
 * @param {object} env - Worker environment
 * @returns {Promise<{allowed: boolean, trust_level: number, entity_type: string, required_level: number, action: string, reason?: string}>}
 */
export async function checkFactPermission(chittyId, action, env) {
  const { trust_level, entity_type } = await resolveTrustLevel(chittyId, env);

  const base = {
    trust_level,
    entity_type,
    required_level: action.min_trust,
    action: action.name,
  };

  // Check entity type constraint
  if (action.entity_types && !action.entity_types.includes(entity_type)) {
    return {
      ...base,
      allowed: false,
      reason: `Action "${action.name}" requires entity type ${action.entity_types.join(" or ")}, got "${entity_type}"`,
    };
  }

  // Check trust level
  if (trust_level < action.min_trust) {
    return {
      ...base,
      allowed: false,
      reason: `Action "${action.name}" requires trust level ${action.min_trust}, got ${trust_level}`,
    };
  }

  return { ...base, allowed: true };
}
