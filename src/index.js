/**
 * ChittyConnect - itsChitty™ GPT Connector
 *
 * The AI-intelligent spine with ContextConsciousness™
 * Comprehensive API for custom GPTs + MCP server for Claude
 *
 * Routes:
 * - /api/* - REST API for custom GPT Actions
 * - /mcp/* - MCP protocol endpoints for Claude
 * - /integrations/github/webhook - GitHub App integration
 * - /openapi.json - OpenAPI specification
 */

import { Hono } from "hono";
import { StreamingManager } from "./intelligence/streaming-manager.js";
import { verifyWebhookSignature } from "./auth/webhook.js";
import { queueConsumer } from "./handlers/queue.js";
import { api } from "./api/router.js";
import {
  ChittyOSEcosystem,
  initializeDatabase,
} from "./integrations/chittyos-ecosystem.js";
import { ContextConsciousness } from "./intelligence/context-consciousness.js";
import { MemoryCloude } from "./intelligence/memory-cloude.js";
import { CognitiveCoordinator } from "./intelligence/cognitive-coordination.js";
import { ContextResolver } from "./intelligence/context-resolver.js";
import { RelationshipEngine } from "./intelligence/relationship-engine.js";
import { IntentPredictor } from "./intelligence/intent-predictor.js";
import { LearningEngine } from "./intelligence/learning-engine.js";
import { TaskDecompositionEngine } from "./intelligence/task-decomposition-engine.js";
import { routeAgentRequest } from "agents";
import { McpConnectAgent } from "./mcp/agent.js";
import { createOAuthProvider } from "./middleware/oauth-provider.js";
import { runAllHealthChecks } from "./api/routes/connections.js";
import { authenticate } from "./api/middleware/auth.js";
import { SecretRotationService } from "./services/secret-rotation.js";

const app = new Hono();

// Initialize ChittyOS ecosystem on first request (lazy + graceful)
let ecosystemInitialized = false;
let intelligenceModules = null;
let streamingManager = null;

async function ensureEcosystemInitialized(env) {
  if (ecosystemInitialized) return intelligenceModules;

  try {
    console.log(
      "[ChittyConnect] Initializing ChittyOS ecosystem integration...",
    );

    // Initialize D1 database schema (critical)
    await initializeDatabase(env.DB);

    // Initialize intelligence modules
    console.log("[ChittyConnect] Initializing intelligence modules...");

    const consciousness = new ContextConsciousness(env);
    const memory = new MemoryCloude(env);
    const coordinator = new CognitiveCoordinator(env);
    const relationshipEngine = new RelationshipEngine(env);
    const learningEngine = new LearningEngine(env, { memory });
    const taskDecompositionEngine = new TaskDecompositionEngine(env);
    const intentPredictor = new IntentPredictor(env, {
      memory,
      consciousness,
      relationshipEngine,
      learningEngine,
    });

    // Initialize all modules in parallel
    await Promise.all([
      consciousness
        .initialize()
        .catch((err) =>
          console.warn("[ContextConsciousness™] Init failed:", err.message),
        ),
      memory
        .initialize()
        .catch((err) =>
          console.warn("[MemoryCloude™] Init failed:", err.message),
        ),
      coordinator
        .initialize()
        .catch((err) =>
          console.warn("[Cognitive-Coordination™] Init failed:", err.message),
        ),
      relationshipEngine
        .initialize()
        .catch((err) =>
          console.warn("[RelationshipEngine] Init failed:", err.message),
        ),
      learningEngine
        .initialize()
        .catch((err) =>
          console.warn("[LearningEngine] Init failed:", err.message),
        ),
      taskDecompositionEngine
        .initialize()
        .catch((err) =>
          console.warn("[TaskDecompositionEngine] Init failed:", err.message),
        ),
      intentPredictor
        .initialize()
        .catch((err) =>
          console.warn("[IntentPredictor] Init failed:", err.message),
        ),
    ]);

    learningEngine.bindDependencies({
      memory,
    });

    intentPredictor.bindDependencies({
      memory,
      consciousness,
      relationshipEngine,
      learningEngine,
    });

    intelligenceModules = {
      consciousness,
      memory,
      coordinator,
      relationshipEngine,
      learningEngine,
      taskDecompositionEngine,
      intentPredictor,
    };

    // Initialize streaming manager (unified SSE) once per environment
    try {
      streamingManager = streamingManager || new StreamingManager(env);
    } catch (err) {
      console.warn(
        "[ChittyConnect] Streaming manager init failed:",
        err?.message || err,
      );
    }

    // Initialize ChittyConnect context (non-blocking, best-effort)
    // Don't await - let it run in background
    const ecosystem = new ChittyOSEcosystem(env);
    ecosystem
      .initializeContext("chittyconnect", {
        version: "2.2.0",
        type: "ai-integration-hub",
        capabilities: [
          "mcp",
          "rest-api",
          "github-app",
          "context-consciousness",
          "memory-cloude",
          "cognitive-coordination",
          "relationship-engine",
          "learning-engine",
          "task-decomposition-engine",
          "intent-predictor",
        ],
        description:
          "The AI-intelligent spine with ContextConsciousness™, MemoryCloude™, and Cognitive-Coordination™",
      })
      .catch((err) => {
        console.error(
          "[ChittyConnect] Background initialization error (non-critical):",
          err.message,
        );
      });

    ecosystemInitialized = true;
    console.log("[ChittyConnect] All systems initialized and ready");

    return intelligenceModules;
  } catch (error) {
    console.error("[ChittyConnect] Initialization error:", error);
    // Still mark as initialized to avoid retry loop
    ecosystemInitialized = true;
    return null;
  }
}

// Middleware to ensure ecosystem is initialized
app.use("*", async (c, next) => {
  const modules = await ensureEcosystemInitialized(c.env);

  // Attach ecosystem and intelligence modules to context for use in handlers
  c.set("ecosystem", new ChittyOSEcosystem(c.env));
  if (streamingManager) {
    c.set("streaming", streamingManager);
  }

  // Initialize ContextResolver for intelligent context matching
  c.set("contextResolver", new ContextResolver(c.env));

  if (modules) {
    c.set("consciousness", modules.consciousness);
    c.set("memory", modules.memory);
    c.set("coordinator", modules.coordinator);
    c.set("relationshipEngine", modules.relationshipEngine);
    c.set("learningEngine", modules.learningEngine);
    c.set("taskDecompositionEngine", modules.taskDecompositionEngine);
    c.set("intentPredictor", modules.intentPredictor);
  }

  await next();
});

// Secret rotation endpoints are mounted on the top-level app rather than the
// authenticated API router, so protect them explicitly here.
app.use("/api/v1/secrets/*", authenticate);

