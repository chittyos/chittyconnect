/**
 * Relationship Engine
 *
 * Discovers direct, inferred, temporal, and contextual relationships
 * between context entities using D1-backed signals.
 *
 * @module intelligence/relationship-engine
 */

export class RelationshipEngine {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.ai = env.AI;
  }

  async initialize() {
    console.log(
      "[RelationshipEngine] Initializing relationship intelligence...",
    );
    console.log("[RelationshipEngine] Ready");
  }

  async discoverRelationships(chittyId, options = {}) {
    const limit = this.clampNumber(options.limit, 1, 50, 15);
    const includeSummary = options.includeSummary !== false;

    const entity = await this.getEntitySnapshot(chittyId);
    if (!entity) {
      throw new Error(`Entity not found: ${chittyId}`);
    }

    const [direct, inferred, temporal, contextual] = await Promise.all([
      this.discoverDirectRelationships(entity, limit),
      this.inferRelationships(entity, limit),
      this.discoverTemporalRelationships(chittyId, limit),
      this.discoverContextualRelationships(chittyId, limit),
    ]);

    const strength = this.calculateRelationshipStrength({
      direct,
      inferred,
      temporal,
      contextual,
    });

    let summary = null;
    if (includeSummary) {
      summary = await this.generateSummary({
        entity,
        direct,
        inferred,
        temporal,
        contextual,
        strength,
      });
    }

    return {
      entity: {
        chitty_id: entity.chitty_id,
        support_type: entity.support_type || null,
        workspace: entity.workspace || null,
        project_path: entity.project_path || null,
      },
      direct,
      inferred,
      temporal,
      contextual,
      strength,
      summary,
    };
  }

  async getHealth() {
    try {
      const entities = await this.db
        .prepare("SELECT COUNT(*) as count FROM context_entities")
        .first();
      const exposures = await this.db
        .prepare("SELECT COUNT(*) as count FROM context_exposure_log")
        .first();
      const events = await this.db
        .prepare("SELECT COUNT(*) as count FROM context_behavioral_events")
        .first();

      return {
        available: true,
        indexedEntities: entities?.count || 0,
        exposureRecords: exposures?.count || 0,
        behavioralEvents: events?.count || 0,
      };
    } catch (error) {
      return {
        available: true,
        error: error.message,
      };
    }
  }

  async getEntitySnapshot(chittyId) {
    const row = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.patterns
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.chitty_id = ?
      LIMIT 1
    `,
      )
      .bind(chittyId)
      .first();

    if (!row) return null;

    return {
      ...row,
      competencies: this.safeJson(row.competencies, []),
      expertise_domains: this.safeJson(row.expertise_domains, []),
      patterns: this.safeJson(row.patterns, []),
    };
  }

  async loadPeerCandidates(chittyId, limit = 200) {
    const results = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.patterns
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status IN ('active', 'dormant')
        AND ce.chitty_id != ?
      LIMIT ?
    `,
      )
      .bind(chittyId, limit)
      .all();

    return (results?.results || []).map((row) => ({
      ...row,
      competencies: this.safeJson(row.competencies, []),
      expertise_domains: this.safeJson(row.expertise_domains, []),
      patterns: this.safeJson(row.patterns, []),
    }));
  }

  async discoverDirectRelationships(entity, limit) {
    const peers = await this.loadPeerCandidates(
      entity.chitty_id,
      Math.max(120, limit * 10),
    );
    const scored = [];

    for (const peer of peers) {
      let score = 0;
      const reasons = [];

      if (
        entity.project_path &&
        peer.project_path &&
        entity.project_path === peer.project_path
      ) {
        score += 0.5;
        reasons.push("shared_project_path");
      }

      if (
        entity.workspace &&
        peer.workspace &&
        entity.workspace === peer.workspace
      ) {
        score += 0.2;
        reasons.push("shared_workspace");
      }

      if (
        entity.support_type &&
        peer.support_type &&
        entity.support_type === peer.support_type
      ) {
        score += 0.15;
        reasons.push("shared_support_type");
      }

      if (
        entity.organization &&
        peer.organization &&
        entity.organization === peer.organization
      ) {
        score += 0.1;
        reasons.push("shared_organization");
      }

      const trustA = Number(entity.trust_level || 0);
      const trustB = Number(peer.trust_level || 0);
      if (!Number.isNaN(trustA) && !Number.isNaN(trustB)) {
        const diff = Math.abs(trustA - trustB);
        score += Math.max(0, 0.05 - diff * 0.01);
      }

      score = Math.min(1, score);
      if (score < 0.25) continue;

      scored.push({
        chitty_id: peer.chitty_id,
        relationship_type: this.primaryRelationshipType(reasons),
        reasons,
        score: Number(score.toFixed(3)),
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async inferRelationships(entity, limit) {
    const peers = await this.loadPeerCandidates(
      entity.chitty_id,
      Math.max(150, limit * 12),
    );
    const inferred = [];

    for (const peer of peers) {
      const competencyOverlap = this.jaccard(
        entity.competencies,
        peer.competencies,
      );
      const domainOverlap = this.jaccard(
        entity.expertise_domains,
        peer.expertise_domains,
      );
      const patternOverlap = this.patternOverlap(
        entity.patterns,
        peer.patterns,
      );

      const confidence =
        competencyOverlap * 0.6 + domainOverlap * 0.35 + patternOverlap * 0.05;

      if (confidence < 0.2) continue;

      inferred.push({
        chitty_id: peer.chitty_id,
        relationship_type: "inferred_similarity",
        confidence: Number(confidence.toFixed(3)),
        shared_competencies: this.intersection(
          entity.competencies,
          peer.competencies,
        ).slice(0, 8),
        shared_domains: this.intersection(
          entity.expertise_domains,
          peer.expertise_domains,
        ).slice(0, 8),
      });
    }

    return inferred.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }

  async discoverTemporalRelationships(chittyId, limit) {
    try {
      const baseEvents = await this.db
        .prepare(
          `
        SELECT event_type, detected_at
        FROM context_behavioral_events
        WHERE context_chitty_id = ?
        ORDER BY detected_at DESC
        LIMIT 60
      `,
        )
        .bind(chittyId)
        .all();

      const baseCount = (baseEvents?.results || []).length;
      if (baseCount === 0) return [];

      const windowSeconds = 2 * 60 * 60;

      const result = await this.db
        .prepare(
          `
        SELECT
          other.context_chitty_id AS chitty_id,
          COUNT(*) AS overlap_count,
          MAX(other.detected_at) AS last_overlap_at
        FROM context_behavioral_events base
        JOIN context_behavioral_events other
          ON other.event_type = base.event_type
         AND other.context_chitty_id != base.context_chitty_id
         AND ABS(CAST(other.detected_at AS INTEGER) - CAST(base.detected_at AS INTEGER)) <= ?
        WHERE base.context_chitty_id = ?
        GROUP BY other.context_chitty_id
        ORDER BY overlap_count DESC
        LIMIT ?
      `,
        )
        .bind(windowSeconds, chittyId, limit)
        .all();

      return (result?.results || []).map((row) => {
        const score = Math.min(
          1,
          Number(row.overlap_count || 0) / Math.max(3, baseCount / 3),
        );
        return {
          chitty_id: row.chitty_id,
          relationship_type: "temporal_correlation",
          overlap_count: Number(row.overlap_count || 0),
          score: Number(score.toFixed(3)),
          last_overlap_at: row.last_overlap_at || null,
        };
      });
    } catch (error) {
      console.warn(
        "[RelationshipEngine] Temporal relationship discovery failed:",
        error.message,
      );
      return [];
    }
  }

  async discoverContextualRelationships(chittyId, limit) {
    try {
      const baseDomains = await this.db
        .prepare(
          `
        SELECT source_domain, COUNT(*) AS count
        FROM context_exposure_log
        WHERE context_chitty_id = ?
        GROUP BY source_domain
        ORDER BY count DESC
        LIMIT 12
      `,
        )
        .bind(chittyId)
        .all();

      const domains = baseDomains?.results || [];
      if (domains.length === 0) return [];

      const domainMap = new Map(
        domains.map((d) => [d.source_domain, Number(d.count || 0)]),
      );
      const domainList = [...domainMap.keys()];
      const placeholders = domainList.map(() => "?").join(", ");

      const query = `
        SELECT context_chitty_id AS chitty_id, source_domain, COUNT(*) AS count
        FROM context_exposure_log
        WHERE context_chitty_id != ?
          AND source_domain IN (${placeholders})
        GROUP BY context_chitty_id, source_domain
      `;

      const args = [chittyId, ...domainList];
      const peerData = await this.db
        .prepare(query)
        .bind(...args)
        .all();
      const rows = peerData?.results || [];

      const byPeer = new Map();
      for (const row of rows) {
        if (!byPeer.has(row.chitty_id)) byPeer.set(row.chitty_id, []);
        byPeer.get(row.chitty_id).push({
          source_domain: row.source_domain,
          count: Number(row.count || 0),
        });
      }

      const totalBaseWeight =
        [...domainMap.values()].reduce((a, b) => a + b, 0) || 1;
      const contextual = [];

      for (const [peerId, sources] of byPeer.entries()) {
        let overlapWeight = 0;
        let matched = 0;

        for (const s of sources) {
          const baseWeight = domainMap.get(s.source_domain) || 0;
          if (!baseWeight) continue;
          matched++;
          overlapWeight += Math.min(baseWeight, s.count);
        }

        const weightedOverlap = overlapWeight / totalBaseWeight;
        const domainCoverage = matched / domainMap.size;
        const score = weightedOverlap * 0.7 + domainCoverage * 0.3;

        if (score < 0.2) continue;
        contextual.push({
          chitty_id: peerId,
          relationship_type: "contextual_overlap",
          shared_domain_count: matched,
          score: Number(score.toFixed(3)),
          top_shared_domains: sources
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((s) => s.source_domain),
        });
      }

      return contextual.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      console.warn(
        "[RelationshipEngine] Contextual relationship discovery failed:",
        error.message,
      );
      return [];
    }
  }

  calculateRelationshipStrength(relationships) {
    const topMean = (items, key) => {
      if (!items || items.length === 0) return 0;
      const vals = items.slice(0, 3).map((x) => Number(x[key] || 0));
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const direct = topMean(relationships.direct, "score");
    const inferred = topMean(relationships.inferred, "confidence");
    const temporal = topMean(relationships.temporal, "score");
    const contextual = topMean(relationships.contextual, "score");

    const weighted =
      direct * 0.35 + inferred * 0.3 + temporal * 0.15 + contextual * 0.2;

    return {
      score: Number(weighted.toFixed(3)),
      dimensions: {
        direct: Number(direct.toFixed(3)),
        inferred: Number(inferred.toFixed(3)),
        temporal: Number(temporal.toFixed(3)),
        contextual: Number(contextual.toFixed(3)),
      },
    };
  }

  async generateSummary({
    entity,
    direct,
    inferred,
    temporal,
    contextual,
    strength,
  }) {
    if (!this.ai) return null;

    try {
      const response = await this.ai.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "Summarize relationship intelligence in 2 concise sentences. Mention strongest signals and one suggested next action.",
          },
          {
            role: "user",
            content: JSON.stringify({
              entity: entity.chitty_id,
              direct: direct.slice(0, 3),
              inferred: inferred.slice(0, 3),
              temporal: temporal.slice(0, 3),
              contextual: contextual.slice(0, 3),
              strength,
            }),
          },
        ],
      });

      return response?.response || null;
    } catch (error) {
      console.warn(
        "[RelationshipEngine] Summary generation failed:",
        error.message,
      );
      return null;
    }
  }

  primaryRelationshipType(reasons) {
    if (reasons.includes("shared_project_path")) return "project_peer";
    if (reasons.includes("shared_workspace")) return "workspace_peer";
    if (reasons.includes("shared_organization")) return "organization_peer";
    if (reasons.includes("shared_support_type")) return "support_peer";
    return "direct_association";
  }

  safeJson(value, fallback) {
    if (!value) return fallback;
    if (Array.isArray(value) || typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  intersection(a = [], b = []) {
    const setB = new Set((b || []).map((x) => String(x).toLowerCase()));
    return (a || []).filter((x) => setB.has(String(x).toLowerCase()));
  }

  jaccard(a = [], b = []) {
    const setA = new Set((a || []).map((x) => String(x).toLowerCase()));
    const setB = new Set((b || []).map((x) => String(x).toLowerCase()));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 0;
    let inter = 0;
    for (const v of setA) {
      if (setB.has(v)) inter++;
    }
    return inter / union.size;
  }

  patternOverlap(a = [], b = []) {
    const normalize = (item) => {
      if (typeof item === "string") return item.toLowerCase();
      return String(item?.name || item?.type || "").toLowerCase();
    };
    const setA = new Set((a || []).map(normalize).filter(Boolean));
    const setB = new Set((b || []).map(normalize).filter(Boolean));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 0;
    let inter = 0;
    for (const v of setA) {
      if (setB.has(v)) inter++;
    }
    return inter / union.size;
  }

  clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }
}

export default RelationshipEngine;
