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
 *   credential: chittysecrets path (e.g. "integrations/notion/api_key") — injected as Bearer token
 */
// Allowlist of (alias → chittysecrets path) pairs for /fetch credential injection.
// Callers reference an alias; the server maps to a path. This prevents callers
// from naming arbitrary credential paths and exfiltrating tokens.
const FETCH_CREDENTIAL_ALIASES = {
  notion: "integrations/notion/api_key",
  google: "integrations/google/access_token",
  github: "integrations/github/token",
};

// This is the provider-ownership boundary, NOT an operator-selected list of
// arbitrary egress targets. Do not allow FETCH_ALLOWED_HOSTS to override it.
// The values are exact hosts (no suffix match, wildcards or userinfo).
const FETCH_CREDENTIAL_PROVIDER_HOSTS = {
  notion: new Set(["api.notion.com"]),
  google: new Set([
    "www.googleapis.com",
    "gmail.googleapis.com",
    "drive.googleapis.com",
    "sheets.googleapis.com",
    "calendar.googleapis.com",
    "people.googleapis.com",
  ]),
  github: new Set(["api.github.com"]),
};

/**
 * Determine whether a credentialed request stays with its issuing provider.
 * A missing FETCH_ALLOWED_HOSTS means the owner-host set remains enforced,
 * not that any Internet destination becomes eligible.
 *
 * @returns {boolean} true only if alias, HTTPS origin and both gates pass.
 */
export function credentialDestinationAllowed(alias, url, operatorAllowlist = "") {
  if (typeof alias !== "string" ||
      !Object.hasOwn(FETCH_CREDENTIAL_ALIASES, alias) ||
      typeof url !== "string") return false;
  let destination;
  try {
    destination = new URL(url);
  } catch {
    return false;
  }
  if (destination.protocol !== "https:" ||
      destination.username || destination.password || destination.port) {
    return false;
  }
  const ownerHosts = FETCH_CREDENTIAL_PROVIDER_HOSTS[alias];
  if (!ownerHosts?.has(destination.hostname)) return false;

  const operatorHosts = new Set(
    String(operatorAllowlist || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  );
  // Optional operator allowlist can only NARROW the canonical provider scope.
  return operatorHosts.size === 0 || operatorHosts.has(destination.hostname);
}

executeRoutes.post("/fetch", async (c) => {
  try {
    const { url, method = "GET", headers = {}, body, credential } = await c.req.json();

    if (!url) {
      return c.json({ error: "url required" }, 400);
    }

    // Parse the destination for every request. Credentialed requests receive
    // the stricter provider-ownership/HTTPS gate below.
    try {
      new URL(url);
    } catch {
      return c.json({ error: "url must be a valid absolute URL" }, 400);
    }
    const allowlistRaw = c.env.FETCH_ALLOWED_HOSTS || "";

    // Headers() canonicalizes casing, avoiding duplicate lower/upper-case
    // Authorization fields when an untrusted caller supplied one.
    const fetchHeaders = new Headers(headers);
    if (credential) {
      if (typeof credential !== "string" ||
          !Object.hasOwn(FETCH_CREDENTIAL_ALIASES, credential)) {
        return c.json(
          { error: "unknown credential alias", allowed: Object.keys(FETCH_CREDENTIAL_ALIASES) },
          400,
        );
      }

      // Validate the target BEFORE resolving or injecting any credential.
      if (!credentialDestinationAllowed(credential, url, allowlistRaw)) {
        return c.json({ error: "credential destination is not authorized for this provider" }, 403);
      }
      const token = await getCredential(c.env, FETCH_CREDENTIAL_ALIASES[credential], null);
      if (typeof token !== "string" || token.length === 0) {
        return c.json({ error: "credential unavailable" }, 503);
      }

      fetchHeaders.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      // Workers forward Authorization across redirects by default. Never
      // auto-follow redirects when a broker-managed credential is present.
      redirect: credential ? "manual" : "follow",
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

  // Try credential broker (chittysecrets)
  const cred = await getCredential(env, known.credentialPath, known.envFallback);
  return cred || null;
}

export { executeRoutes };
