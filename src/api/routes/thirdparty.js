/**
 * Third-Party Integration Routes
 * Proxy for Notion, Neon, Google, OpenAI with chittysecrets Connect integration
 *
 * All credentials are retrieved dynamically from chittysecrets with automatic
 * failover to environment variables if chittysecrets Connect is unavailable.
 */

import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { getCredential } from "../../lib/credential-helper.js";

const thirdpartyRoutes = new Hono();

/** @visibleForTesting */
export async function executeNeonQuery(neonDbUrl, query, params = []) {
  if (neonDbUrl.startsWith("http://") || neonDbUrl.startsWith("https://")) {
    const response = await fetch(neonDbUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, params }),
    });

    if (!response.ok) {
      throw new Error(`Neon query error: ${response.status}`);
    }

    return response.json();
  }

  const client = new Client({ connectionString: neonDbUrl });
  try {
    await client.connect();
    return await client.query(query, params);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * POST /api/thirdparty/notion/query
 * Query Notion database
 */
thirdpartyRoutes.post("/notion/query", async (c) => {
  try {
    const { databaseId, filter, sorts } = await c.req.json();

    if (!databaseId) {
      return c.json({ error: "databaseId is required" }, 400);
    }

    // Get Notion token from chittysecrets with fallback
    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
          details:
            "Neither chittysecrets Connect nor environment variable available",
        },
        503,
      );
    }

    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filter, sorts }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Notion API error: ${response.status} ${body}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/notion/page/create
 * Create Notion page
 */
thirdpartyRoutes.post("/notion/page/create", async (c) => {
  try {
    const body = await c.req.json();

    // Get Notion token from chittysecrets with fallback
    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
        },
        503,
      );
    }

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Notion API error: ${response.status} ${body}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/notion/pages
 * Legacy alias for Notion page creation.
 */
thirdpartyRoutes.post("/notion/pages", async (c) => {
  try {
    const body = await c.req.json();

    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
        },
        503,
      );
    }

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/notion/comments
 * Create Notion comment.
 */