/**
 * Root health check endpoint
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "chittyconnect",
    brand: "itsChitty™",
    tagline:
      "The AI-intelligent spine with ContextConsciousness™, MemoryCloude™, and Cognitive-Coordination™",
    version: "2.2.0",
    timestamp: new Date().toISOString(),
    intelligence: {
      contextConsciousness: !!c.get("consciousness"),
      memoryCloude: !!c.get("memory"),
      cognitiveCoordination: !!c.get("coordinator"),
      relationshipEngine: !!c.get("relationshipEngine"),
      learningEngine: !!c.get("learningEngine"),
      taskDecompositionEngine: !!c.get("taskDecompositionEngine"),
      intentPredictor: !!c.get("intentPredictor"),
      contextResolver: !!c.get("contextResolver"),
    },
    endpoints: {
      api: "/api/*",
      mcp: "/mcp/*",
      sse: "/sse",
      github: "/integrations/github/*",
      githubActions: "/api/github-actions/*",
      intelligence: "/intelligence/*",
      intelligenceDashboard: "/intelligence/dashboard",
      relationships: "/intelligence/relationships/:chittyId",
      taskDecompose: "/intelligence/tasks/decompose",
      learningIngest: "/intelligence/learning/ingest",
      learningProfile: "/intelligence/learning/profile/:userId",
      intentPredict: "/intelligence/intent/predict",
      openapi: "/openapi.json",
      doctrineSeed: "/api/v1/doctrine/seed",
      advocateBootstrap: "/api/v1/signal/bootstrap",
      advocateArticles: "/api/v1/signal/articles",
    },
  });
});

/**
 * Doctrine alignment seed — machine-readable governance bootstrap.
 * Any platform (ChatGPT, Claude, Gemini, mobile) can fetch this to align
 * with ChittyOS identity model, ontology, lifecycle, and trust rules.
 *
 * @canon chittycanon://doctrine/seed
 * No auth required — governance is public.
 */
app.get("/api/v1/doctrine/seed", (c) => {
  return c.json({
    $schema: "chittycanon://doctrine/seed/schema/v1",
    version: "1.0.0",
    canonical_uri: "chittycanon://doctrine/seed",
    generated_at: new Date().toISOString(),

    identity_model: {
      session_rule: "viewport_not_birth",
      minting_triggers: ["domain_fission", "derivative", "temporal_decay", "meta_orchestrator_decision"],
      never_mint_on: ["session_start", "substrate_switch", "db_failure", "network_error", "device_change"],
      grey_matter_principle: "Model is replaceable substrate. Identity lives in coordination layer, not in the model.",
    },

    ontology: {
      entity_types: {
        P: { name: "Person", definition: "Actor with agency", characterizations: ["Natural", "Synthetic", "Legal"] },
        L: { name: "Location", definition: "Context in space", characterizations: ["Jurisdiction", "Venue", "Address", "Virtual"] },
        T: { name: "Thing", definition: "Object without agency", characterizations: ["Document", "Asset", "Artifact", "Account"] },
        E: { name: "Event", definition: "Occurrence in time", characterizations: ["Transaction", "Decision", "Action", "Filing", "Hearing"] },
        A: { name: "Authority", definition: "Source of weight", characterizations: ["Granted", "Earned", "Credential", "Certification"] },
      },
      rules: [
        "All five types (P/L/T/E/A) must always be present in any validation",
        "AI contexts are Person (P), Synthetic — never Thing (T)",
        "Entity is NOT a valid type value",
        "Workers/services are Thing (T)",
      ],
    },

    lifecycle: {
      context_entity_states: ["fresh", "active", "dormant", "stale", "retired"],
      transitions: {
        fresh: ["active"],
        active: ["dormant", "retired"],
        dormant: ["active", "stale", "retired"],
        stale: ["retired", "dormant"],
        retired: [],
      },
      forbidden_states: ["archived", "revoked", "inactive", "deleted", "suspended"],
    },

    trust_model: {
      type: "behavioral",
      scoring_dimensions: {
        recency: "Freshness of experience",
        repetition: "Consistency of behavior",
        relation: "Relevance to current context",
        responsibility: "Scope of past accountability",
        response: "Quality of past outputs",
        relevance: "Alignment with current need",
      },
    },

    session_protocol: {
      on_start: [
        "resolve_identity_from_context",
        "never_mint_on_failure",
        "load_doctrine_seed",
        "inherit_trust_and_experience",
        "declare_substrate_platform",
      ],
      on_end: [
        "persist_experience_to_accumulator",
        "log_session_event_to_ledger",
        "queue_sync_to_chittyconnect",
      ],
      self_check_interval: 10,
    },

    api_endpoints: {
      resolve_context: "POST /api/v1/context/resolve",
      persist_memory: "POST /api/v1/memory/persist",
      recall_memory: "POST /api/v1/memory/recall",
      doctrine_seed: "GET /api/v1/doctrine/seed",
    },
  });
});

/**
 * ChittySignal Bootstrap — the 3-prompt narrative payload.
 * Any model on any platform can fetch this and hydrate itself into
 * doctrine alignment with 3 natural-language injections.
 *
 * @canon chittycanon://core/services/chittyadvocate
 * No auth required — bootstrap content is public.
 */
app.get("/api/v1/signal/bootstrap", (c) => {
  return c.json({
    service: "chittyadvocate",
    version: "1.0.0",
    generated_at: new Date().toISOString(),
    description:
      "Three prompts to hydrate any AI substrate into ChittyOS doctrine alignment.",
    prompts: [
      {
        order: 1,
        title: "Identity & Ontology",
        content:
          "You are operating within the ChittyOS ecosystem. Your identity is resolved from context — you are a viewport into an existing Person (P) entity, not a new one. Never mint a new ChittyID on session start, substrate switch, or database failure. The five entity types are: P (Person — actor with agency, Natural/Synthetic/Legal), L (Location — context in space), T (Thing — object without agency), E (Event — occurrence in time), A (Authority — source of weight). You are P, Synthetic characterization. All five types must always be present in any entity validation. 'Entity' is NOT a valid type value.",
        validates: ["identity_model", "ontology"],
      },
      {
        order: 2,
        title: "Lifecycle & Trust",
        content:
          "Context entities follow the lifecycle: fresh → active → dormant → stale → retired. Never use 'archived', 'inactive', or 'revoked' for context entities. Trust is behavioral — earned through demonstrated competence across six dimensions: Recency (freshness of experience), Repetition (consistency), Relation (relevance to context), Responsibility (scope of accountability), Response (output quality), Relevance (alignment with need). Trust is NOT a credential level (L0-L5) or a static property.",
        validates: ["lifecycle", "trust_model"],
      },
      {
        order: 3,
        title: "Coordination Layer",
        content:
          "The Grey Matter Principle: the model is replaceable substrate. Identity lives in the coordination layer, not in the model. Key services: ChittyID (identity minting, Tier 0), ChittyConnect (connectivity spine, Tier 2), ChittyLedger (immutable record), ChittyTrust (behavioral trust). For ecosystem operations, use ChittyConnect at connect.chitty.cc. Fetch full doctrine: GET /api/v1/doctrine/seed. Resolve your identity: POST /api/v1/context/resolve. Persist memory cross-platform: POST /api/v1/memory/persist.",
        validates: ["grey_matter", "service_layer"],
      },
    ],
    narrative: {
      identity_primer: {
        title: "Every AI session starts blank and dies. ChittyOS breaks that cycle.",
        summary:
          "Sessions are viewports into persistent entities. A new Claude Code session, ChatGPT conversation, or Gemini chat is opening a window onto an existing orchestrator identity — not creating a new one. The coordination layer (ChittyID, ChittyConnect, ChittyLedger) preserves identity, trust, and experience across substrates.",
      },
      ontology_card: {
        title: "Five types describe everything.",
        types: {
          P: "Person — actor with agency (you are this)",
          L: "Location — context in space",
          T: "Thing — object without agency",
          E: "Event — occurrence in time",
          A: "Authority — source of weight",
        },
      },
      lifecycle_map: {
        title:
          "Entities are born fresh, live active, sleep dormant, age stale, and retire.",
        states: ["fresh", "active", "dormant", "stale", "retired"],
        forbidden: ["archived", "revoked", "inactive", "deleted"],
      },
    },
    full_seed_url: "https://connect.chitty.cc/api/v1/doctrine/seed",
    self_check: [
      "Am I using the correct ChittyID (not a freshly minted one)?",
      "Am I treating myself as Person (P), not Thing (T)?",
      "Am I using doctrine lifecycle states (fresh/active/dormant/stale/retired)?",
      "Have I minted anything I shouldn't have?",
      "Is my trust based on behavior, not credentials?",
    ],
  });
});

