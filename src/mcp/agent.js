/**
 * McpConnectAgent — Durable Object MCP agent for ChittyConnect
 *
 * Extends McpAgent from the Cloudflare Agents SDK to provide SSE + Streamable HTTP
 * transports backed by Durable Object session persistence.
 *
 * Replaces the stub MCPSessionDurableObject and the stateless createMcpHandler()
 * call. All 52 tools are registered via the existing createMcpServer() factory.
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/mcp/agent
 */

import { McpAgent } from "agents/mcp";
import { createMcpServer } from "./server-factory.js";

export class McpConnectAgent extends McpAgent {
  async init() {
    const baseUrl = this.props?.baseUrl || "https://connect.chitty.cc";
    const authToken = this.props?.authToken;

    // createMcpServer returns a fully configured McpServer with all 52 tools
    this.server = createMcpServer(this.env, { baseUrl, authToken });
  }
}
