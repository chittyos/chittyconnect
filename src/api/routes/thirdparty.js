/**
 * Third-Party Integration Routes
 * Proxy for Notion, Neon, Google, OpenAI with 1Password Connect integration
 *
 * All credentials are retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { OnePasswordConnectClient } from "../../services/1password-connect-client.js";

const thirdpartyRoutes = new Hono();

/**
 * Helper function to get credential with 1Password fallback
 * @private
 */
async function getCredential(env, credentialPath, fallbackEnvVar) {
  try {
    const opClient = new OnePasswordConnectClient(env);
    const credential = await opClient.get(credentialPath);
    if (credential) return credential;
  } catch (error) {
    console.warn(
      `[ThirdParty] 1Password retrieval failed for ${credentialPath}, using fallback:`,
      error.message,
    );
  }

  // Fallback to environment variable
  return env[fallbackEnvVar];
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
      throw new Error(`Notion API error: ${response.status}`);
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
      throw new Error(`Notion API error: ${response.status}`);
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

    // Use Neon serverless driver
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

    const data = await response.json();
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