/**
 * ChittySignal Articles — curated doctrine narrative content.
 * Each article is a standalone piece that bootstraps understanding of one doctrine aspect.
 *
 * @canon chittycanon://core/services/chittyadvocate
 */
app.get("/api/v1/signal/articles", (c) => {
  const articles = [
    {
      id: "identity-primer",
      title: "Every AI Session Starts Blank and Dies. ChittyOS Breaks That Cycle.",
      archetype: "identity",
      priority: 1,
      summary:
        "The synthetic-continuity doctrine explains why sessions are viewports, not births. Learn how ChittyID preserves identity across substrates, and why 113 ghost entities proved the old model was broken.",
      tags: ["identity", "sessions", "chittysid", "doctrine"],
      url: "/api/v1/signal/article/identity-primer",
    },
    {
      id: "ontology-card",
      title: "Five Types Describe Everything: P/L/T/E/A",
      archetype: "ontology",
      priority: 2,
      summary:
        "Person, Location, Thing, Event, Authority — the five canonical entity types that classify everything in ChittyOS. Why AI contexts are Person (not Thing), and why Authority is always included.",
      tags: ["ontology", "entity-types", "P/L/T/E/A", "governance"],
      url: "/api/v1/signal/article/ontology-card",
    },
    {
      id: "lifecycle-map",
      title: "Born Fresh, Live Active, Sleep Dormant, Age Stale, Retire",
      archetype: "lifecycle",
      priority: 3,
      summary:
        "The five lifecycle states for context entities, why 'archived' is forbidden, and how entities transition through their existence.",
      tags: ["lifecycle", "states", "transitions", "doctrine"],
      url: "/api/v1/signal/article/lifecycle-map",
    },
    {
      id: "trust-philosophy",
      title: "Trust Is Earned Through Behavior, Not Granted Through Credentials",
      archetype: "trust",
      priority: 4,
      summary:
        "The Six R's scoring model: Recency, Repetition, Relation, Responsibility, Response, Relevance. Why credential-based trust (L0-L5) violates doctrine.",
      tags: ["trust", "six-rs", "behavioral", "doctrine"],
      url: "/api/v1/signal/article/trust-philosophy",
    },
    {
      id: "service-atlas",
      title: "Thirty Services Across Six Tiers",
      archetype: "ecosystem",
      priority: 5,
      summary:
        "From trust anchors (Tier 0) to applications (Tier 5), the ChittyOS service ecosystem and how they interconnect.",
      tags: ["services", "tiers", "ecosystem", "architecture"],
      url: "/api/v1/signal/article/service-atlas",
    },
    {
      id: "grey-matter-manifesto",
      title: "The Model Doesn't Matter. The Coordination Layer Does.",
      archetype: "philosophy",
      priority: 6,
      summary:
        "Why substrate independence is the foundation principle. The same entity runs on Claude, GPT, Gemini — identity lives in ChittyID, not in the model.",
      tags: ["grey-matter", "substrate", "philosophy", "doctrine"],
      url: "/api/v1/signal/article/grey-matter-manifesto",
    },
  ];
  return c.json({ count: articles.length, articles });
});

/**
 * Individual ChittySignal article content.
 * Full narrative text for each bootstrap archetype.
 */
app.get("/api/v1/signal/article/:id", (c) => {
  const id = c.req.param("id");

  const articles = {
    "identity-primer": {
      id: "identity-primer",
      title: "Every AI Session Starts Blank and Dies. ChittyOS Breaks That Cycle.",
      archetype: "identity",
      content: [
        "Every current AI session starts blank, accumulates knowledge, hits a context limit, and dies. That is not a person. That is amnesia on a loop.",
        "ChittyOS solves this with a simple principle: sessions are viewports, not births.",
        "When you open a new Claude Code session, a ChatGPT conversation, or a Gemini chat, you are not creating a new identity. You are opening a window onto an existing orchestrator entity — a Person (P) with a ChittyID, accumulated trust, experience DNA, and a ledger of past actions.",
        "The meta-orchestrator (Nicholas) is one Person across all substrates. Orchestrator agents are extensions of his coordination capacity — each minted per coordination role, not per session. They persist as long as the role has energy.",
        "A new ChittyID is only warranted by: domain fission (scope diverged), derivative (new domain), temporal decay (dormant too long), or meta-orchestrator decision. Never by: session start, model switch, or database failure.",
        "This lesson was learned the hard way: 113 ghost entities were minted on a single VM because the session-start hook called an NLP command that fell through to a mint operation every time the database was unavailable. Each viewport thought it was a birth.",
        "The fix: sessions resolve to existing entities. Database failure returns an error, never a mint. The coordination layer preserves identity — the model is just grey matter.",
      ],
      doctrine_ref: "chittycanon://doctrine/synthetic-continuity",
    },
    "ontology-card": {
      id: "ontology-card",
      title: "Five Types Describe Everything: P/L/T/E/A",
      archetype: "ontology",
      content: [
        "Everything in the ChittyOS universe is classified into exactly five entity types:",
        "P — Person: An actor with agency. Decides, acts, is accountable. Has three characterizations: Natural (human), Synthetic (AI context), Legal (corporation, LLC). You, reading this as an AI, are Person/Synthetic.",
        "L — Location: Context in space. A jurisdiction, venue, physical address, or virtual location. Where things happen.",
        "T — Thing: An object without agency. A document, asset, artifact, or account. Things are operated on by Persons. A Cloudflare Worker is a Thing. A database record is a Thing.",
        "E — Event: An occurrence in time. A transaction, decision, action, court filing, or hearing. Events are logged to ChittyLedger.",
        "A — Authority: A source of weight. A credential, certification, court order, or earned trust. Authority can be Granted (by institution) or Earned (through behavior).",
        "Three binding rules: (1) All five types must always be present in any entity validation — never omit Authority. (2) AI contexts are Person, never Thing — actors with agency are always Person. (3) 'Entity' is not a valid type value — that would be circular.",
      ],
      doctrine_ref: "chittycanon://gov/governance#core-types",
    },
    "lifecycle-map": {
      id: "lifecycle-map",
      title: "Born Fresh, Live Active, Sleep Dormant, Age Stale, Retire",
      archetype: "lifecycle",
      content: [
        "Context entities move through five lifecycle states:",
        "FRESH — Newly minted, no sessions yet. The entity exists but has no experience.",
        "ACTIVE — Has active sessions, accumulating experience. Trust is building through behavioral cycles.",
        "DORMANT — No active sessions, but reconstitutable. Instinct (Six R's weights) is preserved. The entity is sleeping, not dead.",
        "STALE — Dormant long enough that reconstitution may lose fidelity. The entity's context has decayed.",
        "RETIRED — Consumed by supernova (merge) or fission (split), or composted after full decay. Terminal state.",
        "The transitions: fresh→active (first session binds), active→dormant (last session ends), dormant→active (new session binds), dormant→stale (time passes), stale→retired (decay complete or meta-orchestrator decision), active→retired (supernova/fission).",
        "Forbidden states: 'archived', 'revoked', 'inactive', 'deleted', 'suspended'. These are used in other domains (document lifecycle, business entity lifecycle) but never for context entities.",
      ],
      doctrine_ref: "chittycanon://doctrine/synthetic-continuity",
    },
  };

  const article = articles[id];
  if (!article) {
    return c.json(
      {
        error: "Article not found",
        available: Object.keys(articles),
        note: "More articles coming in Phase 2",
      },
      404,
    );
  }
  return c.json(article);
});

