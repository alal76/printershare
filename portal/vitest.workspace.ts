import { defineWorkspace } from 'vitest/config'

/**
 * Vitest workspace — runs client (jsdom) and server (node) projects in parallel.
 * E2E tests live in tests/e2e/ and are run separately by Playwright (`npm run test:e2e`).
 */
export default defineWorkspace([
  {
    extends: './vitest.client.config.ts',
    test: {
      include: [
        'tests/unit/stores/**/*.{test,spec}.ts',
        'tests/unit/components/**/*.{test,spec}.ts',
      ],
      exclude: ['tests/e2e/**', 'node_modules/**'],
    },
  },
  {
    extends: './vitest.server.config.ts',
    test: {
      include: [
        'tests/unit/server/**/*.{test,spec}.{ts,js}',
      ],
      exclude: ['tests/e2e/**', 'node_modules/**'],
    },
  },
])
