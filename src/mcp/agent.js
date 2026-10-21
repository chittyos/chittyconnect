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

    // createMcpServer returns a fully configured McpServer with all registered tools
    this.server = createMcpServer(this.env, { baseUrl, authToken });

    // Runtime probe for tests/workers/mcp-agent-runtime.test.js. `this.props`
    // is populated by the Agents SDK lifecycle, so an SDK upgrade that moved
    // props or populated them after init() would silently leave authToken
    // undefined and drop the Authorization header in tool-dispatcher.js.
    // Records presence only — never the token value.
    this.initProbe = { baseUrl, authTokenPresent: Boolean(authToken) };
  }

  /**
   * Handle non-MCP HTTP requests routed to this Durable Object.
   *
   * GET /session — returns persisted session state from DO storage.
   * Called by the chitty://memory/session/{id} MCP resource handler
   * in src/api/routes/mcp.js (line ~166) via stub.fetch().
   */
  async onRequest(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/session") {
      const initializeRequest = await this.ctx.storage.get("initializeRequest");
      const props = await this.ctx.storage.get("props");

      return Response.json({
        sessionId: this.getSessionId(),
        active: !!initializeRequest,
        initializeRequest: initializeRequest || null,
        props: props || {},
        transport: this.getTransportType(),
      });
    }

    return super.onRequest(request);
  }
}
