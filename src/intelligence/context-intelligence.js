/**
 * Context Intelligence Service
 *
 * The decision-making brain that USES context DNA to:
 * - Decide what actions to take
 * - Detect context drift and recommend switches
 * - Suggest relevant tools (Alchemy)
 * - Determine autonomy levels based on trust
 * - Route requests based on expertise
 * - Apply guardrails based on risk profile
 * - Manage collaborations and delegations
 * - Handle supernova (merge) and fission (split) operations
 * - Manage context pairs (complementary relationships)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-intelligence
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/spec/chittyid-format
 */

/**
 * Mint a ChittyID via the canonical ChittyID service
 * Falls back to validated local generation only if service is unavailable
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-intelligence
 * @param {Object} env - Worker environment with service URLs
 * @param {string} entityType - Canonical type code: P (Person). Lifecycle provenance (supernova, fission, derivative, suspension) is metadata, not entity type.
 * @param {Object} metadata - Additional minting metadata
 * @returns {Promise<string>} - Minted ChittyID
 */
async function mintChittyId(env, entityType, metadata = {}) {
  const serviceUrl = env.CHITTYID_SERVICE_URL || "https://id.chitty.cc";

  try {
    const response = await fetch(`${serviceUrl}/api/v1/mint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CHITTY_ID_SERVICE_TOKEN || ""}`,
      },
      body: JSON.stringify({
        entity_type: entityType,
        support_type: metadata.supportType || "development",
        project_path: metadata.projectPath,
        organization: metadata.organization,
        metadata: {
          source: "context-intelligence",
          lifecycle: metadata.lifecycle,
          operation: metadata.operation,
          source_contexts: metadata.sourceContexts,
        },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.chitty_id) {
        return data.chitty_id;
      }
    }

    // Service responded but didn't return valid ID - fall through to fallback
    console.warn(
      "[ContextIntelligence] ChittyID service returned invalid response, using fallback",
    );
  } catch (error) {
    console.warn(
      "[ContextIntelligence] ChittyID service unavailable, using fallback:",
      error.message,
    );
  }

  // Fallback: Generate locally with validated format
  // Format: VV-G-LLL-SSSS-T-YYMM-C-XX
  // Per chittycanon://docs/tech/spec/chittyid-format
  const version = "03";
  const generation = "1";
  const locale = "USA";
  const sequence = Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0");
  const now = new Date();
  const yearMonth = `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  const checksum = "0";
  const variant = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");

  return `${version}-${generation}-${locale}-${sequence}-${entityType}-${yearMonth}-${checksum}-${variant}`;
}

export class ContextIntelligence {
  constructor(env) {
    this.env = env;
    this.db = env.DB;

    // Tool categories mapped to competencies/domains
    this.toolRegistry = {
      wrangler: {
        competencies: ["cloudflare-workers", "deployment"],
        domains: ["backend-development", "infrastructure"],
      },
      d1: {
        competencies: ["d1", "sql", "database"],
        domains: ["backend-development", "data"],
      },
      vectorize: {
        competencies: ["ai", "embeddings", "vector-search"],
        domains: ["ai-development", "search"],
      },
      typescript: {
        competencies: ["typescript", "javascript"],
        domains: ["frontend-development", "backend-development"],
      },
      git: {
        competencies: ["git", "version-control"],
        domains: ["development"],
      },
      chittyid_mint: {
        competencies: ["identity", "chittyos"],
        domains: ["identity-management"],
      },
      chitty_evidence_ingest: {
        competencies: ["evidence", "legal"],
        domains: ["legal", "evidence-management"],
      },
      chitty_case_create: {
        competencies: ["legal", "case-management"],
        domains: ["legal"],
      },
      chitty_finance_connect: {
        competencies: ["finance", "banking"],
        domains: ["financial"],
      },
      notion_query: {
        competencies: ["notion", "documentation"],
        domains: ["documentation", "project-management"],
      },
      neon_query: {
        competencies: ["postgresql", "sql", "database"],
        domains: ["backend-development", "data"],
      },
    };

    // Risk levels for operations
    this.operationRisks = {
      read: 0,
      write: 1,
      delete: 3,
      deploy_staging: 2,
      deploy_production: 4,
      secret_access: 4,
      financial_transaction: 5,
      legal_filing: 5,
      permission_change: 4,
      data_export: 3,
    };

    // Autonomy thresholds by trust level
    this.autonomyThresholds = {
      0: { maxRisk: 0, autoApprove: [] },
      1: { maxRisk: 0, autoApprove: ["read"] },
      2: { maxRisk: 1, autoApprove: ["read", "write"] },
      3: { maxRisk: 2, autoApprove: ["read", "write", "deploy_staging"] },
      4: {
        maxRisk: 3,
        autoApprove: ["read", "write", "deploy_staging", "delete"],
      },
      5: {
        maxRisk: 4,
        autoApprove: [
          "read",
          "write",
          "deploy_staging",
          "deploy_production",
          "delete",
          "data_export",
        ],
      },
    };
  }

  // ============ CORE: Load Profile ============

  async loadContextProfile(chittyId) {
    const result = await this.db
      .prepare(
        `
      SELECT ce.*, cd.patterns, cd.traits, cd.competencies,
             cd.expertise_domains, cd.total_interactions, cd.total_decisions,
             cd.success_rate, cd.anomaly_count, cd.last_anomaly_at
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.chitty_id = ? AND ce.status IN ('active', 'dormant')
    `,
      )
      .bind(chittyId)
      .first();

    if (!result) return null;

    // Destructure out preferences — it is not part of the context profile.
    // Preferences are user-level, not context DNA.
    const { preferences: _unused, ...rest } = result;

    return {
      ...rest,
      patterns: JSON.parse(result.patterns || "[]"),
      traits: JSON.parse(result.traits || "[]"),
      competencies: JSON.parse(result.competencies || "[]"),
      expertise_domains: JSON.parse(result.expertise_domains || "[]"),
      current_sessions: JSON.parse(result.current_sessions || "[]"),
    };
  }

  // ============ COHERENCE: Should we switch contexts? ============

  async analyzeContextCoherence(boundChittyId, currentHints) {
    const profile = await this.loadContextProfile(boundChittyId);
    if (!profile)
      return { recommendation: "error", reason: "Context not found" };

    const coherenceScore = this.calculateCoherence(profile, currentHints);
    const driftIndicators = this.detectDriftIndicators(profile, currentHints);
    const alternatives = await this.findBetterContexts(
      currentHints,
      boundChittyId,
    );

    if (coherenceScore >= 0.7) {
      return {
        recommendation: "continue",
        coherenceScore,
        reason: "Work aligns with context",
      };
    } else if (coherenceScore >= 0.4 && driftIndicators.isExpansion) {
      return {
        recommendation: "expand",
        coherenceScore,
        expansionAreas: driftIndicators.newDomains,
        confirm: true,
      };
    } else if (
      alternatives.length > 0 &&
      alternatives[0].score > coherenceScore + 0.2
    ) {
      return {
        recommendation: "switch",
        coherenceScore,
        suggestedContext: alternatives[0],
      };
    } else if (coherenceScore < 0.3) {
      return {
        recommendation: "new",
        coherenceScore,
        reason: "Work differs significantly",
      };
    }
    return {
      recommendation: "confirm",
      coherenceScore,
      driftIndicators,
      alternatives,
    };
  }

  calculateCoherence(profile, hints) {
    let score = 0,
      factors = 0;
    if (hints.projectPath) {
      factors += 3;
      if (profile.project_path === hints.projectPath) score += 3;
      else if (this.pathsRelated(profile.project_path, hints.projectPath))
        score += 1.5;
    }
    if (hints.workspace) {
      factors += 1;
      if (profile.workspace === hints.workspace) score += 1;
    }
    if (hints.supportType) {
      factors += 2;
      if (profile.support_type === hints.supportType) score += 2;
    }
    return factors > 0 ? score / factors : 0.5;
  }

  detectDriftIndicators(profile, hints) {
    const existingDomains = new Set(profile.expertise_domains);
    const newDomains = (hints.domains || []).filter(
      (d) => !existingDomains.has(d),
    );
    const projectChanged =
      hints.projectPath && profile.project_path !== hints.projectPath;
    return {
      newDomains,
      projectChanged,
      isExpansion:
        !projectChanged && newDomains.length > 0 && newDomains.length <= 2,
      isDrift: projectChanged || newDomains.length > 3,
    };
  }

  async findBetterContexts(hints, excludeChittyId) {
    const results = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains
      FROM context_entities ce LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status IN ('active', 'dormant') AND ce.chitty_id != ?
        AND (ce.project_path = ? OR ce.support_type = ?)
      LIMIT 10
    `,
      )
      .bind(excludeChittyId, hints.projectPath || "", hints.supportType || "")
      .all();

    return results.results
      .map((ctx) => ({
        chittyId: ctx.chitty_id,
        score: this.calculateCoherence(
          {
            ...ctx,
            competencies: JSON.parse(ctx.competencies || "[]"),
            expertise_domains: JSON.parse(ctx.expertise_domains || "[]"),
          },
          hints,
        ),
      }))
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score);
  }

  // ============ ALCHEMY: Tool Suggestions ============

  suggestTools(profile) {
    const competencyNames = new Set(
      profile.competencies.map((c) => (typeof c === "string" ? c : c.name)),
    );
    const domainNames = new Set(profile.expertise_domains);
    const suggestions = [];

    for (const [tool, req] of Object.entries(this.toolRegistry)) {
      const compMatch = req.competencies.some((c) => competencyNames.has(c));
      const domMatch = req.domains.some((d) => domainNames.has(d));
      if (compMatch || domMatch) {
        suggestions.push({
          tool,
          relevance: (compMatch ? 0.6 : 0) + (domMatch ? 0.4 : 0),
        });
      }
    }
    return suggestions.sort((a, b) => b.relevance - a.relevance).slice(0, 10);
  }

  // ============ AUTONOMY: What can auto-approve ============

  determineAutonomy(profile) {
    const trustLevel = profile.trust_level || 0;
    let maxRisk = this.autonomyThresholds[trustLevel].maxRisk;
    if (profile.anomaly_count > 5) maxRisk = Math.max(0, maxRisk - 2);
    else if (profile.anomaly_count > 2) maxRisk = Math.max(0, maxRisk - 1);
    if (profile.success_rate > 0.9 && profile.total_decisions > 50)
      maxRisk = Math.min(5, maxRisk + 1);

    const autoApprove = Object.entries(this.operationRisks)
      .filter(([, risk]) => risk <= maxRisk)
      .map(([op]) => op);
    const requiresConfirm = Object.entries(this.operationRisks)
      .filter(([, risk]) => risk > maxRisk)
      .map(([op, risk]) => ({ operation: op, risk }));

    return { trustLevel, maxRisk, autoApprove, requiresConfirm };
  }

  // ============ GUARDRAILS: Restrictions ============

  determineGuardrails(profile) {
    const guardrails = [];
    if (profile.trust_level < 2)
      guardrails.push({ type: "confirmation_required", scope: "all_writes" });
    if (profile.anomaly_count > 3)
      guardrails.push({ type: "enhanced_logging", scope: "all_operations" });
    if (profile.success_rate < 0.5 && profile.total_decisions > 10) {
      guardrails.push({
        type: "additional_validation",
        scope: "complex_operations",
      });
    }
    return guardrails;
  }

  // ============ ROUTING: Where to send requests ============

  determineRouting(profile) {
    const routes = {
      development: "chittyconnect",
      operations: "chittymonitor",
      legal: "chittycases",
      financial: "chittyfinance",
    };
    return { primary: routes[profile.support_type] || "chittyconnect" };
  }

  // ============ COLLABORATION: Contexts as Team Members ============

  async findCollaborators(projectHints, requiredCompetencies = []) {
    const results = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate
      FROM context_entities ce LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status = 'active' AND ce.trust_level >= 2
      ORDER BY ce.trust_score DESC LIMIT 50
    `,
      )
      .all();

    const candidates = [];
    for (const ctx of results.results) {
      const competencies = JSON.parse(ctx.competencies || "[]");
      const compNames = competencies.map((c) =>
        typeof c === "string" ? c : c.name,
      );
      const matched = requiredCompetencies.filter((r) => compNames.includes(r));
      if (matched.length > 0) {
        candidates.push({
          chittyId: ctx.chitty_id,
          supportType: ctx.support_type,
          trustLevel: ctx.trust_level,
          matchedCompetencies: matched,
          score: matched.length * 2 + ctx.trust_level * 0.5,
        });
      }
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  async createCollaboration(
    parentChittyId,
    childChittyId,
    projectId,
    scope,
    permissions,
  ) {
    const parent = await this.loadContextProfile(parentChittyId);
    const child = await this.loadContextProfile(childChittyId);
    if (!parent || !child) return { error: "Context not found" };
    if (parent.trust_level < 3)
      return { error: "Parent needs trust level 3+ to delegate" };

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `
      INSERT INTO context_collaborations (id, parent_context_id, parent_chitty_id,
        child_context_id, child_chitty_id, project_id, scope, permissions, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch())
    `,
      )
      .bind(
        id,
        parent.id,
        parentChittyId,
        child.id,
        childChittyId,
        projectId,
        JSON.stringify(scope),
        JSON.stringify(permissions),
      )
      .run();

    return { collaborationId: id, status: "active" };
  }

  // ============ CONTEXT PAIRS: Complementary Relationships ============

  async createContextPair(chittyId1, chittyId2, relationship) {
    const ctx1 = await this.loadContextProfile(chittyId1);
    const ctx2 = await this.loadContextProfile(chittyId2);
    if (!ctx1 || !ctx2) return { error: "One or both contexts not found" };

    // Analyze complementarity
    const comp1 = new Set(
      ctx1.competencies.map((c) => (typeof c === "string" ? c : c.name)),
    );
    const comp2 = new Set(
      ctx2.competencies.map((c) => (typeof c === "string" ? c : c.name)),
    );
    const overlap = [...comp1].filter((c) => comp2.has(c));
    const unique1 = [...comp1].filter((c) => !comp2.has(c));
    const unique2 = [...comp2].filter((c) => !comp1.has(c));

    const complementarity =
      unique1.length + unique2.length > overlap.length
        ? "complementary"
        : "overlapping";

    const pairId = crypto.randomUUID();
    await this.db
      .prepare(
        `
      INSERT INTO context_pairs (id, context_id_1, chitty_id_1, context_id_2, chitty_id_2,
        relationship_type, complementarity, overlap_competencies, unique_competencies_1,
        unique_competencies_2, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch())
    `,
      )
      .bind(
        pairId,
        ctx1.id,
        chittyId1,
        ctx2.id,
        chittyId2,
        relationship,
        complementarity,
        JSON.stringify(overlap),
        JSON.stringify(unique1),
        JSON.stringify(unique2),
      )
      .run();

    return {
      pairId,
      relationship,
      complementarity,
      overlap,
      unique1,
      unique2,
      recommendation:
        complementarity === "complementary"
          ? "Great pairing - contexts bring different strengths"
          : "Consider if both contexts are needed - significant overlap",
    };
  }

  async getContextPairs(chittyId) {
    const pairs = await this.db
      .prepare(
        `
      SELECT * FROM context_pairs
      WHERE (chitty_id_1 = ? OR chitty_id_2 = ?) AND status = 'active'
    `,
      )
      .bind(chittyId, chittyId)
      .all();

    return pairs.results.map((p) => ({
      pairId: p.id,
      partner: p.chitty_id_1 === chittyId ? p.chitty_id_2 : p.chitty_id_1,
      relationship: p.relationship_type,
      complementarity: p.complementarity,
    }));
  }

  // ============ SUPERNOVA: Context Merging ============

  async analyzeSupernova(chittyId1, chittyId2) {
    const ctx1 = await this.loadContextProfile(chittyId1);
    const ctx2 = await this.loadContextProfile(chittyId2);
    if (!ctx1 || !ctx2) return { error: "Context not found" };

    // Compatibility analysis
    const sameSupport = ctx1.support_type === ctx2.support_type;
    const relatedProjects = this.pathsRelated(
      ctx1.project_path,
      ctx2.project_path,
    );
    const trustDiff = Math.abs(ctx1.trust_level - ctx2.trust_level);
    const totalAnomalies =
      (ctx1.anomaly_count || 0) + (ctx2.anomaly_count || 0);

    const risks = [];
    if (trustDiff > 2) risks.push({ type: "trust_dilution", severity: "high" });
    if (!sameSupport) risks.push({ type: "role_conflict", severity: "medium" });
    if (totalAnomalies > 5)
      risks.push({ type: "anomaly_accumulation", severity: "high" });
    if (!relatedProjects)
      risks.push({ type: "identity_confusion", severity: "high" });

    // Merged preview
    const comp1 = ctx1.competencies.map((c) =>
      typeof c === "string" ? c : c.name,
    );
    const comp2 = ctx2.competencies.map((c) =>
      typeof c === "string" ? c : c.name,
    );
    const mergedCompetencies = [...new Set([...comp1, ...comp2])];
    const mergedDomains = [
      ...new Set([...ctx1.expertise_domains, ...ctx2.expertise_domains]),
    ];

    const riskLevel =
      risks.filter((r) => r.severity === "high").length > 1
        ? "critical"
        : risks.length > 2
          ? "warning"
          : "info";

    return {
      contexts: [
        {
          chittyId: chittyId1,
          supportType: ctx1.support_type,
          trustLevel: ctx1.trust_level,
        },
        {
          chittyId: chittyId2,
          supportType: ctx2.support_type,
          trustLevel: ctx2.trust_level,
        },
      ],
      risks,
      riskLevel,
      mergedPreview: {
        competencies: mergedCompetencies,
        domains: mergedDomains,
        trustLevel: Math.min(ctx1.trust_level, ctx2.trust_level),
      },
      recommendation:
        riskLevel === "critical"
          ? "discourage"
          : riskLevel === "warning"
            ? "caution"
            : "consider",
    };
  }

  async executeSupernova(chittyId1, chittyId2, confirmationToken) {
    if (!confirmationToken) return { error: "Confirmation required" };

    const analysis = await this.analyzeSupernova(chittyId1, chittyId2);
    if (analysis.error) return analysis;
    if (analysis.recommendation === "discourage")
      return { error: "Supernova discouraged", analysis };

    const ctx1 = await this.loadContextProfile(chittyId1);
    const ctx2 = await this.loadContextProfile(chittyId2);

    // Create merged context with canonical ChittyID
    const mergedId = crypto.randomUUID();
    const mergedChittyId = await mintChittyId(this.env, "P", {
      lifecycle: "supernova",
      operation: "supernova",
      supportType: ctx1.support_type,
      projectPath: ctx1.project_path,
      organization: ctx1.organization,
      sourceContexts: [chittyId1, chittyId2],
    });

    await this.db
      .prepare(
        `
      INSERT INTO context_entities (id, chitty_id, context_hash, project_path, workspace,
        support_type, organization, signature, issuer, trust_score, trust_level, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'supernova', ?, ?, 'active')
    `,
      )
      .bind(
        mergedId,
        mergedChittyId,
        `supernova:${ctx1.context_hash}:${ctx2.context_hash}`,
        ctx1.project_path,
        ctx1.workspace,
        ctx1.support_type,
        ctx1.organization,
        `supernova:${chittyId1}+${chittyId2}`,
        (ctx1.trust_score + ctx2.trust_score) / 2,
        Math.min(ctx1.trust_level, ctx2.trust_level),
      )
      .run();

    // Create merged DNA
    await this.db
      .prepare(
        `
      INSERT INTO context_dna (id, context_id, context_chitty_id, competencies, expertise_domains,
        total_interactions, success_rate, anomaly_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        crypto.randomUUID(),
        mergedId,
        mergedChittyId,
        JSON.stringify(analysis.mergedPreview.competencies),
        JSON.stringify(analysis.mergedPreview.domains),
        (ctx1.total_interactions || 0) + (ctx2.total_interactions || 0),
        ((ctx1.success_rate || 0) + (ctx2.success_rate || 0)) / 2,
        (ctx1.anomaly_count || 0) + (ctx2.anomaly_count || 0),
      )
      .run();

    // Archive source contexts
    await this.db
      .prepare(
        `UPDATE context_entities SET status = 'archived' WHERE chitty_id IN (?, ?)`,
      )
      .bind(chittyId1, chittyId2)
      .run();

    return {
      success: true,
      mergedChittyId,
      sourceContexts: [chittyId1, chittyId2],
      analysis,
    };
  }

  // ============ FISSION: Context Splitting ============

  async analyzeFission(chittyId, splitCriteria) {
    const ctx = await this.loadContextProfile(chittyId);
    if (!ctx) return { error: "Context not found" };

    const { splitBy = "domain" } = splitCriteria;
    let proposedSplits = [];

    if (splitBy === "domain") {
      // Split by expertise domains
      const domains = ctx.expertise_domains;
      if (domains.length < 2) return { error: "Not enough domains to split" };

      const domainGroups = this.groupDomains(domains);
      proposedSplits = domainGroups.map((group) => ({
        domains: group,
        competencies: ctx.competencies.filter((c) => {
          const name = typeof c === "string" ? c : c.name;
          return this.competencyMatchesDomains(name, group);
        }),
      }));
    } else if (splitBy === "supportType") {
      // Split development from operations, etc.
      proposedSplits = [
        {
          supportType: "development",
          keep: ["typescript", "javascript", "react", "api-design"],
        },
        {
          supportType: "operations",
          keep: ["deployment", "monitoring", "infrastructure"],
        },
      ];
    }

    return {
      sourceContext: {
        chittyId,
        supportType: ctx.support_type,
        trustLevel: ctx.trust_level,
      },
      proposedSplits,
      recommendation: proposedSplits.length >= 2 ? "viable" : "not_recommended",
      warning: "Fission will archive the original context and create new ones",
    };
  }

  async executeFission(chittyId, splitConfig, confirmationToken) {
    if (!confirmationToken) return { error: "Confirmation required" };

    const ctx = await this.loadContextProfile(chittyId);
    if (!ctx) return { error: "Context not found" };

    const newContexts = [];

    for (const split of splitConfig.splits) {
      const newId = crypto.randomUUID();
      const newChittyId = await mintChittyId(this.env, "P", {
        lifecycle: "fission",
        operation: "fission",
        supportType: split.supportType || ctx.support_type,
        projectPath: ctx.project_path,
        organization: ctx.organization,
        sourceContexts: [chittyId],
      });

      await this.db
        .prepare(
          `
        INSERT INTO context_entities (id, chitty_id, context_hash, project_path, workspace,
          support_type, organization, signature, issuer, trust_score, trust_level, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fission', ?, ?, 'active')
      `,
        )
        .bind(
          newId,
          newChittyId,
          `fission:${ctx.context_hash}:${split.label}`,
          ctx.project_path,
          ctx.workspace,
          split.supportType || ctx.support_type,
          ctx.organization,
          `fission:${chittyId}`,
          ctx.trust_score,
          ctx.trust_level,
        )
        .run();

      await this.db
        .prepare(
          `
        INSERT INTO context_dna (id, context_id, context_chitty_id, competencies, expertise_domains)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .bind(
          crypto.randomUUID(),
          newId,
          newChittyId,
          JSON.stringify(split.competencies || []),
          JSON.stringify(split.domains || []),
        )
        .run();

      newContexts.push({ chittyId: newChittyId, label: split.label });
    }

    // Archive source
    await this.db
      .prepare(
        `UPDATE context_entities SET status = 'archived' WHERE chitty_id = ?`,
      )
      .bind(chittyId)
      .run();

    return { success: true, sourceArchived: chittyId, newContexts };
  }

  // ============ DERIVATIVE: Fork a Context ============

  async createDerivative(sourceChittyId, derivativeConfig) {
    const source = await this.loadContextProfile(sourceChittyId);
    if (!source) return { error: "Source context not found" };

    const {
      label,
      projectPath,
      supportType,
      inheritCompetencies = true,
      inheritDomains = true,
    } = derivativeConfig;

    const derivativeId = crypto.randomUUID();
    const derivativeChittyId = await mintChittyId(this.env, "P", {
      lifecycle: "derivative",
      operation: "derivative",
      supportType: supportType || source.support_type,
      projectPath: projectPath || source.project_path,
      organization: source.organization,
      sourceContexts: [sourceChittyId],
    });

    // Create derivative context
    await this.db
      .prepare(
        `
      INSERT INTO context_entities (id, chitty_id, context_hash, project_path, workspace,
        support_type, organization, signature, issuer, trust_score, trust_level, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'derivative', ?, ?, 'active')
    `,
      )
      .bind(
        derivativeId,
        derivativeChittyId,
        `derivative:${source.context_hash}:${label}`,
        projectPath || source.project_path,
        source.workspace,
        supportType || source.support_type,
        source.organization,
        `derivative:${sourceChittyId}`,
        source.trust_score * 0.8, // Derivatives start at 80% of parent trust
        Math.max(1, source.trust_level - 1), // One level below parent
      )
      .run();

    // Create DNA (inherit or start fresh)
    await this.db
      .prepare(
        `
      INSERT INTO context_dna (id, context_id, context_chitty_id, competencies, expertise_domains)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .bind(
        crypto.randomUUID(),
        derivativeId,
        derivativeChittyId,
        inheritCompetencies ? JSON.stringify(source.competencies) : "[]",
        inheritDomains ? JSON.stringify(source.expertise_domains) : "[]",
      )
      .run();

    // Track lineage
    await this.db
      .prepare(
        `
      INSERT INTO context_lifecycle_events (id, event_type, source_chitty_ids, result_chitty_ids, trigger_reason)
      VALUES (?, 'derivative_created', ?, ?, ?)
    `,
      )
      .bind(
        crypto.randomUUID(),
        JSON.stringify([sourceChittyId]),
        JSON.stringify([derivativeChittyId]),
        `derivative:${label}`,
      )
      .run();

    return {
      derivativeChittyId,
      sourceChittyId,
      label,
      inherited: { competencies: inheritCompetencies, domains: inheritDomains },
      trustLevel: Math.max(1, source.trust_level - 1),
    };
  }

  // ============ SUSPENSION: Temporary Context Blend ============

  async createSuspension(contextIds, suspensionConfig) {
    const { taskDescription, expiresIn = 86400 } = suspensionConfig; // Default 24h

    if (contextIds.length < 2)
      return { error: "Need at least 2 contexts for suspension" };

    // Load all contexts
    const contexts = [];
    for (const id of contextIds) {
      const ctx = await this.loadContextProfile(id);
      if (!ctx) return { error: `Context ${id} not found` };
      contexts.push(ctx);
    }

    // Create suspension (temporary blend) with canonical ChittyID
    const suspensionId = crypto.randomUUID();
    const suspensionChittyId = await mintChittyId(this.env, "P", {
      lifecycle: "suspension",
      operation: "suspension",
      supportType: contexts[0].support_type,
      projectPath: contexts[0].project_path,
      organization: contexts[0].organization,
      sourceContexts: contextIds,
    });

    // Blend competencies from all sources
    const allCompetencies = new Map();
    const allDomains = new Set();
    for (const ctx of contexts) {
      for (const comp of ctx.competencies) {
        const name = typeof comp === "string" ? comp : comp.name;
        if (!allCompetencies.has(name))
          allCompetencies.set(name, { name, level: 1, count: 0, sources: [] });
        const existing = allCompetencies.get(name);
        existing.level = Math.max(
          existing.level,
          typeof comp === "string" ? 1 : comp.level || 1,
        );
        existing.count++;
        existing.sources.push(ctx.chitty_id);
      }
      ctx.expertise_domains.forEach((d) => allDomains.add(d));
    }

    // Use minimum trust (most conservative)
    const minTrust = Math.min(...contexts.map((c) => c.trust_level));

    await this.db
      .prepare(
        `
      INSERT INTO context_entities (id, chitty_id, context_hash, project_path, workspace,
        support_type, organization, signature, issuer, trust_score, trust_level, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suspension', ?, ?, 'active')
    `,
      )
      .bind(
        suspensionId,
        suspensionChittyId,
        `suspension:${contextIds.join("+")}`,
        contexts[0].project_path,
        contexts[0].workspace,
        contexts[0].support_type,
        contexts[0].organization,
        `suspension:${contextIds.join("+")}`,
        Math.min(...contexts.map((c) => c.trust_score)),
        minTrust,
      )
      .run();

    await this.db
      .prepare(
        `
      INSERT INTO context_dna (id, context_id, context_chitty_id, competencies, expertise_domains)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .bind(
        crypto.randomUUID(),
        suspensionId,
        suspensionChittyId,
        JSON.stringify(Array.from(allCompetencies.values())),
        JSON.stringify(Array.from(allDomains)),
      )
      .run();

    // Store suspension metadata for expiry
    await this.db
      .prepare(
        `
      INSERT INTO context_lifecycle_events (id, event_type, source_chitty_ids, result_chitty_ids, analysis, trigger_reason)
      VALUES (?, 'suspension_created', ?, ?, ?, ?)
    `,
      )
      .bind(
        crypto.randomUUID(),
        JSON.stringify(contextIds),
        JSON.stringify([suspensionChittyId]),
        JSON.stringify({
          taskDescription,
          expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
        }),
        taskDescription,
      )
      .run();

    return {
      suspensionChittyId,
      sourceContexts: contextIds,
      task: taskDescription,
      expiresIn,
      blendedCompetencies: Array.from(allCompetencies.keys()),
      blendedDomains: Array.from(allDomains),
      trustLevel: minTrust,
    };
  }

  async dissolveSuspension(suspensionChittyId, rollbackMetrics = true) {
    // Archive the suspension
    await this.db
      .prepare(
        `
      UPDATE context_entities SET status = 'dissolved' WHERE chitty_id = ? AND issuer = 'suspension'
    `,
      )
      .bind(suspensionChittyId)
      .run();

    // Get the original contexts
    const event = await this.db
      .prepare(
        `
      SELECT source_chitty_ids, analysis FROM context_lifecycle_events
      WHERE result_chitty_ids LIKE ? AND event_type = 'suspension_created'
    `,
      )
      .bind(`%${suspensionChittyId}%`)
      .first();

    const sourceIds = event ? JSON.parse(event.source_chitty_ids) : [];

    await this.db
      .prepare(
        `
      INSERT INTO context_lifecycle_events (id, event_type, source_chitty_ids, result_chitty_ids, trigger_reason)
      VALUES (?, 'suspension_dissolved', ?, ?, 'task_complete_or_expired')
    `,
      )
      .bind(
        crypto.randomUUID(),
        JSON.stringify([suspensionChittyId]),
        JSON.stringify(sourceIds),
      )
      .run();

    return { dissolved: true, suspensionChittyId, restoredContexts: sourceIds };
  }

  // ============ SOLUTION: Team of Contexts ============

  async createSolution(contextIds, solutionConfig) {
    const { problemDescription, roles = {} } = solutionConfig;

    if (contextIds.length < 2)
      return { error: "Need at least 2 contexts for a solution" };

    const solutionId = crypto.randomUUID();

    // Create solution record
    await this.db
      .prepare(
        `
      INSERT INTO context_collaborations (id, parent_context_id, parent_chitty_id,
        child_context_id, child_chitty_id, project_id, scope, permissions, status, started_at)
      VALUES (?, 'solution', 'solution', 'solution', ?, ?, ?, '["collaborate"]', 'active', unixepoch())
    `,
      )
      .bind(
        solutionId,
        contextIds.join(","),
        problemDescription,
        JSON.stringify({ type: "solution", members: contextIds, roles }),
      )
      .run();

    // Assign roles if specified, otherwise infer
    const members = [];
    for (const chittyId of contextIds) {
      const profile = await this.loadContextProfile(chittyId);
      if (!profile) continue;

      const role =
        roles[chittyId] ||
        this.inferRole(
          profile.support_type,
          profile.competencies.map((c) => (typeof c === "string" ? c : c.name)),
          profile.expertise_domains,
        );

      members.push({
        chittyId,
        role,
        trustLevel: profile.trust_level,
        strengths: profile.competencies
          .slice(0, 3)
          .map((c) => (typeof c === "string" ? c : c.name)),
      });
    }

    return {
      solutionId,
      problem: problemDescription,
      members,
      status: "active",
    };
  }

  async getSolution(solutionId) {
    const solution = await this.db
      .prepare(
        `
      SELECT * FROM context_collaborations WHERE id = ? AND scope LIKE '%"type":"solution"%'
    `,
      )
      .bind(solutionId)
      .first();

    if (!solution) return { error: "Solution not found" };

    const scope = JSON.parse(solution.scope);
    return {
      solutionId,
      problem: solution.project_id,
      members: scope.members,
      roles: scope.roles,
      status: solution.status,
    };
  }

  // ============ COMBINATION: Soft Merge (Share Insights) ============

  async createCombination(chittyId1, chittyId2, combinationConfig = {}) {
    const {
      shareDirection = "bidirectional",
      shareDomains = true,
      shareCompetencies = true,
    } = combinationConfig;

    const ctx1 = await this.loadContextProfile(chittyId1);
    const ctx2 = await this.loadContextProfile(chittyId2);
    if (!ctx1 || !ctx2) return { error: "One or both contexts not found" };

    // Create combination record (soft link, no merge)
    const combinationId = crypto.randomUUID();

    await this.db
      .prepare(
        `
      INSERT INTO context_pairs (id, context_id_1, chitty_id_1, context_id_2, chitty_id_2,
        relationship_type, complementarity, overlap_competencies, unique_competencies_1,
        unique_competencies_2, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'combination', 'synergistic', ?, ?, ?, 'active', unixepoch())
    `,
      )
      .bind(
        combinationId,
        ctx1.id,
        chittyId1,
        ctx2.id,
        chittyId2,
        JSON.stringify({ shareDirection, shareDomains, shareCompetencies }),
        JSON.stringify([]),
        JSON.stringify([]),
      )
      .run();

    // If sharing, cross-pollinate insights (add to DNA without removing)
    if (
      shareDomains &&
      (shareDirection === "bidirectional" || shareDirection === "1to2")
    ) {
      await this.crossPollinateDomains(ctx1, ctx2);
    }
    if (
      shareDomains &&
      (shareDirection === "bidirectional" || shareDirection === "2to1")
    ) {
      await this.crossPollinateDomains(ctx2, ctx1);
    }

    return {
      combinationId,
      contexts: [chittyId1, chittyId2],
      shareDirection,
      shared: { domains: shareDomains, competencies: shareCompetencies },
      note: "Contexts remain separate but now share insights",
    };
  }

  async crossPollinateDomains(fromCtx, toCtx) {
    // Add domains from fromCtx to toCtx's DNA
    const toDna = await this.db
      .prepare(
        `SELECT expertise_domains FROM context_dna WHERE context_chitty_id = ?`,
      )
      .bind(toCtx.chitty_id)
      .first();

    if (!toDna) return;

    const currentDomains = JSON.parse(toDna.expertise_domains || "[]");
    const newDomains = [
      ...new Set([...currentDomains, ...fromCtx.expertise_domains]),
    ];

    await this.db
      .prepare(
        `UPDATE context_dna SET expertise_domains = ? WHERE context_chitty_id = ?`,
      )
      .bind(JSON.stringify(newDomains), toCtx.chitty_id)
      .run();
  }

  // ============ FULL SESSION DECISIONS ============

  async getSessionDecisions(chittyId, currentHints = {}) {
    const profile = await this.loadContextProfile(chittyId);
    if (!profile) return { error: "Context not found" };

    return {
      profile: this.summarizeProfile(profile),
      coherence: await this.analyzeContextCoherence(chittyId, currentHints),
      alchemy: this.suggestTools(profile),
      autonomy: this.determineAutonomy(profile),
      guardrails: this.determineGuardrails(profile),
      routing: this.determineRouting(profile),
      pairs: await this.getContextPairs(chittyId),
      timestamp: new Date().toISOString(),
    };
  }

  // ============ HELPERS ============

  summarizeProfile(profile) {
    return {
      chittyId: profile.chitty_id,
      projectPath: profile.project_path,
      supportType: profile.support_type,
      trustLevel: profile.trust_level,
      totalInteractions: profile.total_interactions,
      successRate: profile.success_rate
        ? Math.round(profile.success_rate * 100)
        : null,
      competencies: profile.competencies
        .slice(0, 5)
        .map((c) => (typeof c === "string" ? c : c.name)),
    };
  }

  pathsRelated(path1, path2) {
    if (!path1 || !path2) return false;
    return path1.startsWith(path2) || path2.startsWith(path1);
  }

  groupDomains(domains) {
    // Simple grouping - in reality would use ML clustering
    const devDomains = domains.filter(
      (d) => d.includes("development") || d.includes("api"),
    );
    const opsDomains = domains.filter(
      (d) => d.includes("operations") || d.includes("infrastructure"),
    );
    const otherDomains = domains.filter(
      (d) => !devDomains.includes(d) && !opsDomains.includes(d),
    );
    return [devDomains, opsDomains, otherDomains].filter((g) => g.length > 0);
  }

  competencyMatchesDomains(competency, domains) {
    const mappings = {
      typescript: [
        "development",
        "frontend-development",
        "backend-development",
      ],
      deployment: ["operations", "infrastructure"],
      kubernetes: ["operations", "infrastructure"],
    };
    return (mappings[competency] || []).some((d) =>
      domains.some((dom) => dom.includes(d)),
    );
  }
}

export default ContextIntelligence;