thirdpartyRoutes.post("/notion/comments", async (c) => {
  try {
    const body = await c.req.json();

    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
        },
        503,
      );
    }

    const response = await fetch("https://api.notion.com/v1/comments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/neon/query
 * Execute Neon SQL query
 */
thirdpartyRoutes.post("/neon/query", async (c) => {
  try {
    const { query, params } = await c.req.json();

    if (!query) {
      return c.json({ error: "query is required" }, 400);
    }

    // Get Neon database URL from chittysecrets with fallback
    const neonDbUrl =
      c.env.NEON_DATABASE_URL ||
      (await getCredential(
        c.env,
        "database/neon/chittyos_core",
        "NEON_DATABASE_URL",
      ));

    if (!neonDbUrl) {
      return c.json(
        {
          error: "Neon database URL not configured",
        },
        503,
      );
    }

    const data = await executeNeonQuery(neonDbUrl, query, params || []);
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/openai/chat
 * OpenAI chat completion
 */
thirdpartyRoutes.post("/openai/chat", async (c) => {
  try {
    const {
      messages,
      model = "gpt-4",
      temperature,
      max_tokens,
    } = await c.req.json();

    if (!messages) {
      return c.json({ error: "messages is required" }, 400);
    }

    // Get OpenAI API key from chittysecrets with fallback
    const openaiKey = await getCredential(
      c.env,
      "integrations/openai/api_key",
      "OPENAI_API_KEY",
    );

    if (!openaiKey) {
      return c.json(
        {
          error: "OpenAI API key not configured",
        },
        503,
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, model, temperature, max_tokens }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/ollama/chat
 * Ollama chat completion (OpenAI-compatible) via chittyserv-dev
 * Falls back to OpenAI if Ollama is unavailable or times out
 */
thirdpartyRoutes.post("/ollama/chat", async (c) => {
  try {
    const {
      messages,
      model = "llama3.2:3b",
      temperature,
      max_tokens,
    } = await c.req.json();

    if (!messages) {
      return c.json({ error: "messages is required" }, 400);
    }

    const ollamaUrl =
      c.env.OLLAMA_URL || "https://ollama.chitty.cc/v1/chat/completions";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(ollamaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(c.env.OLLAMA_CF_CLIENT_ID &&
            c.env.OLLAMA_CF_CLIENT_SECRET && {
              "CF-Access-Client-Id": c.env.OLLAMA_CF_CLIENT_ID,
              "CF-Access-Client-Secret": c.env.OLLAMA_CF_CLIENT_SECRET,
            }),
        },
        body: JSON.stringify({ messages, model, temperature, max_tokens }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json();
      data._provider = "ollama";

      // Fire-and-forget usage logging
      if (c.env.IDEMP_KV) {
        const day = new Date().toISOString().slice(0, 10);
        const key = `usage:ollama:chat:${day}`;
        c.executionCtx.waitUntil(
          c.env.IDEMP_KV.get(key).then((prev) => {
            const counts = prev ? JSON.parse(prev) : { requests: 0, tokens: 0 };
            counts.requests += 1;
            counts.tokens += data.usage?.total_tokens || 0;
            return c.env.IDEMP_KV.put(key, JSON.stringify(counts), {
              expirationTtl: 90 * 86400,
            });
          }),
        );
      }

      return c.json(data);
    } catch (ollamaError) {
      clearTimeout(timeout);
      console.warn(
        `[Thirdparty] Ollama unavailable (${ollamaError.message}), falling back to OpenAI`,
      );

      const openaiKey = await getCredential(
        c.env,
        "integrations/openai/api_key",
        "OPENAI_API_KEY",
      );

      if (!openaiKey) {
        return c.json(
          {
            error: "Ollama unavailable and OpenAI API key not configured",
            ollamaError: ollamaError.message,
          },
          503,
        );
      }

      const fallbackResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages,
            model: "gpt-4o-mini",
            temperature,
            max_tokens,
          }),
        },
      );

      if (!fallbackResponse.ok) {
        throw new Error(`OpenAI fallback error: ${fallbackResponse.status}`);
      }

      const data = await fallbackResponse.json();
      data._provider = "openai-fallback";

      // Log OpenAI fallback usage
      if (c.env.IDEMP_KV) {
        const day = new Date().toISOString().slice(0, 10);
        const key = `usage:openai:fallback:${day}`;
        c.executionCtx.waitUntil(
          c.env.IDEMP_KV.get(key).then((prev) => {
            const counts = prev ? JSON.parse(prev) : { requests: 0, tokens: 0 };
            counts.requests += 1;
            counts.tokens += data.usage?.total_tokens || 0;
            return c.env.IDEMP_KV.put(key, JSON.stringify(counts), {
              expirationTtl: 90 * 86400,
            });
          }),
        );
      }

      return c.json(data);
    }
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/ollama/embeddings
 * Ollama embeddings (OpenAI-compatible) via chittyserv-dev
 */
thirdpartyRoutes.post("/ollama/embeddings", async (c) => {
  try {
    const { input, model = "nomic-embed-text" } = await c.req.json();

    if (!input) {
      return c.json({ error: "input is required" }, 400);
    }

    const ollamaUrl =
      c.env.OLLAMA_URL?.replace("/v1/chat/completions", "/v1/embeddings") ||
      "https://ollama.chitty.cc/v1/embeddings";

    const response = await fetch(ollamaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(c.env.OLLAMA_CF_CLIENT_ID &&
          c.env.OLLAMA_CF_CLIENT_SECRET && {
            "CF-Access-Client-Id": c.env.OLLAMA_CF_CLIENT_ID,
            "CF-Access-Client-Secret": c.env.OLLAMA_CF_CLIENT_SECRET,
          }),
      },
      body: JSON.stringify({ input, model }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings error: ${response.status}`);
    }

    const data = await response.json();
    data._provider = "ollama";

    // Fire-and-forget usage logging
    if (c.env.IDEMP_KV) {
      const day = new Date().toISOString().slice(0, 10);
      const key = `usage:ollama:embeddings:${day}`;
      c.executionCtx.waitUntil(
        c.env.IDEMP_KV.get(key).then((prev) => {
          const counts = prev ? JSON.parse(prev) : { requests: 0, tokens: 0 };
          counts.requests += 1;
          counts.tokens += data.usage?.total_tokens || 0;
          return c.env.IDEMP_KV.put(key, JSON.stringify(counts), {
            expirationTtl: 90 * 86400,
          });
        }),
      );
    }

    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/ollama/models
 * List available Ollama models
 */
thirdpartyRoutes.get("/ollama/models", async (c) => {
  try {
    const ollamaBase =
      c.env.OLLAMA_URL?.replace("/v1/chat/completions", "") ||
      "https://ollama.chitty.cc";

    const response = await fetch(`${ollamaBase}/api/tags`, {
      headers: {
        ...(c.env.OLLAMA_CF_CLIENT_ID &&
          c.env.OLLAMA_CF_CLIENT_SECRET && {
            "CF-Access-Client-Id": c.env.OLLAMA_CF_CLIENT_ID,
            "CF-Access-Client-Secret": c.env.OLLAMA_CF_CLIENT_SECRET,
          }),
      },
    });

    if (!response.ok) {
      throw new Error(`Ollama models error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/ollama/usage
 * Query inference usage stats from KV
 */
thirdpartyRoutes.get("/ollama/usage", async (c) => {
  try {
    if (!c.env.IDEMP_KV) {
      return c.json({ error: "Usage tracking not available" }, 503);
    }

    const days = parseInt(c.req.query("days") || "7", 10);
    const results = {};
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const day = date.toISOString().slice(0, 10);

      const [chat, embeddings, fallback] = await Promise.all([
        c.env.IDEMP_KV.get(`usage:ollama:chat:${day}`),
        c.env.IDEMP_KV.get(`usage:ollama:embeddings:${day}`),
        c.env.IDEMP_KV.get(`usage:openai:fallback:${day}`),
      ]);

      results[day] = {
        ollama_chat: chat ? JSON.parse(chat) : { requests: 0, tokens: 0 },
        ollama_embeddings: embeddings
          ? JSON.parse(embeddings)
          : { requests: 0, tokens: 0 },
        openai_fallback: fallback
          ? JSON.parse(fallback)
          : { requests: 0, tokens: 0 },
      };
    }

    return c.json({ days, usage: results });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/cloudflare/ai/run
 * Cloudflare Workers AI
 */
thirdpartyRoutes.post("/cloudflare/ai/run", async (c) => {
  try {
    const { model, inputs } = await c.req.json();

    if (!model || !inputs) {
      return c.json({ error: "model and inputs are required" }, 400);
    }

    const response = await c.env.AI.run(model, inputs);
    return c.json({ response });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PATCH /api/thirdparty/notion/page/update
 * Update Notion page
 */
thirdpartyRoutes.patch("/notion/page/update", async (c) => {
  try {
    const { pageId, ...properties } = await c.req.json();

    if (!pageId) {
      return c.json({ error: "pageId is required" }, 400);
    }

    // Get Notion token from chittysecrets with fallback
    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
        },
        503,
      );
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(properties),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * PATCH /api/thirdparty/notion/pages/:pageId
 * Legacy alias for Notion page update.
 */
thirdpartyRoutes.patch("/notion/pages/:pageId", async (c) => {
  try {
    const pageId = c.req.param("pageId");
    const properties = await c.req.json();

    if (!pageId) {
      return c.json({ error: "pageId is required" }, 400);
    }

    const notionToken = await getCredential(
      c.env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
    );

    if (!notionToken) {
      return c.json(
        {
          error: "Notion API key not configured",
        },
        503,
      );
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(properties),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// ── GitHub repository proxy (contents, pulls, commits, merge) ─────────
// Used by chittyagent-autoassist's pr_land_v1 loop over a service binding.
// Token: getCredential("integrations/github/token", "GITHUB_TOKEN").
// GitHub's status and body pass through unchanged: callers treat 4xx as a
// final decision and 5xx as retryable, so a 409 (head moved) must stay a 409.
// owner/repo are validated and every path segment is encoded, so a crafted
// segment can't normalise into another GitHub API path.

const GITHUB_NAME_RE = /^[A-Za-z0-9_.-]+$/;
const GITHUB_MERGE_METHODS = ["merge", "squash", "rebase"];
const GITHUB_SHA_RE = /^[0-9a-f]{7,40}$/i;
const GITHUB_PASSTHROUGH_HEADERS = ["Content-Type", "Link", "Retry-After"];
// Plus every X-RateLimit-* header, so callers can back off on 403/429.
const GITHUB_RATELIMIT_HEADER_PREFIX = "x-ratelimit-";

function githubRepoBase(owner, repo) {
  for (const name of [owner, repo]) {
    if (!GITHUB_NAME_RE.test(name) || name === "." || name === "..") {
      return null;
    }
  }
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function parsePullNumber(n) {
  return /^[1-9][0-9]{0,9}$/.test(n) ? Number(n) : null;
}

// Re-encode a raw (still percent-encoded) file path one segment at a time.
function encodeContentPath(rawPath) {
  const segments = rawPath.split("/");
  const out = [];
  for (const raw of segments) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg === "." || seg === ".." || seg.includes("/")) return null;
    out.push(encodeURIComponent(seg));
  }
  return out.join("/");
}

// Slice at the exact route prefix (mount + owner/repo), so an owner or repo
// literally named "contents" can't shift where the file path starts.
function contentPathFromRequest(c, owner, repo) {
  const mount = c.req.routePath.replace(
    /\/github\/repos\/:owner\/:repo\/contents\/\*$/,
    "",
  );
  const prefix = `${mount}/github/repos/${owner}/${repo}/contents/`;
  if (!c.req.path.startsWith(prefix)) return null;
  return encodeContentPath(c.req.path.slice(prefix.length));
}

// ── Per-caller authorization for the GitHub proxy ──────────────────────
// The broker's GitHub token reaches many repos, so every route checks the
// caller before any upstream call. API_KEYS records opt in with two optional
// fields (docs/github-proxy-key-scoping.md):
//   github_actions: ["read" | "write" | "merge"]
//   github_repos:   ["owner/repo" | "owner/*"]
// A key without both fields is denied (fail closed). OAuth principals from
// /mcp are always denied: a grant carries no repo allow-list, so even a read
// would open every repo the broker token reaches.
// Synthetic principals (public, cloudflare-access, oidc) are always denied.
const GITHUB_ACTIONS = new Set(["read", "write", "merge"]);
const GITHUB_SYNTHETIC_PRINCIPALS = new Set([
  "public",
  "cloudflare-access",
  "oidc",
]);

function githubRepoAllowed(patterns, owner, repo) {
  const o = owner.toLowerCase();
  const full = `${o}/${repo.toLowerCase()}`;
  return patterns.some((pattern) => {
    if (typeof pattern !== "string") return false;
    const p = pattern.toLowerCase();
    return p === full || p === `${o}/*`;
  });
}

/** @visibleForTesting */
export function githubAuthorizationError(principal, action, owner, repo) {
  if (!GITHUB_ACTIONS.has(action)) return "unknown action";
  if (!principal) return "no authenticated principal";
  if (principal.type === "oauth") {
    return "OAuth principals may not use the GitHub proxy";
  }
  if (GITHUB_SYNTHETIC_PRINCIPALS.has(principal.type)) {
    return `${principal.type} principal may not use the GitHub proxy`;
  }
  const { github_actions: actions, github_repos: repos } = principal;
  if (!Array.isArray(actions) || !Array.isArray(repos)) {
    return "API key is not scoped for the GitHub proxy";
  }
  if (!actions.includes(action)) return `API key lacks github ${action}`;
  if (!githubRepoAllowed(repos, owner, repo)) {
    return `API key is not allowed on ${owner}/${repo}`;
  }
  return null;
}

// Single guard used by every GitHub proxy route. Returns a 403 Response to
// send, or null when the caller may proceed.
function githubGuard(c, action, owner, repo) {
  const reason = githubAuthorizationError(c.get("apiKey"), action, owner, repo);
  if (!reason) return null;
  console.warn("[github-proxy] denied", {
    action,
    repo: `${owner}/${repo}`,
    caller: c.get("apiKey")?.service || c.get("apiKey")?.name || "unknown",
    reason,
  });
  return c.json(
    { error: "forbidden", code: "GITHUB_PROXY_FORBIDDEN", reason },
    403,
  );
}

// Forward only the named query parameters that are present.
function pickQuery(c, names) {
  const params = new URLSearchParams();
  for (const name of names) {
    const value = c.req.query(name);
    if (value !== undefined) params.set(name, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function githubPassthrough(c, method, apiPath, body) {
  const githubToken = await getCredential(
    c.env,
    "integrations/github/token",
    "GITHUB_TOKEN",
  );

  if (!githubToken) {
    return c.json({ error: "GitHub token not configured" }, 503);
  }

  let response;
  try {
    response = await fetch(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (error) {
    return c.json({ error: `GitHub request failed: ${error.message}` }, 502);
  }

  const headers = { "Content-Type": "application/json" };
  for (const name of GITHUB_PASSTHROUGH_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  for (const [name, value] of response.headers) {
    if (name.toLowerCase().startsWith(GITHUB_RATELIMIT_HEADER_PREFIX)) {
      headers[name] = value;
    }
  }
  return new Response(await response.text(), {
    status: response.status,
    headers,
  });
}

/**
 * PUT /api/thirdparty/github/repos/:owner/:repo/contents/*
 * Create or update a file. Returns GitHub's full response body, including
 * commit.sha and commit.parents.
 */
thirdpartyRoutes.put("/github/repos/:owner/:repo/contents/*", async (c) => {
  const { owner, repo } = c.req.param();
  const base = githubRepoBase(owner, repo);
  const path = base && contentPathFromRequest(c, owner, repo);
  if (!base || !path) {
    return c.json({ error: "invalid owner, repo or file path" }, 400);
  }
  const denied = githubGuard(c, "write", owner, repo);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  if (!body?.content) {
    return c.json({ error: "content is required" }, 400);
  }

  return githubPassthrough(c, "PUT", `${base}/contents/${path}`, body);
});

/**
 * GET /api/thirdparty/github/repos/:owner/:repo/contents/*
 * Get file contents (optional ?ref=branch|sha)
 */
thirdpartyRoutes.get("/github/repos/:owner/:repo/contents/*", async (c) => {
  const { owner, repo } = c.req.param();
  const base = githubRepoBase(owner, repo);
  const path = base && contentPathFromRequest(c, owner, repo);
  if (!base || !path) {
    return c.json({ error: "invalid owner, repo or file path" }, 400);
  }
  const denied = githubGuard(c, "read", owner, repo);
  if (denied) return denied;
  return githubPassthrough(
    c,
    "GET",
    `${base}/contents/${path}${pickQuery(c, ["ref"])}`,
  );
});

/**
 * GET /api/thirdparty/github/repos/:owner/:repo/pulls/:n
 * Read a pull request
 */
thirdpartyRoutes.get("/github/repos/:owner/:repo/pulls/:n", async (c) => {
  const { owner, repo, n } = c.req.param();
  const base = githubRepoBase(owner, repo);
  const pr = parsePullNumber(n);
  if (!base || pr === null) {
    return c.json({ error: "invalid owner, repo or pull number" }, 400);
  }
  const denied = githubGuard(c, "read", owner, repo);
  if (denied) return denied;
  return githubPassthrough(c, "GET", `${base}/pulls/${pr}`);
});

// 400 Response when per_page or page is present but not a positive integer.
function invalidPageParam(c) {
  for (const name of ["per_page", "page"]) {
    const value = c.req.query(name);
    if (value !== undefined && !/^[1-9][0-9]{0,3}$/.test(value)) {
      return c.json({ error: `${name} must be a positive integer` }, 400);
    }
  }
  return null;
}

/**
 * GET /api/thirdparty/github/repos/:owner/:repo/commits/:sha/check-runs
 * List check runs for a commit. Forwards ?per_page and ?page, and GitHub's
 * Link header for pagination. Each run carries GitHub's app.id / app.slug.
 */
thirdpartyRoutes.get(
  "/github/repos/:owner/:repo/commits/:sha/check-runs",
  async (c) => {
    const { owner, repo, sha } = c.req.param();
    const base = githubRepoBase(owner, repo);
    if (!base || !GITHUB_SHA_RE.test(sha)) {
      return c.json({ error: "invalid owner, repo or commit sha" }, 400);
    }
    const denied = githubGuard(c, "read", owner, repo);
    if (denied) return denied;
    const badPage = invalidPageParam(c);
    if (badPage) return badPage;
    return githubPassthrough(
      c,
      "GET",
      `${base}/commits/${sha}/check-runs${pickQuery(c, ["per_page", "page"])}`,
    );
  },
);

/**
 * GET /api/thirdparty/github/repos/:owner/:repo/commits/:sha/status
 * Combined commit status (legacy statuses API). Forwards ?per_page and ?page,
 * and GitHub's Link header for pagination.
 */
thirdpartyRoutes.get(
  "/github/repos/:owner/:repo/commits/:sha/status",
  async (c) => {
    const { owner, repo, sha } = c.req.param();
    const base = githubRepoBase(owner, repo);
    if (!base || !GITHUB_SHA_RE.test(sha)) {
      return c.json({ error: "invalid owner, repo or commit sha" }, 400);
    }
    const denied = githubGuard(c, "read", owner, repo);
    if (denied) return denied;
    const badPage = invalidPageParam(c);
    if (badPage) return badPage;
    return githubPassthrough(
      c,
      "GET",
      `${base}/commits/${sha}/status${pickQuery(c, ["per_page", "page"])}`,
    );
  },
);

/**
 * PUT /api/thirdparty/github/repos/:owner/:repo/pulls/:n/merge
 * Merge a pull request. `sha` is required so GitHub rejects the merge (409)
 * if the head moved since the caller evaluated it.
 */
thirdpartyRoutes.put("/github/repos/:owner/:repo/pulls/:n/merge", async (c) => {
  const { owner, repo, n } = c.req.param();
  const base = githubRepoBase(owner, repo);
  const pr = parsePullNumber(n);
  if (!base || pr === null) {
    return c.json({ error: "invalid owner, repo or pull number" }, 400);
  }
  const denied = githubGuard(c, "merge", owner, repo);
  if (denied) return denied;

  const body = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body.sha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(body.sha)
  ) {
    return c.json(
      { error: "sha is required: the full 40-character head commit sha" },
      400,
    );
  }
  if (
    body.merge_method !== undefined &&
    !GITHUB_MERGE_METHODS.includes(body.merge_method)
  ) {
    return c.json(
      {
        error: `merge_method must be one of ${GITHUB_MERGE_METHODS.join(", ")}`,
      },
      400,
    );
  }

  return githubPassthrough(c, "PUT", `${base}/pulls/${pr}/merge`, {
    sha: body.sha,
    ...(body.merge_method && { merge_method: body.merge_method }),
  });
});

/**
 * GET /api/thirdparty/google/calendar/events
 * List Google Calendar events
 */
thirdpartyRoutes.get("/google/calendar/events", async (c) => {
  try {
    const {
      calendarId = "primary",
      timeMin,
      timeMax,
      maxResults = 10,
    } = c.req.query();

    // Get Google access token from chittysecrets with fallback
    const googleToken = await getCredential(
      c.env,
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );

    if (!googleToken) {
      return c.json(
        {
          error: "Google access token not configured",
        },
        503,
      );
    }

    const params = new URLSearchParams({
      timeMin: timeMin || new Date().toISOString(),
      maxResults,
      singleEvents: "true",
      orderBy: "startTime",
    });

    if (timeMax) params.append("timeMax", timeMax);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${googleToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// ── Mercury Banking API Proxy ────────────────────────────────────────
// Mercury API: https://api.mercury.com/api/v1
// Auth: Bearer token per business login (one API key per Mercury business)
// Multi-account: ChittyFinance stores integration rows per Mercury login,
// each with its own API key in credentials JSONB.

const MERCURY_API = "https://api.mercury.com/api/v1";

/**
 * Read a Worker binding that may be a Cloudflare Secrets Store secret
 * (an object exposing an async get()) or a plain string secret/var.
 * Returns the string value, or undefined if the binding is absent.
 */
async function resolveBinding(binding) {
  if (!binding) return undefined;
  if (typeof binding === "string") return binding;
  if (typeof binding.get === "function") {
    try {
      const value = await binding.get();
      return value || undefined;
    } catch {
      // Store unreachable / secret missing — degrade to the next
      // resolution layer (legacy env var → single fallback → broker).
      return undefined;
    }
  }
  return undefined;
}

/**
 * Mercury credential references are stable identifiers only. ChittyConnect
 * resolves them through the private ChittySecrets service binding at the exact
 * point of provider execution; no Mercury value is stored in Worker bindings,
 * route context, KV, or application configuration.
 */
export const MERCURY_READ_REFERENCES = Object.freeze({
  ARIBIA: Object.freeze({ credentialRef: "chittysecrets://mercury/aribia/read", secretName: "MERCURY_TOKEN_ARIBIA_LLC" }),
  CITY: Object.freeze({ credentialRef: "chittysecrets://mercury/city/read", secretName: "MERCURY_TOKEN_ARIBIA_LLC_CITY_STUDIO" }),
  APT: Object.freeze({ credentialRef: "chittysecrets://mercury/apt/read", secretName: "MERCURY_TOKEN_ARIBIA_LLC_APT_ARLENE" }),
  FC: Object.freeze({ credentialRef: "chittysecrets://mercury/fc/read", secretName: "MERCURY_TOKEN_CHICAGO_FURNISHED_CONDOS" }),
  CHIT: Object.freeze({ credentialRef: "chittysecrets://mercury/chit/read", secretName: "MERCURY_TOKEN_CHITTY_SERVICES" }),
  ICB: Object.freeze({ credentialRef: "chittysecrets://mercury/icb/read", secretName: "MERCURY_TOKEN_IT_CAN_BE_LLC" }),
  JAVL: Object.freeze({ credentialRef: "chittysecrets://mercury/javl/read", secretName: "MERCURY_TOKEN_JEAN_ARLENE_VENTURING" }),
  MNW: Object.freeze({ credentialRef: "chittysecrets://mercury/mnw/read", secretName: "MERCURY_TOKEN_MNW" }),
  NAJB: Object.freeze({ credentialRef: "chittysecrets://mercury/najb/read", secretName: "MERCURY_TOKEN_NAJB" }),
});

const MERCURY_READ_ALIASES = Object.freeze({
  "aribia": "ARIBIA",
  "aribia-llc": "ARIBIA",
  "city": "CITY",
  "aribia-llc-city-studio": "CITY",
  "apt": "APT",
  "aribia-llc-apt-arlene": "APT",
  "fc": "FC",
  "chicago-furnished-condos": "FC",
  "chit": "CHIT",
  "chitty-services": "CHIT",
  "icb": "ICB",
  "it-can-be-llc": "ICB",
  "javl": "JAVL",
  "jean-arlene-venturing": "JAVL",
  "mnw": "MNW",
  "najb": "NAJB",
});

export function resolveMercuryReadReference(integrationSlug) {
  const slug = String(integrationSlug ?? "").trim().toLowerCase();
  const code = MERCURY_READ_ALIASES[slug] || slug.toUpperCase();
  const descriptor = MERCURY_READ_REFERENCES[code];
  if (!descriptor) {
    throw new Error(`Unknown Mercury credential boundary '${integrationSlug ?? ""}'`);
  }
  return descriptor;
}

async function resolveBrokerCredential(env, descriptor) {
  const broker = env?.SVC_SECRETS;
  if (!broker || typeof broker.resolveReference !== "function") {
    throw new Error("POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE: SVC_SECRETS runtime broker is not bound");
  }
  const result = await broker.resolveReference({
    secretName: descriptor.secretName,
    credentialRef: descriptor.credentialRef,
  });
  if (
    !result ||
    result.credentialRef !== descriptor.credentialRef ||
    typeof result.value !== "string" ||
    result.value.length === 0
  ) {
    throw new Error(`MISSING_CREDENTIAL_MATERIAL: ${descriptor.credentialRef}`);
  }
  return result.value;
}

// ── Mercury egress profile (static-IP relay indirection) ─────────────
// Mercury per-token IP allowlisting requires that all calls leave from one
// static IP. The `relay` profile routes the Mercury request through a
// configurable relay endpoint (an Access-locked Worker / app-connector on a
// reserved-IP node) that forwards to api.mercury.com from that static IP.
// The `direct` profile (default) preserves today's behavior: hit
// api.mercury.com directly from Cloudflare's shared egress.
//
// Keys NEVER move to the relay: the Mercury token is resolved from Secrets
// here (Option A) and transits to the relay as a request header only.

const EGRESS_DIRECT = "direct";
const EGRESS_RELAY = "relay";
const EGRESS_PROFILES = new Set([EGRESS_DIRECT, EGRESS_RELAY]);

/**
 * Normalize a raw profile value to a canonical, recognized profile.
 * Profile config arrives as free-form env strings, so `RELAY`, `Relay`, and
 * ` relay ` must all match `relay` — otherwise they'd silently fall through to
 * the direct path, defeating the egress indirection and being hard to diagnose.
 * Rejects unknown values early (fail closed) rather than masking misconfig.
 *
 * @param {string} raw
 * @returns {string} one of EGRESS_DIRECT | EGRESS_RELAY
 */
function normalizeEgressProfile(raw) {
  const profile = String(raw).trim().toLowerCase();
  if (!EGRESS_PROFILES.has(profile)) {
    throw new Error(
      `Unknown Mercury egress profile '${raw}' (expected one of: ${[...EGRESS_PROFILES].join(", ")})`,
    );
  }
  return profile;
}

/**
 * Resolve the active egress profile for a slug.
 * Per-slug override `MERCURY_EGRESS_PROFILE_<SLUG>` wins, else the global
 * `MERCURY_EGRESS_PROFILE`, else the `direct` default.
 * Mirrors the per-slug env convention used by getMercuryToken.
 * Profile values are normalized case-insensitively; unknown values throw.
 *
 * @returns {{ profile: string, relayUrl?: string, accessClientId?: string, accessClientSecret?: string }}
 */
export function resolveEgressProfile(env, slug) {
  const e = env || {};
  let rawProfile = e.MERCURY_EGRESS_PROFILE || EGRESS_DIRECT;
  if (slug) {
    const overrideKey = `MERCURY_EGRESS_PROFILE_${String(slug).replace(/-/g, "_").toUpperCase()}`;
    if (e[overrideKey]) rawProfile = e[overrideKey];
  }
  const profile = normalizeEgressProfile(rawProfile);
  return {
    profile,
    relayUrl: e.MERCURY_EGRESS_URL,
  };
}

/**
 * Fixed code -> Secrets Store binding map for Mercury WRITE tokens (#328).
 * Write tokens are whitelisted to the mercury-proxy static IP and must only
 * ever be used through the relay. The list is closed: an unknown code throws
 * (fail closed) rather than being interpolated into a binding name.
 */
export const MERCURY_WRITE_REFERENCES = Object.freeze({
  ARIBIA: Object.freeze({ credentialRef: "chittysecrets://mercury/aribia/write", secretName: "MERCURY_WRITE_TOKEN_ARIBIA" }),
  APT: Object.freeze({ credentialRef: "chittysecrets://mercury/apt/write", secretName: "MERCURY_WRITE_TOKEN_APT" }),
  CITY: Object.freeze({ credentialRef: "chittysecrets://mercury/city/write", secretName: "MERCURY_WRITE_TOKEN_CITY" }),
  FC: Object.freeze({ credentialRef: "chittysecrets://mercury/fc/write", secretName: "MERCURY_WRITE_TOKEN_FC" }),
  CHIT: Object.freeze({ credentialRef: "chittysecrets://mercury/chit/write", secretName: "MERCURY_WRITE_TOKEN_CHIT" }),
  ICB: Object.freeze({ credentialRef: "chittysecrets://mercury/icb/write", secretName: "MERCURY_WRITE_TOKEN_ICB" }),
  JAVL: Object.freeze({ credentialRef: "chittysecrets://mercury/javl/write", secretName: "MERCURY_WRITE_TOKEN_JAVL" }),
  MNW: Object.freeze({ credentialRef: "chittysecrets://mercury/mnw/write", secretName: "MERCURY_WRITE_TOKEN_MNW" }),
  NAJB: Object.freeze({ credentialRef: "chittysecrets://mercury/najb/write", secretName: "MERCURY_WRITE_TOKEN_NAJB" }),
});

/**
 * Map a business code to its immutable ChittySecrets credential reference.
 * Unknown codes (including APTA) fail closed.
 */
export function resolveWriteCredentialReference(code) {
  const key = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(MERCURY_WRITE_REFERENCES, key)) {
    throw new Error(`Unknown Mercury write code '${code}'`);
  }
  return MERCURY_WRITE_REFERENCES[key];
}

async function resolveWriteToken(env, code) {
  return resolveBrokerCredential(env, resolveWriteCredentialReference(code));
}

const MERCURY_EGRESS_REFERENCES = Object.freeze({
  accessClientId: Object.freeze({
    credentialRef: "chittysecrets://mercury/egress/access-client-id",
    secretName: "MERCURY_EGRESS_ACCESS_CLIENT_ID",
  }),
  accessClientSecret: Object.freeze({
    credentialRef: "chittysecrets://mercury/egress/access-client-secret",
    secretName: "MERCURY_EGRESS_ACCESS_CLIENT_SECRET",
  }),
  proxyToken: Object.freeze({
    credentialRef: "chittysecrets://mercury/egress/proxy-token",
    secretName: "MERCURY_EGRESS_PROXY_TOKEN",
  }),
});

/**
 * Hydrate relay credentials only inside the provider-execution boundary. The
 * route layer carries no secret values and Worker configuration stores none.
 */
async function resolveWriteEgress(env) {
  const e = env || {};
  if (!e.MERCURY_EGRESS_URL) {
    throw new Error(
      "MERCURY_EGRESS_URL is not configured; Mercury writes require the relay",
    );
  }

  const [accessClientId, accessClientSecret, proxyToken] = await Promise.all([
    resolveBrokerCredential(e, MERCURY_EGRESS_REFERENCES.accessClientId),
    resolveBrokerCredential(e, MERCURY_EGRESS_REFERENCES.accessClientSecret),
    resolveBrokerCredential(e, MERCURY_EGRESS_REFERENCES.proxyToken),
  ]);

  return {
    profile: EGRESS_RELAY,
    relayUrl: e.MERCURY_EGRESS_URL,
    accessClientId,
    accessClientSecret,
    proxyToken,
  };
}

/**
 * Perform a Mercury write (POST/PUT/PATCH/DELETE) for a business code through
 * the relay. Reads must keep using mercuryFetch with the per-slug profile.
 */
export async function mercuryWrite(env, code, path, options = {}) {
  const method = String(options.method || "POST").toUpperCase();
  const allowedMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (!allowedMethods.has(method)) {
    throw new Error(
      `mercuryWrite only permits POST, PUT, PATCH, or DELETE; got ${method}`,
    );
  }
  const token = await resolveWriteToken(env, code);
  const egress = await resolveWriteEgress(env);
  return mercuryFetch(token, path, { ...options, method }, egress);
}

/**
 * Build the concrete fetch request (url, method, headers, body) for a Mercury
 * call under the active egress profile. Pure function — no I/O — so the
 * profile-selection / header-construction / fail-closed logic is unit-testable
 * without mocking fetch.
 *
 * - `direct`: targets `${MERCURY_API}${path}` directly, Bearer token, exactly
 *   as the legacy implementation did.
 * - `relay`: POSTs `{ method, path, body }` to the relay URL with the Mercury
 *   token as `X-Mercury-Token` plus Cloudflare Access service-token headers.
 *   The relay only ever receives a relative `path` (never a caller-supplied
 *   host), so api.mercury.com host-allowlisting is preserved structurally.
 *   Fails closed (throws) if `relay` is selected but no relay URL is set.
 *
 * @returns {{ url: string, method: string, headers: Record<string,string>, body?: string }}
 */
export function buildEgressRequest({
  profile = EGRESS_DIRECT,
  relayUrl,
  accessClientId,
  accessClientSecret,
  proxyToken,
  token,
  path,
  options = {},
}) {
  if (profile === EGRESS_RELAY) {
    if (!relayUrl) {
      // Fail closed — do NOT silently fall back to direct; that would mask an
      // egress misconfiguration and leak Cloudflare's shared egress IP to
      // Mercury, defeating the per-token IP allowlist this profile exists for.
      throw new Error(
        "Mercury egress profile is 'relay' but MERCURY_EGRESS_URL is not configured",
      );
    }
    // Validate the path BEFORE putting it in the relay envelope. The relay
    // re-hosts `path` onto api.mercury.com, so an absolute URL or a host-
    // bearing / traversal value would let a caller redirect the relay off
    // Mercury (host/URL injection), breaking the host-allowlist guarantee.
    // Only relative Mercury API paths are permitted — fail closed otherwise.
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("://") ||
      path.includes("..")
    ) {
      throw new Error(
        `Mercury relay path must be a relative API path beginning with '/' (no host, scheme, '//', or '..'); got: ${path}`,
      );
    }
    const headers = {
      "Content-Type": "application/json",
      "X-Mercury-Token": token,
    };
    // mercury-proxy second layer: Authorization: Bearer <PROXY_TOKEN>.
    if (proxyToken) headers.Authorization = `Bearer ${proxyToken}`;
    if (accessClientId) headers["CF-Access-Client-Id"] = accessClientId;
    if (accessClientSecret)
      headers["CF-Access-Client-Secret"] = accessClientSecret;
    return {
      url: relayUrl,
      method: "POST",
      headers,
      body: JSON.stringify({
        method: (options.method || "GET").toUpperCase(),
        // Relative Mercury API path only — relay re-hosts onto api.mercury.com.
        path,
        body: options.body ?? null,
      }),
    };
  }

  // direct (default) — byte-for-byte the legacy request shape.
  return {
    url: `${MERCURY_API}${path}`,
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    body: options.body,
  };
}

async function mercuryFetch(
  token,
  path,
  options = {},
  egress = { profile: EGRESS_DIRECT },
) {
  const req = buildEgressRequest({
    profile: egress.profile,
    relayUrl: egress.relayUrl,
    accessClientId: egress.accessClientId,
    accessClientSecret: egress.accessClientSecret,
    proxyToken: egress.proxyToken,
    token,
    path,
    options,
  });

  const isRelay = egress.profile === EGRESS_RELAY;
  const fetchOptions = isRelay
    ? { method: req.method, headers: req.headers, body: req.body }
    : { ...options, method: req.method, headers: req.headers };

  const res = await fetch(req.url, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Mercury API ${res.status} on ${path}: ${body.slice(0, 200)}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Mercury API returned non-JSON (${ct}) on ${path}: ${body.slice(0, 100)}`,
    );
  }
  return res.json();
}

/**
 * Extract the integration slug from query params.
 * Accepts ?slug= or ?entity= (legacy).
 */
function getSlug(c) {
  const slug = c.req.query("slug") || c.req.query("entity");
  if (slug && !/^[a-z0-9_-]+$/i.test(slug)) return undefined;
  return slug;
}

/**
 * Middleware: resolve only the Mercury credential reference and attach that
 * non-secret descriptor to context. Secret material is injected later inside
 * brokerMercuryFetch and never lives on route context.
 */
async function requireMercuryCredential(c, next) {
  const slug = c.get("mercurySlug") ?? getSlug(c);
  try {
    const descriptor = resolveMercuryReadReference(slug);
    c.set("mercuryCredential", descriptor);
    c.set("mercurySlug", slug);
    c.set("mercuryEgress", resolveEgressProfile(c.env, slug));
  } catch (error) {
    return c.json(
      {
        error: `Mercury credential/egress unavailable for ${slug || "default"}: ${error.message}`,
      },
      503,
    );
  }
  await next();
}

async function brokerMercuryFetch(env, descriptor, path, options = {}, egress = { profile: EGRESS_DIRECT }) {
  const token = await resolveBrokerCredential(env, descriptor);
  const hydratedEgress =
    egress.profile === EGRESS_RELAY ? await resolveWriteEgress(env) : egress;
  return mercuryFetch(token, path, options, hydratedEgress);
}

/**
 * Validate :accountId path param — alphanumeric, hyphens, underscores only.
 */
function validateAccountId(c, next) {
  const accountId = c.req.param("accountId");
  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    return c.json({ error: "Invalid account ID format" }, 400);
  }
  return next();
}

/**
 * Wrap Mercury handler with error logging.
 */
function mercuryHandler(operation, handler) {
  return async (c) => {
    try {
      return await handler(c);
    } catch (error) {
      const slug = c.get("mercurySlug") || "default";
      console.error(
        `[Mercury] ${operation} failed (slug=${slug}):`,
        error.message,
      );
      return c.json({ error: error.message }, 500);
    }
  };
}

/** GET /api/thirdparty/mercury/accounts */
thirdpartyRoutes.get(
  "/mercury/accounts",
  requireMercuryCredential,
  mercuryHandler("GET /accounts", async (c) => {
    const data = await brokerMercuryFetch(
      c.env,
      c.get("mercuryCredential"),
      "/accounts",
      {},
      c.get("mercuryEgress"),
    );
    return c.json(data);
  }),
);

/** GET /api/thirdparty/mercury/account/:accountId */
thirdpartyRoutes.get(
  "/mercury/account/:accountId",
  validateAccountId,
  requireMercuryCredential,
  mercuryHandler("GET /account/:id", async (c) => {
    const data = await brokerMercuryFetch(
      c.env,
      c.get("mercuryCredential"),
      `/account/${c.req.param("accountId")}`,
      {},
      c.get("mercuryEgress"),
    );
    return c.json(data);
  }),
);

/** GET /api/thirdparty/mercury/account/:accountId/transactions */
thirdpartyRoutes.get(
  "/mercury/account/:accountId/transactions",
  validateAccountId,
  requireMercuryCredential,
  mercuryHandler("GET /account/:id/transactions", async (c) => {
    const params = new URLSearchParams();
    for (const key of ["start", "end", "limit", "offset"]) {
      const val = c.req.query(key);
      if (val) params.set(key, val);
    }
    const qs = params.toString() ? `?${params}` : "";
    const data = await brokerMercuryFetch(
      c.env,
      c.get("mercuryCredential"),
      `/account/${c.req.param("accountId")}/transactions${qs}`,
      {},
      c.get("mercuryEgress"),
    );
    return c.json(data);
  }),
);

/**
 * POST /api/thirdparty/mercury/refresh
 * Keepalive ping — any successful API call resets Mercury's 30-day inactivity timer.
 */
thirdpartyRoutes.post(
  "/mercury/refresh",
  async (c, next) => {
    const body = await c.req.json().catch(() => ({}));
    c.set("mercurySlug", body.slug || getSlug(c));
    await next();
  },
  requireMercuryCredential,
  mercuryHandler("POST /refresh", async (c) => {
    const slug = c.get("mercurySlug");
    const data = await brokerMercuryFetch(
      c.env,
      c.get("mercuryCredential"),
      "/accounts",
      {},
      c.get("mercuryEgress"),
    );
    return c.json({
      ok: true,
      slug,
      accounts: data.accounts?.length || 0,
      timestamp: new Date().toISOString(),
    });
  }),
);

export { thirdpartyRoutes };
