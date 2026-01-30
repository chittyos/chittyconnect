/**
 * Periodic Table of Contexts
 *
 * @deprecated This module is deprecated in favor of context-taxonomy.js
 * The chemistry metaphor adds unnecessary complexity without practical benefit.
 * Use context-taxonomy.js for all context classification needs.
 *
 * @see context-taxonomy.js - The canonical context classification system
 *
 * A predefined taxonomy of context types that can be discovered.
 * Each context type has elemental properties similar to chemical elements.
 *
 * Organization:
 * - Groups (columns): Primary support type
 * - Periods (rows): Complexity/maturity level
 * - Blocks: Functional category
 *
 * Atomic Number: Unique identifier for the context type
 * Symbol: 1-3 letter abbreviation
 * Name: Full name of the context type
 * Group: Support type category
 * Period: Maturity/complexity level (1-7)
 * Block: Functional block (s, p, d, f)
 */

console.warn('[DEPRECATED] context-periodic-table.js is deprecated. Use context-taxonomy.js instead.');

export const CONTEXT_PERIODIC_TABLE = {
  // =============================================================================
  // GROUP 1: DEVELOPMENT CONTEXTS (s-block, highly reactive)
  // =============================================================================

  DEV: {
    atomicNumber: 1,
    symbol: 'De',
    name: 'Developer',
    group: 1,
    period: 1,
    block: 's',
    supportType: 'technical',
    description: 'General software development context',
    characteristics: ['code_writing', 'debugging', 'refactoring'],
    typicalCompetencies: ['javascript', 'typescript', 'python', 'git'],
    compatibleReactions: ['FUSION', 'FISSION', 'SUSPENSION'],
    electronConfig: '[Ne] 3s¹', // Metaphorical
    volatility: 'high',
    color: '#3B82F6', // Blue
  },

  FE: {
    atomicNumber: 2,
    symbol: 'Fe',
    name: 'Frontend',
    group: 1,
    period: 2,
    block: 's',
    supportType: 'technical',
    description: 'Frontend/UI development specialist',
    characteristics: ['ui_development', 'styling', 'responsiveness'],
    typicalCompetencies: ['react', 'vue', 'css', 'tailwind', 'html'],
    compatibleReactions: ['FUSION', 'SUSPENSION', 'SOLUTION'],
    volatility: 'medium',
    color: '#8B5CF6', // Purple
  },

  BE: {
    atomicNumber: 3,
    symbol: 'Be',
    name: 'Backend',
    group: 1,
    period: 3,
    block: 's',
    supportType: 'technical',
    description: 'Backend/API development specialist',
    characteristics: ['api_design', 'database', 'server_logic'],
    typicalCompetencies: ['nodejs', 'python', 'sql', 'rest', 'graphql'],
    compatibleReactions: ['FUSION', 'SUSPENSION', 'CATALYSIS'],
    volatility: 'medium',
    color: '#10B981', // Green
  },

  FS: {
    atomicNumber: 4,
    symbol: 'Fs',
    name: 'Fullstack',
    group: 1,
    period: 4,
    block: 's',
    supportType: 'technical',
    description: 'Full-stack development context',
    characteristics: ['end_to_end', 'integration', 'architecture'],
    typicalCompetencies: ['react', 'nodejs', 'sql', 'docker', 'ci_cd'],
    compatibleReactions: ['FISSION', 'PRECIPITATION'],
    volatility: 'low',
    color: '#F59E0B', // Amber
  },

  // =============================================================================
  // GROUP 2: DATA CONTEXTS (s-block)
  // =============================================================================

  DA: {
    atomicNumber: 5,
    symbol: 'Da',
    name: 'Data Analyst',
    group: 2,
    period: 1,
    block: 's',
    supportType: 'analytical',
    description: 'Data analysis and visualization',
    characteristics: ['data_analysis', 'visualization', 'reporting'],
    typicalCompetencies: ['sql', 'python', 'excel', 'tableau', 'pandas'],
    compatibleReactions: ['SUSPENSION', 'SOLUTION', 'AMALGAMATION'],
    volatility: 'medium',
    color: '#EC4899', // Pink
  },

  DS: {
    atomicNumber: 6,
    symbol: 'Ds',
    name: 'Data Scientist',
    group: 2,
    period: 2,
    block: 's',
    supportType: 'analytical',
    description: 'Machine learning and statistical modeling',
    characteristics: ['ml_modeling', 'statistics', 'experimentation'],
    typicalCompetencies: ['python', 'tensorflow', 'sklearn', 'statistics'],
    compatibleReactions: ['FUSION', 'CATALYSIS', 'DISTILLATION'],
    volatility: 'medium',
    color: '#6366F1', // Indigo
  },

  DE: {
    atomicNumber: 7,
    symbol: 'En',
    name: 'Data Engineer',
    group: 2,
    period: 3,
    block: 's',
    supportType: 'technical',
    description: 'Data pipelines and infrastructure',
    characteristics: ['etl', 'pipelines', 'data_warehousing'],
    typicalCompetencies: ['sql', 'spark', 'airflow', 'aws', 'dbt'],
    compatibleReactions: ['FUSION', 'SUSPENSION'],
    volatility: 'low',
    color: '#14B8A6', // Teal
  },

  // =============================================================================
  // GROUP 3: INFRASTRUCTURE CONTEXTS (p-block)
  // =============================================================================

  DO: {
    atomicNumber: 8,
    symbol: 'Do',
    name: 'DevOps',
    group: 3,
    period: 1,
    block: 'p',
    supportType: 'operations',
    description: 'CI/CD and deployment automation',
    characteristics: ['deployment', 'automation', 'monitoring'],
    typicalCompetencies: ['docker', 'kubernetes', 'terraform', 'github_actions'],
    compatibleReactions: ['CATALYSIS', 'SUSPENSION', 'SOLUTION'],
    volatility: 'high',
    color: '#EF4444', // Red
  },

  SR: {
    atomicNumber: 9,
    symbol: 'Sr',
    name: 'SRE',
    group: 3,
    period: 2,
    block: 'p',
    supportType: 'operations',
    description: 'Site reliability engineering',
    characteristics: ['reliability', 'incident_response', 'slos'],
    typicalCompetencies: ['monitoring', 'alerting', 'runbooks', 'postmortems'],
    compatibleReactions: ['CATALYSIS', 'AMALGAMATION'],
    volatility: 'low',
    color: '#F97316', // Orange
  },

  CL: {
    atomicNumber: 10,
    symbol: 'Cl',
    name: 'Cloud Architect',
    group: 3,
    period: 3,
    block: 'p',
    supportType: 'operations',
    description: 'Cloud infrastructure design',
    characteristics: ['architecture', 'cost_optimization', 'scaling'],
    typicalCompetencies: ['aws', 'gcp', 'azure', 'terraform', 'networking'],
    compatibleReactions: ['FUSION', 'DISTILLATION'],
    volatility: 'low',
    color: '#0EA5E9', // Sky
  },

  // =============================================================================
  // GROUP 4: SECURITY CONTEXTS (p-block)
  // =============================================================================

  SC: {
    atomicNumber: 11,
    symbol: 'Sc',
    name: 'Security',
    group: 4,
    period: 1,
    block: 'p',
    supportType: 'compliance',
    description: 'Application security specialist',
    characteristics: ['vulnerability_assessment', 'code_review', 'threat_modeling'],
    typicalCompetencies: ['owasp', 'penetration_testing', 'encryption'],
    compatibleReactions: ['CATALYSIS', 'AMALGAMATION'],
    volatility: 'low',
    color: '#DC2626', // Red-600
  },

  CP: {
    atomicNumber: 12,
    symbol: 'Cp',
    name: 'Compliance',
    group: 4,
    period: 2,
    block: 'p',
    supportType: 'compliance',
    description: 'Regulatory compliance specialist',
    characteristics: ['audit', 'policy', 'documentation'],
    typicalCompetencies: ['gdpr', 'hipaa', 'sox', 'iso27001'],
    compatibleReactions: ['CATALYSIS', 'SOLUTION'],
    volatility: 'very_low',
    color: '#7C3AED', // Violet
  },

  // =============================================================================
  // GROUP 5: DESIGN CONTEXTS (d-block, transition elements)
  // =============================================================================

  UX: {
    atomicNumber: 13,
    symbol: 'Ux',
    name: 'UX Designer',
    group: 5,
    period: 1,
    block: 'd',
    supportType: 'creative',
    description: 'User experience design',
    characteristics: ['user_research', 'wireframing', 'prototyping'],
    typicalCompetencies: ['figma', 'user_testing', 'information_architecture'],
    compatibleReactions: ['FUSION', 'SUSPENSION', 'SOLUTION'],
    volatility: 'medium',
    color: '#A855F7', // Purple-500
  },

  UI: {
    atomicNumber: 14,
    symbol: 'Ui',
    name: 'UI Designer',
    group: 5,
    period: 2,
    block: 'd',
    supportType: 'creative',
    description: 'Visual interface design',
    characteristics: ['visual_design', 'brand_consistency', 'design_systems'],
    typicalCompetencies: ['figma', 'sketch', 'adobe', 'css'],
    compatibleReactions: ['FUSION', 'SOLUTION'],
    volatility: 'medium',
    color: '#D946EF', // Fuchsia
  },

  // =============================================================================
  // GROUP 6: MANAGEMENT CONTEXTS (d-block)
  // =============================================================================

  PM: {
    atomicNumber: 15,
    symbol: 'Pm',
    name: 'Project Manager',
    group: 6,
    period: 1,
    block: 'd',
    supportType: 'project_management',
    description: 'Project planning and coordination',
    characteristics: ['planning', 'coordination', 'risk_management'],
    typicalCompetencies: ['jira', 'agile', 'scrum', 'stakeholder_management'],
    compatibleReactions: ['CATALYSIS', 'SOLUTION', 'AMALGAMATION'],
    volatility: 'low',
    color: '#22C55E', // Green-500
  },

  PO: {
    atomicNumber: 16,
    symbol: 'Po',
    name: 'Product Owner',
    group: 6,
    period: 2,
    block: 'd',
    supportType: 'project_management',
    description: 'Product vision and backlog management',
    characteristics: ['product_vision', 'backlog_management', 'user_stories'],
    typicalCompetencies: ['product_strategy', 'user_research', 'roadmapping'],
    compatibleReactions: ['CATALYSIS', 'FUSION', 'SOLUTION'],
    volatility: 'low',
    color: '#84CC16', // Lime
  },

  TL: {
    atomicNumber: 17,
    symbol: 'Tl',
    name: 'Tech Lead',
    group: 6,
    period: 3,
    block: 'd',
    supportType: 'project_management',
    description: 'Technical leadership and architecture',
    characteristics: ['architecture', 'mentoring', 'technical_decisions'],
    typicalCompetencies: ['system_design', 'code_review', 'team_leadership'],
    compatibleReactions: ['CATALYSIS', 'DISTILLATION', 'FUSION'],
    volatility: 'low',
    color: '#06B6D4', // Cyan
  },

  // =============================================================================
  // GROUP 7: LEGAL/BUSINESS CONTEXTS (f-block, lanthanides)
  // =============================================================================

  LG: {
    atomicNumber: 18,
    symbol: 'Lg',
    name: 'Legal',
    group: 7,
    period: 1,
    block: 'f',
    supportType: 'legal',
    description: 'Legal analysis and documentation',
    characteristics: ['legal_research', 'contract_review', 'compliance'],
    typicalCompetencies: ['legal_writing', 'case_law', 'regulations'],
    compatibleReactions: ['CATALYSIS', 'AMALGAMATION'],
    volatility: 'very_low',
    color: '#78350F', // Amber-900
  },

  FN: {
    atomicNumber: 19,
    symbol: 'Fn',
    name: 'Finance',
    group: 7,
    period: 2,
    block: 'f',
    supportType: 'financial',
    description: 'Financial analysis and reporting',
    characteristics: ['financial_analysis', 'budgeting', 'forecasting'],
    typicalCompetencies: ['excel', 'financial_modeling', 'accounting'],
    compatibleReactions: ['CATALYSIS', 'SOLUTION'],
    volatility: 'very_low',
    color: '#166534', // Green-800
  },

  // =============================================================================
  // GROUP 8: AI/ML CONTEXTS (f-block, actinides)
  // =============================================================================

  AI: {
    atomicNumber: 20,
    symbol: 'Ai',
    name: 'AI Engineer',
    group: 8,
    period: 1,
    block: 'f',
    supportType: 'technical',
    description: 'AI system development and integration',
    characteristics: ['llm_integration', 'prompt_engineering', 'ai_ops'],
    typicalCompetencies: ['openai', 'anthropic', 'langchain', 'vector_db'],
    compatibleReactions: ['FUSION', 'CATALYSIS', 'DISTILLATION'],
    volatility: 'high',
    color: '#7C3AED', // Violet-600
  },

  ML: {
    atomicNumber: 21,
    symbol: 'Ml',
    name: 'ML Engineer',
    group: 8,
    period: 2,
    block: 'f',
    supportType: 'technical',
    description: 'Machine learning model development',
    characteristics: ['model_training', 'feature_engineering', 'mlops'],
    typicalCompetencies: ['pytorch', 'tensorflow', 'mlflow', 'kubeflow'],
    compatibleReactions: ['FUSION', 'FISSION', 'DISTILLATION'],
    volatility: 'medium',
    color: '#4F46E5', // Indigo-600
  },

  // =============================================================================
  // SPECIAL ELEMENTS (Noble gases - stable, autonomous)
  // =============================================================================

  AU: {
    atomicNumber: 22,
    symbol: 'Au',
    name: 'Autonomous',
    group: 0,
    period: 1,
    block: 'noble',
    supportType: 'autonomous',
    description: 'Fully autonomous, self-sufficient context',
    characteristics: ['self_sufficient', 'stable', 'trusted'],
    typicalCompetencies: ['multi_domain', 'decision_making', 'self_correction'],
    compatibleReactions: [], // Noble gases don't easily react
    volatility: 'inert',
    color: '#FFD700', // Gold
  },

  OR: {
    atomicNumber: 23,
    symbol: 'Or',
    name: 'Orchestrator',
    group: 0,
    period: 2,
    block: 'noble',
    supportType: 'orchestration',
    description: 'Multi-context orchestration and coordination',
    characteristics: ['coordination', 'delegation', 'workflow_management'],
    typicalCompetencies: ['multi_context', 'scheduling', 'resource_allocation'],
    compatibleReactions: ['CATALYSIS'], // Only catalyzes, doesn't fuse
    volatility: 'inert',
    color: '#C0C0C0', // Silver
  },

  // =============================================================================
  // SYNTHETIC ELEMENTS (Created through reactions)
  // =============================================================================

  SN: {
    atomicNumber: 100,
    symbol: 'Sn',
    name: 'Supernova',
    group: -1,
    period: -1,
    block: 'synthetic',
    supportType: 'hybrid',
    description: 'Context created by fusion (Supernova)',
    characteristics: ['merged', 'combined_expertise', 'unified'],
    typicalCompetencies: [], // Inherits from parents
    compatibleReactions: ['FISSION'], // Can split back
    origin: 'FUSION',
    chittyIdType: 'S',
    volatility: 'variable',
    color: '#FF6B6B', // Coral
  },

  FI: {
    atomicNumber: 101,
    symbol: 'Fi',
    name: 'Fission Product',
    group: -1,
    period: -1,
    block: 'synthetic',
    supportType: 'specialized',
    description: 'Context created by fission (split)',
    characteristics: ['specialized', 'focused', 'derived'],
    typicalCompetencies: [], // Subset of parent
    compatibleReactions: ['FUSION', 'SUSPENSION'],
    origin: 'FISSION',
    chittyIdType: 'F',
    volatility: 'medium',
    color: '#4ECDC4', // Teal-light
  },

  DR: {
    atomicNumber: 102,
    symbol: 'Dr',
    name: 'Derivative',
    group: -1,
    period: -1,
    block: 'synthetic',
    supportType: 'inherited',
    description: 'Context derived from parent (fork)',
    characteristics: ['inherited', 'branched', 'evolved'],
    typicalCompetencies: [], // Copy of parent at creation
    compatibleReactions: ['FUSION', 'FISSION', 'SUSPENSION'],
    origin: 'PRECIPITATION',
    chittyIdType: 'D',
    volatility: 'medium',
    color: '#45B7D1', // Cyan-light
  },

  SU: {
    atomicNumber: 103,
    symbol: 'Su',
    name: 'Suspension',
    group: -1,
    period: -1,
    block: 'synthetic',
    supportType: 'temporary',
    description: 'Temporary blend of contexts',
    characteristics: ['temporary', 'task_bound', 'reversible'],
    typicalCompetencies: [], // Combination of participants
    compatibleReactions: ['DISSOLUTION'], // Can dissolve back
    origin: 'SUSPENSION',
    chittyIdType: 'X',
    volatility: 'high',
    color: '#96CEB4', // Sage
  },
};

