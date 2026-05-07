import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for the **server** project (Express routes + services).
 * Runs in node so `require`, `process`, etc. are available.
 */
export default defineConfig({
  test: {
    name:        'server',
    environment: 'node',
    globals:     true,
    setupFiles:  ['tests/setup/server.js'],
    include:     [
      'tests/unit/server/**/*.{test,spec}.{ts,js}',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include:  ['server/**/*.js'],
      exclude:  ['server/index.js'],
      reporter: ['text', 'lcov', 'html'],
    },
  },
})
