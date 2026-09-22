/**
 * ChittyRegistry API Routes
 */

import { Hono } from "hono";
import { getCredential } from "../../lib/credential-helper.js";
import { ChronicleEngine } from "../../services/chronicle-engine.js";
import { validateRegistrationEnvelope } from "../../lib/registry-entity-envelope.js";

const registryRoutes = new Hono();

// registry.chitty.cc's real KV-backed catalog. `/api/services`,
// `/api/v1/search`, `/api/v1/categories` and `/api/v1/stats` either 404 or
// (per operator findings) return hardcoded mock data — only `/api/v1/tools`
// is backed by the live registry KV. See ~/.claude/CLAUDE.md "Ecosystem
// Discovery (MANDATORY)".
const CHITTY_REGISTRY_TOOLS_URL = "https://registry.chitty.cc/api/v1/tools";

// register.chitty.cc is the compliance gateway that actually mints ChittyIDs
// and writes the registry. `/api/v1/register` is intentionally an OPEN public
// endpoint (chittyregister-worker.js:52-53) — proof-of-control + validation
// gate issuance, not a pre-issued token — so no service token is attached
// here. This broker's value is policy enforcement (fail fast on a malformed
// envelope) and audit (Chronicle record of the attempt), per the
// sensitive-intent contract's mandate that registry writes route through
// ChittyConnect.
const CHITTY_REGISTER_URL = "https://register.chitty.cc/api/v1/register";

function registryAuthHeaders(c) {
  // Public endpoint — only attach a bearer token if one is actually
  // configured. Sending "Bearer undefined" is worse than sending nothing.
  return c.env.CHITTY_REGISTRY_TOKEN
    ? { Authorization: `Bearer ${c.env.CHITTY_REGISTRY_TOKEN}` }
    : {};
}

/**
 * Best-effort audit record via ChittyChronicle. Never throws — a broker that
 * fails a registration attempt because its own audit sink is down would be
 * worse than one that registers the attempt as "audit: recorded=false".
 */
async function auditRegistrationAttempt(c, { actor, entityType, subtype, name, status, downstreamStatus, error }) {
  try {
    const databaseUrl = await getCredential(
      c.env,
      "database/neon/chittyos_core",
      "NEON_DATABASE_URL",
      "ChittyConnect-RegistryBroker",
    );
    if (!databaseUrl) {
      return { recorded: false, error: "audit database not configured" };
    }
    const chronicle = new ChronicleEngine(databaseUrl);
    await chronicle.connect();
    const result = await chronicle.logEvent({
      service: "chittyconnect-registry-broker",
      action: "registry.register",
      userId: actor || "unknown",
      metadata: { entityType, subtype, name, downstreamStatus },
      triggeredBy: "chittyconnect",
      status,
      errorMessage: error,
    });
    return { recorded: true, id: result.id, timestamp: result.timestamp };
  } catch (auditError) {
    console.error("[Registry/Register] audit failed:", auditError.message);
    return { recorded: false, error: auditError.message };
  }
}

/**
 * GET /api/registry/services
 * List all registered services (proxies to ChittyRegistry's live KV-backed
 * catalog at /api/v1/tools — NOT /api/services, which 404s on the deployed
 * worker).
 */
