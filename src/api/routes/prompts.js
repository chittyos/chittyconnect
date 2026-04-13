/**
 * Prompt Registry Routes — TY-VY-RY Governed Context Provisioning
 *
 * Prompts are managed, versioned, composable context payloads governed
 * by the TY-VY-RY framework:
 *   TY (Identity): what IS this prompt — version, layers, genotype
 *   VY (Connectivity): how has the network experienced it — execution log, drift
 *   RY (Authority): what should it be authorized to do — env/author/consumer gates
 *
 * Two consumption modes:
 *   /resolve — returns composed prompt, consumer calls AI themselves
 *   /execute — resolves + dispatches to agent, returns result
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/api/routes/prompts
 * @canon chittycanon://gov/governance#core-types
 */

import { Hono } from "hono";

export const promptRoutes = new Hono();

// ── TY Plane: CRUD ──────────────────────────────────────────

// Create a new prompt
promptRoutes.post("/", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const body = await c.req.json().catch(() => null);
  if (!body?.id || !body?.domain || !body?.base) {
    return c.json({ error: "id, domain, and base are required" }, 400);
  }

  const consumerId = c.get("apiKey")?.chittyId || c.get("apiKey")?.userId || null;

  // RY: check author gate if updating an existing prompt in this domain
  // For creation, any authenticated user can create (domain-level gates enforced on update)

  const layers = JSON.stringify(body.layers || []);
  const envGate = JSON.stringify(body.envGate || { production: "ai", staging: "ai", dev: "configurable", test: "deterministic" });
  const authorGate = JSON.stringify(body.authorGate || { domain: body.domain, allowedAuthors: consumerId ? [consumerId] : ["*"], requireApproval: false });
  const consumerGate = JSON.stringify(body.consumerGate || { allowedServices: ["*"], allowedAgents: ["*"], scopeBoundaries: [] });

  try {
    // Check if already exists
    const existing = await db.prepare("SELECT id, version FROM prompt_registry WHERE id = ?").bind(body.id).first();
    if (existing) {
      return c.json({ error: "Prompt already exists. Use PUT to update." }, 409);
    }

    // Atomic: batch both inserts in a single D1 transaction
    const registryStmt = db.prepare(`
      INSERT INTO prompt_registry (id, domain, version, base, layers, fallback, env_gate, author_gate, consumer_gate, created_by, changelog)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.id, body.domain, body.base, layers,
      body.fallback || "passthrough", envGate, authorGate, consumerGate,
      consumerId, body.changelog || "Initial creation"
    );

    // TY: save version 1
    const versionStmt = db.prepare(`
      INSERT INTO prompt_versions (prompt_id, version, base, layers, fallback, env_gate, author_gate, consumer_gate, changelog, created_by)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.id, body.base, layers, body.fallback || "passthrough",
      envGate, authorGate, consumerGate,
      body.changelog || "Initial creation", consumerId
    );

    await db.batch([registryStmt, versionStmt]);

    return c.json({ id: body.id, version: 1, status: "created" }, 201);
  } catch (err) {
    console.error("[prompts] create error:", err);
    return c.json({ error: "Failed to create prompt", detail: err.message }, 500);
  }
});

// Get prompt by ID (latest version)
promptRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const prompt = await db.prepare("SELECT * FROM prompt_registry WHERE id = ?").bind(c.req.param("id")).first();
  if (!prompt) return c.json({ error: "Prompt not found" }, 404);

  // RY: check consumer gate on read
  const getApiKey = c.get("apiKey");
  const getConsumerService = getApiKey?.service || getApiKey?.chittyId || c.req.header("X-Source-Service") || "unknown";
  const consumerCheck = checkConsumerGate(prompt, getConsumerService);
  if (!consumerCheck.allowed) {
    return c.json({ error: "Unauthorized: consumer gate denied", reason: consumerCheck.reason }, 403);
  }

  return c.json(formatPrompt(prompt));
});

// List prompts (optionally filtered by domain)
promptRoutes.get("/", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const domain = c.req.query("domain");
  let results;
  if (domain) {
    results = await db.prepare("SELECT * FROM prompt_registry WHERE domain = ? ORDER BY id").bind(domain).all();
  } else {
    results = await db.prepare("SELECT * FROM prompt_registry ORDER BY domain, id").all();
  }

  // RY: filter results by consumer gate
  const listApiKey = c.get("apiKey");
  const listConsumerService = listApiKey?.service || listApiKey?.chittyId || c.req.header("X-Source-Service") || "unknown";
  const filtered = (results.results || []).filter((row) => checkConsumerGate(row, listConsumerService).allowed);

  return c.json({ prompts: filtered.map(formatPrompt), total: filtered.length });
});

