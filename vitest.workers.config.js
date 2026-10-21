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
      miniflare: {
        compatibilityDate: "2026-08-07",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["tests/workers/**/*.test.js"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
