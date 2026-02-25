/**
 * Context Alchemy - Chemistry-Inspired Naming for Context Operations
 *
 * Maps context lifecycle operations to chemistry/alchemy concepts
 * for intuitive understanding and consistent terminology.
 *
 * ELEMENTS (Context Types):
 * - Noble (Au, Pt): High-trust, stable contexts that don't easily combine
 * - Reactive (Na, K): Low inertia, eager to collaborate
 * - Catalyst (Pd): Enables others without being consumed
 * - Isotope: Same project/anchor, different configuration
 *
 * REACTIONS (Operations):
 * - Fusion: Supernova - two contexts become one (exothermic, releases energy)
 * - Fission: Split - one context becomes many (requires energy input)
 * - Precipitation: Derivative forms from parent solution
 * - Sublimation: Direct state change (context transforms type)
 * - Dissolution: Context breaks down, insights absorbed by others
 * - Suspension: Temporary blend, can separate
 * - Solution: Stable multi-context team
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-alchemy
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/spec/chittyid-format#type-codes
 * - Amalgamation: Soft merge, share properties
 * - Catalysis: One context accelerates another
 * - Distillation: Extract pure essence/competencies
 * - Transmutation: Fundamental change (support type shift)
 *
 * STATES:
 * - Solid: Bound, active, stable
 * - Liquid: Flexible, adaptable
 * - Gas: Dormant, expanded, high entropy
 * - Plasma: High-energy, rapid change
 */

export const ALCHEMY = {
  // Element classifications based on context properties
  ELEMENTS: {
    NOBLE: {
      symbol: "Au",
      name: "Noble",
      description: "High-trust, stable context - rarely combines",
      criteria: { minTrustLevel: 5, minSuccessRate: 0.9, minInteractions: 100 },
    },
    CATALYST: {
      symbol: "Pd",
      name: "Catalyst",
      description: "Accelerates other contexts without being consumed",
      criteria: { supportType: "operations", minCollaborations: 5 },
    },
    REACTIVE: {
      symbol: "Na",
      name: "Reactive",
      description: "Eager to combine and collaborate",
      criteria: { maxTrustLevel: 3, maxInteractions: 50 },
    },
    INERT: {
      symbol: "He",
      name: "Inert",
      description: "Dormant, rarely engages",
      criteria: { status: "dormant", daysSinceActivity: 30 },
    },
  },

  // Reaction types (operations)
  REACTIONS: {
    FUSION: {
      name: "Fusion",
      operation: "supernova",
      description: "Two contexts merge into one, combining all properties",
      energy: "exothermic", // Releases energy (capabilities)
      chittyIdType: "S",
      reversible: false,
      warning: "Irreversible - source contexts will be archived",
    },
    FISSION: {
      name: "Fission",
      operation: "fission",
      description: "One context splits into multiple specialized contexts",
      energy: "endothermic", // Requires energy input (confirmation)
      chittyIdType: "F",
      reversible: false,
      warning: "Irreversible - source context will be archived",
    },
    PRECIPITATION: {
      name: "Precipitation",
      operation: "derivative",
      description:
        "New context crystallizes from parent, inheriting properties",
      energy: "neutral",
      chittyIdType: "D",
      reversible: false,
      note: "Parent remains unchanged",
    },
    SUSPENSION: {
      name: "Suspension",
      operation: "suspension",
      description: "Temporary blend of contexts for a specific task",
      energy: "neutral",
      chittyIdType: "X",
      reversible: true,
      note: "Automatically dissolves when task completes or expires",
    },
    SOLUTION: {
      name: "Solution",
      operation: "solution",
      description: "Stable team of contexts collaborating on a problem",
      energy: "neutral",
      chittyIdType: null, // No new context created
      reversible: true,
      note: "Contexts remain separate but work together",
    },
    AMALGAMATION: {
      name: "Amalgamation",
      operation: "combination",
      description: "Soft merge - contexts share insights but stay separate",
      energy: "neutral",
      chittyIdType: null,
      reversible: true,
      note: "Like mercury amalgam - blended but separable",
    },
    CATALYSIS: {
      name: "Catalysis",
      operation: "collaboration",
      description: "One context accelerates another without being consumed",
      energy: "neutral",
      chittyIdType: null,
      reversible: true,
      note: "Catalyst context enables but doesn't merge",
    },
    DISTILLATION: {
      name: "Distillation",
      operation: "extract",
      description: "Extract pure competencies/patterns from context",
      energy: "endothermic",
      chittyIdType: null,
      reversible: false,
      note: 'Creates shareable "essence" without affecting source',
    },
    TRANSMUTATION: {
      name: "Transmutation",
      operation: "transform",
      description: "Fundamental change of context type (support type shift)",
      energy: "endothermic",
      chittyIdType: null,
      reversible: false,
      warning: "Changes context identity - use carefully",
    },
    DISSOLUTION: {
      name: "Dissolution",
      operation: "decommission",
      description:
        "Context breaks down, insights optionally absorbed by others",
      energy: "exothermic",
      chittyIdType: null,
      reversible: false,
      note: "Archived - can be referenced but not used",
    },
  },

  // State classifications
  STATES: {
    SOLID: {
      name: "Solid",
      status: "active",
      description: "Bound, active, stable - ready for work",
      entropy: "low",
    },
    LIQUID: {
      name: "Liquid",
      status: "active",
      description: "Flexible, adaptable - open to change",
      entropy: "medium",
    },
    GAS: {
      name: "Gas",
      status: "dormant",
      description: "Dormant, expanded - awaiting condensation",
      entropy: "high",
    },
    PLASMA: {
      name: "Plasma",
      status: "transitioning",
      description: "High-energy state during transformation",
      entropy: "maximum",
    },
  },
};