// Update prompt (creates new version)
promptRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const promptId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Request body required" }, 400);

  const existing = await db.prepare("SELECT * FROM prompt_registry WHERE id = ?").bind(promptId).first();
  if (!existing) return c.json({ error: "Prompt not found" }, 404);

  const consumerId = c.get("apiKey")?.chittyId || c.get("apiKey")?.userId || null;

  // RY: enforce author gate
  const authorGateCheck = checkAuthorGate(existing, consumerId);
  if (!authorGateCheck.allowed) {
    return c.json({ error: "Unauthorized: author gate denied", reason: authorGateCheck.reason }, 403);
  }

  const newVersion = (existing.version || 0) + 1;
  const base = body.base || existing.base;
  const layers = JSON.stringify(body.layers || JSON.parse(existing.layers || "[]"));
  const fallback = body.fallback || existing.fallback;
  const envGate = JSON.stringify(body.envGate || JSON.parse(existing.env_gate || "{}"));
  const authorGate = JSON.stringify(body.authorGate || JSON.parse(existing.author_gate || "{}"));
  const consumerGate = JSON.stringify(body.consumerGate || JSON.parse(existing.consumer_gate || "{}"));
  const changelog = body.changelog || `Updated to version ${newVersion}`;

  try {
    // Atomic: batch update + version insert in a single D1 transaction
    const updateStmt = db.prepare(`
      UPDATE prompt_registry
      SET version = ?, base = ?, layers = ?, fallback = ?, env_gate = ?, author_gate = ?, consumer_gate = ?,
          updated_at = datetime('now'), changelog = ?
      WHERE id = ?
    `).bind(newVersion, base, layers, fallback, envGate, authorGate, consumerGate, changelog, promptId);

    // TY: save version snapshot
    const versionInsertStmt = db.prepare(`
      INSERT INTO prompt_versions (prompt_id, version, base, layers, fallback, env_gate, author_gate, consumer_gate, changelog, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(promptId, newVersion, base, layers, fallback, envGate, authorGate, consumerGate, changelog, consumerId);

    await db.batch([updateStmt, versionInsertStmt]);

    return c.json({ id: promptId, version: newVersion, status: "updated" });
  } catch (err) {
    console.error("[prompts] update error:", err);
    return c.json({ error: "Failed to update prompt", detail: err.message }, 500);
  }
});

// Get version history
promptRoutes.get("/:id/versions", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const results = await db.prepare(
    "SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC"
  ).bind(c.req.param("id")).all();

  return c.json({ versions: (results.results || []).map(formatVersion), total: results.results?.length || 0 });
});

// ── Resolve (TY + RY) ───────────────────────────────────────

promptRoutes.post("/resolve", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const body = await c.req.json().catch(() => null);
  if (!body?.promptId) return c.json({ error: "promptId is required" }, 400);

  const prompt = await db.prepare("SELECT * FROM prompt_registry WHERE id = ?").bind(body.promptId).first();
  if (!prompt) return c.json({ error: "Prompt not found" }, 404);

  const environment = body.environment || "production";
  const apiKey = c.get("apiKey");
  const consumerService = apiKey?.service || apiKey?.chittyId || c.req.header("X-Source-Service") || "unknown";
  const consumerId = apiKey?.chittyId || apiKey?.userId || null;

  // RY: check consumer gate
  const consumerCheck = checkConsumerGate(prompt, consumerService);
  if (!consumerCheck.allowed) {
    return c.json({ error: "Unauthorized: consumer gate denied", reason: consumerCheck.reason }, 403);
  }

  // RY: check environment gate
  const envGate = safeParseJson(prompt.env_gate);
  const envMode = envGate[environment] || "ai";
  const aiEnabled = envMode === "ai" || (envMode === "configurable" && body.forceAi);

  // TY: compose prompt from base + layers + additional layers
  const baseLayers = safeParseJson(prompt.layers);
  const additionalLayerIds = body.additionalLayers || [];
  const resolvedLayers = [...baseLayers];

  // Look up additional layers by ID (from other prompts or layer registry)
  for (const layerId of additionalLayerIds) {
    const layerPrompt = await db.prepare("SELECT base FROM prompt_registry WHERE id = ?").bind(layerId).first();
    if (layerPrompt) {
      resolvedLayers.push({ id: layerId, content: layerPrompt.base, order: resolvedLayers.length + 1 });
    }
  }

  // Sort by order and compose
  resolvedLayers.sort((a, b) => (a.order || 0) - (b.order || 0));
  const composedPrompt = composePrompt(prompt.base, resolvedLayers, body.variables);
  const resolvedLayerIds = resolvedLayers.map((l) => l.id);

  // VY: log execution
  await logExecution(db, {
    promptId: body.promptId,
    promptVersion: prompt.version,
    consumerId,
    consumerService,
    mode: "resolve",
    environment,
    layersResolved: resolvedLayerIds,
  });

  return c.json({
    systemPrompt: composedPrompt,
    aiEnabled,
    version: prompt.version,
    resolvedLayers: resolvedLayerIds,
    fallbackMode: aiEnabled ? null : prompt.fallback,
  });
});

// ── Execute (TY + VY + RY) ──────────────────────────────────

promptRoutes.post("/execute", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const body = await c.req.json().catch(() => null);
  if (!body?.promptId || !body?.input) {
    return c.json({ error: "promptId and input are required" }, 400);
  }

  const prompt = await db.prepare("SELECT * FROM prompt_registry WHERE id = ?").bind(body.promptId).first();
  if (!prompt) return c.json({ error: "Prompt not found" }, 404);

  const environment = body.environment || "production";
  const apiKeyExec = c.get("apiKey");
  const consumerService = apiKeyExec?.service || apiKeyExec?.chittyId || c.req.header("X-Source-Service") || "unknown";
  const consumerId = apiKeyExec?.chittyId || apiKeyExec?.userId || null;

  // RY: gates
  const consumerCheck = checkConsumerGate(prompt, consumerService);
  if (!consumerCheck.allowed) {
    return c.json({ error: "Unauthorized: consumer gate denied", reason: consumerCheck.reason }, 403);
  }

  const envGate = safeParseJson(prompt.env_gate);
  const envMode = envGate[environment] || "ai";
  const aiEnabled = envMode === "ai" || (envMode === "configurable" && body.forceAi);

  if (!aiEnabled) {
    // VY: log gated execution
    await logExecution(db, {
      promptId: body.promptId, promptVersion: prompt.version,
      consumerId, consumerService, mode: "execute", environment,
      layersResolved: [], error: `AI gated: env=${environment} mode=${envMode}`,
    });

    return c.json({
      result: null,
      aiEnabled: false,
      fallbackMode: prompt.fallback,
      version: prompt.version,
      message: `AI execution gated in ${environment} environment (mode: ${envMode})`,
    });
  }

  // TY: compose prompt
  const baseLayers = safeParseJson(prompt.layers);
  const additionalLayerIds = body.additionalLayers || [];
  const resolvedLayers = [...baseLayers];

  for (const layerId of additionalLayerIds) {
    const layerPrompt = await db.prepare("SELECT base FROM prompt_registry WHERE id = ?").bind(layerId).first();
    if (layerPrompt) {
      resolvedLayers.push({ id: layerId, content: layerPrompt.base, order: resolvedLayers.length + 1 });
    }
  }

  resolvedLayers.sort((a, b) => (a.order || 0) - (b.order || 0));
  const composedPrompt = composePrompt(prompt.base, resolvedLayers, body.variables);
  const resolvedLayerIds = resolvedLayers.map((l) => l.id);

  // Dispatch to agent or AI proxy
  const startMs = Date.now();
  let result = null;
  let executedBy = "chittyconnect/ai-proxy";
  let error = null;

  try {
    // Determine dispatch target from prompt domain
    const dispatchTarget = resolveDispatchTarget(prompt.domain, c.env);

    if (dispatchTarget.type === "chittyrouter") {
      // Dispatch to ChittyRouter agent
      const agentUrl = `${dispatchTarget.url}${dispatchTarget.path}`;
      const res = await fetch(agentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Source-Service": "chittyconnect",
        },
        body: JSON.stringify({
          systemPrompt: composedPrompt,
          input: body.input,
          promptId: body.promptId,
          promptVersion: prompt.version,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Agent dispatch failed: ${res.status} ${errText.slice(0, 200)}`);
      }

      const agentResult = await res.json();
      result = agentResult.result || agentResult.output || agentResult;
      executedBy = `chittyrouter/${dispatchTarget.agent}`;
    } else {
      // Direct AI proxy via Workers AI
      if (c.env.AI) {
        const aiResult = await c.env.AI.run(
          c.env.AI_MODEL_PRIMARY || "@cf/meta/llama-4-scout-17b-16e-instruct",
          {
            messages: [
              { role: "system", content: composedPrompt },
              { role: "user", content: typeof body.input === "string" ? body.input : JSON.stringify(body.input) },
            ],
            max_tokens: body.maxTokens || 4096,
          }
        );
        result = aiResult.response;
        executedBy = "chittyconnect/workers-ai";
      } else {
        throw new Error("No AI binding or dispatch target available");
      }
    }
  } catch (err) {
    error = err.message;
    console.error("[prompts/execute]", err);
  }

  const latencyMs = Date.now() - startMs;

  // VY: log execution with full context
  const inputStr = typeof body.input === "string" ? body.input : JSON.stringify(body.input);
  const inputHash = await hashInput(inputStr);

  await logExecution(db, {
    promptId: body.promptId, promptVersion: prompt.version,
    consumerId, consumerService, executedBy, mode: "execute",
    environment, inputHash, layersResolved: resolvedLayerIds,
    latencyMs, error,
  });

  if (error) {
    return c.json({ error: "Execution failed", detail: error, version: prompt.version }, 502);
  }

  return c.json({
    result,
    promptVersion: prompt.version,
    resolvedLayers: resolvedLayerIds,
    executedBy,
    latencyMs,
    aiEnabled: true,
  });
});

