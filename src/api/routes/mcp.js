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
 * GET /mcp/tools/list
 * List all available MCP tools (52 tools across 10 domains)
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
      // TODO: Wire to MCP Session Durable Object for real session memory retrieval
      return c.json(
        {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: "Session memory retrieval not yet implemented — requires Durable Object wiring",
            },
          ],
        },
        501,
      );
    } else if (uri === "chitty://credentials/audit") {
      // TODO: Wire to credential audit log (ChittyChronicle or KV-based audit trail)
      return c.json(
        {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: "Credential audit log not yet implemented",
            },
          ],
        },
        501,
      );
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
    // TODO: Wire to MCP Session Durable Object for real session persistence
    return c.json(
      {
        success: false,
        sessionId,
        error:
          "Session persistence not yet implemented — requires Durable Object wiring",
      },
      501,
    );
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
  // Extract request body (unused for now but kept for future implementation)
  await c.req.json();

  try {
    // TODO: Wire to Workers AI or proxy to OpenAI for real MCP sampling
    return c.json(
      {
        error:
          "MCP sampling not yet implemented — requires Workers AI or OpenAI proxy wiring",
      },
      501,
    );
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { mcpRoutes };
