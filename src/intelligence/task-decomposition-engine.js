/**
 * Task Decomposition Engine
 *
 * Converts a high-level task into a dependency-aware task graph
 * and staged execution plan.
 *
 * @module intelligence/task-decomposition-engine
 */

export class TaskDecompositionEngine {
  constructor(env = {}) {
    this.env = env;
    this.stats = {
      requests: 0,
      avgSubtasks: 0,
      avgDepth: 0,
    };
  }

  async initialize() {
    console.log("[TaskDecompositionEngine] Ready");
  }

  async decompose(taskInput, options = {}) {
    this.stats.requests += 1;

    const task = String(taskInput || "").trim();
    if (!task) {
      throw new Error("task is required");
    }

    const normalized = this.normalize(task);
    const rawSubtasks = this.extractSubtasks(task, normalized, options);
    const enriched = this.enrichSubtasks(rawSubtasks, options);
    const dependencies = this.buildDependencies(enriched, normalized);
    const graph = this.buildGraph(enriched, dependencies);
    const stages = this.buildExecutionStages(graph);
    const criticalPath = this.computeCriticalPath(graph, stages);
    const metrics = this.computeMetrics(graph, stages, criticalPath);
    const riskAssessment = this.assessRisks(graph, metrics, options);

    this.updateStats(metrics.subtaskCount, metrics.maxDepth);

    return {
      task,
      summary: this.buildSummary(metrics, riskAssessment),
      graph,
      stages,
      criticalPath,
      metrics,
      riskAssessment,
      recommendations: this.buildRecommendations(
        graph,
        metrics,
        riskAssessment,
      ),
    };
  }

  async getStats() {
    return {
      available: true,
      ...this.stats,
    };
  }

  normalize(text) {
    return text.toLowerCase().replace(/[^\w\s.:,/-]/g, " ");
  }

