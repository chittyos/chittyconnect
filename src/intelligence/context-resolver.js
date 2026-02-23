/**
 * Context Resolver - Intelligent Context Matching & Binding
 *
 * Implements the Context Anchor Model:
 * - Resolves existing contexts by anchor hash (project_path + workspace + support_type)
 * - Only mints new ChittyID when no match exists
 * - Requires user confirmation for new context creation
 * - Auto-logs to context_ledger
 * - Auto-accumulates to context_dna on session end
 *
 * Flow:
 * 1. Extract context hints from request/headers/params
 * 2. Build anchor hash from static identifiers
 * 3. Query context_entities for existing match
 * 4. If match: return existing context for binding confirmation
 * 5. If no match: prepare new context (pending user confirmation)
 * 6. On confirmation: bind session to context, log to ledger
 * 7. On session end: roll up metrics to DNA
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-resolver
 * @version 1.0.0
 * @status CERTIFIED
 * @author ChittyOS Foundation
 * @see chittycanon://docs/tech/architecture/context-anchor-model
 */

export class ContextResolver {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
  }

  /**
   * Resolve context from hints - finds existing or prepares new
   * Does NOT create or bind automatically - returns resolution for confirmation
   */
  async resolveContext(hints) {
    const {
      projectPath,
      workspace,
      supportType = 'development',
      organization,
      sessionId,
      platform = 'unknown',
      explicitChittyId,
    } = hints;

    // If explicit ChittyID provided, load that context directly
    if (explicitChittyId) {
      const context = await this.loadContextByChittyId(explicitChittyId);
      if (context) {
        return {
          action: 'bind_existing',
          context,
          confidence: 1.0,
          reason: 'Explicit ChittyID provided',
        };
      }
      // Explicit ID not found - this is an error condition
      return {
        action: 'error',
        error: `ChittyID ${explicitChittyId} not found`,
      };
    }

    // Build anchor hash from static identifiers
    const anchors = this.buildAnchors({ projectPath, workspace, supportType, organization });
    const anchorHash = await this.hashAnchors(anchors);

    // Look for existing context with matching anchor hash
    const existingContext = await this.findContextByHash(anchorHash);

    if (existingContext) {
      // Found existing context - return for binding confirmation
      return {
        action: 'bind_existing',
        context: existingContext,
        confidence: this.calculateMatchConfidence(existingContext, hints),
        reason: `Matched by anchor hash: ${anchorHash.slice(0, 16)}...`,
        anchors,
        anchorHash,
      };
    }

    // No existing context - prepare new one (pending confirmation)
    return {
      action: 'create_new',
      pendingContext: {
        projectPath,
        workspace,
        supportType,
        organization,
        anchorHash,
      },
      reason: 'No existing context matches these anchors',
      anchors,
      anchorHash,
      requiresConfirmation: true,
    };
  }

  /**
   * Build anchor object from context hints
   */
  buildAnchors({ projectPath, workspace, supportType, organization }) {
    return {
      projectPath: projectPath || '',
      workspace: workspace || '',
      supportType: supportType || 'development',
      organization: organization || '',
    };
  }

  /**
   * Hash anchors to create unique context identifier
   */
  async hashAnchors(anchors) {
    const canonical = JSON.stringify([
      anchors.projectPath,
      anchors.workspace,
      anchors.supportType,
      anchors.organization,
    ].filter(Boolean).sort());

    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Find existing context by anchor hash
   */
  async findContextByHash(anchorHash) {
    const result = await this.db.prepare(`
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.context_hash = ? AND ce.status IN ('active', 'dormant')
    `).bind(anchorHash).first();

    if (!result) return null;

    return {
      ...result,
      competencies: JSON.parse(result.competencies || '[]'),
      expertise_domains: JSON.parse(result.expertise_domains || '[]'),
      current_sessions: JSON.parse(result.current_sessions || '[]'),
    };
  }

  /**
   * Load context by ChittyID
   */
  async loadContextByChittyId(chittyId) {
    const result = await this.db.prepare(`
      SELECT ce.*, cd.competencies, cd.expertise_domains, cd.success_rate, cd.total_interactions
      FROM context_entities ce
      LEFT JOIN context_dna cd ON ce.id = cd.context_id
      WHERE ce.chitty_id = ? AND ce.status IN ('active', 'dormant')
    `).bind(chittyId).first();

    if (!result) return null;

    return {
      ...result,
      competencies: JSON.parse(result.competencies || '[]'),
      expertise_domains: JSON.parse(result.expertise_domains || '[]'),
      current_sessions: JSON.parse(result.current_sessions || '[]'),
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
    const daysSinceActivity = (Date.now() / 1000 - context.last_activity) / 86400;
    if (daysSinceActivity < 7) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Create new context entity - ONLY after user confirmation
   */
  async createContext({ projectPath, workspace, supportType, organization, anchorHash }) {
    const contextId = crypto.randomUUID();

    // Mint ChittyID from ChittyID service
    const chittyId = await this.mintChittyId({
      projectPath,
      workspace,
      supportType,
      organization,
    });

    // Create context entity
    await this.db.prepare(`
      INSERT INTO context_entities (
        id, chitty_id, context_hash, project_path, workspace, support_type, organization,
        signature, issuer, trust_score, trust_level, total_sessions, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      contextId,
      chittyId,
      anchorHash,
      projectPath,
      workspace || null,
      supportType,
      organization || null,
      'pending-signature', // Will be signed by ChittyID service
      'chittyid',
      50.0, // Default starting trust
      3,    // Default trust level
      0,    // No sessions yet
      'active'
    ).run();

    // Initialize DNA record
    await this.db.prepare(`
      INSERT INTO context_dna (
        id, context_id, context_chitty_id,
        patterns, traits, preferences, competencies, expertise_domains,
        total_interactions, total_decisions, success_rate
      ) VALUES (?, ?, ?, '[]', '[]', '[]', '[]', '[]', 0, 0, 0.0)
    `).bind(crypto.randomUUID(), contextId, chittyId).run();

    // Log creation to ledger
    await this.logToLedger(contextId, chittyId, 'system', 'transaction', {
      type: 'context_created',
      anchors: { projectPath, workspace, supportType, organization },
    });

    return this.loadContextByChittyId(chittyId);
  }

  /**
   * Mint ChittyID from service
   */
  async mintChittyId({ projectPath, workspace, supportType, organization }) {
    try {
      const response = await fetch(`${this.env.CHITTYID_SERVICE_URL || 'https://id.chitty.cc'}/api/v1/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.CHITTY_ID_TOKEN || ''}`,
        },
        body: JSON.stringify({
          // @canon: chittycanon://gov/governance#core-types
          // Contexts are Person (P, Synthetic) — actors with agency, not Things
          entity_type: 'P',
          characterization: 'Synthetic',
          metadata: {
            project_path: projectPath,
            workspace,
            support_type: supportType,
            organization,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.chitty_id || data.id;
      }
    } catch (error) {
      console.warn('[ContextResolver] ChittyID mint failed, generating locally:', error.message);
    }

    // Fallback: generate local ChittyID format
    // @canon: chittycanon://gov/governance#core-types
    // Contexts are Person (P, Synthetic) — actors with agency, even in fallback
    const version = '03';
    const geo = '1';
    const locale = 'USA';
    const sequence = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    const type = 'P';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const check = Math.floor(Math.random() * 100).toString().padStart(2, '0');

    return `${version}-${geo}-${locale}-${sequence}-${type}-${year}${month}-0-${check}`;
  }

  /**
   * Bind session to context - called after user confirmation
   */
  async bindSession(contextId, chittyId, sessionId, platform = 'unknown') {
    const bindingId = crypto.randomUUID();

    // Create session binding
    await this.db.prepare(`
      INSERT INTO context_session_bindings (
        id, session_id, context_id, context_chitty_id, context_hash, platform
      )
      SELECT ?, ?, ?, ?, context_hash, ?
      FROM context_entities WHERE id = ?
    `).bind(bindingId, sessionId, contextId, chittyId, platform, contextId).run();

    // Update context's session tracking
    const context = await this.db.prepare(`
      SELECT current_sessions, total_sessions FROM context_entities WHERE id = ?
    `).bind(contextId).first();

    const currentSessions = JSON.parse(context.current_sessions || '[]');
    currentSessions.push(sessionId);

    await this.db.prepare(`
      UPDATE context_entities
      SET current_sessions = ?,
          total_sessions = total_sessions + 1,
          last_activity = unixepoch(),
          status = 'active'
      WHERE id = ?
    `).bind(JSON.stringify(currentSessions), contextId).run();

    // Log session start to ledger
    await this.logToLedger(contextId, chittyId, sessionId, 'transaction', {
      type: 'session_start',
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
    const binding = await this.db.prepare(`
      SELECT * FROM context_session_bindings WHERE session_id = ? AND unbound_at IS NULL
    `).bind(sessionId).first();

    if (!binding) {
      console.warn(`[ContextResolver] No active binding found for session ${sessionId}`);
      return null;
    }

    // Update binding with metrics
    await this.db.prepare(`
      UPDATE context_session_bindings
      SET unbound_at = unixepoch(),
          unbind_reason = 'session_complete',
          interactions_count = ?,
          decisions_count = ?,
          session_success_rate = ?
      WHERE id = ?
    `).bind(
      metrics.interactions || 0,
      metrics.decisions || 0,
      metrics.successRate || null,
      binding.id
    ).run();

    // Remove from context's current sessions
    const context = await this.db.prepare(`
      SELECT current_sessions FROM context_entities WHERE id = ?
    `).bind(binding.context_id).first();

    const currentSessions = JSON.parse(context.current_sessions || '[]')
      .filter(s => s !== sessionId);

    await this.db.prepare(`
      UPDATE context_entities
      SET current_sessions = ?,
          last_activity = unixepoch()
      WHERE id = ?
    `).bind(JSON.stringify(currentSessions), binding.context_id).run();

    // Roll up metrics to DNA
    await this.accumulateToDNA(binding.context_id, metrics);

    // Log session end to ledger
    await this.logToLedger(binding.context_id, binding.context_chitty_id, sessionId, 'transaction', {
      type: 'session_end',
      duration: Date.now() - binding.bound_at * 1000,
      metrics,
    });

    return { contextId: binding.context_id, chittyId: binding.context_chitty_id };
  }

  /**
   * Accumulate session metrics to context DNA
   */
  async accumulateToDNA(contextId, metrics) {
    const { interactions = 0, decisions = 0, successRate, competencies = [], domains = [] } = metrics;

    // Get current DNA
    const dna = await this.db.prepare(`
      SELECT * FROM context_dna WHERE context_id = ?
    `).bind(contextId).first();

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
    const existingCompetencies = JSON.parse(dna.competencies || '[]');
    const mergedCompetencies = this.mergeCompetencies(existingCompetencies, competencies);

    // Merge expertise domains
    const existingDomains = JSON.parse(dna.expertise_domains || '[]');
    const mergedDomains = [...new Set([...existingDomains, ...domains])];

    // Update DNA
    await this.db.prepare(`
      UPDATE context_dna
      SET total_interactions = ?,
          total_decisions = ?,
          success_rate = ?,
          competencies = ?,
          expertise_domains = ?,
          updated_at = unixepoch()
      WHERE context_id = ?
    `).bind(
      totalInteractions,
      totalDecisions,
      newSuccessRate,
      JSON.stringify(mergedCompetencies),
      JSON.stringify(mergedDomains),
      contextId
    ).run();
  }

  /**
   * Merge competencies with level tracking
   */
  mergeCompetencies(existing, newCompetencies) {
    const map = new Map();

    // Add existing
    for (const comp of existing) {
      const name = typeof comp === 'string' ? comp : comp.name;
      const level = typeof comp === 'string' ? 1 : (comp.level || 1);
      map.set(name, { name, level, count: 1 });
    }

    // Merge new
    for (const comp of newCompetencies) {
      const name = typeof comp === 'string' ? comp : comp.name;
      const level = typeof comp === 'string' ? 1 : (comp.level || 1);

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
    const previous = await this.db.prepare(`
      SELECT hash FROM context_ledger
      WHERE context_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).bind(contextId).first();

    const entryId = crypto.randomUUID();
    const entryData = { entryId, contextId, sessionId, eventType, payload, timestamp: Date.now() };
    const entryHash = await this.hashContent(entryData);

    await this.db.prepare(`
      INSERT INTO context_ledger (
        id, context_id, context_chitty_id, session_id,
        event_type, payload, hash, previous_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entryId,
      contextId,
      chittyId,
      sessionId,
      eventType,
      JSON.stringify(payload),
      entryHash,
      previous?.hash || 'genesis'
    ).run();

    return { entryId, hash: entryHash };
  }

  /**
   * Hash content for ledger integrity
   */
  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(content));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
      successRate: context.success_rate ? Math.round(context.success_rate * 100) : null,
      status: context.status,
      projectName: context.project_path?.split('/').pop(),
    };
  }
}
