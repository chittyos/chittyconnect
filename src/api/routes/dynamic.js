/**
 * Dynamic Worker Execution Routes
 *
 * Uses Cloudflare Dynamic Workers (worker_loaders) to execute arbitrary code
 * at runtime in isolated sandboxes. Callers provide code + specify which
 * bindings to pass through. ChittyConnect acts as the supervisor.
 *
 * This enables:
 * - Other Workers to run code that needs ChittyConnect's credentials/bindings
 * - AI agents to execute generated code safely
 * - Ad-hoc integrations without deploying new Workers
 * - Neon queries from contexts that can't reach external hosts (Workflows)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#dynamic-worker
 */

import { Hono } from "hono";

const dynamicRoutes = new Hono();

/**
 * POST /run
 * Execute arbitrary code in a Dynamic Worker sandbox.
 *
 * Body: {
 *   code: string,           // JavaScript/TypeScript module code
 *   entrypoint?: string,    // Export name to call (default: "default")
 *   method?: string,        // Method to call on entrypoint (default: "run")
 *   args?: any[],           // Arguments to pass
 *   bindings?: string[],    // Which env bindings to pass through (default: none)
 *   timeout?: number,       // Max execution time in ms (default: 30000)
 *   network?: boolean,      // Allow outbound fetch (default: true)
 * }
 *
 * The code receives an `env` object with only the requested bindings.
 */
dynamicRoutes.post("/run", async (c) => {
  const loader = c.env.LOADER;
  if (!loader) {
    return c.json({ error: "LOADER binding not configured — enable worker_loaders in wrangler.jsonc" }, 503);
  }

  try {
    const body = await c.req.json();
    const {
      code,
      entrypoint = "default",
      method = "run",
      args = [],
      bindings = [],
      network = true,
    } = body;

    if (!code) {
      return c.json({ error: "code required" }, 400);
    }

    // Build the env to pass to the dynamic worker — only requested bindings
    const dynamicEnv = {};
    for (const name of bindings) {
      if (c.env[name] !== undefined) {
        dynamicEnv[name] = c.env[name];
      }
    }

    // Generate a unique ID for this execution
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Load the dynamic worker
    const worker = loader.load({
      compatibilityDate: "2026-04-24",
      mainModule: "index.js",
      modules: { "index.js": code },
      env: dynamicEnv,
      globalOutbound: network ? undefined : null, // null = block network
    });

    // Call the entrypoint
    const ep = worker.getEntrypoint(entrypoint);
    if (typeof ep[method] !== "function") {
      return c.json({ error: `No method '${method}' on entrypoint '${entrypoint}'` }, 400);
    }

    const result = await ep[method](...args);

    return c.json({
      success: true,
      execId,
      result: typeof result === "object" ? result : { value: result },
    });
  } catch (error) {
    console.error("[Dynamic/Run]", error);
    return c.json({
      success: false,
      error: error.message,
      type: "execution_error",
    }, 500);
  }
});

/**
 * POST /sql
 * Convenience: execute SQL against Neon via a dynamic worker that has
 * access to the @neondatabase/serverless driver + ChittyConnect's
 * credential resolution. No bindings management needed by the caller.
 *
 * Body: { database: string, query: string, params?: any[] }
 */
dynamicRoutes.post("/sql", async (c) => {
  try {
    const { database, query, params = [] } = await c.req.json();

    if (!database || !query) {
      return c.json({ error: "database and query required" }, 400);
    }

    // Resolve connection string
    const connectionString = await resolveDatabase(c.env, database);
    if (!connectionString) {
      return c.json({ error: `Unknown database: ${database}` }, 400);
    }

    // Execute directly — ChittyConnect CAN reach Neon (not in a Workflow sandbox)
    const { Client } = await import("@neondatabase/serverless");
    const client = new Client(connectionString);
    await client.connect();
    try {
      const result = await client.query(query, params);
      return c.json({
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("[Dynamic/SQL]", error);
    return c.json({ error: error.message, type: "sql_error" }, 500);
  }
});

// Database resolution — shared with execute.js
async function resolveDatabase(env, database) {
  if (database.startsWith("postgresql://") || database.startsWith("postgres://")) {
    return database;
  }

  const { getCredential } = await import("../../lib/credential-helper.js");

  const KNOWN = {
    "chittyos-core": { path: "integrations/neon/chittyos-core", env: "NEON_DATABASE_URL", kv: "secret:neon:chittyos-core:connection_uri" },
    "chittycommand": { path: "integrations/neon/chittycommand", env: "NEON_CHITTYCOMMAND_URL", kv: "secret:neon:chittycommand:connection_uri" },
    "chittycounsel": { path: "integrations/neon/chittycounsel", env: "NEON_CHITTYCOUNSEL_URL", kv: "secret:neon:chittycounsel:connection_uri" },
  };

  const known = KNOWN[database];
  if (!known) return null;

  // KV cache first
  if (env.CREDENTIAL_CACHE) {
    const cached = await env.CREDENTIAL_CACHE.get(known.kv);
    if (cached) return cached;
  }

  return getCredential(env, known.path, known.env);
}

export { dynamicRoutes };
