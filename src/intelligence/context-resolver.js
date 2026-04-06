/**
 * Context Resolver - Intelligent Context Reconstitution & Binding
 *
 * Per synthetic-continuity doctrine (chittycanon://doctrine/synthetic-continuity):
 * - Sessions are VIEWPORTS into existing entities, not births
 * - Entities are minted per COORDINATION NEED, not per session
 * - DB lookup failure is an ERROR, never a minting trigger
 * - Reconstitution evaluates temporal, experiential, trust, and context signals
 *
 * Resolution hierarchy:
 * 1. Explicit ChittyID → direct load (highest confidence)
 * 2. Anchor hash match → reconstitute existing entity
 * 3. Multi-signal fallback → find best candidate by project, workspace, org, recency
 * 4. No match AND confirmed coordination need → mint new entity (requires confirmation)
 * 5. DB failure → return error (NEVER mint as fallback)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-resolver
 * @canon-ref chittycanon://doctrine/synthetic-continuity
 * @version 2.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 */

export class ContextResolver {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
  }

  /**
   * Resolve context from hints — reconstitute existing entity or propose new
   *
   * Resolution cascade:
   * 1. Explicit ChittyID → direct reconstitution
   * 2. Anchor hash match → reconstitute with confidence scoring
   * 3. Multi-signal fallback → best candidate by project/workspace/org/recency
   * 4. No match → propose new (requires confirmation + coordination need justification)
   *
   * Per doctrine: sessions are viewports, not births. DB failure is error, not mint trigger.
   */
  async resolveContext(hints) {
    const {
      projectPath,
      workspace,
      supportType = "development",
      organization,
      sessionId,
      platform = "unknown",
      explicitChittyId,
    } = hints;

    // 1. Explicit ChittyID — highest confidence, direct reconstitution
    if (explicitChittyId) {
      try {
        const context = await this.loadContextByChittyId(explicitChittyId);
        if (context) {
          return {
            action: "bind_existing",
            context,
            confidence: 1.0,
            reason: "Explicit ChittyID reconstituted",
            resolution: "explicit",
          };
        }
      } catch (err) {
        // DB failure with explicit ID is an error — never fallthrough to mint
        return {
          action: "error",
          error: `DB lookup failed for explicit ChittyID ${explicitChittyId}: ${err.message}`,
          resolution: "db_error",
        };
      }
      // Explicit ID not found in DB (not a DB error, just not there)
      return {
        action: "error",
        error: `ChittyID ${explicitChittyId} not found in context_entities`,
        resolution: "not_found",
      };
    }

    // Build anchor hash for matching
    const anchors = this.buildAnchors({
      projectPath,
      workspace,
      supportType,
      organization,
    });
    const anchorHash = await this.hashAnchors(anchors);

    // 2. Anchor hash match — reconstitute existing entity
    try {
      const existingContext = await this.findContextByHash(anchorHash);
      if (existingContext) {
        return {
          action: "bind_existing",
          context: existingContext,
          confidence: this.calculateMatchConfidence(existingContext, hints),
          reason: `Reconstituted by anchor hash: ${anchorHash.slice(0, 16)}...`,
          resolution: "anchor_hash",
          anchors,
          anchorHash,
        };
      }
    } catch (err) {
      // DB failure during anchor lookup — return error, do NOT fall through to mint
      console.error(
        `[ContextResolver] DB error during anchor hash lookup: ${err.message}`,
      );
      return {
        action: "error",
        error: `DB unavailable during context resolution: ${err.message}`,
        resolution: "db_error",
        anchors,
        anchorHash,
      };
    }

    // 3. Multi-signal fallback — find best candidate entity
    try {
      const candidate = await this.findBestCandidate(hints);
      if (candidate) {
        return {
          action: "bind_existing",
          context: candidate.context,
          confidence: candidate.confidence,
          reason: candidate.reason,
          resolution: "multi_signal",
          anchors,
          anchorHash,
        };
      }
    } catch (err) {
      // Multi-signal search failed — return error, do NOT fall through to mint
      console.warn(
        `[ContextResolver] Multi-signal search failed: ${err.message}`,
      );
      return {
        action: "error",
        error: `Multi-signal search failed: ${err.message}`,
        resolution: "db_error",
        anchors,
        anchorHash,
      };
    }

    // 4. No match found — propose new entity (requires confirmation)
    // This is the ONLY path to minting, and it requires explicit confirmation
    // with a coordination need justification
    return {
      action: "create_new",
      pendingContext: {
        projectPath,
        workspace,
        supportType,
        organization,
        anchorHash,
      },
      reason:
        "No existing entity matches these signals. New entity requires coordination need justification.",
      resolution: "no_match",
      anchors,
      anchorHash,
      requiresConfirmation: true,
      coordinationNeedRequired: true,
    };
  }

  /**
   * Multi-signal entity matching — finds the best existing entity when
   * anchor hash doesn't match. Evaluates:
   * - Project path overlap
   * - Workspace match
   * - Organization match
   * - Temporal recency (last activity)
   * - Trust level (higher trust = more likely the intended entity)
   * - Session count (established entities preferred over new)
   */
  async findBestCandidate(hints) {
    const { projectPath, workspace, organization, supportType } = hints;

    // Query candidates — active or dormant entities, ordered by recency
    const candidates = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.status IN ('active', 'dormant')
      ORDER BY ce.last_activity DESC
      LIMIT 50
    `,
      )
      .all();

    if (!candidates?.results?.length) return null;

    let bestScore = 0;
    let bestCandidate = null;
    let bestReason = "";

    for (const row of candidates.results) {
      let score = 0;
      const signals = [];

      // Project path — strongest signal (same project = same coordination need)
      if (projectPath && row.project_path === projectPath) {
        score += 0.4;
        signals.push("project_match");
      } else if (
        projectPath &&
        row.project_path &&
        projectPath.split("/").pop() ===
          row.project_path.split("/").pop()
      ) {
        score += 0.2;
        signals.push("project_name_match");
      }

      // Workspace
      if (workspace && row.workspace === workspace) {
        score += 0.15;
        signals.push("workspace_match");
      }

      // Organization
      if (organization && row.organization === organization) {
        score += 0.1;
        signals.push("organization_match");
      }

      // Support type
      if (supportType && row.support_type === supportType) {
        score += 0.05;
        signals.push("support_type_match");
      }

      // Temporal recency — more recent activity = more likely correct entity
      if (row.last_activity) {
        const daysSince =
          (Date.now() / 1000 - row.last_activity) / 86400;
        if (daysSince < 1) {
          score += 0.15;
          signals.push("active_today");
        } else if (daysSince < 7) {
          score += 0.1;
          signals.push("active_this_week");
        } else if (daysSince < 30) {
          score += 0.05;
          signals.push("active_this_month");
        }
      }

      // Trust level — established entities preferred
      const trustLevel = Number(row.trust_level || 0);
      if (trustLevel >= 4) {
        score += 0.1;
        signals.push("high_trust");
      } else if (trustLevel >= 2) {
        score += 0.05;
        signals.push("moderate_trust");
      }

      // Experience depth — entities with real experience preferred over empty
      const interactions = Number(row.total_interactions || 0);
      if (interactions > 50) {
        score += 0.05;
        signals.push("deep_experience");
      }

      score = Math.min(1, score);

      if (score > bestScore && score >= 0.3) {
        bestScore = score;
        bestCandidate = row;
        bestReason = `Multi-signal match (${signals.join(", ")}): score ${score.toFixed(3)}`;
      }
    }

    if (!bestCandidate) return null;

    return {
      context: {
        ...bestCandidate,
        competencies: JSON.parse(bestCandidate.competencies || "[]"),
        expertise_domains: JSON.parse(
          bestCandidate.expertise_domains || "[]",
        ),
        current_sessions: JSON.parse(
          bestCandidate.current_sessions || "[]",
        ),
      },
      confidence: bestScore,
      reason: bestReason,
    };
  }

  /**
   * Build anchor object from context hints
   */
  buildAnchors({ projectPath, workspace, supportType, organization }) {
    return {
      projectPath: projectPath || "",
      workspace: workspace || "",
      supportType: supportType || "development",
      organization: organization || "",
    };
  }

  /**
   * Hash anchors to create unique context identifier
   */
  async hashAnchors(anchors) {
    const canonical = JSON.stringify(
      [
        anchors.projectPath,
        anchors.workspace,
        anchors.supportType,
        anchors.organization,
      ]
        .filter(Boolean)
        .sort(),
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Find existing context by anchor hash.
   * Throws on DB errors — callers must handle (DB failure is never a mint trigger).
   */
  async findContextByHash(anchorHash) {
    // This will throw on DB errors — intentionally not caught here
    // so resolveContext can distinguish "not found" from "DB unavailable"
    const result = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.context_hash = ? AND ce.status IN ('active', 'dormant')
    `,
      )
      .bind(anchorHash)
      .first();

    if (!result) return null;

    return {
      ...result,
      competencies: JSON.parse(result.competencies || "[]"),
      expertise_domains: JSON.parse(result.expertise_domains || "[]"),
      current_sessions: JSON.parse(result.current_sessions || "[]"),
    };
  }

  /**
   * Load context by ChittyID
   */
  async loadContextByChittyId(chittyId) {
    const result = await this.db
      .prepare(
        `
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.chitty_id = ? AND ce.status IN ('active', 'dormant')
    `,
      )
      .bind(chittyId)
      .first();

    if (!result) return null;

    return {
      ...result,
      competencies: JSON.parse(result.competencies || "[]"),
      expertise_domains: JSON.parse(result.expertise_domains || "[]"),
      current_sessions: JSON.parse(result.current_sessions || "[]"),
    };
  }

  /**
   * Calculate confidence score for context match
   */
  calculateMatchConfidence(context, hints) {
    let confidence = 0.5; // Base confidence for hash match

    // Boost for project path match
    if (context.project_path === hints.projectPath) confidence += 0.2;

    // Boost for workspace match
    if (context.workspace === hints.workspace) confidence += 0.1;

    // Boost for high trust level
    if (context.trust_level >= 4) confidence += 0.1;

    // Boost for recent activity
    const daysSinceActivity =
      (Date.now() / 1000 - context.last_activity) / 86400;
    if (daysSinceActivity < 7) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Create new context entity — ONLY after user confirmation AND coordination need.
   *
   * Per doctrine: minting triggers are:
   * - Domain fission (scope diverged enough that one entity can't specialize in both)
   * - Derivative (entering new domain where parent's trust/instinct don't transfer)
   * - Temporal decay (entity dormant so long that reconstitution is meaningless)
   * - Meta-orchestrator decision (user decides a new coordination role is needed)
   *
   * NEVER a minting trigger:
   * - New session starting
   * - Model/substrate switching
   * - DB lookup failing
   *
   * @param {string} coordinationNeed - Required justification for new entity
   */
  async createContext({
    projectPath,
    workspace,
    supportType,
    organization,
    anchorHash,
    coordinationNeed,
  }) {
    if (!coordinationNeed || !coordinationNeed.trim()) {
      throw new Error(
        "Coordination need justification required for new entity minting. " +
          "Sessions are viewports, not births. Provide coordinationNeed describing " +
          "why an existing entity cannot serve this role.",
      );
    }
    const contextId = crypto.randomUUID();

    // Mint ChittyID from ChittyID service
    const chittyId = await this.mintChittyId({
      projectPath,
      workspace,
      supportType,
      organization,
    });

    // Create context entity
    await this.db
      .prepare(
        `
      INSERT INTO context_entities (
        id, chitty_id, context_hash, project_path, workspace, support_type, organization,
        signature, issuer, trust_score, trust_level, total_sessions, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        contextId,
        chittyId,
        anchorHash,
        projectPath,
        workspace || null,
        supportType,
        organization || null,
        "pending-signature", // Will be signed by ChittyID service
        "chittyid",
        50.0, // Default starting trust
        3, // Default trust level
        0, // No sessions yet
        "active",
      )
      .run();

    // Initialize DNA record
    await this.db
      .prepare(
        `
      INSERT INTO context_dna (
        id, context_id, context_chitty_id,
        patterns, traits, preferences, competencies, expertise_domains,
        total_interactions, total_decisions, success_rate
      ) VALUES (?, ?, ?, '[]', '[]', '[]', '[]', '[]', 0, 0, 0.0)
    `,
      )
      .bind(crypto.randomUUID(), contextId, chittyId)
      .run();

    // Log creation to ledger with coordination need justification
    await this.logToLedger(contextId, chittyId, "system", "transaction", {
      type: "context_created",
      coordinationNeed,
      anchors: { projectPath, workspace, supportType, organization },
    });

    return this.loadContextByChittyId(chittyId);
  }

  /**
   * Mint ChittyID via ChittyMint (mint.chitty.cc).
   * Falls back to fallback.id.chitty.cc for error-coded IDs (domain 'E')
   * that are automatically reconciled when the primary service returns.
   * Local generation is NEVER permitted.
   */
  async mintChittyId({ projectPath, workspace, supportType, organization }) {
    const mintUrl = this.env.CHITTYMINT_URL || "https://mint.chitty.cc";
    const fallbackUrl =
      this.env.CHITTY_FALLBACK_URL || "https://fallback.id.chitty.cc";

    const mintBody = {
      entity_type: "P", // @canon: chittycanon://gov/governance#core-types
      characterization: "Synthetic", // AI/Claude contexts are synthetic Persons
      metadata: {
        project_path: projectPath,
        workspace,
        support_type: supportType,
        organization,
      },
    };

    // Primary: ChittyMint authority service
    try {
      const response = await fetch(`${mintUrl}/api/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTYMINT_SECRET || this.env.CHITTY_ID_TOKEN || ""}`,
        },
        body: JSON.stringify(mintBody),
      });

      if (response.ok) {
        const data = await response.json();
        const chittyId = data.chitty_id || data.id;
        if (chittyId) return chittyId;
        console.warn(
          `[ContextResolver] ChittyMint returned OK but no ID in response, trying fallback`,
        );
      } else {
        console.warn(
          `[ContextResolver] ChittyMint primary failed (${response.status}), trying fallback`,
        );
      }
    } catch (err) {
      console.warn(
        `[ContextResolver] ChittyMint unreachable: ${err.message}, trying fallback`,
      );
    }

    // Fallback: pre-authorized error-coded IDs (domain 'E', auto-reconciled later)
    try {
      const response = await fetch(`${fallbackUrl}/api/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTY_ID_TOKEN || ""}`,
        },
        body: JSON.stringify(mintBody),
      });

      if (response.ok) {
        const data = await response.json();
        const chittyId = data.chitty_id || data.id;
        if (chittyId) {
          console.warn(
            `[ContextResolver] Using fallback error-coded ID: ${chittyId}`,
          );
          return chittyId;
        }
        throw new Error(
          `Fallback mint returned OK but no ID in response: ${JSON.stringify(data).slice(0, 200)}`,
        );
      }

      const body = await response.text().catch(() => "");
      throw new Error(
        `Fallback mint failed (${response.status}): ${body.slice(0, 200)}`,
      );
    } catch (err) {
      throw new Error(
        `ChittyID minting failed — both primary (mint.chitty.cc) and fallback (fallback.id.chitty.cc) unavailable: ${err.message}`,
      );
    }
  }

  /**
   * Bind session to context - called after user confirmation
   */
  async bindSession(contextId, chittyId, sessionId, platform = "unknown") {
    const bindingId = crypto.randomUUID();

    // Create session binding
    await this.db
      .prepare(
        `
      INSERT INTO context_session_bindings (
        id, session_id, context_id, context_chitty_id, context_hash, platform
      )
      SELECT ?, ?, ?, ?, context_hash, ?
      FROM context_entities WHERE id = ?
    `,
      )
      .bind(bindingId, sessionId, contextId, chittyId, platform, contextId)
      .run();

    // Update context's session tracking
    const context = await this.db
      .prepare(
        `
      SELECT current_sessions, total_sessions FROM context_entities WHERE id = ?
    `,
      )
      .bind(contextId)
      .first();

    const currentSessions = JSON.parse(context.current_sessions || "[]");
    currentSessions.push(sessionId);

    await this.db
      .prepare(
        `
      UPDATE context_entities
      SET current_sessions = ?,
          total_sessions = total_sessions + 1,
          last_activity = unixepoch(),
          status = 'active'
      WHERE id = ?
    `,
      )
      .bind(JSON.stringify(currentSessions), contextId)
      .run();

    // Log session start to ledger
    await this.logToLedger(contextId, chittyId, sessionId, "transaction", {
      type: "session_start",
      platform,
      bound_at: Date.now(),
    });

    return { bindingId, contextId, chittyId, sessionId };
  }

  /**
   * Unbind session and roll up metrics to DNA
   */
  async unbindSession(sessionId, metrics = {}) {
    // Get binding info
    const binding = await this.db
      .prepare(
        `
      SELECT * FROM context_session_bindings WHERE session_id = ? AND unbound_at IS NULL
    `,
      )
      .bind(sessionId)
      .first();

    if (!binding) {
      console.warn(
        `[ContextResolver] No active binding found for session ${sessionId}`,
      );
      return null;
    }

    // Update binding with metrics
    await this.db
      .prepare(
        `
      UPDATE context_session_bindings
      SET unbound_at = unixepoch(),
          unbind_reason = 'session_complete',
          interactions_count = ?,
          decisions_count = ?,
          session_success_rate = ?
      WHERE id = ?
    `,
      )
      .bind(
        metrics.interactions || 0,
        metrics.decisions || 0,
        metrics.successRate || null,
        binding.id,
      )
      .run();

    // Remove from context's current sessions
    const context = await this.db
      .prepare(
        `
      SELECT current_sessions FROM context_entities WHERE id = ?
    `,
      )
      .bind(binding.context_id)
      .first();

    const currentSessions = JSON.parse(context.current_sessions || "[]").filter(
      (s) => s !== sessionId,
    );

    await this.db
      .prepare(
        `
      UPDATE context_entities
      SET current_sessions = ?,
          last_activity = unixepoch()
      WHERE id = ?
    `,
      )
      .bind(JSON.stringify(currentSessions), binding.context_id)
      .run();

    // Roll up metrics to DNA
    await this.accumulateToDNA(binding.context_id, metrics);

    // Log session end to ledger
    await this.logToLedger(
      binding.context_id,
      binding.context_chitty_id,
      sessionId,
      "transaction",
      {
        type: "session_end",
        duration: Date.now() - binding.bound_at * 1000,
        metrics,
      },
    );

    return {
      contextId: binding.context_id,
      chittyId: binding.context_chitty_id,
    };
  }

  /**
   * Accumulate session metrics to context DNA
   */
  async accumulateToDNA(contextId, metrics) {
    const {
      interactions = 0,
      decisions = 0,
      successRate,
      competencies = [],
      domains = [],
    } = metrics;

    // Get current DNA
    const dna = await this.db
      .prepare(
        `
      SELECT * FROM context_dna WHERE context_id = ?
    `,
      )
      .bind(contextId)
      .first();

    if (!dna) return;

    // Calculate new totals
    const totalInteractions = dna.total_interactions + interactions;
    const totalDecisions = dna.total_decisions + decisions;

    // Calculate new success rate (weighted average)
    let newSuccessRate = dna.success_rate;
    if (successRate !== null && successRate !== undefined) {
      const weight = interactions / Math.max(totalInteractions, 1);
      newSuccessRate = dna.success_rate * (1 - weight) + successRate * weight;
    }

    // Merge competencies
    const existingCompetencies = JSON.parse(dna.competencies || "[]");
    const mergedCompetencies = this.mergeCompetencies(
      existingCompetencies,
      competencies,
    );

    // Merge expertise domains
    const existingDomains = JSON.parse(dna.expertise_domains || "[]");
    const mergedDomains = [...new Set([...existingDomains, ...domains])];

    // Update DNA
    await this.db
      .prepare(
        `
      UPDATE context_dna
      SET total_interactions = ?,
          total_decisions = ?,
          success_rate = ?,
          competencies = ?,
          expertise_domains = ?,
          updated_at = unixepoch()
      WHERE context_id = ?
    `,
      )
      .bind(
        totalInteractions,
        totalDecisions,
        newSuccessRate,
        JSON.stringify(mergedCompetencies),
        JSON.stringify(mergedDomains),
        contextId,
      )
      .run();
  }

  /**
   * Merge competencies with level tracking
   */
  mergeCompetencies(existing, newCompetencies) {
    const map = new Map();

    // Add existing
    for (const comp of existing) {
      const name = typeof comp === "string" ? comp : comp.name;
      const level = typeof comp === "string" ? 1 : comp.level || 1;
      map.set(name, { name, level, count: 1 });
    }

    // Merge new
    for (const comp of newCompetencies) {
      const name = typeof comp === "string" ? comp : comp.name;
      const level = typeof comp === "string" ? 1 : comp.level || 1;

      if (map.has(name)) {
        const existing = map.get(name);
        existing.count++;
        existing.level = Math.max(existing.level, level);
      } else {
        map.set(name, { name, level, count: 1 });
      }
    }

    return Array.from(map.values());
  }

  /**
   * Log event to context ledger with chaining
   */
  async logToLedger(contextId, chittyId, sessionId, eventType, payload) {
    // Get previous entry for chaining
    const previous = await this.db
      .prepare(
        `
      SELECT hash FROM context_ledger
      WHERE context_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `,
      )
      .bind(contextId)
      .first();

    const entryId = crypto.randomUUID();
    const entryData = {
      entryId,
      contextId,
      sessionId,
      eventType,
      payload,
      timestamp: Date.now(),
    };
    const entryHash = await this.hashContent(entryData);

    await this.db
      .prepare(
        `
      INSERT INTO context_ledger (
        id, context_id, context_chitty_id, session_id,
        event_type, payload, hash, previous_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        entryId,
        contextId,
        chittyId,
        sessionId,
        eventType,
        JSON.stringify(payload),
        entryHash,
        previous?.hash || "genesis",
      )
      .run();

    return { entryId, hash: entryHash };
  }

  /**
   * Hash content for ledger integrity
   */
  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(content));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Get context summary for status line display
   */
  async getContextSummary(chittyId) {
    const context = await this.loadContextByChittyId(chittyId);
    if (!context) return null;

    return {
      chittyId: context.chitty_id,
      trustLevel: context.trust_level,
      trustScore: Math.round(context.trust_score),
      supportType: context.support_type,
      activeSessions: context.current_sessions?.length || 0,
      totalInteractions: context.total_interactions || 0,
      successRate: context.success_rate
        ? Math.round(context.success_rate * 100)
        : null,
      status: context.status,
      projectName: context.project_path?.split("/").pop(),
    };
  }

  /**
   * Build provisioning recommendation — what services/connections this entity
   * should have access to, based on project context + entity history + trust level.
   *
   * Derives from:
   * 1. Project signals (wrangler.jsonc bindings, package.json deps, repo org)
   * 2. Entity history (what services has this entity used before in this project?)
   * 3. Trust level (what access tier is this entity authorized for?)
   * 4. Ch1tty system connections (what's available?)
   *
   * Returns summary by default. Verbose available on request.
   *
   * @param {string} chittyId
   * @param {object} context - D1 context row
   * @param {object} hints - Resolution hints (projectPath, etc.)
   * @returns {object} Provisioning recommendation
   */
  async buildProvisioningRecommendation(chittyId, context, hints = {}) {
    const trustLevel = Number(context?.trust_level || 0);
    const project = hints.projectPath?.split("/").pop() || context?.project_path?.split("/").pop();

    // Derive service needs from entity's ledger history
    const usedServices = new Set();
    if (this.env.HYPERDRIVE) {
      try {
        const { default: postgres } = await import("postgres");
        const sql = postgres(this.env.HYPERDRIVE.connectionString);
        try {
          const rows = await sql`
            SELECT DISTINCT
              CASE
                WHEN action LIKE '%neon%' OR action LIKE '%hyperdrive%' THEN 'neon'
                WHEN action LIKE '%github%' OR action LIKE '%gh_%' THEN 'github'
                WHEN action LIKE '%cloudflare%' OR action LIKE '%wrangler%' OR action LIKE '%worker%' THEN 'cloudflare'
                WHEN action LIKE '%notion%' THEN 'notion'
                WHEN action LIKE '%1password%' OR action LIKE '%op_%' THEN '1password'
                WHEN action LIKE '%claude%' OR action LIKE '%anthropic%' THEN 'claude'
                WHEN action LIKE '%gemini%' OR action LIKE '%google%' THEN 'gemini'
                WHEN action LIKE '%mercury%' THEN 'mercury'
                WHEN action LIKE '%stripe%' THEN 'stripe'
                ELSE NULL
              END AS service
            FROM event_ledger
            WHERE chitty_id = ${chittyId}
              AND project = ${project}
              AND timestamp > now() - interval '30 days'
          `;
          for (const r of rows) {
            if (r.service) usedServices.add(r.service);
          }
        } finally {
          await sql.end();
        }
      } catch {
        // Best effort — proceed with empty history
      }
    }

    // ── DRL Reckoning: compute fresh trust scores from ledger ──────────
    // The DRL is "reckoning, not record" — computed at query time from
    // ledger entries. We call it NOW at provisioning time, not use cached.
    // @canon chittycanon://gov/governance#drl
    let trustScores = { ty: 0, vy: 0, ry: 0, signalCount: 0, composite: 0 };

    if (this.env.HYPERDRIVE) {
      try {
        const { default: postgres } = await import("postgres");
        const sql = postgres(this.env.HYPERDRIVE.connectionString);
        try {
          // Fresh reckoning from trust_scores cache (updated by DRL service)
          const [scores] = await sql`
            SELECT ty_score, vy_score, ry_score, signal_count, composite_score,
                   trust_level, confidence, reckoned_at
            FROM trust_scores
            WHERE identity_id = (
              SELECT id FROM identities WHERE chitty_id = ${chittyId} LIMIT 1
            )
            ORDER BY reckoned_at DESC
            LIMIT 1
          `;

          if (scores) {
            trustScores = {
              ty: Number(scores.ty_score || 0),
              vy: Number(scores.vy_score || 0),
              ry: Number(scores.ry_score || 0),
              signalCount: Number(scores.signal_count || 0),
              composite: Number(scores.composite_score || 0),
              trustLevel: scores.trust_level,
              confidence: Number(scores.confidence || 0),
              reckonedAt: scores.reckoned_at ? String(scores.reckoned_at) : null,
            };
          }
        } finally {
          await sql.end();
        }
      } catch {
        // DRL unavailable — use basic trust level from context
      }
    }

    // Effective trust level: from DRL if available, otherwise from context
    const effectiveTrustLevel = trustScores.trustLevel
      ? parseInt(trustScores.trustLevel.replace(/\D/g, '') || '0')
      : trustLevel;

    // Read service access tiers from ChittyCanon (Neon)
    // Baseline + identity-class-specific services
    let baseline = [];
    let classServices = [];
    let identityClass = "advocate";

    if (this.env.HYPERDRIVE) {
      try {
        const { default: postgres } = await import("postgres");
        const sql = postgres(this.env.HYPERDRIVE.connectionString);
        try {
          // Resolve identity class from DRL trust level
          const [classRow] = await sql`
            SELECT id FROM canon.identity_classes
            WHERE min_trust_level <= ${effectiveTrustLevel}
            ORDER BY min_trust_level DESC
            LIMIT 1
          `;
          if (classRow) identityClass = classRow.id;

          // Baseline: every entity gets these
          baseline = await sql`
            SELECT service, access, reason, required
            FROM canon.baseline_services
            ORDER BY id
          `;

          // Class-specific: services this identity class gets
          classServices = await sql`
            SELECT service, access, reason, requires_auth
            FROM canon.service_access
            WHERE identity_class = ${identityClass}
            ORDER BY service
          `;
        } finally {
          await sql.end();
        }
      } catch {
        // Fallback: hardcoded minimums
        identityClass =
          effectiveTrustLevel >= 4 ? "agent" :
          effectiveTrustLevel >= 3 ? "coordinator" :
          effectiveTrustLevel >= 1 ? "context" : "advocate";
      }
    }

    // Merge baseline + class services, mark what's already provisioned
    const allServices = [
      ...baseline.map((s) => ({
        service: s.service, access: s.access, reason: s.reason,
        tier: "baseline", provisioned: true, // baseline is always provisioned
      })),
      ...classServices.map((s) => ({
        service: s.service, access: s.access, reason: s.reason,
        tier: identityClass, requiresAuth: s.requires_auth,
        provisioned: usedServices.has(s.service.toLowerCase().split(" ")[0]),
      })),
    ];

    const needsProvisioning = allServices.filter((s) => !s.provisioned && s.tier !== "baseline");
    const alreadyProvisioned = allServices.filter((s) => s.provisioned);

    return {
      // DRL reckoning — fresh trust scores computed from ledger
      trust: {
        ty: trustScores.ty,       // Identity Substrate (0-1)
        vy: trustScores.vy,       // Verified Yesterday / experience (0-1)
        ry: trustScores.ry,       // Reach and Authority / earned (0-1)
        composite: trustScores.composite,
        signalCount: trustScores.signalCount,
        confidence: trustScores.confidence,
        reckonedAt: trustScores.reckonedAt,
        level: trustScores.trustLevel || `L${effectiveTrustLevel}`,
      },
      identityClass,
      summary: {
        baseline: baseline.map((s) => s.service),
        alreadyProvisioned: alreadyProvisioned
          .filter((s) => s.tier !== "baseline")
          .map((s) => `${s.service} (${s.access})`),
        needsProvisioning: needsProvisioning.map((s) => ({
          service: s.service,
          access: s.access,
          requiresAuth: s.requiresAuth,
        })),
      },
      services: allServices, // Full detail for verbose mode
    };
  }

  /**
   * Compute domain-scoped trust — not just "how trustworthy" but
   * "what should I trust this entity WITH?"
   *
   * An entity might have high VY overall but only in infrastructure.
   * You wouldn't trust it with your taxes. Domain trust is derived
   * from ledger history: what outcomes in what domains.
   *
   * @param {string} chittyId
   * @returns {object} Domain trust scores
   */
  async computeDomainTrust(chittyId) {
    const domains = {};

    if (!this.env.HYPERDRIVE) return domains;

    try {
      const { default: postgres } = await import("postgres");
      const sql = postgres(this.env.HYPERDRIVE.connectionString);
      try {
        // Load trust taxonomy from ChittyCanon
        const trustDomains = await sql`
          SELECT id, parent_id, name, core, niche_threshold, action_patterns
          FROM canon.trust_domains
          ORDER BY core DESC, parent_id NULLS FIRST, id
        `;

        // Load all events for this entity (last 90 days)
        const events = await sql`
          SELECT action, project, event_type, event_severity, metadata, timestamp
          FROM event_ledger
          WHERE chitty_id = ${chittyId}
            AND timestamp > now() - interval '90 days'
        `;

        // Score each domain by matching event actions against domain patterns
        const domainScores = {};

        for (const domain of trustDomains) {
          const patterns = domain.action_patterns || [];
          if (patterns.length === 0) continue;

          let total = 0, successes = 0, failures = 0, toolCalls = 0;
          let lastActive = null;

          for (const evt of events) {
            const action = (evt.action || "").toLowerCase();
            const project = (evt.project || "").toLowerCase();
            const matched = patterns.some((p) => action.includes(p) || project.includes(p));
            if (!matched) continue;

            total++;
            if (evt.event_type === "TOOL_CALL") toolCalls++;
            if (evt.metadata?.success === true || evt.event_severity === "INFO") successes++;
            if (evt.metadata?.success === false || evt.event_severity === "ERROR") failures++;
            if (!lastActive || evt.timestamp > lastActive) lastActive = evt.timestamp;
          }

          // Only include domains with evidence
          // Niche domains require niche_threshold events; core domains always included
          const threshold = domain.core ? 1 : (domain.niche_threshold || 20);
          if (total >= threshold) {
            const successRate = total > 0 ? successes / (successes + failures || 1) : 0;
            const volumeWeight = Math.min(1, Math.log10(total + 1) / 3);

            domainScores[domain.id] = {
              name: domain.name,
              core: domain.core,
              parent: domain.parent_id,
              score: Number((successRate * volumeWeight).toFixed(3)),
              totalEvents: total,
              toolCalls,
              successRate: Number((successRate * 100).toFixed(1)),
              confidence: Number((volumeWeight * 100).toFixed(1)),
              lastActive: lastActive ? String(lastActive) : null,
            };
          }
        }

        // Placeholder to match downstream code expectations
        const rows = Object.entries(domainScores).map(([id, data]) => ({
          domain: id,
          ...data,
        }));

        for (const row of rows) {
          domains[row.domain] = {
            name: row.name,
            core: row.core,
            parent: row.parent,
            score: row.score,
            totalEvents: row.totalEvents,
            toolCalls: row.toolCalls,
            successRate: row.successRate,
            confidence: row.confidence,
            lastActive: row.lastActive,
          };
        }
      } finally {
        await sql.end();
      }
    } catch {
      // Best effort
    }

    return domains;
  }

  /**
   * Build an entity "resume" from ChittyLedger — a human-readable summary of
   * what this entity has done, what it's good at, and its track record.
   *
   * Presented during context resolution so the user can confirm:
   * "Yes, that's the right entity to bind this session to."
   *
   * Reads from event_ledger (Neon via HYPERDRIVE), NOT from D1.
   * D1 has context_entities/context_dna. Neon has the full event history.
   *
   * @param {string} chittyId - The entity's ChittyID
   * @param {object} context - Context row from D1 (for DNA/competencies)
   * @returns {object} Resume summary
   */
  async buildEntityResume(chittyId, context = null) {
    const resume = {
      chittyId,
      displayName: context?.display_name || null,
      entityType: "P", // Default; should come from ledger
      lifecycleState: context?.status || "unknown",
      trustLevel: context?.trust_level || 0,

      // From D1 context_dna
      competencies: context?.competencies || [],
      expertiseDomains: context?.expertise_domains || [],
      successRate: context?.success_rate ? Math.round(context.success_rate * 100) + "%" : null,

      // Domain-scoped trust — WHAT to trust this entity with
      domainTrust: {},

      // From ChittyLedger (Neon) — populated below
      totalSessions: 0,
      totalToolCalls: 0,
      recentProjects: [],
      recentActivity: [],
      lineage: null,
      createdAt: null,
      lastSeen: null,
      archetype: null,
    };

    // Compute domain-scoped trust — what to trust this entity WITH
    resume.domainTrust = await this.computeDomainTrust(chittyId);

    // Read from ChittyLedger (Neon) if HYPERDRIVE is available
    if (this.env.HYPERDRIVE) {
      try {
        // Dynamic import — postgres may not be available in all envs
        const { default: postgres } = await import("postgres");
        const sql = postgres(this.env.HYPERDRIVE.connectionString);

        try {
          // Session and tool call counts
          const [stats] = await sql`
            SELECT
              count(*) FILTER (WHERE event_type = 'SESSION_START') AS total_sessions,
              count(*) FILTER (WHERE event_type = 'TOOL_CALL') AS total_tool_calls,
              min(timestamp) FILTER (WHERE event_type = 'ENTITY_CREATED') AS created_at,
              max(timestamp) AS last_seen
            FROM event_ledger
            WHERE chitty_id = ${chittyId}
          `;

          if (stats) {
            resume.totalSessions = Number(stats.total_sessions || 0);
            resume.totalToolCalls = Number(stats.total_tool_calls || 0);
            resume.createdAt = stats.created_at ? String(stats.created_at) : null;
            resume.lastSeen = stats.last_seen ? String(stats.last_seen) : null;
          }

          // Recent projects (last 10 distinct)
          const projects = await sql`
            SELECT DISTINCT project, max(timestamp) AS last_active
            FROM event_ledger
            WHERE chitty_id = ${chittyId} AND project IS NOT NULL
            GROUP BY project
            ORDER BY last_active DESC
            LIMIT 10
          `;
          resume.recentProjects = projects.map((r) => ({
            project: r.project,
            lastActive: String(r.last_active),
          }));

          // Recent activity summary (last 5 significant events)
          const activity = await sql`
            SELECT event_type, action, project, timestamp, metadata
            FROM event_ledger
            WHERE chitty_id = ${chittyId}
              AND event_type IN ('SESSION_START', 'LIFECYCLE_SIGNAL', 'ENTITY_FISSION',
                                 'ALCHEMIST_PROPOSAL', 'ROUTING_DECISION')
            ORDER BY timestamp DESC
            LIMIT 5
          `;
          resume.recentActivity = activity.map((r) => ({
            type: r.event_type,
            action: r.action,
            project: r.project,
            when: String(r.timestamp),
          }));

          // Lineage (parent entity if this was a fission/derivative)
          const [lineage] = await sql`
            SELECT parent_chitty_id, display_name, action, timestamp
            FROM event_ledger
            WHERE chitty_id = ${chittyId}
              AND event_type = 'ENTITY_CREATED'
              AND parent_chitty_id IS NOT NULL
            LIMIT 1
          `;
          if (lineage?.parent_chitty_id) {
            resume.lineage = {
              parentId: lineage.parent_chitty_id,
              fissionType: lineage.action,
              fissionDate: String(lineage.timestamp),
            };
          }

          // Archetype (from most recent metadata that includes it)
          const [archRow] = await sql`
            SELECT metadata->>'archetype' AS archetype
            FROM event_ledger
            WHERE chitty_id = ${chittyId}
              AND metadata->>'archetype' IS NOT NULL
            ORDER BY timestamp DESC
            LIMIT 1
          `;
          if (archRow?.archetype) {
            resume.archetype = archRow.archetype;
          }
        } finally {
          await sql.end();
        }
      } catch (err) {
        // Neon unavailable — resume will have D1 data only
        console.warn(`[ContextResolver] ChittyLedger unavailable for resume: ${err.message}`);
      }
    }

    return resume;
  }
}