// ── VY: Quality Signal (async feedback) ─────────────────────

promptRoutes.post("/executions/:executionId/quality", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const body = await c.req.json().catch(() => null);
  if (body?.quality === undefined || body?.quality === null) {
    return c.json({ error: "quality (0.0-1.0) is required" }, 400);
  }

  const quality = Math.max(0, Math.min(1, Number(body.quality)));
  const source = body.source || "user_rating";
  const executionId = Number(c.req.param("executionId"));

  // Verify the execution exists and belongs to the caller
  const qualityApiKey = c.get("apiKey");
  const callerService = qualityApiKey?.service || qualityApiKey?.chittyId || c.req.header("X-Source-Service") || "unknown";
  const callerId = qualityApiKey?.chittyId || qualityApiKey?.userId || null;

  const execution = await db.prepare(
    "SELECT consumer_id, consumer_service FROM prompt_executions WHERE id = ?"
  ).bind(executionId).first();

  if (!execution) {
    return c.json({ error: "Execution not found" }, 404);
  }

  // Ownership check: caller must match the original consumer
  if (execution.consumer_id && callerId && execution.consumer_id !== callerId) {
    return c.json({ error: "Unauthorized: execution belongs to a different consumer" }, 403);
  }
  if (execution.consumer_service !== callerService && execution.consumer_id !== callerId) {
    return c.json({ error: "Unauthorized: execution belongs to a different service" }, 403);
  }

  await db.prepare(
    "UPDATE prompt_executions SET output_quality = ?, quality_source = ? WHERE id = ?"
  ).bind(quality, source, executionId).run();

  return c.json({ status: "updated" });
});

