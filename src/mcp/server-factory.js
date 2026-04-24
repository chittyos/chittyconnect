/**
 * MCP Server Factory
 *
 * Creates an McpServer instance with all ChittyConnect tools registered.
 * Uses the unified tool registry as the single source of truth.
 *
 * Used by:
 * - OAuth MCP transport (mcp.chitty.cc/mcp via createMcpHandler)
 * - ChatGPT Streamable HTTP (connect.chitty.cc/chatgpt/mcp via SDK transport)
 *
 * @module mcp/server-factory
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatchToolCall } from "./tool-dispatcher.js";
import { MCP_TOOL_DEFS } from "./tool-registry.js";

/**
 * Create a configured McpServer with all ChittyConnect tools.
 *
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] - Base URL for local API calls
 * @param {string} [opts.authToken] - Auth token to pass through to tool dispatcher
 * @returns {McpServer}
 */
export function createMcpServer(env, opts = {}) {
  const server = new McpServer(
    {
      name: "ChittyConnect",
      version: "2.1.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  const baseUrl = opts.baseUrl || "https://connect.chitty.cc";

  for (const def of MCP_TOOL_DEFS) {
    // schema is ZodRawShape (plain object) for most tools, or ZodEffects (from anyOf
    // superRefine) for tools where at least one of several keys must be present.
    const hasAnyOf = def.schema instanceof z.ZodType;
    const rawShape = hasAnyOf ? def.schema._def.schema.shape : def.schema;

    server.tool(
      def.name,
      def.description,
      rawShape,
      def.annotations,
      async (args) => {
        if (hasAnyOf) {
          const result = def.schema.safeParse(args);
          if (!result.success) {
            const msg = result.error.issues.map((i) => i.message).join("; ");
            return { content: [{ type: "text", text: msg }], isError: true };
          }
        }
        return await dispatchToolCall(def.name, args, env, {
          baseUrl,
          authToken: opts.authToken,
        });
      },
    );
  }

  return server;
}