registryRoutes.get("/services", async (c) => {
  try {
    const response = await fetch(CHITTY_REGISTRY_TOOLS_URL, {
      headers: registryAuthHeaders(c),
    });

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/registry/services/:serviceId
 * Get service details (proxies to /api/v1/tools/:chitty_id).
 */
registryRoutes.get("/services/:serviceId", async (c) => {
  try {
    const serviceId = c.req.param("serviceId");

    const response = await fetch(
      `${CHITTY_REGISTRY_TOOLS_URL}/${encodeURIComponent(serviceId)}`,
      { headers: registryAuthHeaders(c) },
    );

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/registry/register
 *
 * The mandated registry-write broker route. Per the system-wide
 * sensitive-intent contract, registry writes / service registration MUST
 * route through ChittyConnect. Previously ChittyConnect's live surface only
 * exposed a read-only GET /api/registry/services — there was no write path,
 * so every registration attempt was policy-blocked with no route to
 * complete. This closes that deadlock.
 *
 * ChittyConnect does NOT become the registrar here (that responsibility
 * stays with chittyregister — ChittyID mint, cert, chronicle, registry
 * write). This route is a policy+audit broker: it validates the entity
 * envelope against the real P/L/T/E/A contract BEFORE forwarding (so
 * garbage fails fast, at the broker, without spending chittyregister's
 * 10/hour/IP submission budget), forwards to register.chitty.cc verbatim,
 * records an audit attempt via ChittyChronicle, and returns the downstream
 * result — including any minted ChittyID — faithfully. A downstream 4xx
 * (e.g. failed proof-of-control) is surfaced as-is, not collapsed into a
 * generic error.
 *
 * Body: the same registration envelope chittyregister's
 * POST /api/v1/register accepts — { entity_type, subtype, name,
 * description, ...subtype-specific fields }.
 */
registryRoutes.post("/register", async (c) => {
  const apiKey = c.get("apiKey"); // set by the global authenticate middleware
  let submission;
  try {
    submission = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Request body must be valid JSON" }, 400);
  }

  const validation = validateRegistrationEnvelope(submission);
  if (!validation.valid) {
    const audit = await auditRegistrationAttempt(c, {
      actor: apiKey?.name || apiKey?.userId || apiKey?.service,
      entityType: validation.entityType,
      subtype: validation.subtype,
      name: submission?.name,
      status: "rejected",
      error: validation.errors.join("; "),
    });
    return c.json(
      {
        success: false,
        stage: "broker_validation",
        errors: validation.errors,
        hint: "Validated against the canonical P/L/T/E/A contract (chittycanon://gov/governance#core-types) before forwarding to register.chitty.cc.",
        audit,
      },
      400,
    );
  }

  let downstreamResponse;
  let downstreamBody;
  try {
    downstreamResponse = await fetch(CHITTY_REGISTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Source-Service": "chittyconnect",
        "X-Canonical-URI": "chittycanon://core/services/connect",
      },
      body: JSON.stringify(submission),
    });
    const rawBody = await downstreamResponse.text();
    try {
      downstreamBody = JSON.parse(rawBody);
    } catch {
      downstreamBody = { raw: rawBody };
    }
  } catch (error) {
    const audit = await auditRegistrationAttempt(c, {
      actor: apiKey?.name || apiKey?.userId || apiKey?.service,
      entityType: validation.entityType,
      subtype: validation.subtype,
      name: submission?.name,
      status: "error",
      error: error.message,
    });
    return c.json(
      {
        success: false,
        stage: "downstream_unreachable",
        error: `register.chitty.cc unreachable: ${error.message}`,
        audit,
      },
      502,
    );
  }

  const audit = await auditRegistrationAttempt(c, {
    actor: apiKey?.name || apiKey?.userId || apiKey?.service,
    entityType: validation.entityType,
    subtype: validation.subtype,
    name: submission?.name,
    status: downstreamResponse.ok ? "success" : "rejected",
    downstreamStatus: downstreamResponse.status,
    error: downstreamResponse.ok ? undefined : JSON.stringify(downstreamBody).slice(0, 2000),
  });

  // Surface the downstream status and body faithfully — a 412 (failed
  // proof-of-control) or 400 (validation) from chittyregister is not
  // collapsed into a generic broker error.
  return c.json({ ...downstreamBody, broker: { audit } }, downstreamResponse.status);
});

/**
 * GET /api/registry/whoami
 * Get current tenant and session information
 * Requires authentication via API key
 */
registryRoutes.get("/whoami", async (c) => {
  try {
    const apiKey = c.get("apiKey"); // Set by authenticate middleware

    if (!apiKey) {
      return c.json(
        {
          error: "unauthorized",
          message: "API key required",
        },
        401,
      );
    }

    // Query context_files for active files
    let activeFiles = [];
    try {
      const filesResult = await c.env.DB.prepare(
        `
        SELECT file_uri, file_name, file_size, sha256, mime_type, last_accessed
        FROM context_files
        WHERE session_id = ? AND is_active = 1
        ORDER BY last_accessed DESC
        LIMIT 10
      `,
      )
        .bind(apiKey.sessionId)
        .all();
      activeFiles = filesResult.results || [];
    } catch (error) {
      console.warn("[whoami] Failed to query active files:", error.message);
    }

    // Query context_tasks for active tasks
    let activeTasks = [];
    try {
      const tasksResult = await c.env.DB.prepare(
        `
        SELECT task_id, title, status, priority, created_at, updated_at
        FROM context_tasks
        WHERE session_id = ? AND status IN ('pending', 'in_progress')
        ORDER BY priority DESC, created_at DESC
        LIMIT 10
      `,
      )
        .bind(apiKey.sessionId)
        .all();
      activeTasks = tasksResult.results || [];
    } catch (error) {
      console.warn("[whoami] Failed to query active tasks:", error.message);
    }

    // Build response
    const response = {
      success: true,
      data: {
        tenant: {
          chitty_id: apiKey.chittyId || apiKey.userId,
          name: apiKey.name || apiKey.userId || "Unknown User",
          account_type: apiKey.accountType || "standard",
        },
        session: {
          session_id: apiKey.sessionId,
          created_at: apiKey.createdAt || new Date().toISOString(),
          last_activity: new Date().toISOString(),
          active_files: activeFiles.map((f) => ({
            uri: f.file_uri,
            name: f.file_name,
            size: f.file_size,
            sha256: f.sha256,
            mime: f.mime_type,
            last_accessed: new Date(f.last_accessed * 1000).toISOString(),
          })),
          active_tasks: activeTasks.map((t) => ({
            task_id: t.task_id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            created_at: new Date(t.created_at * 1000).toISOString(),
            updated_at: new Date(t.updated_at * 1000).toISOString(),
          })),
        },
        scopes: apiKey.scopes || ["read", "write"],
        flags: {
          mcp_enabled: true,
          context_consciousness_enabled: true,
          memory_cloude_enabled: true,
          beta_features: ["presigned_uploads", "task_tracking", "context_sync"],
        },
        quota: {
          storage_bytes: apiKey.storageQuota || 1073741824, // 1GB default
          api_calls_remaining: apiKey.rateLimit || 1000,
        },
      },
    };

    return c.json(response);
  } catch (error) {
    console.error("[whoami] Error:", error);
    return c.json(
      {
        error: "internal_error",
        message: "Failed to retrieve user information",
      },
      500,
    );
  }
});

export { registryRoutes };