/**
 * Group metadata - like columns in periodic table
 */
export const GROUPS = {
  0: { name: 'Noble', description: 'Stable, autonomous contexts', color: '#FFD700' },
  1: { name: 'Development', description: 'Code-focused contexts', color: '#3B82F6' },
  2: { name: 'Data', description: 'Data-focused contexts', color: '#EC4899' },
  3: { name: 'Infrastructure', description: 'Operations and infrastructure', color: '#EF4444' },
  4: { name: 'Security', description: 'Security and compliance', color: '#DC2626' },
  5: { name: 'Design', description: 'UX/UI design contexts', color: '#A855F7' },
  6: { name: 'Management', description: 'Project and team leadership', color: '#22C55E' },
  7: { name: 'Business', description: 'Legal, finance, business', color: '#78350F' },
  8: { name: 'AI/ML', description: 'Artificial intelligence', color: '#7C3AED' },
  '-1': { name: 'Synthetic', description: 'Created through reactions', color: '#888888' },
};

/**
 * Block metadata - functional categories
 */
export const BLOCKS = {
  s: { name: 'Reactive', description: 'Highly reactive, eager to collaborate' },
  p: { name: 'Operational', description: 'Infrastructure and operational focus' },
  d: { name: 'Transitional', description: 'Bridge between technical and business' },
  f: { name: 'Specialized', description: 'Deep domain expertise' },
  noble: { name: 'Noble', description: 'Stable and autonomous' },
  synthetic: { name: 'Synthetic', description: 'Created through context reactions' },
};