/**
 * Classify a context's elemental type based on its properties
 */
export function classifyElement(profile) {
  const {
    trust_level = 0,
    success_rate = 0,
    total_interactions = 0,
    status = "active",
    support_type,
    anomaly_count = 0,
  } = profile;

  // Noble: High trust, high success, many interactions
  if (trust_level >= 5 && success_rate >= 0.9 && total_interactions >= 100) {
    return { ...ALCHEMY.ELEMENTS.NOBLE, profile: "Exceptional performer" };
  }

  // Inert: Dormant, hasn't been active
  if (status === "dormant" || total_interactions === 0) {
    return { ...ALCHEMY.ELEMENTS.INERT, profile: "Awaiting activation" };
  }

  // Reactive: Low trust, few interactions, eager to prove itself
  if (trust_level <= 3 && total_interactions < 50) {
    return { ...ALCHEMY.ELEMENTS.REACTIVE, profile: "Ready to engage" };
  }

  // Catalyst: Operations support with collaboration history
  if (support_type === "operations") {
    return { ...ALCHEMY.ELEMENTS.CATALYST, profile: "Enabler role" };
  }

  // Default: Standard active context
  return {
    symbol: "Fe",
    name: "Standard",
    description: "Typical working context",
    profile: "Active contributor",
  };
}

/**
 * Suggest appropriate reactions based on context profiles
 */
export function suggestReactions(profile1, profile2 = null) {
  const suggestions = [];
  const element1 = classifyElement(profile1);

  if (!profile2) {
    // Single context - suggest internal operations
    if (profile1.expertise_domains?.length > 3) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.FISSION,
        reason: "Multiple domains could benefit from specialization",
      });
    }

    if (profile1.trust_level >= 4 && profile1.total_interactions > 50) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.DISTILLATION,
        reason: "Mature context - extract shareable patterns",
      });
    }

    if (profile1.anomaly_count > 5) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.TRANSMUTATION,
        reason: "High anomalies - consider role change",
      });
    }
  } else {
    // Two contexts - suggest combination operations
    const element2 = classifyElement(profile2);

    // Same project = good fusion candidates
    if (profile1.project_path === profile2.project_path) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.FUSION,
        reason: "Same project - natural merge candidates",
        risk: "medium",
      });
    }

    // Complementary skills = good for solution/amalgamation
    const comp1 = new Set(
      (profile1.competencies || []).map((c) =>
        typeof c === "string" ? c : c.name,
      ),
    );
    const comp2 = new Set(
      (profile2.competencies || []).map((c) =>
        typeof c === "string" ? c : c.name,
      ),
    );
    const overlap = [...comp1].filter((c) => comp2.has(c)).length;

    if (overlap < comp1.size * 0.3) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.SOLUTION,
        reason: "Complementary skills - strong team potential",
      });
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.AMALGAMATION,
        reason: "Share insights without full merge",
      });
    }

    // Noble + Reactive = Catalysis opportunity
    if (
      (element1.symbol === "Au" && element2.symbol === "Na") ||
      (element1.symbol === "Na" && element2.symbol === "Au")
    ) {
      suggestions.push({
        reaction: ALCHEMY.REACTIONS.CATALYSIS,
        reason: "Experienced context can mentor reactive one",
      });
    }

    // Short-term collaboration = Suspension
    suggestions.push({
      reaction: ALCHEMY.REACTIONS.SUSPENSION,
      reason: "Temporary blend for specific task",
      note: "Use when collaboration is time-bounded",
    });
  }

  return suggestions;
}

/**
 * Get human-readable description of a ChittyID type
 */
export function describeChittyIdType(typeCode) {
  const descriptions = {
    T: { name: "Standard", origin: "Created normally" },
    S: { name: "Supernova", origin: "Fusion of two contexts" },
    F: { name: "Fission", origin: "Split from parent context" },
    D: { name: "Derivative", origin: "Precipitated from parent" },
    X: { name: "Suspension", origin: "Temporary blend" },
  };
  return (
    descriptions[typeCode] || { name: "Unknown", origin: "Unknown origin" }
  );
}

export default ALCHEMY;
