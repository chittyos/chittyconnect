/**
 * ChatGPT Developer Mode MCP Server Factory
 *
 * Creates an McpServer instance with all ChittyConnect tools registered.
 * Uses the unified tool registry as the single source of truth.
 * Used with WebStandardStreamableHTTPServerTransport for ChatGPT integration.
 *
 * @module mcp/chatgpt-server
 */

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
export function createChatGPTMcpServer(env, opts = {}) {
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
    server.tool(
      def.name,
      def.description,
      def.schema,
      def.annotations,
      async (args) => {
        return await dispatchToolCall(def.name, args, env, {
          baseUrl,
          authToken: opts.authToken,
        });
      },
    );
  }

  return server;
}