/**
 * Classify a context into a periodic table element based on its profile
 */
export function classifyContext(profile) {
  const { support_type, competencies = [], expertise_domains = [] } = profile;
  const competencySet = new Set(
    competencies.map((c) => (typeof c === 'string' ? c.toLowerCase() : c.name?.toLowerCase()))
  );
  const domainSet = new Set(expertise_domains.map((d) => d.toLowerCase()));

  // Check for synthetic types first (created through reactions)
  if (profile.chitty_id_type === 'S') return CONTEXT_PERIODIC_TABLE.SN;
  if (profile.chitty_id_type === 'F') return CONTEXT_PERIODIC_TABLE.FI;
  if (profile.chitty_id_type === 'D') return CONTEXT_PERIODIC_TABLE.DR;
  if (profile.chitty_id_type === 'X') return CONTEXT_PERIODIC_TABLE.SU;

  // Check for noble/autonomous
  if (profile.trust_level >= 5 && profile.total_interactions > 200) {
    return CONTEXT_PERIODIC_TABLE.AU;
  }

  // Match by support type and competencies
  const matches = [];

  for (const [key, element] of Object.entries(CONTEXT_PERIODIC_TABLE)) {
    if (element.block === 'synthetic' || element.block === 'noble') continue;

    let score = 0;

    // Support type match
    if (element.supportType === support_type) score += 3;

    // Competency overlap
    const elementComps = new Set(element.typicalCompetencies.map((c) => c.toLowerCase()));
    const overlap = [...competencySet].filter((c) => elementComps.has(c)).length;
    score += overlap * 2;

    // Domain match with characteristics
    const charSet = new Set(element.characteristics);
    const domainOverlap = [...domainSet].filter((d) => charSet.has(d)).length;
    score += domainOverlap * 2;

    if (score > 0) {
      matches.push({ key, element, score });
    }
  }

  // Sort by score and return best match
  matches.sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    return { ...matches[0].element, matchScore: matches[0].score, alternatives: matches.slice(1, 3) };
  }

  // Default to generic Developer if no match
  return { ...CONTEXT_PERIODIC_TABLE.DEV, matchScore: 0, note: 'Default classification' };
}

