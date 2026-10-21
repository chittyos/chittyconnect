// Workers-runtime test project. Runs tests that must load modules which only
// resolve inside workerd (cloudflare:workers / cloudflare:email, pulled in by
// @cloudflare/workers-oauth-provider and agents). The Node-based suite in
// vitest.config.js stays as it is and excludes tests/workers/**.
//
// The Worker is configured through miniflare options rather than
// wrangler.jsonc: the tests import modules directly and need only the
// runtime, not the deployed bindings.
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // A test-only entry Worker (not src/index.js) so the pool can bind
      // McpConnectAgent as a real Durable Object and SELF can drive the real
      // McpAgent.serve() handler. Keeping src/index.js out of `main` keeps the
      // rest of its module scope out of the test runtime.
      main: "tests/workers/fixtures/mcp-agent-worker.js",
      miniflare: {
        compatibilityDate: "2026-08-07",
        compatibilityFlags: ["nodejs_compat"],
        // useSQLite: the agents SDK Agent base class stores state in
        // ctx.storage.sql.
        durableObjects: {
          MCP_AGENT: { className: "McpConnectAgent", useSQLite: true },
        },
      },
    }),
  ],
  test: {
    include: ["tests/workers/**/*.test.js"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
