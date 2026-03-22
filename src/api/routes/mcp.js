/**
 * ChittyConnect MCP API Routes
 *
 * Model Context Protocol endpoints for Claude Desktop/Code integration.
 * Provides tools, resources, prompts, and session management.
 *
 * Tool definitions are imported from the unified tool registry.
 * @see src/mcp/tool-registry.js
 */

import { Hono } from "hono";
import { dispatchToolCall } from "../../mcp/tool-dispatcher.js";
import { MCP_TOOLS } from "../../mcp/tool-registry.js";

const mcpRoutes = new Hono();

const HTTP_STATUS_PATTERN = /\((\d{3})\)(?::|$)/;

function getResultMessage(result) {
  if (!Array.isArray(result?.content)) return "";
  const textItem = result.content.find(
    (item) => item?.type === "text" && typeof item.text === "string",
  );
  return textItem?.text || "";
}

/** @visibleForTesting */
export function resolveInternalBaseUrl(requestUrl) {
  const url = new URL(requestUrl);
  const internalHost = url.hostname.replace(/^mcp\./, "connect.");
  return `${url.protocol}//${internalHost}`;
}

/** @visibleForTesting */
export function deriveToolErrorStatus(result) {
  const msg = getResultMessage(result);

  if (msg.includes("Unknown tool")) return 400;
  if (msg.includes("Permission denied")) return 403;
  if (
    msg.includes("Authentication required") ||
    msg.includes("Missing API key") ||
    msg.includes("Invalid API key")
  ) {
    return 401;
  }
  if (msg.includes("Rate limit exceeded")) return 429;

  const statusMatch = msg.match(HTTP_STATUS_PATTERN);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status >= 400 && status <= 599) return status;
  }

  return 500;
}

/**
 * GET /mcp/manifest
 * MCP server manifest (unauthenticated)
 */
mcpRoutes.get("/manifest", (c) => {
  return c.json({
    name: "chittyconnect",
    version: "2.2.0",
    description:
      "ChittyConnect MCP Server — ContextConsciousness™ & MemoryCloude™",
    protocol: "mcp",
    tools: MCP_TOOLS.length,
    capabilities: ["tools", "resources", "sampling", "session"],
    endpoints: {
      tools: "/mcp/tools/list",
      call: "/mcp/tools/call",
      resources: "/mcp/resources/list",
      session: "/mcp/session/persist",
      sampling: "/mcp/sampling/sample",
    },
  });
});

/**
 * GET /mcp/tools/list
 * List all available MCP tools
 */
mcpRoutes.get("/tools/list", async (c) => {
  return c.json({ tools: MCP_TOOLS });
});

/**
 * POST /mcp/tools/call
 * Execute an MCP tool
 */