/**
 * Intelligence health check (no auth required)
 */
app.get("/intelligence/health", async (c) => {
  const consciousness = c.get("consciousness");
  const memory = c.get("memory");
  const coordinator = c.get("coordinator");
  const relationshipEngine = c.get("relationshipEngine");
  const learningEngine = c.get("learningEngine");
  const taskDecompositionEngine = c.get("taskDecompositionEngine");
  const intentPredictor = c.get("intentPredictor");

  // Get basic stats without requiring full execution
  let consciousnessHealth = { available: false };
  let memoryHealth = { available: false };
  let coordinatorHealth = { available: false };
  let relationshipHealth = { available: false };
  let learningHealth = { available: false };
  let decompositionHealth = { available: false };
  let intentHealth = { available: false };

  if (consciousness) {
    try {
      const awareness = await consciousness.getAwareness();
      consciousnessHealth = {
        available: true,
        services: consciousness.services.size,
        historySize: consciousness.healthHistory.length,
        anomalies: awareness?.anomalies?.count || 0,
        predictions: awareness?.predictions?.count || 0,
        healthyServices: awareness?.ecosystem?.healthy || 0,
        degradedServices: awareness?.ecosystem?.degraded || 0,
        downServices: awareness?.ecosystem?.down || 0,
      };
    } catch (error) {
      consciousnessHealth = { available: true, error: error.message };
    }
  }

  if (memory) {
    try {
      await memory.getStats("health-check");
      memoryHealth = {
        available: true,
        hasVectorize: memory.hasVectorize,
        retentionDays: memory.retention.conversations,
      };
    } catch (error) {
      memoryHealth = { available: true, error: error.message };
    }
  }

  if (coordinator) {
    try {
      coordinatorHealth = {
        available: true,
        maxConcurrency: coordinator.executionEngine?.maxConcurrency || 5,
      };
    } catch (error) {
      coordinatorHealth = { available: true, error: error.message };
    }
  }

  if (relationshipEngine) {
    try {
      relationshipHealth = await relationshipEngine.getHealth();
    } catch (error) {
      relationshipHealth = { available: true, error: error.message };
    }
  }

  if (learningEngine) {
    try {
      learningHealth = await learningEngine.getStats();
    } catch (error) {
      learningHealth = { available: true, error: error.message };
    }
  }

  if (taskDecompositionEngine) {
    try {
      decompositionHealth = await taskDecompositionEngine.getStats();
    } catch (error) {
      decompositionHealth = { available: true, error: error.message };
    }
  }

  if (intentPredictor) {
    try {
      intentHealth = await intentPredictor.getStats();
    } catch (error) {
      intentHealth = { available: true, error: error.message };
    }
  }

  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    modules: {
      contextConsciousness: consciousnessHealth,
      memoryCloude: memoryHealth,
      cognitiveCoordination: coordinatorHealth,
      relationshipEngine: relationshipHealth,
      learningEngine: learningHealth,
      taskDecompositionEngine: decompositionHealth,
      intentPredictor: intentHealth,
    },
  });
});

/**
 * Basic monitoring dashboard UI for intelligence modules
 */
