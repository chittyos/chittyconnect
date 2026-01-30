/**
 * Context Taxonomy
 *
 * Practical categorization of context types for:
 * 1. Automatic classification based on competencies
 * 2. Discovery tracking (what types has user encountered)
 * 3. Recommending compatible contexts for collaboration
 *
 * This is the canonical classification system for context types.
 * The over-engineered "periodic table" (context-periodic-table.js) is deprecated.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-taxonomy
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/spec/context-types
 */

export const CONTEXT_TYPES = {
  // =============================================================================
  // TECHNICAL CONTEXTS
  // =============================================================================
  DEVELOPER: {
    id: 'developer',
    name: 'Developer',
    category: 'technical',
    description: 'General software development',
    indicators: {
      competencies: ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'git'],
      domains: ['coding', 'development', 'programming', 'software'],
    },
    collaboratesWellWith: ['devops', 'frontend', 'backend', 'qa'],
    color: '#3B82F6',
  },

  FRONTEND: {
    id: 'frontend',
    name: 'Frontend',
    category: 'technical',
    description: 'UI/Frontend development',
    indicators: {
      competencies: ['react', 'vue', 'angular', 'svelte', 'css', 'tailwind', 'html', 'figma'],
      domains: ['ui', 'frontend', 'user_interface', 'web'],
    },
    collaboratesWellWith: ['ux_designer', 'backend', 'developer'],
    color: '#8B5CF6',
  },

  BACKEND: {
    id: 'backend',
    name: 'Backend',
    category: 'technical',
    description: 'API/Backend development',
    indicators: {
      competencies: ['nodejs', 'express', 'fastapi', 'django', 'sql', 'graphql', 'rest', 'postgres', 'mongodb'],
      domains: ['backend', 'api', 'server', 'database'],
    },
    collaboratesWellWith: ['frontend', 'devops', 'data_engineer'],
    color: '#10B981',
  },

  DEVOPS: {
    id: 'devops',
    name: 'DevOps',
    category: 'operations',
    description: 'CI/CD and infrastructure',
    indicators: {
      competencies: ['docker', 'kubernetes', 'terraform', 'ansible', 'github_actions', 'jenkins', 'aws', 'gcp'],
      domains: ['deployment', 'ci_cd', 'infrastructure', 'automation'],
    },
    collaboratesWellWith: ['developer', 'sre', 'cloud_architect'],
    color: '#EF4444',
  },

  SRE: {
    id: 'sre',
    name: 'SRE',
    category: 'operations',
    description: 'Site reliability engineering',
    indicators: {
      competencies: ['monitoring', 'prometheus', 'grafana', 'datadog', 'pagerduty', 'runbooks'],
      domains: ['reliability', 'observability', 'incident_response', 'slos'],
    },
    collaboratesWellWith: ['devops', 'backend', 'cloud_architect'],
    color: '#F97316',
  },

  // =============================================================================
  // DATA CONTEXTS
  // =============================================================================
  DATA_ANALYST: {
    id: 'data_analyst',
    name: 'Data Analyst',
    category: 'data',
    description: 'Data analysis and visualization',
    indicators: {
      competencies: ['sql', 'excel', 'tableau', 'looker', 'pandas', 'jupyter'],
      domains: ['analysis', 'reporting', 'visualization', 'metrics'],
    },
    collaboratesWellWith: ['data_engineer', 'product_manager'],
    color: '#EC4899',
  },

  DATA_ENGINEER: {
    id: 'data_engineer',
    name: 'Data Engineer',
    category: 'data',
    description: 'Data pipelines and warehousing',
    indicators: {
      competencies: ['spark', 'airflow', 'dbt', 'snowflake', 'redshift', 'kafka', 'etl'],
      domains: ['pipelines', 'etl', 'data_warehouse', 'streaming'],
    },
    collaboratesWellWith: ['data_analyst', 'data_scientist', 'backend'],
    color: '#14B8A6',
  },

  DATA_SCIENTIST: {
    id: 'data_scientist',
    name: 'Data Scientist',
    category: 'data',
    description: 'ML modeling and statistics',
    indicators: {
      competencies: ['python', 'sklearn', 'tensorflow', 'pytorch', 'statistics', 'jupyter', 'r'],
      domains: ['machine_learning', 'statistics', 'modeling', 'experimentation'],
    },
    collaboratesWellWith: ['data_engineer', 'ml_engineer', 'product_manager'],
    color: '#6366F1',
  },

  // =============================================================================
  // AI/ML CONTEXTS
  // =============================================================================
  AI_ENGINEER: {
    id: 'ai_engineer',
    name: 'AI Engineer',
    category: 'ai',
    description: 'AI integration and LLM ops',
    indicators: {
      competencies: ['openai', 'anthropic', 'langchain', 'llm', 'vector_db', 'embeddings', 'rag'],
      domains: ['ai', 'llm', 'prompt_engineering', 'agents'],
    },
    collaboratesWellWith: ['ml_engineer', 'backend', 'product_manager'],
    color: '#7C3AED',
  },

  ML_ENGINEER: {
    id: 'ml_engineer',
    name: 'ML Engineer',
    category: 'ai',
    description: 'ML model training and deployment',
    indicators: {
      competencies: ['pytorch', 'tensorflow', 'mlflow', 'kubeflow', 'sagemaker', 'model_serving'],
      domains: ['ml_ops', 'model_training', 'feature_engineering', 'model_deployment'],
    },
    collaboratesWellWith: ['data_scientist', 'ai_engineer', 'devops'],
    color: '#4F46E5',
  },

  // =============================================================================
  // DESIGN CONTEXTS
  // =============================================================================
  UX_DESIGNER: {
    id: 'ux_designer',
    name: 'UX Designer',
    category: 'design',
    description: 'User experience design',
    indicators: {
      competencies: ['figma', 'sketch', 'user_testing', 'wireframing', 'prototyping'],
      domains: ['ux', 'user_research', 'information_architecture', 'usability'],
    },
    collaboratesWellWith: ['ui_designer', 'frontend', 'product_manager'],
    color: '#A855F7',
  },

  UI_DESIGNER: {
    id: 'ui_designer',
    name: 'UI Designer',
    category: 'design',
    description: 'Visual interface design',
    indicators: {
      competencies: ['figma', 'sketch', 'adobe', 'design_systems', 'css'],
      domains: ['visual_design', 'branding', 'design_tokens', 'iconography'],
    },
    collaboratesWellWith: ['ux_designer', 'frontend'],
    color: '#D946EF',
  },

  // =============================================================================
  // MANAGEMENT CONTEXTS
  // =============================================================================
  PROJECT_MANAGER: {
    id: 'project_manager',
    name: 'Project Manager',
    category: 'management',
    description: 'Project planning and coordination',
    indicators: {
      competencies: ['jira', 'asana', 'agile', 'scrum', 'kanban', 'gantt'],
      domains: ['planning', 'coordination', 'risk_management', 'stakeholders'],
    },
    collaboratesWellWith: ['product_manager', 'tech_lead', 'developer'],
    color: '#22C55E',
  },

  PRODUCT_MANAGER: {
    id: 'product_manager',
    name: 'Product Manager',
    category: 'management',
    description: 'Product vision and strategy',
    indicators: {
      competencies: ['product_strategy', 'roadmapping', 'user_stories', 'okrs', 'analytics'],
      domains: ['product', 'backlog', 'prioritization', 'customer_research'],
    },
    collaboratesWellWith: ['ux_designer', 'tech_lead', 'data_analyst'],
    color: '#84CC16',
  },

  TECH_LEAD: {
    id: 'tech_lead',
    name: 'Tech Lead',
    category: 'management',
    description: 'Technical leadership',
    indicators: {
      competencies: ['architecture', 'code_review', 'mentoring', 'system_design'],
      domains: ['technical_decisions', 'team_leadership', 'standards'],
    },
    collaboratesWellWith: ['developer', 'project_manager', 'devops'],
    color: '#06B6D4',
  },

  // =============================================================================
  // SECURITY/COMPLIANCE CONTEXTS
  // =============================================================================
  SECURITY: {
    id: 'security',
    name: 'Security Engineer',
    category: 'security',
    description: 'Application and infrastructure security',
    indicators: {
      competencies: ['owasp', 'penetration_testing', 'encryption', 'sast', 'dast', 'siem'],
      domains: ['security', 'vulnerabilities', 'threat_modeling', 'authentication'],
    },
    collaboratesWellWith: ['devops', 'compliance', 'backend'],
    color: '#DC2626',
  },

  COMPLIANCE: {
    id: 'compliance',
    name: 'Compliance',
    category: 'security',
    description: 'Regulatory compliance',
    indicators: {
      competencies: ['gdpr', 'hipaa', 'sox', 'pci', 'iso27001', 'audit'],
      domains: ['compliance', 'regulations', 'policy', 'audit'],
    },
    collaboratesWellWith: ['security', 'legal'],
    color: '#7C3AED',
  },

  // =============================================================================
  // BUSINESS CONTEXTS
  // =============================================================================
  LEGAL: {
    id: 'legal',
    name: 'Legal',
    category: 'business',
    description: 'Legal analysis and documentation',
    indicators: {
      competencies: ['contracts', 'legal_writing', 'regulations', 'case_law'],
      domains: ['legal', 'contracts', 'litigation', 'compliance'],
    },
    collaboratesWellWith: ['compliance', 'finance'],
    color: '#78350F',
  },

  FINANCE: {
    id: 'finance',
    name: 'Finance',
    category: 'business',
    description: 'Financial analysis',
    indicators: {
      competencies: ['excel', 'financial_modeling', 'accounting', 'forecasting', 'budgeting'],
      domains: ['finance', 'accounting', 'budgeting', 'forecasting'],
    },
    collaboratesWellWith: ['legal', 'data_analyst'],
    color: '#166534',
  },

  // =============================================================================
  // SPECIAL/SYNTHETIC TYPES (created through operations)
  // =============================================================================
  SUPERNOVA: {
    id: 'supernova',
    name: 'Supernova',
    category: 'synthetic',
    description: 'Merged context (fusion product)',
    indicators: { competencies: [], domains: [] },
    origin: 'Created by merging two contexts',
    chittyIdType: 'S',
    color: '#FF6B6B',
  },

  FISSION: {
    id: 'fission',
    name: 'Fission Product',
    category: 'synthetic',
    description: 'Split context (fission product)',
    indicators: { competencies: [], domains: [] },
    origin: 'Created by splitting a context',
    chittyIdType: 'F',
    color: '#4ECDC4',
  },

  DERIVATIVE: {
    id: 'derivative',
    name: 'Derivative',
    category: 'synthetic',
    description: 'Forked context (derivative)',
    indicators: { competencies: [], domains: [] },
    origin: 'Created as a fork of another context',
    chittyIdType: 'D',
    color: '#45B7D1',
  },

  SUSPENSION: {
    id: 'suspension',
    name: 'Suspension',
    category: 'synthetic',
    description: 'Temporary blend',
    indicators: { competencies: [], domains: [] },
    origin: 'Temporary collaboration context',
    chittyIdType: 'X',
    color: '#96CEB4',
  },

  // Fallback
  GENERAL: {
    id: 'general',
    name: 'General',
    category: 'general',
    description: 'General purpose context',
    indicators: { competencies: [], domains: [] },
    collaboratesWellWith: [],
    color: '#6B7280',
  },
};

