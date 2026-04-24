/**
 * Third-Party Integration Routes
 * Proxy for Notion, Neon, Google, OpenAI with 1Password Connect integration
 *
 * All credentials are retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
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

    // Get Notion token from 1Password with fallback
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
            "Neither 1Password Connect nor environment variable available",
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

    // Get Notion token from 1Password with fallback
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

    // Get Neon database URL from 1Password with fallback
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

    // Get OpenAI API key from 1Password with fallback
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
    const { messages, model = "llama3.2:3b", temperature, max_tokens } =
      await c.req.json();

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
          ...(c.env.OLLAMA_CF_CLIENT_ID && c.env.OLLAMA_CF_CLIENT_SECRET && {
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
        ...(c.env.OLLAMA_CF_CLIENT_ID && c.env.OLLAMA_CF_CLIENT_SECRET && {
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
        ...(c.env.OLLAMA_CF_CLIENT_ID && c.env.OLLAMA_CF_CLIENT_SECRET && {
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

    // Get Notion token from 1Password with fallback
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

/**
 * PUT /api/thirdparty/github/repos/:owner/:repo/contents/*
 * Create or update file in GitHub repository
 */
thirdpartyRoutes.put("/github/repos/:owner/:repo/contents/*", async (c) => {
  try {
    const { owner, repo } = c.req.param();
    const path = c.req.path.replace(
      `/api/thirdparty/github/repos/${owner}/${repo}/contents/`,
      "",
    );
    const body = await c.req.json();

    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }

    // Get GitHub token from 1Password with fallback
    const githubToken = await getCredential(
      c.env,
      "integrations/github/token",
      "GITHUB_TOKEN",
    );

    if (!githubToken) {
      return c.json(
        {
          error: "GitHub token not configured",
          details:
            "Neither 1Password Connect nor environment variable available",
        },
        503,
      );
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "ChittyConnect/1.0",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/github/repos/:owner/:repo/contents/*
 * Get file contents from GitHub repository
 */
thirdpartyRoutes.get("/github/repos/:owner/:repo/contents/*", async (c) => {
  try {
    const { owner, repo } = c.req.param();
    const path = c.req.path.replace(
      `/api/thirdparty/github/repos/${owner}/${repo}/contents/`,
      "",
    );

    // Get GitHub token from 1Password with fallback
    const githubToken = await getCredential(
      c.env,
      "integrations/github/token",
      "GITHUB_TOKEN",
    );

    if (!githubToken) {
      return c.json(
        {
          error: "GitHub token not configured",
        },
        503,
      );
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "ChittyConnect/1.0",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
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

    // Get Google access token from 1Password with fallback
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
 * Resolve Mercury API token for a given integration.
 * Checks: request header > env secret > credential broker (1Password)
 */
async function getMercuryToken(c, integrationSlug) {
  const slug = integrationSlug || "default";

  const headerToken = c.req.header("X-Mercury-Token");
  if (headerToken) return headerToken;

  const envKey = `MERCURY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`;
  if (c.env[envKey]) return c.env[envKey];

  if (c.env.MERCURY_API_TOKEN) return c.env.MERCURY_API_TOKEN;

  return getCredential(c.env, `integrations/mercury/${slug}`, "MERCURY_API_TOKEN", "Mercury");
}

async function mercuryFetch(token, path, options = {}) {
  const res = await fetch(`${MERCURY_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mercury API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mercury API returned non-JSON (${ct}) on ${path}: ${body.slice(0, 100)}`);
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
 * Middleware: resolve Mercury token and attach to context.
 * Returns 503 if no token can be resolved for the slug.
 */
async function requireMercuryToken(c, next) {
  const slug = c.get("mercurySlug") ?? getSlug(c);
  const token = await getMercuryToken(c, slug);
  if (!token) {
    return c.json({ error: `Mercury API token not configured for ${slug || "default"}` }, 503);
  }
  c.set("mercuryToken", token);
  c.set("mercurySlug", slug);
  await next();
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
      console.error(`[Mercury] ${operation} failed (slug=${slug}):`, error.message);
      return c.json({ error: error.message }, 500);
    }
  };
}

/** GET /api/thirdparty/mercury/accounts */
thirdpartyRoutes.get("/mercury/accounts", requireMercuryToken, mercuryHandler("GET /accounts", async (c) => {
  const data = await mercuryFetch(c.get("mercuryToken"), "/accounts");
  return c.json(data);
}));

/** GET /api/thirdparty/mercury/account/:accountId */
thirdpartyRoutes.get("/mercury/account/:accountId", validateAccountId, requireMercuryToken, mercuryHandler("GET /account/:id", async (c) => {
  const data = await mercuryFetch(c.get("mercuryToken"), `/account/${c.req.param("accountId")}`);
  return c.json(data);
}));

/** GET /api/thirdparty/mercury/account/:accountId/transactions */
thirdpartyRoutes.get("/mercury/account/:accountId/transactions", validateAccountId, requireMercuryToken, mercuryHandler("GET /account/:id/transactions", async (c) => {
  const params = new URLSearchParams();
  for (const key of ["start", "end", "limit", "offset"]) {
    const val = c.req.query(key);
    if (val) params.set(key, val);
  }
  const qs = params.toString() ? `?${params}` : "";
  const data = await mercuryFetch(c.get("mercuryToken"), `/account/${c.req.param("accountId")}/transactions${qs}`);
  return c.json(data);
}));

/**
 * POST /api/thirdparty/mercury/refresh
 * Keepalive ping — any successful API call resets Mercury's 30-day inactivity timer.
 */
thirdpartyRoutes.post("/mercury/refresh", async (c, next) => {
  const body = await c.req.json().catch(() => ({}));
  c.set("mercurySlug", body.slug || getSlug(c));
  await next();
}, requireMercuryToken, mercuryHandler("POST /refresh", async (c) => {
  const slug = c.get("mercurySlug");
  const data = await mercuryFetch(c.get("mercuryToken"), "/accounts");
  return c.json({
    ok: true,
    slug,
    accounts: data.accounts?.length || 0,
    timestamp: new Date().toISOString(),
  });
}));

// ── Gmail API Proxy ─────────────────────────────────────────────────
// Proxies Gmail REST API calls using the same Google OAuth2 token
// that powers Google Calendar. Requires gmail.readonly scope on the
// OAuth app (same refresh token rotated by SecretRotationService).

/**
 * GET /api/thirdparty/gmail/messages
 * List Gmail messages (metadata only)
 */
thirdpartyRoutes.get("/gmail/messages", async (c) => {
  try {
    const { q, maxResults = "10", pageToken } = c.req.query();

    const googleToken = await getCredential(
      c.env,
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );

    if (!googleToken) {
      return c.json({ error: "Google access token not configured" }, 503);
    }

    const params = new URLSearchParams({ maxResults });
    if (q) params.append("q", q);
    if (pageToken) params.append("pageToken", pageToken);

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gmail API error: ${response.status} — ${body}`);
    }

    return c.json(await response.json());
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/gmail/message/:messageId
 * Get a single Gmail message (full metadata + snippet)
 */
thirdpartyRoutes.get("/gmail/message/:messageId", async (c) => {
  try {
    const { messageId } = c.req.param();
    const { format = "metadata" } = c.req.query();

    const googleToken = await getCredential(
      c.env,
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );

    if (!googleToken) {
      return c.json({ error: "Google access token not configured" }, 503);
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=${format}`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gmail API error: ${response.status} — ${body}`);
    }

    return c.json(await response.json());
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/gmail/message/:messageId/raw
 * Get raw RFC 2822 .eml bytes for a Gmail message.
 * Returns the decoded binary (not base64url) with Content-Type: message/rfc822.
 * This is what chittyevidence-db's backfill endpoint calls.
 */
thirdpartyRoutes.get("/gmail/message/:messageId/raw", async (c) => {
  try {
    const { messageId } = c.req.param();

    const googleToken = await getCredential(
      c.env,
      "integrations/google/access_token",
      "GOOGLE_ACCESS_TOKEN",
    );

    if (!googleToken) {
      return c.json({ error: "Google access token not configured" }, 503);
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gmail API error: ${response.status} — ${body}`);
    }

    const data = await response.json();
    if (!data.raw) {
      return c.json({ error: "No raw content in response" }, 404);
    }

    // Gmail returns base64url-encoded RFC 2822 message
    // Convert base64url → base64 → binary
    let base64 = data.raw.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += '=';
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes, {
      headers: {
        "Content-Type": "message/rfc822",
        "Content-Disposition": `attachment; filename="${messageId}.eml"`,
      },
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { thirdpartyRoutes };