/**
 * Get compatible reaction partners for a context element
 */
export function getCompatiblePartners(element, allContexts) {
  const compatible = [];

  for (const context of allContexts) {
    const otherElement = classifyContext(context);

    // Same element types can fuse
    if (element.symbol === otherElement.symbol) {
      compatible.push({
        context,
        element: otherElement,
        recommendedReaction: 'FUSION',
        reason: 'Same context type - natural merge candidates',
      });
      continue;
    }

    // s-block elements are reactive with each other
    if (element.block === 's' && otherElement.block === 's') {
      compatible.push({
        context,
        element: otherElement,
        recommendedReaction: 'SUSPENSION',
        reason: 'Both reactive - good for temporary collaboration',
      });
      continue;
    }

    // d-block (transitional) works well with both s and p
    if (element.block === 'd' && (otherElement.block === 's' || otherElement.block === 'p')) {
      compatible.push({
        context,
        element: otherElement,
        recommendedReaction: 'SOLUTION',
        reason: 'Transitional element bridges technical and operational',
      });
      continue;
    }

    // Noble elements catalyze others
    if (element.block === 'noble' || otherElement.block === 'noble') {
      compatible.push({
        context,
        element: otherElement,
        recommendedReaction: 'CATALYSIS',
        reason: 'Noble element can mentor/accelerate',
      });
    }
  }

  return compatible;
}

