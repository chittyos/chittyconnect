/**
 * Dynamic Execution Routes
 *
 * Universal backend execution layer for ChittyConnect.
 * Runs SQL queries, API calls, and code fragments against connected backends
 * on behalf of other Workers (via service binding) or authenticated callers.
 *
 * Backends available:
 *   - Neon PostgreSQL (any project/database via credential broker)
 *   - Google APIs (Drive, Gmail, Calendar — via rotated OAuth tokens)
 *   - Notion API (via integration token)
 *   - Generic HTTP (fetch with credential injection)
 *
 * This replaces the need for every Worker to independently manage credentials
 * and outbound connections. Workers call ChittyConnect via service binding,
 * ChittyConnect handles auth + execution + credential rotation.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#execute
 */

import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { getCredential } from "../../lib/credential-helper.js";

const executeRoutes = new Hono();

// ============================================
// SQL EXECUTION (Neon PostgreSQL)
// ============================================

/**
 * POST /sql
 * Execute a SQL query against a Neon database.
 *
 * Body: { database: string, query: string, params?: any[] }
 *   database: "chittyos-core" | "chittycommand" | "chittycounsel" | connection-string
 *
 * The database name maps to a known Neon connection string via the credential
 * broker. Raw connection strings are also accepted for flexibility.
 */
executeRoutes.post("/sql", async (c) => {
  try {
    const { database, query, params = [] } = await c.req.json();

    if (!database || !query) {
      return c.json({ error: "database and query required" }, 400);
    }

    const connectionString = await resolveNeonConnection(c.env, database);
    if (!connectionString) {
      return c.json({ error: `Unknown database: ${database}` }, 400);
    }

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
    console.error("[Execute/SQL]", error);
    return c.json(
      { error: error.message, type: "sql_execution_error" },
      500,
    );
  }
});

/**
 * POST /sql/batch
 * Execute multiple SQL statements in sequence (not a transaction).
 *
 * Body: { database: string, statements: Array<{ query: string, params?: any[] }> }
 */
executeRoutes.post("/sql/batch", async (c) => {
  try {
    const { database, statements } = await c.req.json();

    if (!database || !statements?.length) {
      return c.json({ error: "database and statements[] required" }, 400);
    }

    const connectionString = await resolveNeonConnection(c.env, database);
    if (!connectionString) {
      return c.json({ error: `Unknown database: ${database}` }, 400);
    }

    const client = new Client(connectionString);
    await client.connect();
    try {
      const results = [];
      for (const stmt of statements) {
        const result = await client.query(stmt.query, stmt.params || []);
        results.push({
          rows: result.rows,
          rowCount: result.rowCount,
        });
      }
      return c.json({ results, count: results.length });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("[Execute/SQL/Batch]", error);
    return c.json(
      { error: error.message, type: "sql_batch_error" },
      500,
    );
  }
});

// ============================================
// HTTP EXECUTION (Generic fetch with credentials)
// ============================================

/**
 * POST /fetch
 * Execute an HTTP request with credential injection.
 *
 * Body: { url: string, method?: string, headers?: object, body?: string,
 *         credential?: string }
 *   credential: 1Password path (e.g. "integrations/notion/api_key") — injected as Bearer token
 */
executeRoutes.post("/fetch", async (c) => {
  try {
    const { url, method = "GET", headers = {}, body, credential } = await c.req.json();

    if (!url) {
      return c.json({ error: "url required" }, 400);
    }

    const fetchHeaders = { ...headers };
    if (credential) {
      const token = await getCredential(c.env, credential, null);
      if (token) {
        fetchHeaders["Authorization"] = `Bearer ${token}`;
      }
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });

    const contentType = response.headers.get("content-type") || "";
    const responseBody = contentType.includes("json")
      ? await response.json()
      : await response.text();

    return c.json({
      status: response.status,
      ok: response.ok,
      body: responseBody,
    });
  } catch (error) {
    console.error("[Execute/Fetch]", error);
    return c.json({ error: error.message, type: "fetch_error" }, 500);
  }
});

// ============================================
// DATABASE RESOLUTION
// ============================================

const KNOWN_DATABASES = {
  "chittyos-core": {
    credentialPath: "integrations/neon/chittyos-core",
    envFallback: "NEON_CHITTYOS_CORE_URL",
    kvKey: "secret:neon:chittyos-core:connection_uri",
  },
  "chittycommand": {
    credentialPath: "integrations/neon/chittycommand",
    envFallback: "NEON_CHITTYCOMMAND_URL",
    kvKey: "secret:neon:chittycommand:connection_uri",
  },
  "chittycounsel": {
    credentialPath: "integrations/neon/chittycounsel",
    envFallback: "NEON_CHITTYCOUNSEL_URL",
    kvKey: "secret:neon:chittycounsel:connection_uri",
  },
};

async function resolveNeonConnection(env, database) {
  // Direct connection string
  if (database.startsWith("postgresql://") || database.startsWith("postgres://")) {
    return database;
  }

  const known = KNOWN_DATABASES[database];
  if (!known) return null;

  // Try KV cache first (rotated connection strings)
  if (env.CREDENTIAL_CACHE) {
    const cached = await env.CREDENTIAL_CACHE.get(known.kvKey);
    if (cached) return cached;
  }

  // Try credential broker (1Password)
  const cred = await getCredential(env, known.credentialPath, known.envFallback);
  return cred || null;
}

export { executeRoutes };