// ── VY: Drift Detection ─────────────────────────────────────

promptRoutes.get("/:id/drift", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const promptId = c.req.param("id");
  const rawDays = parseInt(c.req.query("days") || "30", 10);
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(rawDays, 365)) : 30;

  // Get quality distribution over time
  const results = await db.prepare(`
    SELECT
      prompt_version,
      COUNT(*) as executions,
      AVG(output_quality) as avg_quality,
      MIN(output_quality) as min_quality,
      MAX(output_quality) as max_quality,
      COUNT(CASE WHEN output_quality IS NOT NULL THEN 1 END) as rated_count,
      COUNT(CASE WHEN error IS NOT NULL THEN 1 END) as error_count
    FROM prompt_executions
    WHERE prompt_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY prompt_version
    ORDER BY prompt_version DESC
  `).bind(promptId, days).all();

  return c.json({
    promptId,
    periodDays: days,
    versions: results.results || [],
  });
});

// ── VY: Execution History ───────────────────────────────────

promptRoutes.get("/:id/executions", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "D1 not available" }, 503);

  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
  const offset = parseInt(c.req.query("offset") || "0");

  const results = await db.prepare(`
    SELECT * FROM prompt_executions
    WHERE prompt_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(c.req.param("id"), limit, offset).all();

  return c.json({ executions: results.results || [], total: results.results?.length || 0 });
});

// ── Helpers ──────────────────────────────────────────────────

function formatPrompt(row) {
  return {
    id: row.id,
    domain: row.domain,
    version: row.version,
    base: row.base,
    layers: safeParseJson(row.layers),
    fallback: row.fallback,
    envGate: safeParseJson(row.env_gate),
    authorGate: safeParseJson(row.author_gate),
    consumerGate: safeParseJson(row.consumer_gate),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    changelog: row.changelog,
  };
}

function formatVersion(row) {
  return {
    promptId: row.prompt_id,
    version: row.version,
    base: row.base,
    layers: safeParseJson(row.layers),
    fallback: row.fallback,
    envGate: safeParseJson(row.env_gate),
    authorGate: safeParseJson(row.author_gate),
    consumerGate: safeParseJson(row.consumer_gate),
    changelog: row.changelog,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function safeParseJson(str) {
  try { return JSON.parse(str || "{}"); } catch { return {}; }
}

function composePrompt(base, layers, variables) {
  let composed = base;
  for (const layer of layers) {
    composed += "\n\n" + (layer.content || "");
  }
  // Variable substitution: {{variable}} → value
  if (variables && typeof variables === "object") {
    for (const [key, value] of Object.entries(variables)) {
      composed = composed.replaceAll(`{{${key}}}`, String(value));
    }
  }
  return composed;
}

function checkAuthorGate(prompt, consumerId) {
  const gate = safeParseJson(prompt.author_gate);
  if (!gate.allowedAuthors || gate.allowedAuthors.includes("*")) {
    return { allowed: true };
  }
  if (!consumerId) {
    return { allowed: false, reason: "No ChittyID provided and author gate is restricted" };
  }
  if (!gate.allowedAuthors.includes(consumerId)) {
    return { allowed: false, reason: `ChittyID ${consumerId} not in allowedAuthors for domain ${gate.domain || "unknown"}` };
  }
  return { allowed: true };
}

function checkConsumerGate(prompt, consumerService) {
  const gate = safeParseJson(prompt.consumer_gate);
  if (!gate.allowedServices || gate.allowedServices.includes("*")) {
    return { allowed: true };
  }
  if (!gate.allowedServices.includes(consumerService)) {
    return { allowed: false, reason: `Service ${consumerService} not in allowedServices` };
  }
  return { allowed: true };
}

function resolveDispatchTarget(domain, env) {
  // Map prompt domains to ChittyRouter agents
  const domainAgentMap = {
    litigation: { agent: "response-agent", path: "/agents/response/generate" },
    scrape: { agent: "scrape-agent", path: "/agents/scrape/process" },
    triage: { agent: "triage-agent", path: "/agents/triage/classify" },
    intelligence: { agent: "intelligence-agent", path: "/agents/intelligence/analyze" },
    agents: { agent: "agent-executor", path: "/agents/executor/run" },
  };

  const target = domainAgentMap[domain];
  if (target && env.CHITTYROUTER_URL) {
    return { type: "chittyrouter", url: env.CHITTYROUTER_URL, ...target };
  }

  // Fallback to direct Workers AI
  return { type: "direct" };
}

async function logExecution(db, params) {
  try {
    await db.prepare(`
      INSERT INTO prompt_executions
        (prompt_id, prompt_version, consumer_id, consumer_service, executed_by, mode, environment, input_hash, layers_resolved, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      params.promptId, params.promptVersion,
      params.consumerId || null, params.consumerService || "unknown",
      params.executedBy || null, params.mode || "resolve",
      params.environment || "production", params.inputHash || null,
      JSON.stringify(params.layersResolved || []),
      params.latencyMs || null, params.error || null
    ).run();
  } catch (err) {
    console.error("[prompts] execution log failed:", err);
  }
}

async function hashInput(input) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return "sha256:" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
