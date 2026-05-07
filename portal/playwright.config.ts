import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for end-to-end tests.
 *
 * The web server started here is the **preview** build (Vite + Express).
 * API calls are mocked at the network layer via `page.route()` in each spec.
 */
export default defineConfig({
  testDir:    './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries:    process.env['CI'] ? 2 : 0,
  workers:    process.env['CI'] ? 1 : undefined,
  reporter:   process.env['CI'] ? 'dot' : 'list',

  use: {
    baseURL:        'http://localhost:4173',
    trace:          'on-first-retry',
    screenshot:     'only-on-failure',
  },

  projects: [
    {
      name:    'chromium',
      use:     { ...devices['Desktop Chrome'] },
    },
    {
      name:    'mobile-chrome',
      use:     { ...devices['Pixel 5'] },
    },
    {
      name:    'mobile-safari',
      use:     { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command:           'npm run preview',
    url:               'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout:           60_000,
  },
})
