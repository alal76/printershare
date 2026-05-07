import { defineConfig } from 'vitest/config'
import vue  from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

/**
 * Vitest configuration for the **client** project (Vue components + stores).
 * Runs in jsdom so browser APIs are available.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    name:        'client',
    environment: 'jsdom',
    globals:     true,
    setupFiles:  ['tests/setup/client.ts'],
    include:     [
      'tests/unit/stores/**/*.{test,spec}.ts',
      'tests/unit/components/**/*.{test,spec}.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include:  ['src/**/*.{ts,vue}'],
      exclude:  ['src/main.ts', 'src/router/**'],
      reporter: ['text', 'lcov', 'html'],
    },
  },
})
