/**
 * Test-only entry Worker for the Workers-pool MCP agent runtime tests.
 *
 * It exists so the pool can bind McpConnectAgent as a real Durable Object and
 * so `SELF` drives the real `McpAgent.serve()` handler. It is NOT a mock: the
 * DO class, the `agents` SDK router and workerd are all the real ones. It
 * mirrors the production mount in src/index.js:2090 and deliberately carries
 * nothing else from src/index.js, so the rest of the worker's module scope
 * (Sentry, the OAuth provider, hono) stays out of the test runtime.
 */
import { McpConnectAgent } from "../../../src/mcp/agent.js";

export { McpConnectAgent };

// Module-scope mount, exactly as src/index.js:2090 does it.
const mcpAgentHandler = McpConnectAgent.serve("/mcp", { binding: "MCP_AGENT" });

export default {
  async fetch(request, env, ctx) {
    return mcpAgentHandler.fetch(request, env, ctx);
  },
};