mcpRoutes.post("/tools/call", async (c) => {
  const { name, arguments: args, context } = await c.req.json();
  const baseUrl = resolveInternalBaseUrl(c.req.url);
  const authToken = (c.req.header("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );

  const result = await dispatchToolCall(name, args, c.env, {
    baseUrl,
    authToken,
    context,
  });

  if (result.isError) {
    const status = deriveToolErrorStatus(result);
    return c.json(result, status);
  }
  return c.json(result);
});

/**
 * GET /mcp/resources/list
 * List available MCP resources
 */
mcpRoutes.get("/resources/list", async (c) => {
  // NOTE: These are MCP transport resource URIs, distinct from chittycanon:// canonical identifiers.
  // chitty:// is used here as the MCP resource scheme; chittycanon:// is for governed document identifiers.
  return c.json({
    resources: [
      {
        uri: "chitty://ecosystem/status",
        name: "Ecosystem Status",
        description: "Real-time status of all ChittyOS services",
        mimeType: "application/json",
      },
      {
        uri: "chitty://memory/session/{id}",
        name: "Session Memory",
        description: "MemoryCloude™ session context and history",
        mimeType: "application/json",
      },
      {
        uri: "chitty://credentials/audit",
        name: "Credential Audit Log",
        description: "Credential access patterns and security posture",
        mimeType: "application/json",
      },
    ],
  });
});

/**
 * GET /mcp/resources/read
 * Read an MCP resource
 */
mcpRoutes.get("/resources/read", async (c) => {
  const uri = c.req.query("uri");

  try {
    let content;

    if (uri === "chitty://ecosystem/status") {
      const response = await fetch(
        `${resolveInternalBaseUrl(c.req.url)}/api/services/status`,
        {
          headers: { Authorization: c.req.header("Authorization") },
        },
      );
      if (!response.ok) {
        return c.json({
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Ecosystem status unavailable (${response.status})`,
            },
          ],
        });
      }
      content = await response.text();
    } else if (uri.startsWith("chitty://memory/session/")) {
      const sessionId = uri.replace("chitty://memory/session/", "");
      if (!sessionId) {
        return c.json(
          {
            contents: [
              { uri, mimeType: "text/plain", text: "Missing session ID" },
            ],
          },
          400,
        );
      }
      try {
        const doId = c.env.MCP_AGENT.idFromName(sessionId);
        const stub = c.env.MCP_AGENT.get(doId);
        const doResponse = await stub.fetch(
          new Request("https://do/session", { method: "GET" }),
        );
        if (!doResponse.ok) {
          return c.json(
            {
              contents: [
                {
                  uri,
                  mimeType: "text/plain",
                  text: `Session ${sessionId} not found`,
                },
              ],
            },
            404,
          );
        }
        content = await doResponse.text();
      } catch (err) {
        return c.json(
          {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text: `Session lookup failed: ${err.message}`,
              },
            ],
          },
          500,
        );
      }
    } else if (uri === "chitty://credentials/audit") {
      const chronicleToken = c.env.CHITTY_CHRONICLE_TOKEN;
      if (!chronicleToken) {
        return c.json(
          {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text: "Credential audit unavailable — CHITTY_CHRONICLE_TOKEN not configured",
              },
            ],
          },
          503,
        );
      }
      try {
        const auditResponse = await fetch(
          "https://chronicle.chitty.cc/api/audit/credentials",
          { headers: { Authorization: `Bearer ${chronicleToken}` } },
        );
        if (!auditResponse.ok) {
          return c.json(
            {
              contents: [
                {
                  uri,
                  mimeType: "text/plain",
                  text: `Chronicle returned ${auditResponse.status}`,
                },
              ],
            },
            auditResponse.status >= 500 ? 502 : auditResponse.status,
          );
        }
        content = await auditResponse.text();
      } catch (err) {
        return c.json(
          {
            contents: [
              {
                uri,
                mimeType: "text/plain",
                text: `Chronicle unreachable: ${err.message}`,
              },
            ],
          },
          502,
        );
      }
    } else {
      return c.json(
        {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Unknown resource: ${uri}`,
            },
          ],
        },
        404,
      );
    }

    return c.json({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content,
        },
      ],
    });
  } catch (error) {
    return c.json(
      {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `Error reading resource: ${error.message}`,
          },
        ],
      },
      500,
    );
  }
});

/**
 * POST /mcp/session/persist
 * Persist session data to MemoryCloude™
 */
mcpRoutes.post("/session/persist", async (c) => {
  const { sessionId } = await c.req.json();

  try {
    return c.json({
      success: true,
      sessionId,
      message:
        "Session persistence is handled automatically by McpConnectAgent Durable Object",
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
});

/**
 * POST /mcp/sampling/sample
 * MCP sampling support for advanced features
 */
mcpRoutes.post("/sampling/sample", async (c) => {
  const { messages, modelPreferences, systemPrompt, maxTokens } =
    await c.req.json();

  if (!c.env.AI) {
    return c.json({ error: "Workers AI binding not configured" }, 503);
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages array is required" }, 400);
  }

  try {
    const aiMessages = [];
    if (systemPrompt) {
      aiMessages.push({ role: "system", content: systemPrompt });
    }
    for (const msg of messages) {
      const textContent =
        typeof msg.content === "string"
          ? msg.content
          : msg.content?.text || JSON.stringify(msg.content);
      aiMessages.push({ role: msg.role, content: textContent });
    }

    const model =
      modelPreferences?.hints?.[0]?.name || "@cf/meta/llama-3.1-8b-instruct";

    const aiResult = await c.env.AI.run(model, {
      messages: aiMessages,
      max_tokens: maxTokens || 1024,
    });

    return c.json({
      model,
      role: "assistant",
      content: { type: "text", text: aiResult.response },
      stopReason: "endTurn",
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { mcpRoutes };