  extractSubtasks(task, normalized, options) {
    const extracted = [];
    let idCounter = 1;

    const pushSubtask = (title, kind, source = "derived") => {
      const clean = String(title || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!clean) return;
      if (extracted.some((t) => t.title.toLowerCase() === clean.toLowerCase()))
        return;
      extracted.push({
        id: `t${idCounter++}`,
        title: clean,
        kind,
        source,
      });
    };

    // Parse list-style items if provided.
    const lines = task
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^([-*]|\d+[.)])\s+(.+)$/);
      if (match) {
        pushSubtask(match[2], this.classifyKind(match[2]), "explicit_list");
      }
    }

    // Split narrative text into candidate clauses.
    const clauses = task
      .split(/[.;]/)
      .flatMap((chunk) => chunk.split(/\b(?:and then|then|and|after that)\b/i))
      .map((c) => c.trim())
      .filter((c) => c.length >= 8);
    for (const clause of clauses) {
      if (this.looksActionable(clause)) {
        pushSubtask(clause, this.classifyKind(clause), "clause");
      }
    }

    // If still sparse, derive canonical decomposition steps.
    if (extracted.length < 2) {
      pushSubtask("Analyze requirements and constraints", "analysis");
      pushSubtask("Implement core changes", "implementation");
      pushSubtask("Validate outcomes with checks/tests", "validation");
    }

    // Add optional deployment step if task hints at release.
    if (/\bdeploy|release|production|ship|rollout\b/.test(normalized)) {
      pushSubtask("Deploy and verify in target environment", "deployment");
    }

    // Add doc step if requested or implied.
    if (
      /\bdocument|roadmap|summary|report|handoff|notes\b/.test(normalized) ||
      options.requireDocumentation === true
    ) {
      pushSubtask("Document changes and update roadmap/state", "documentation");
    }

    return extracted.slice(0, 20);
  }

  looksActionable(text) {
    return /\b(build|create|implement|add|fix|update|refactor|deploy|test|verify|review|analyze|map|organize|clean)\b/i.test(
      text,
    );
  }

  classifyKind(text) {
    const t = text.toLowerCase();
    if (/\banaly|research|inspect|map|discover|identify\b/.test(t))
      return "analysis";
    if (/\bimplement|build|create|add|refactor|wire|integrate\b/.test(t))
      return "implementation";
    if (/\btest|verify|validate|check|qa\b/.test(t)) return "validation";
    if (/\bdeploy|release|ship|publish|rollout\b/.test(t)) return "deployment";
    if (/\bdocument|report|summary|roadmap|notes|handoff\b/.test(t))
      return "documentation";
    if (/\bmonitor|observe|alert|dashboard\b/.test(t)) return "operations";
    return "implementation";
  }

  enrichSubtasks(subtasks, options) {
    return subtasks.map((task) => {
      const effort = this.estimateEffort(task.title, task.kind);
      const risk = this.estimateRisk(task.title, task.kind, options);
      const capabilities = this.capabilitiesForKind(task.kind, task.title);
      return {
        ...task,
        effort,
        risk,
        capabilities,
      };
    });
  }

  estimateEffort(title, kind) {
    const words = title.split(/\s+/).length;
    let score = words / 12;
    if (kind === "analysis") score += 0.4;
    if (kind === "implementation") score += 0.7;
    if (kind === "validation") score += 0.5;
    if (kind === "deployment") score += 0.8;
    if (kind === "documentation") score += 0.3;

    if (score < 1.0) return "S";
    if (score < 2.0) return "M";
    return "L";
  }

  estimateRisk(title, kind, options) {
    let risk = 0.2;
    const t = title.toLowerCase();

    if (kind === "deployment") risk += 0.35;
    if (kind === "implementation") risk += 0.2;
    if (/\bprod|production|billing|finance|auth|credential|security\b/.test(t))
      risk += 0.25;
    if (/\bdelete|drop|remove|migrate\b/.test(t)) risk += 0.2;
    if (options.highRiskMode === true) risk += 0.1;

    return Number(Math.min(1, risk).toFixed(3));
  }

  capabilitiesForKind(kind, title) {
    const out = new Set();
    const t = title.toLowerCase();
    if (kind === "analysis") out.add("context-analysis");
    if (kind === "implementation") out.add("code-change");
    if (kind === "validation") out.add("verification");
    if (kind === "deployment") out.add("release-ops");
    if (kind === "documentation") out.add("documentation");
    if (/\bapi|endpoint|route|http\b/.test(t)) out.add("api");
    if (/\bdb|database|sql|migration|schema\b/.test(t)) out.add("database");
    if (/\btest|vitest|unit\b/.test(t)) out.add("testing");
    return [...out];
  }

  buildDependencies(subtasks, normalizedTask) {
    const deps = [];
    const byKind = this.indexByKind(subtasks);

    for (const current of subtasks) {
      const addDep = (fromId, reason) => {
        if (!fromId || fromId === current.id) return;
        if (deps.some((d) => d.from === fromId && d.to === current.id)) return;
        deps.push({ from: fromId, to: current.id, reason });
      };

      if (current.kind === "implementation") {
        for (const pre of byKind.analysis || [])
          addDep(pre.id, "analysis_before_implementation");
      }
      if (current.kind === "validation") {
        for (const pre of [
          ...(byKind.implementation || []),
          ...(byKind.analysis || []),
        ]) {
          addDep(pre.id, "validate_after_change");
        }
      }
      if (current.kind === "deployment") {
        for (const pre of [
          ...(byKind.implementation || []),
          ...(byKind.validation || []),
        ]) {
          addDep(pre.id, "deploy_after_ready");
        }
      }
      if (current.kind === "documentation") {
        for (const pre of subtasks.filter((t) => t.id !== current.id)) {
          if (pre.kind !== "documentation")
            addDep(pre.id, "document_after_execution");
        }
      }
    }

    // Sequential text hints: "then", "after".
    if (/\bthen|after\b/.test(normalizedTask) && subtasks.length >= 2) {
      for (let i = 1; i < subtasks.length; i++) {
        addUniqueDep(
          deps,
          subtasks[i - 1].id,
          subtasks[i].id,
          "textual_sequence",
        );
      }
    }

    return deps;
  }

  indexByKind(tasks) {
    const idx = {};
    for (const t of tasks) {
      idx[t.kind] = idx[t.kind] || [];
      idx[t.kind].push(t);
    }
    return idx;
  }

  buildGraph(subtasks, dependencies) {
    const nodes = subtasks.map((task) => ({
      ...task,
      dependsOn: dependencies
        .filter((d) => d.to === task.id)
        .map((d) => d.from),
      blocks: dependencies.filter((d) => d.from === task.id).map((d) => d.to),
    }));

    return {
      nodes,
      edges: dependencies,
    };
  }

  buildExecutionStages(graph) {
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const indegree = new Map(
      graph.nodes.map((n) => [n.id, n.dependsOn.length]),
    );
    const remaining = new Set(graph.nodes.map((n) => n.id));
    const stages = [];

    while (remaining.size > 0) {
      const ready = [...remaining].filter(
        (id) => (indegree.get(id) || 0) === 0,
      );
      if (ready.length === 0) {
        // Cycle safeguard.
        stages.push({
          stage: stages.length + 1,
          mode: "sequential",
          taskIds: [...remaining],
          note: "cycle_detected_forced_stage",
        });
        break;
      }

      stages.push({
        stage: stages.length + 1,
        mode: ready.length > 1 ? "parallel" : "sequential",
        taskIds: ready,
      });

      for (const id of ready) {
        remaining.delete(id);
        for (const blockedId of nodeMap.get(id).blocks || []) {
          indegree.set(
            blockedId,
            Math.max(0, (indegree.get(blockedId) || 0) - 1),
          );
        }
      }
    }

    return stages;
  }

  computeCriticalPath(graph, stages) {
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const stageIndex = new Map();
    for (const s of stages) {
      for (const id of s.taskIds) stageIndex.set(id, s.stage);
    }

    const sorted = [...graph.nodes].sort(
      (a, b) => (stageIndex.get(a.id) || 0) - (stageIndex.get(b.id) || 0),
    );

    const dist = new Map();
    const prev = new Map();

    for (const node of sorted) {
      const baseWeight = this.effortWeight(node.effort) + node.risk;
      if ((node.dependsOn || []).length === 0) {
        dist.set(node.id, baseWeight);
        prev.set(node.id, null);
        continue;
      }
      let bestDist = -Infinity;
      let bestParent = null;
      for (const parent of node.dependsOn) {
        const candidate = (dist.get(parent) || 0) + baseWeight;
        if (candidate > bestDist) {
          bestDist = candidate;
          bestParent = parent;
        }
      }
      dist.set(node.id, bestDist);
      prev.set(node.id, bestParent);
    }

    let endNode = null;
    let best = -Infinity;
    for (const [id, value] of dist.entries()) {
      if (value > best) {
        best = value;
        endNode = id;
      }
    }

    const path = [];
    let cursor = endNode;
    while (cursor) {
      path.unshift(cursor);
      cursor = prev.get(cursor);
    }

    return {
      taskIds: path,
      totalWeight: Number((best > 0 ? best : 0).toFixed(3)),
      tasks: path.map((id) => ({
        id,
        title: nodeById.get(id)?.title || id,
      })),
    };
  }

  computeMetrics(graph, stages, criticalPath) {
    const subtaskCount = graph.nodes.length;
    const edgeCount = graph.edges.length;
    const maxDepth = stages.length;
    const parallelStages = stages.filter((s) => s.mode === "parallel").length;
    const highRiskTasks = graph.nodes.filter((n) => n.risk >= 0.6).length;

    return {
      subtaskCount,
      dependencyCount: edgeCount,
      maxDepth,
      parallelStages,
      highRiskTasks,
      criticalPathWeight: criticalPath.totalWeight,
    };
  }

  assessRisks(graph, metrics, options) {
    const highRiskTitles = graph.nodes
      .filter((n) => n.risk >= 0.6)
      .map((n) => n.title)
      .slice(0, 6);

    let overall = "low";
    if (metrics.highRiskTasks >= 3 || metrics.maxDepth >= 6) overall = "high";
    else if (metrics.highRiskTasks >= 1 || metrics.maxDepth >= 4)
      overall = "medium";

    if (options.highRiskMode === true && overall !== "high") overall = "medium";

    return {
      overall,
      highRiskTitles,
      notes: this.riskNotes(overall, metrics),
    };
  }

  riskNotes(level, metrics) {
    if (level === "high") {
      return [
        `High execution complexity (${metrics.maxDepth} stages).`,
        "Introduce checkpoints and staged verification before deployment.",
      ];
    }
    if (level === "medium") {
      return ["Moderate dependency depth; keep validation gates active."];
    }
    return ["Low-risk decomposition based on current signals."];
  }

  buildRecommendations(graph, metrics, risk) {
    const recs = [];
    if (metrics.parallelStages > 0) {
      recs.push("Execute parallel stages concurrently to reduce cycle time.");
    }
    if (risk.overall !== "low") {
      recs.push("Add explicit rollback checkpoints for high-impact tasks.");
    }
    if (!graph.nodes.some((n) => n.kind === "validation")) {
      recs.push("Add a validation task before finalization.");
    }
    if (!graph.nodes.some((n) => n.kind === "documentation")) {
      recs.push(
        "Add documentation/handoff task to preserve execution context.",
      );
    }
    return [...new Set(recs)];
  }

  buildSummary(metrics, risk) {
    return `Decomposed into ${metrics.subtaskCount} subtasks across ${metrics.maxDepth} stages; risk is ${risk.overall}.`;
  }

  effortWeight(effort) {
    if (effort === "S") return 1;
    if (effort === "M") return 2;
    return 3;
  }

  updateStats(subtasks, depth) {
    const n = this.stats.requests;
    this.stats.avgSubtasks =
      n <= 1
        ? subtasks
        : Number(
            ((this.stats.avgSubtasks * (n - 1) + subtasks) / n).toFixed(3),
          );
    this.stats.avgDepth =
      n <= 1
        ? depth
        : Number(((this.stats.avgDepth * (n - 1) + depth) / n).toFixed(3));
  }
}

function addUniqueDep(deps, from, to, reason) {
  if (!from || !to || from === to) return;
  if (deps.some((d) => d.from === from && d.to === to)) return;
  deps.push({ from, to, reason });
}

export default TaskDecompositionEngine;