/**
 * Generate visual periodic table data for dashboard
 */
export function generatePeriodicTableView() {
  const table = [];
  const maxPeriod = 4;
  const maxGroup = 8;

  // Build grid layout
  for (let period = 1; period <= maxPeriod; period++) {
    const row = [];
    for (let group = 0; group <= maxGroup; group++) {
      const element = Object.values(CONTEXT_PERIODIC_TABLE).find(
        (e) => e.period === period && e.group === group && e.block !== 'synthetic'
      );
      row.push(element || null);
    }
    table.push(row);
  }

  // Add synthetic elements row
  const syntheticRow = Object.values(CONTEXT_PERIODIC_TABLE).filter((e) => e.block === 'synthetic');

  return {
    mainTable: table,
    syntheticElements: syntheticRow,
    groups: GROUPS,
    blocks: BLOCKS,
    legend: {
      volatility: {
        high: 'Eager to react and collaborate',
        medium: 'Balanced reactivity',
        low: 'Stable, prefers consistency',
        very_low: 'Highly stable, resists change',
        inert: 'Noble - self-sufficient',
        variable: 'Depends on composition',
      },
    },
  };
}

/**
 * Get element discovery status for a user's contexts
 */
export function getDiscoveryStatus(userContexts) {
  const discovered = new Set();
  const discoveryDetails = [];

  for (const context of userContexts) {
    const element = classifyContext(context);
    if (!discovered.has(element.symbol)) {
      discovered.add(element.symbol);
      discoveryDetails.push({
        symbol: element.symbol,
        name: element.name,
        discoveredAt: context.created_at,
        contextId: context.chitty_id,
        contextName: context.name,
      });
    }
  }

  const allElements = Object.values(CONTEXT_PERIODIC_TABLE).filter((e) => e.block !== 'synthetic');
  const undiscovered = allElements.filter((e) => !discovered.has(e.symbol));

  return {
    totalElements: allElements.length,
    discovered: discovered.size,
    undiscovered: undiscovered.length,
    completionPercentage: Math.round((discovered.size / allElements.length) * 100),
    discoveredElements: discoveryDetails,
    undiscoveredElements: undiscovered.map((e) => ({
      symbol: e.symbol,
      name: e.name,
      hint: e.description,
      group: GROUPS[e.group]?.name,
    })),
    syntheticElements: Object.values(CONTEXT_PERIODIC_TABLE)
      .filter((e) => e.block === 'synthetic')
      .map((e) => ({
        symbol: e.symbol,
        name: e.name,
        origin: e.origin,
        howToCreate: `Perform ${e.origin} reaction`,
      })),
  };
}

export default CONTEXT_PERIODIC_TABLE;