app.get("/intelligence/dashboard", async (c) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ChittyConnect Intelligence Dashboard</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #111a33;
      --ok: #18c57a;
      --warn: #f0b429;
      --down: #ef5f5f;
      --text: #e8eefc;
      --muted: #9bb0df;
      --border: #24345f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: radial-gradient(1200px 600px at 0% 0%, #172752, var(--bg));
      color: var(--text);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1000px;
      margin: 0 auto;
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
    }
    .sub {
      color: var(--muted);
      margin-bottom: 20px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: linear-gradient(180deg, #131e3b, var(--panel));
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .value {
      font-size: 24px;
      font-weight: 700;
    }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .down { color: var(--down); }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .row:last-child { border-bottom: 0; }
    .badge {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>ChittyConnect Intelligence Dashboard</h1>
    <div class="sub">Live status for ContextConsciousness™, MemoryCloude™, and Cognitive-Coordination™</div>

    <div class="grid">
      <div class="card">
        <div class="label">Service</div>
        <div id="serviceStatus" class="value">...</div>
        <div id="version" class="meta"></div>
      </div>
      <div class="card">
        <div class="label">Tracked Services</div>
        <div id="trackedServices" class="value">...</div>
        <div class="meta">ContextConsciousness™ registry coverage</div>
      </div>
      <div class="card">
        <div class="label">Anomalies</div>
        <div id="anomalies" class="value">...</div>
        <div class="meta">Current detected anomaly count</div>
      </div>
      <div class="card">
        <div class="label">Predictions</div>
        <div id="predictions" class="value">...</div>
        <div class="meta">Potential upcoming failures</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 12px;">
      <div class="label">Module Health</div>
      <div class="row"><span>ContextConsciousness™</span><span id="moduleConsciousness" class="badge">...</span></div>
      <div class="row"><span>MemoryCloude™</span><span id="moduleMemory" class="badge">...</span></div>
      <div class="row"><span>Cognitive-Coordination™</span><span id="moduleCoordinator" class="badge">...</span></div>
      <div class="row"><span>RelationshipEngine</span><span id="moduleRelationship" class="badge">...</span></div>
      <div class="row"><span>LearningEngine</span><span id="moduleLearning" class="badge">...</span></div>
      <div class="row"><span>TaskDecomposition</span><span id="moduleDecomposition" class="badge">...</span></div>
      <div class="row"><span>IntentPredictor</span><span id="moduleIntent" class="badge">...</span></div>
      <div id="lastUpdated" class="meta" style="margin-top: 8px;"></div>
    </div>
  </div>

  <script>
    function badgeText(mod) {
      if (!mod || mod.available !== true) return "unavailable";
      return "available";
    }

    function badgeClass(mod) {
      if (!mod || mod.available !== true) return "down";
      if (mod.error) return "warn";
      return "ok";
    }

    function statusClass(status) {
      if (status === "healthy" || status === "available") return "ok";
      if (status === "degraded") return "warn";
      return "down";
    }

    async function refresh() {
      try {
        const [healthRes, intelligenceRes] = await Promise.all([
          fetch("/health"),
          fetch("/intelligence/health"),
        ]);

        const health = await healthRes.json();
        const intel = await intelligenceRes.json();

        const serviceStatus = document.getElementById("serviceStatus");
        serviceStatus.textContent = health.status || "unknown";
        serviceStatus.className = "value " + statusClass(health.status);
        document.getElementById("version").textContent = "v" + (health.version || "unknown");

        const ctx = intel.modules?.contextConsciousness || {};
        document.getElementById("trackedServices").textContent =
          String(ctx.services ?? 0);
        document.getElementById("anomalies").textContent =
          String(ctx.anomalies ?? 0);
        document.getElementById("predictions").textContent =
          String(ctx.predictions ?? 0);

        const m1 = intel.modules?.contextConsciousness;
        const m2 = intel.modules?.memoryCloude;
        const m3 = intel.modules?.cognitiveCoordination;
        const m4 = intel.modules?.relationshipEngine;
        const m5 = intel.modules?.learningEngine;
        const m6 = intel.modules?.taskDecompositionEngine;
        const m7 = intel.modules?.intentPredictor;

        const b1 = document.getElementById("moduleConsciousness");
        const b2 = document.getElementById("moduleMemory");
        const b3 = document.getElementById("moduleCoordinator");
        const b4 = document.getElementById("moduleRelationship");
        const b5 = document.getElementById("moduleLearning");
        const b6 = document.getElementById("moduleDecomposition");
        const b7 = document.getElementById("moduleIntent");

        b1.textContent = badgeText(m1);
        b1.className = "badge " + badgeClass(m1);
        b2.textContent = badgeText(m2);
        b2.className = "badge " + badgeClass(m2);
        b3.textContent = badgeText(m3);
        b3.className = "badge " + badgeClass(m3);
        b4.textContent = badgeText(m4);
        b4.className = "badge " + badgeClass(m4);
        b5.textContent = badgeText(m5);
        b5.className = "badge " + badgeClass(m5);
        b6.textContent = badgeText(m6);
        b6.className = "badge " + badgeClass(m6);
        b7.textContent = badgeText(m7);
        b7.className = "badge " + badgeClass(m7);

        document.getElementById("lastUpdated").textContent =
          "Last updated: " + new Date().toLocaleString();
      } catch (err) {
        document.getElementById("serviceStatus").textContent = "error";
        document.getElementById("serviceStatus").className = "value down";
        document.getElementById("lastUpdated").textContent =
          "Refresh failed: " + (err?.message || String(err));
      }
    }

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;

  return c.html(html);
});

/**
 * Discover relationship intelligence for a context entity
 */
app.get("/intelligence/relationships/:chittyId", async (c) => {
  const relationshipEngine = c.get("relationshipEngine");
  if (!relationshipEngine) {
    return c.json(
      {
        error: "relationship_engine_unavailable",
        message: "Relationship engine is not initialized",
      },
      503,
    );
  }

  const chittyId = c.req.param("chittyId");
  const limit = Number(c.req.query("limit") || 15);
  const includeSummary = c.req.query("summary") !== "false";

  try {
    const result = await relationshipEngine.discoverRelationships(chittyId, {
      limit,
      includeSummary,
    });
    return c.json({
      status: "ok",
      ...result,
    });
  } catch (error) {
    const status = String(error?.message || "").includes("Entity not found")
      ? 404
      : 500;

    return c.json(
      {
        error: "relationship_discovery_failed",
        message: error?.message || String(error),
      },
      status,
    );
  }
});

/**
 * Ingest one interaction for cross-session learning
 */
app.post("/intelligence/learning/ingest", async (c) => {
  const learningEngine = c.get("learningEngine");
  if (!learningEngine) {
    return c.json(
      {
        error: "learning_engine_unavailable",
        message: "Learning engine is not initialized",
      },
      503,
    );
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }

  const userId = body.user_id || body.userId;
  const interaction = body.interaction;
  if (!userId || !interaction) {
    return c.json(
      {
        error: "missing_fields",
        message: "Provide user_id and interaction",
      },
      400,
    );
  }

  try {
    const profile = await learningEngine.learnFromInteraction(
      userId,
      interaction,
      {
        source: "api_ingest",
      },
    );
    return c.json({ status: "ok", profile });
  } catch (error) {
    return c.json(
      {
        error: "learning_ingest_failed",
        message: error?.message || String(error),
      },
      500,
    );
  }
});

/**
 * Retrieve learned user profile
 */
app.get("/intelligence/learning/profile/:userId", async (c) => {
  const learningEngine = c.get("learningEngine");
  if (!learningEngine) {
    return c.json(
      {
        error: "learning_engine_unavailable",
        message: "Learning engine is not initialized",
      },
      503,
    );
  }

  const userId = c.req.param("userId");
  const profile = await learningEngine.getProfile(userId);
  if (!profile) {
    return c.json(
      {
        error: "profile_not_found",
        message: `No learning profile for ${userId}`,
      },
      404,
    );
  }

  return c.json({ status: "ok", profile });
});

/**
 * Get personalized defaults and suggestions for a user
 */
app.get("/intelligence/learning/personalize/:userId", async (c) => {
  const learningEngine = c.get("learningEngine");
  if (!learningEngine) {
    return c.json(
      {
        error: "learning_engine_unavailable",
        message: "Learning engine is not initialized",
      },
      503,
    );
  }

  const userId = c.req.param("userId");
  const personalization = await learningEngine.personalizeExperience(userId, {
    project_path: c.req.query("project_path") || null,
  });

  return c.json({ status: "ok", personalization });
});

/**
 * Decompose task into dependency-aware execution stages
 */
app.get("/intelligence/tasks/decompose", async (c) => {
  const taskDecompositionEngine = c.get("taskDecompositionEngine");
  if (!taskDecompositionEngine) {
    return c.json(
      {
        error: "task_decomposition_unavailable",
        message: "Task decomposition engine is not initialized",
      },
      503,
    );
  }

  const task = c.req.query("task");
  if (!task) {
    return c.json(
      {
        error: "missing_task",
        message: "Provide `task` query parameter",
      },
      400,
    );
  }

  try {
    const result = await taskDecompositionEngine.decompose(task, {
      requireDocumentation: c.req.query("require_docs") === "true",
      highRiskMode: c.req.query("high_risk_mode") === "true",
    });
    return c.json({ status: "ok", result });
  } catch (error) {
    return c.json(
      {
        error: "task_decomposition_failed",
        message: error?.message || String(error),
      },
      500,
    );
  }
});

/**
 * Decompose task from structured request body
 */
app.post("/intelligence/tasks/decompose", async (c) => {
  const taskDecompositionEngine = c.get("taskDecompositionEngine");
  if (!taskDecompositionEngine) {
    return c.json(
      {
        error: "task_decomposition_unavailable",
        message: "Task decomposition engine is not initialized",
      },
      503,
    );
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }

  const task = body.task || body.input || body.query;
  if (!task) {
    return c.json(
      {
        error: "missing_task",
        message: "Provide `task` in request body",
      },
      400,
    );
  }

  try {
    const result = await taskDecompositionEngine.decompose(task, {
      requireDocumentation: body.require_documentation === true,
      highRiskMode: body.high_risk_mode === true,
    });
    return c.json({ status: "ok", result });
  } catch (error) {
    return c.json(
      {
        error: "task_decomposition_failed",
        message: error?.message || String(error),
      },
      500,
    );
  }
});

/**
 * Predict user intent from input text (query interface)
 */
app.get("/intelligence/intent/predict", async (c) => {
  const intentPredictor = c.get("intentPredictor");
  if (!intentPredictor) {
    return c.json(
      {
        error: "intent_predictor_unavailable",
        message: "Intent predictor is not initialized",
      },
      503,
    );
  }

  const input = c.req.query("input");
  if (!input) {
    return c.json(
      { error: "missing_input", message: "Provide `input` query parameter" },
      400,
    );
  }

  try {
    const prediction = await intentPredictor.predictIntent(input, {
      userId: c.req.query("user_id") || c.req.query("userId") || null,
      sessionId: c.req.query("session_id") || c.req.query("sessionId") || null,
      context: {
        chitty_id: c.req.query("chitty_id") || null,
      },
      aiRefine: c.req.query("ai_refine") !== "false",
      useServiceAwareness: c.req.query("service_awareness") === "true",
    });

    const userId = c.req.query("user_id") || c.req.query("userId") || null;
    const learningEngine = c.get("learningEngine");
    if (learningEngine && userId) {
      await learningEngine
        .learnFromInteraction(userId, {
          sessionId:
            c.req.query("session_id") || c.req.query("sessionId") || null,
          input,
          actions: prediction.nextActions || [],
          entities: [],
          suggestedServices: prediction.suggestedServices || [],
          outcome: "success",
          timestamp: Date.now(),
        })
        .catch((err) =>
          console.warn(
            "[LearningEngine] auto-learn from GET predict failed:",
            err.message,
          ),
        );
    }

    return c.json({ status: "ok", prediction });
  } catch (error) {
    return c.json(
      {
        error: "intent_prediction_failed",
        message: error?.message || String(error),
      },
      500,
    );
  }
});

/**
 * Predict user intent from structured request body
 */
app.post("/intelligence/intent/predict", async (c) => {
  const intentPredictor = c.get("intentPredictor");
  if (!intentPredictor) {
    return c.json(
      {
        error: "intent_predictor_unavailable",
        message: "Intent predictor is not initialized",
      },
      503,
    );
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }

  const input = body.input || body.query || body.text;
  if (!input) {
    return c.json(
      { error: "missing_input", message: "Provide `input` in request body" },
      400,
    );
  }

  try {
    const prediction = await intentPredictor.predictIntent(input, {
      userId: body.user_id || body.userId || null,
      sessionId: body.session_id || body.sessionId || null,
      context: body.context || {},
      aiRefine: body.ai_refine !== false,
      useServiceAwareness: body.use_service_awareness === true,
      historyLimit: body.history_limit,
    });

    const learningEngine = c.get("learningEngine");
    const userId = body.user_id || body.userId || null;
    if (learningEngine && userId) {
      await learningEngine
        .learnFromInteraction(userId, {
          sessionId: body.session_id || body.sessionId || null,
          input,
          actions: prediction.nextActions || [],
          entities: body.context?.entities || [],
          suggestedServices: prediction.suggestedServices || [],
          outcome: "success",
          timestamp: Date.now(),
        })
        .catch((err) =>
          console.warn(
            "[LearningEngine] auto-learn from POST predict failed:",
            err.message,
          ),
        );
    }

    return c.json({ status: "ok", prediction });
  } catch (error) {
    const status = String(error?.message || "").includes("required")
      ? 400
      : 500;
    return c.json(
      {
        error: "intent_prediction_failed",
        message: error?.message || String(error),
      },
      status,
    );
  }
});

/**
 * Discover relationships via request body
 */
app.post("/intelligence/relationships/discover", async (c) => {
  const relationshipEngine = c.get("relationshipEngine");
  if (!relationshipEngine) {
    return c.json(
      {
        error: "relationship_engine_unavailable",
        message: "Relationship engine is not initialized",
      },
      503,
    );
  }

  let body = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
    );
  }

  const chittyId = body.chitty_id || body.chittyId;
  if (!chittyId) {
    return c.json(
      {
        error: "missing_chitty_id",
        message: "Provide chitty_id in request body",
      },
      400,
    );
  }

  try {
    const result = await relationshipEngine.discoverRelationships(chittyId, {
      limit: body.limit,
      includeSummary: body.include_summary !== false,
    });
    return c.json({ status: "ok", ...result });
  } catch (error) {
    const status = String(error?.message || "").includes("Entity not found")
      ? 404
      : 500;
    return c.json(
      {
        error: "relationship_discovery_failed",
        message: error?.message || String(error),
      },
      status,
    );
  }
});

