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

export { thirdpartyRoutes };

// ── Mercury Banking API Proxy ────────────────────────────────────────
// Mercury API: https://api.mercury.com/api/v1
// Auth: Bearer token per business login (one API key per Mercury business)
// Multi-account: ChittyFinance stores integration rows per Mercury login,
// each with its own API key in credentials JSONB.

const MERCURY_API = "https://api.mercury.com/api/v1";

/**
 * Resolve Mercury API token for a given integration.
 * Checks: request header > env secret > credential broker
 */
async function getMercuryToken(c, integrationSlug) {
  // 1. Explicit header (for testing)
  const headerToken = c.req.header("X-Mercury-Token");
  if (headerToken) return headerToken;

  // 2. Env secret by slug pattern: MERCURY_API_KEY_{SLUG}
  const envKey = `MERCURY_API_KEY_${(integrationSlug || "default").toUpperCase()}`;
  if (c.env[envKey]) return c.env[envKey];

  // 3. Generic fallback
  if (c.env.MERCURY_API_TOKEN) return c.env.MERCURY_API_TOKEN;

  // 4. Credential broker (1Password)
  const { getCredential } = await import("../../lib/credential-helper.js");
  return getCredential(
    c.env,
    `integrations/mercury/${integrationSlug || "default"}`,
    "MERCURY_API_TOKEN",
    "Mercury",
  );
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
    throw new Error(`Mercury API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * GET /api/thirdparty/mercury/accounts
 * List all bank accounts for a Mercury login.
 * Query: ?slug=mgmt (resolves API key by slug)
 */
thirdpartyRoutes.get("/mercury/accounts", async (c) => {
  try {
    const slug = c.req.query("slug") || c.req.query("entity");
    const token = await getMercuryToken(c, slug);
    if (!token) {
      return c.json({ error: "Mercury API token not configured for " + (slug || "default") }, 503);
    }
    const data = await mercuryFetch(token, "/accounts");
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/mercury/account/:accountId
 * Get details for a specific Mercury bank account.
 * Query: ?slug=mgmt
 */
thirdpartyRoutes.get("/mercury/account/:accountId", async (c) => {
  try {
    const slug = c.req.query("slug") || c.req.query("entity");
    const accountId = c.req.param("accountId");
    const token = await getMercuryToken(c, slug);
    if (!token) {
      return c.json({ error: "Mercury API token not configured" }, 503);
    }
    const data = await mercuryFetch(token, `/account/${accountId}`);
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/thirdparty/mercury/account/:accountId/transactions
 * List transactions for a Mercury bank account.
 * Query: ?slug=mgmt&start=2026-01-01&end=2026-03-28&limit=100&offset=0
 */
thirdpartyRoutes.get("/mercury/account/:accountId/transactions", async (c) => {
  try {
    const slug = c.req.query("slug") || c.req.query("entity");
    const accountId = c.req.param("accountId");
    const token = await getMercuryToken(c, slug);
    if (!token) {
      return c.json({ error: "Mercury API token not configured" }, 503);
    }
    const params = new URLSearchParams();
    if (c.req.query("start")) params.set("start", c.req.query("start"));
    if (c.req.query("end")) params.set("end", c.req.query("end"));
    if (c.req.query("limit")) params.set("limit", c.req.query("limit"));
    if (c.req.query("offset")) params.set("offset", c.req.query("offset"));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const data = await mercuryFetch(token, `/account/${accountId}/transactions${qs}`);
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/thirdparty/mercury/refresh
 * Keepalive ping — prevents Mercury token from expiring (30-day inactivity).
 * Body: { slug: "mgmt" } or query: ?slug=mgmt
 */
thirdpartyRoutes.post("/mercury/refresh", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const slug = body.slug || c.req.query("slug") || c.req.query("entity");
    const token = await getMercuryToken(c, slug);
    if (!token) {
      return c.json({ error: "Mercury API token not configured for " + (slug || "default") }, 503);
    }
    // Keepalive: just list accounts — any successful API call resets the 30-day timer
    const data = await mercuryFetch(token, "/accounts");
    return c.json({ ok: true, slug, accounts: data.accounts?.length || 0, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: error.message, slug: c.req.query("slug") }, 500);
  }
});

// Legacy aliases for ChittyFinance compatibility
// ChittyFinance calls /api/mercury/accounts → maps to /api/thirdparty/mercury/accounts
