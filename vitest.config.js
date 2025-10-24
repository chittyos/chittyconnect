/**
 * Vitest Configuration for ChittyConnect
 *
 * Main test configuration using Cloudflare Workers pool
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
        miniflare: {
          // Bindings to use in tests
          bindings: {
            // Environment variables
            ENVIRONMENT: 'test',
            SERVICE_VERSION: '1.0.0-test',

            // ChittyOS service URLs (mock)
            CHITTY_ID_SERVICE: 'https://id.chitty.test',
            CHITTY_AUTH_SERVICE: 'https://auth.chitty.test',
            CHITTY_REGISTRY_SERVICE: 'https://registry.chitty.test',
            CHITTY_DNA_SERVICE: 'https://dna.chitty.test',
            CHITTY_VERIFY_SERVICE: 'https://verify.chitty.test',
            CHITTY_CERTIFY_SERVICE: 'https://certify.chitty.test',
            CHITTY_CHRONICLE_SERVICE: 'https://chronicle.chitty.test',

            // Mock tokens
            CHITTY_ID_SERVICE_TOKEN: 'test-token-id',
            CHITTY_AUTH_SERVICE_TOKEN: 'test-token-auth',
            CHITTY_REGISTRY_SERVICE_TOKEN: 'test-token-registry',
            CHITTY_DNA_SERVICE_TOKEN: 'test-token-dna',
            CHITTY_VERIFY_SERVICE_TOKEN: 'test-token-verify',
            CHITTY_CERTIFY_SERVICE_TOKEN: 'test-token-certify',
            CHITTY_CHRONICLE_SERVICE_TOKEN: 'test-token-chronicle',
          },
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.js',
        '**/*.spec.js',
        'scripts/',
        'migrations/',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist', '.wrangler'],
    testTimeout: 10000,
  },
});