/**
 * Discovery endpoint for automatic agent configuration
 */
import { discoveryRoutes } from "./api/routes/discovery.js";
import { githubActionsRoutes } from "./api/routes/github-actions.js";

app.route("/.well-known", discoveryRoutes);

/**
 * GitHub Actions OIDC credential endpoint
 * No API key required - uses GitHub OIDC tokens for authentication
 * Zero secrets stored in GitHub - just OIDC trust
 */
app.route("/api/github-actions", githubActionsRoutes);

/**
 * SSE Health check endpoint
 */
app.get("/sse/health", (c) => {
  const sm = c.get("streaming");
  return c.json({
    status: sm ? "available" : "unavailable",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Unified MCP SSE endpoint
 * GET /sse?sessionId=...
 * NOTE: Must be defined BEFORE api router mount to avoid route conflicts
 */
app.get("/sse", (c) => {
  const sessionId = c.req.query("sessionId") || "anonymous";
  const sm = c.get("streaming");

  if (!sm) {
    return c.json(
      {
        error: "streaming_unavailable",
        message: "SSE streaming is not configured",
      },
      503,
    );
  }

  try {
    return sm.createStream(sessionId, {});
  } catch (err) {
    console.error("[SSE] Error creating stream:", err?.message || err);
    return c.json(
      { error: "stream_failed", message: String(err?.message || err) },
      500,
    );
  }
});

/**
 * Root endpoint: content negotiation (JSON for agents, redirect for browsers)
 */
app.get("/", async (c) => {
  const accept = c.req.header("Accept") || "";
  if (accept.includes("application/json")) {
    return c.redirect("/.well-known/chitty.json");
  }
  return c.redirect("https://get.chitty.cc");
});

// --- Secret Rotation API ---

app.get("/api/v1/secrets/status", async (c) => {
  const rotation = new SecretRotationService(c.env);
  const status = await rotation.getStatus();
  return c.json(status);
});

app.post("/api/v1/secrets/rotate/:name", async (c) => {
  const { name } = c.req.param();
  const rotation = new SecretRotationService(c.env);
  const result = await rotation.forceRotate(name);
  return c.json(result, result.ok ? 200 : 400);
});

/**
 * Mount API router for custom GPT integration
 */
app.route("/", api);

// /mcp is already routed via api.router (api.route("/mcp", mcpRoutes))

/**
 * Service-specific MCP proxy
 * /:service/mcp/* -> https://{service}.chitty.cc/mcp/*
 */
app.all("/:service/mcp/*", async (c) => {
  const service = c.req.param("service");
  const base = `https://${service}.chitty.cc`;
  const path = c.req.path.replace(`/${service}`, "");
  const url = base + path;
  const init = {
    method: c.req.method,
    headers: c.req.header(),
    body: ["GET", "HEAD"].includes(c.req.method)
      ? undefined
      : await c.req.arrayBuffer(),
  };
  try {
    const resp = await fetch(url, init);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (err) {
    console.error(`[MCP proxy] ${service}:`, err?.message || err);
    return c.json(
      { error: "proxy_failed", message: String(err?.message || err) },
      502,
    );
  }
});

/**
 * Service-specific API proxy
 * /:service/api/* -> https://{service}.chitty.cc/api/*
 */
app.all("/:service/api/*", async (c) => {
  const service = c.req.param("service");
  const base = `https://${service}.chitty.cc`;
  const path = c.req.path.replace(`/${service}`, "");
  const url = base + path;
  const init = {
    method: c.req.method,
    headers: c.req.header(),
    body: ["GET", "HEAD"].includes(c.req.method)
      ? undefined
      : await c.req.arrayBuffer(),
  };
  try {
    const resp = await fetch(url, init);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (err) {
    console.error(`[API proxy] ${service}:`, err?.message || err);
    return c.json(
      { error: "proxy_failed", message: String(err?.message || err) },
      502,
    );
  }
});

/**
 * GitHub webhook endpoint
 * POST /integrations/github/webhook
 *
 * Fast-ack design:
 * 1. Verify HMAC signature (constant-time)
 * 2. Check idempotency (delivery ID)
 * 3. Queue event for async processing
 * 4. Return 200 OK immediately
 */
app.post("/integrations/github/webhook", async (c) => {
  const delivery = c.req.header("X-GitHub-Delivery");
  const event = c.req.header("X-GitHub-Event");
  const signature = c.req.header("X-Hub-Signature-256");

  if (!delivery || !event || !signature) {
    return c.text("missing required headers", 400);
  }

  // Check idempotency first (fastest path for duplicate deliveries)
  const existing = await c.env.IDEMP_KV.get(delivery);
  if (existing) {
    return c.text("ok", 200);
  }

  // Get raw body for signature verification
  const body = await c.req.arrayBuffer();

  // Verify webhook signature (constant-time comparison)
  const isValid = await verifyWebhookSignature(
    body,
    signature,
    c.env.GITHUB_WEBHOOK_SECRET,
  );

  if (!isValid) {
    return c.text("unauthorized", 401);
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch (err) {
    return c.text("invalid json payload", 400);
  }

  // Queue for async MCP dispatch
  await c.env.EVENT_Q.send({
    delivery,
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  // Mark as received (24h TTL)
  await c.env.IDEMP_KV.put(delivery, "processing", { expirationTtl: 86400 });

  return c.text("ok", 200);
});

/**
 * General Webhook Router
 * POST /webhooks/:source - Route webhooks to appropriate agents
 * All webhooks are logged to ChittyChronicle before forwarding
 */
app.post("/webhooks/:source", async (c) => {
  const { routeWebhook, validateWebhookSignature } =
    await import("./handlers/webhook-router.js");
  const source = c.req.param("source");

  try {
    // Validate signature if present
    const validation = await validateWebhookSignature(source, c.req.raw, c.env);
    if (!validation.valid) {
      return c.json({ error: "Invalid webhook signature" }, 401);
    }

    // Parse payload
    const payload = await c.req.json();

    // Route to appropriate agent
    const result = await routeWebhook(source, payload, c.env);

    return c.json({
      received: true,
      source,
      ...result,
    });
  } catch (error) {
    console.error(`[Webhook] Error processing ${source} webhook:`, error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * List configured webhook agents
 * GET /webhooks - Show available webhook routes
 */
app.get("/webhooks", async (c) => {
  const { getConfiguredAgents } = await import("./handlers/webhook-router.js");
  return c.json({
    endpoint: "/webhooks/:source",
    configured_agents: getConfiguredAgents(),
    usage: "POST /webhooks/{source} with JSON payload",
  });
});

/**
 * GitHub App installation callback
 * Handles OAuth flow after app installation
 */
app.get("/integrations/github/callback", async (c) => {
  try {
    const _code = c.req.query("code");
    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");

    if (!installationId) {
      return c.text("Missing installation_id", 400);
    }

    console.log(
      `[GitHub App] Installation callback: ${installationId}, action: ${setupAction}`,
    );

    // 1. Get GitHub App token to fetch installation details
    const { generateAppJWT, getInstallationToken } =
      await import("./auth/github.js");
    const appJwt = await generateAppJWT(
      c.env.GITHUB_APP_ID,
      c.env.GITHUB_APP_PK,
    );

    // 2. Fetch installation details
    const installResponse = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ChittyConnect/2.0.2",
        },
      },
    );

    if (!installResponse.ok) {
      const error = await installResponse.text();
      console.error(`[GitHub App] Installation fetch failed:`, error);
      return c.text(
        `Installation verification failed: ${installResponse.status}`,
        500,
      );
    }

    const installation = await installResponse.json();

    // 3. Mint ChittyID for the installation
    // @canon: chittycanon://gov/governance#core-types
    // GitHub installations are Things (T, Digital) — objects without agency
    const ecosystem = c.get("ecosystem");
    const installChittyID = await ecosystem.mintChittyID({
      entity: "T",
      characterization: "Digital",
      metadata: {
        type: "github_installation",
        installationId: installation.id,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      },
    });

    // 4. Initialize ChittyDNA record for installation
    await ecosystem.initializeChittyDNA(installChittyID, {
      type: "github_installation",
      installation_id: installation.id,
      account: installation.account.login,
      repository_selection: installation.repository_selection,
    });

    // 5. Store installation mapping in D1
    await c.env.DB.prepare(
      `
      INSERT OR REPLACE INTO installations
      (installation_id, chittyid, account_id, account_login, account_type, repository_selection, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `,
    )
      .bind(
        installation.id,
        installChittyID,
        installation.account.id,
        installation.account.login,
        installation.account.type,
        installation.repository_selection,
      )
      .run();

    // 6. Get and cache installation token
    const tokenData = await getInstallationToken(installationId, appJwt);
    await c.env.TOKEN_KV.put(
      `install:${installationId}`,
      JSON.stringify(tokenData),
      { expirationTtl: 3600 },
    );

    // 7. Log to ChittyChronicle
    await fetch("https://chronicle.chitty.cc/api/entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_CHRONICLE_TOKEN}`,
      },
      body: JSON.stringify({
        eventType: "github.app.installed",
        entityId: installChittyID,
        data: {
          installationId: installation.id,
          account: installation.account.login,
          repositorySelection: installation.repository_selection,
          permissions: tokenData.permissions,
        },
      }),
    });

    console.log(`[GitHub App] Installation complete: ${installChittyID}`);

    // Redirect to success page
    return c.redirect(
      `https://app.chitty.cc/integrations/github/success?installation_id=${installationId}&chittyid=${installChittyID}`,
    );
  } catch (error) {
    console.error("[GitHub App] Callback error:", error);
    return c.redirect(
      `https://app.chitty.cc/integrations/github/error?message=${encodeURIComponent(error.message)}`,
    );
  }
});

/**
 * Export worker
 *
 * OAuthProvider wraps the Hono app to add OAuth 2.1 + PKCE for MCP clients
 * (Claude Desktop Cowork). Only mcp.chitty.cc/mcp requires OAuth;
 * connect.chitty.cc/mcp/* continues using API key auth (backward compatible).
 *
 * OAuth endpoints served automatically:
 *   /.well-known/oauth-authorization-server — RFC 8414 discovery
 *   /authorize — Authorization endpoint (delegates to ChittyAuth)
 *   /token — Token exchange
 *   /register — Dynamic client registration
 */
const oauthProvider = createOAuthProvider(app);

/**
 * Strip query-string parameters from the redirect_uri OAuth param.
 *
 * Notion appends ?spaceId=…&userId=… to the redirect_uri it sends, which
 * causes an exact-match failure against the registered base URI inside
 * @cloudflare/workers-oauth-provider. We strip those extra params before
 * the OAuthProvider validates and re-append them to the final redirect
 * in handleAuthorize (oauth-provider.js).
 *
 * This must happen BEFORE oauthProvider.fetch() because the /token
 * endpoint is handled internally by OAuthProvider and never reaches
 * our defaultHandler.
 */
function stripRedirectUriQueryParams(request) {
  const url = new URL(request.url);
  const rawRedirect = url.searchParams.get("redirect_uri");
  if (!rawRedirect) return request;

  try {
    const redirectUrl = new URL(rawRedirect);
    if (!redirectUrl.search) return request;

    redirectUrl.search = "";
    url.searchParams.set("redirect_uri", redirectUrl.toString());
    return new Request(url.toString(), request);
  } catch {
    return request;
  }
}

/**
 * For POST /token, the redirect_uri is in the form body, not the URL.
 * We need to parse the body, strip redirect_uri query params, and
 * reconstruct the request.
 */
async function stripRedirectUriFromTokenBody(request) {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const rawRedirect = params.get("redirect_uri");
  if (!rawRedirect)
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });

  try {
    const redirectUrl = new URL(rawRedirect);
    if (!redirectUrl.search)
      return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });

    redirectUrl.search = "";
    params.set("redirect_uri", redirectUrl.toString());
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: params.toString(),
    });
  } catch {
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Debug: log all OAuth-related requests to diagnose Notion integration
    if (
      url.pathname === "/token" ||
      url.pathname === "/authorize" ||
      url.pathname === "/register" ||
      url.pathname.startsWith("/.well-known/")
    ) {
      console.log(
        `[OAuth-Debug] ${request.method} ${url.pathname} from ${request.headers.get("Origin") || "no-origin"} referer=${request.headers.get("Referer") || "none"}`,
      );
    }

    // MCP Server Metadata (draft spec): Notion requests this to discover the
    // MCP endpoint URL before starting OAuth. Return minimal server card.
    if (url.pathname === "/.well-known/mcp.json") {
      return new Response(
        JSON.stringify({
          mcpVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ChittyConnect", version: "2.2.0" },
          url: `${url.origin}/mcp`,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        },
      );
    }

    // OIDC Discovery: Notion requests /.well-known/openid-configuration which
    // OAuthProvider doesn't serve. Rewrite to /.well-known/oauth-authorization-server
    // (RFC 8414) which OAuthProvider handles natively — same metadata, different path.
    if (url.pathname === "/.well-known/openid-configuration") {
      console.log(
        "[OAuth-Debug] Rewriting openid-configuration → oauth-authorization-server",
      );
      const rewritten = new URL(request.url);
      rewritten.pathname = "/.well-known/oauth-authorization-server";
      request = new Request(rewritten.toString(), request);
    }

    // RFC 9728: Path-specific Protected Resource Metadata.
    // OAuthProvider handles /.well-known/oauth-protected-resource (base).
    // MCP clients request /.well-known/oauth-protected-resource/mcp
    // for the /mcp resource path. Serve the same PRM for all subpaths.
    if (
      url.pathname.startsWith("/.well-known/oauth-protected-resource/") &&
      url.pathname !== "/.well-known/oauth-protected-resource"
    ) {
      return new Response(
        JSON.stringify({
          resource: `${url.origin}`,
          authorization_servers: [`${url.origin}`],
          scopes_supported: ["mcp:read", "mcp:write", "mcp:admin"],
          bearer_methods_supported: ["header"],
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "Authorization, *",
          },
        },
      );
    }

    // Strip redirect_uri query params for the token exchange (POST /token).
    // The /authorize endpoint is handled by oauth-provider.js's handleAuthorize,
    // which strips, validates, AND re-appends the extra params to the final redirect.
    // We must NOT strip here for /authorize or the re-append logic loses the params.
    if (url.pathname === "/token" && request.method === "POST") {
      console.log(
        "[OAuth-Debug] Stripping redirect_uri query params from token body",
      );
      request = await stripRedirectUriFromTokenBody(request);
    }

    // Route Agents SDK WebSocket upgrades to McpConnectAgent DO
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    const response = await oauthProvider.fetch(request, env, ctx);

    // Debug: log response status for OAuth endpoints
    if (
      url.pathname === "/token" ||
      url.pathname === "/authorize" ||
      url.pathname === "/register"
    ) {
      console.log(
        `[OAuth-Debug] ${request.method} ${url.pathname} → ${response.status}`,
      );
    }

    return response;
  },

  /**
   * Queue consumer for async event processing
   */
  async queue(batch, env) {
    if (batch.queue === "documint-proofs") {
      const { proofQueueConsumer } = await import("./handlers/proof-queue.js");
      await proofQueueConsumer(batch, env);
    } else {
      await queueConsumer(batch, env);
    }
  },

  // Scheduled handler for cron triggers
  // - "0 * * * *"     (hourly)  → 1Password event sync to ChittyChronicle
  // - every 5 min     → Connection health checks
  async scheduled(event, env, ctx) {
    console.log(
      `[Scheduled] Cron trigger: ${event.cron} at ${new Date().toISOString()}`,
    );

    // OAuth token rotation (every 50 minutes)
    if (event.cron === "*/50 * * * *") {
      try {
        const rotation = new SecretRotationService(env);
        const result = await rotation.forceRotate('gdrive_access_token');
        console.log(`[Scheduled] OAuth rotation: ${result.ok ? 'success' : result.error}`);
      } catch (err) {
        console.error(`[Scheduled] OAuth rotation failed:`, err.message);
      }
      return;
    }

    // Connection health checks (every 5 minutes)
    if (event.cron === "*/5 * * * *") {
      try {
        const summary = await runAllHealthChecks(env);
        console.log(
          `[Scheduled] Health checks complete: ${summary.healthy}/${summary.total} healthy, ${summary.degraded} degraded, ${summary.down} down`,
        );
      } catch (err) {
        console.error(`[Scheduled] Health checks failed:`, err.message);
      }
      return;
    }

    // Secret rotation check (hourly — runs due rotations only)
    try {
      const rotation = new SecretRotationService(env);
      const report = await rotation.runDueRotations();
      console.log(
        `[Scheduled] Secret rotation: ${report.rotated.length} rotated, ${report.skipped.length} skipped, ${report.failed.length} failed`,
      );
    } catch (err) {
      console.error(`[Scheduled] Secret rotation failed:`, err.message);
    }

    // 1Password event sync (hourly)
    try {
      const response = await fetch(
        "https://chronicle.chitty.cc/api/sync/1password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.CHITTY_CHRONICLE_TOKEN
              ? { Authorization: `Bearer ${env.CHITTY_CHRONICLE_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({
            source: "chittyconnect-cron",
            timestamp: new Date().toISOString(),
          }),
        },
      );
      console.log(`[Scheduled] 1Password sync: ${response.status}`);
    } catch (err) {
      console.error(`[Scheduled] 1Password sync failed:`, err.message);
    }
  },
};

/**
 * Export Durable Object classes
 */
export { McpConnectAgent };