/**
 * Categories for grouping context types
 */
export const CATEGORIES = {
  technical: { name: 'Technical', description: 'Software development', color: '#3B82F6' },
  operations: { name: 'Operations', description: 'Infrastructure and DevOps', color: '#EF4444' },
  data: { name: 'Data', description: 'Data and analytics', color: '#EC4899' },
  ai: { name: 'AI/ML', description: 'AI and machine learning', color: '#7C3AED' },
  design: { name: 'Design', description: 'UX and UI design', color: '#A855F7' },
  management: { name: 'Management', description: 'Project and product management', color: '#22C55E' },
  security: { name: 'Security', description: 'Security and compliance', color: '#DC2626' },
  business: { name: 'Business', description: 'Legal and finance', color: '#78350F' },
  synthetic: { name: 'Synthetic', description: 'Created through reactions', color: '#6B7280' },
  general: { name: 'General', description: 'General purpose', color: '#6B7280' },
};

/**
 * Classify a context based on its profile
 *
 * @param {Object} profile - Context profile with competencies, domains, support_type
 * @returns {Object} - Matched context type with confidence score
 */
export function classifyContext(profile) {
  const { support_type, competencies = [], expertise_domains = [] } = profile;

  // Normalize inputs
  const compSet = new Set(
    competencies.map((c) => (typeof c === 'string' ? c.toLowerCase() : c.name?.toLowerCase())).filter(Boolean)
  );
  const domainSet = new Set(expertise_domains.map((d) => d.toLowerCase()));

  // Check for synthetic types first (created through reactions)
  if (profile.chitty_id_type === 'S') return { type: CONTEXT_TYPES.SUPERNOVA, confidence: 1.0, reason: 'Created by fusion' };
  if (profile.chitty_id_type === 'F') return { type: CONTEXT_TYPES.FISSION, confidence: 1.0, reason: 'Created by fission' };
  if (profile.chitty_id_type === 'D') return { type: CONTEXT_TYPES.DERIVATIVE, confidence: 1.0, reason: 'Created as derivative' };
  if (profile.chitty_id_type === 'X') return { type: CONTEXT_TYPES.SUSPENSION, confidence: 1.0, reason: 'Temporary suspension' };

  const scores = [];

  for (const [key, type] of Object.entries(CONTEXT_TYPES)) {
    if (type.category === 'synthetic' || type.id === 'general') continue;

    let score = 0;
    const reasons = [];

    // Check competency overlap
    const typeComps = new Set(type.indicators.competencies.map((c) => c.toLowerCase()));
    const compOverlap = [...compSet].filter((c) => typeComps.has(c));
    if (compOverlap.length > 0) {
      score += compOverlap.length * 2;
      reasons.push(`Competencies: ${compOverlap.join(', ')}`);
    }

    // Check domain overlap
    const typeDomains = new Set(type.indicators.domains.map((d) => d.toLowerCase()));
    const domainOverlap = [...domainSet].filter((d) => typeDomains.has(d));
    if (domainOverlap.length > 0) {
      score += domainOverlap.length * 3;
      reasons.push(`Domains: ${domainOverlap.join(', ')}`);
    }

    if (score > 0) {
      scores.push({ key, type, score, reasons });
    }
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  if (scores.length > 0) {
    const best = scores[0];
    const maxPossible = (best.type.indicators.competencies.length * 2) + (best.type.indicators.domains.length * 3);
    const confidence = Math.min(1.0, best.score / Math.max(maxPossible, 1));

    return {
      type: best.type,
      confidence: Math.round(confidence * 100) / 100,
      reason: best.reasons.join('; '),
      alternatives: scores.slice(1, 3).map((s) => ({
        type: s.type,
        confidence: Math.round((s.score / Math.max(maxPossible, 1)) * 100) / 100,
      })),
    };
  }

  return {
    type: CONTEXT_TYPES.GENERAL,
    confidence: 0,
    reason: 'No strong indicators matched',
  };
}

/**
 * Find contexts that would collaborate well with a given type
 */
export function findCollaborators(contextType, availableContexts) {
  const collaborators = contextType.collaboratesWellWith || [];
  const matches = [];

  for (const context of availableContexts) {
    const classification = classifyContext(context);
    if (collaborators.includes(classification.type.id)) {
      matches.push({
        context,
        type: classification.type,
        reason: `${contextType.name} collaborates well with ${classification.type.name}`,
      });
    }
  }

  return matches;
}

/**
 * Get discovery status - which types has the user encountered
 */
export function getDiscoveryStatus(userContexts) {
  const discovered = new Map();

  for (const context of userContexts) {
    const classification = classifyContext(context);
    const typeId = classification.type.id;

    if (!discovered.has(typeId)) {
      discovered.set(typeId, {
        type: classification.type,
        firstDiscoveredAt: context.created_at,
        contextId: context.chitty_id,
        contextName: context.name,
      });
    }
  }

  const allTypes = Object.values(CONTEXT_TYPES).filter((t) => t.category !== 'synthetic' && t.id !== 'general');
  const undiscovered = allTypes.filter((t) => !discovered.has(t.id));

  return {
    total: allTypes.length,
    discovered: discovered.size,
    percentage: Math.round((discovered.size / allTypes.length) * 100),
    discoveredTypes: Array.from(discovered.values()),
    undiscoveredTypes: undiscovered.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      hint: t.description,
      indicators: t.indicators,
    })),
  };
}

/**
 * Get summary grouped by category
 */
export function getTaxonomySummary() {
  const byCategory = {};

  for (const type of Object.values(CONTEXT_TYPES)) {
    if (!byCategory[type.category]) {
      byCategory[type.category] = {
        ...CATEGORIES[type.category],
        types: [],
      };
    }
    byCategory[type.category].types.push({
      id: type.id,
      name: type.name,
      description: type.description,
      color: type.color,
    });
  }

  return byCategory;
}

export default CONTEXT_TYPES;
