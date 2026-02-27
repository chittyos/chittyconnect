import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js', 'src/**/__tests__/*.test.js'],
    exclude: ['tests/scenarios/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/mcp/**/*.js']
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
