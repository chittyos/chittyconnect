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
import { verifyWebhookSignature } from "./auth/webhook.js";
import { handleWebhookEvent } from "./handlers/webhook.js";
import { queueConsumer } from "./handlers/queue.js";
import { api } from "./api/router.js";
import { mcp } from "./mcp/server.js";
import {
  ChittyOSEcosystem,
  initializeDatabase,
} from "./integrations/chittyos-ecosystem.js";
import { ContextConsciousness } from "./intelligence/context-consciousness.js";
import { MemoryCloude } from "./intelligence/memory-cloude.js";
import { CognitiveCoordinator } from "./intelligence/cognitive-coordination.js";

const app = new Hono();

// Initialize ChittyOS ecosystem on first request (lazy + graceful)
let ecosystemInitialized = false;
let intelligenceModules = null;

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
    ]);

    intelligenceModules = { consciousness, memory, coordinator };

    // Initialize ChittyConnect context (non-blocking, best-effort)
    // Don't await - let it run in background
    const ecosystem = new ChittyOSEcosystem(env);
    ecosystem
      .initializeContext("chittyconnect", {
        version: "1.0.0",
        type: "ai-integration-hub",
        capabilities: [
          "mcp",
          "rest-api",
          "github-app",
          "context-consciousness",
          "memory-cloude",
          "cognitive-coordination",
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

  if (modules) {
    c.set("consciousness", modules.consciousness);
    c.set("memory", modules.memory);
    c.set("coordinator", modules.coordinator);
  }

  await next();
});

/**
 * Root health check endpoint
 */
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "chittyconnect",
    brand: "itsChitty™",
    tagline:
      "The AI-intelligent spine with ContextConsciousness™, MemoryCloude™, and Cognitive-Coordination™",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    intelligence: {
      contextConsciousness: !!c.get("consciousness"),
      memoryCloude: !!c.get("memory"),
      cognitiveCoordination: !!c.get("coordinator"),
    },
    endpoints: {
      api: "/api/*",
      mcp: "/mcp/*",
      github: "/integrations/github/*",
      intelligence: "/intelligence/*",
      openapi: "/openapi.json",
    },
  });
});

/**
 * Intelligence health check (no auth required)
 */
app.get("/intelligence/health", async (c) => {
  const consciousness = c.get("consciousness");
  const memory = c.get("memory");
  const coordinator = c.get("coordinator");

  // Get basic stats without requiring full execution
  let consciousnessHealth = { available: false };
  let memoryHealth = { available: false };
  let coordinatorHealth = { available: false };

  if (consciousness) {
    try {
      consciousnessHealth = {
        available: true,
        services: consciousness.services.size,
        historySize: consciousness.healthHistory.length,
      };
    } catch (error) {
      consciousnessHealth = { available: true, error: error.message };
    }
  }

  if (memory) {
    try {
      const stats = await memory.getStats("health-check");
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

  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    modules: {
      contextConsciousness: consciousnessHealth,
      memoryCloude: memoryHealth,
      cognitiveCoordination: coordinatorHealth,
    },
  });
});

/**
 * Mount API router for custom GPT integration
 */
app.route("/", api);

/**
 * Mount MCP server for Claude integration
 */
app.route("/mcp", mcp);

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
 * GitHub App installation callback
 * Handles OAuth flow after app installation
 */
app.get("/integrations/github/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");

    if (!installationId) {
      return c.text("Missing installation_id", 400);
    }

    console.log(
      `[GitHub App] Installation callback: ${installationId}, action: ${setupAction}`,
    );

    // 1. Get GitHub App token to fetch installation details
    const { generateAppJWT, getInstallationToken } = await import(
      "./auth/github.js"
    );
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
          "User-Agent": "ChittyConnect/1.0",
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
    const ecosystem = c.get("ecosystem");
    const installChittyID = await ecosystem.mintChittyID({
      entity: "CONTEXT",
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
 */
export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  /**
   * Queue consumer for async event processing
   */
  async queue(batch, env) {
    await queueConsumer(batch, env);
  },
};
