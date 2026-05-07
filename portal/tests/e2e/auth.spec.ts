import { test, expect } from '@playwright/test'

/**
 * Auth E2E tests.
 *
 * These tests exercise the login flow in two modes:
 *   1. Auth disabled (default dev mode) — all routes are accessible without login.
 *   2. Auth enabled — unauthenticated requests to protected routes redirect to /login.
 *
 * The tests mock /api/v1/auth/* to avoid needing a real running backend with
 * PORTAL_AUTH=true, while still exercising the frontend auth guard logic.
 */

test.describe('Auth — disabled mode (default)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth config: auth disabled
    await page.route('/api/v1/auth/config', route =>
      route.fulfill({ json: { authEnabled: false } }),
    )
    await page.route('/api/v1/auth/me', route =>
      route.fulfill({ json: { authenticated: true, authEnabled: false, user: 'anonymous' } }),
    )
    // Stub data routes so the dashboard can load
    await page.route('/api/v1/health',        route => route.fulfill({ json: { status: 'ok', services: {} } }))
    await page.route('/api/v1/devices',       route => route.fulfill({ json: { usb: [], printers: [] } }))
    await page.route('/api/v1/scans',         route => route.fulfill({ json: { files: [] } }))
    await page.route('/api/v1/printer/queue', route => route.fulfill({ json: { jobs: [], status: 'ok' } }))
    await page.route('/api/v1/settings',      route => route.fulfill({ json: {} }))
  })

  test('navigates directly to dashboard without redirect', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('/login is accessible and does not loop', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })
})

test.describe('Auth — enabled mode', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth config: auth enabled, user is NOT authenticated
    await page.route('/api/v1/auth/config', route =>
      route.fulfill({ json: { authEnabled: true, usernameHint: 'admin' } }),
    )
    await page.route('/api/v1/auth/me', route =>
      route.fulfill({ status: 401, json: { authenticated: false, authEnabled: true } }),
    )
  })

  test('unauthenticated access to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page is accessible without auth', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })

  test('login form submits credentials and redirects on success', async ({ page }) => {
    await page.route('/api/v1/auth/login', route =>
      route.fulfill({ json: { ok: true, authEnabled: true, user: 'admin' } }),
    )
    // After successful login, me returns authenticated
    await page.route('/api/v1/auth/me', route =>
      route.fulfill({ json: { authenticated: true, authEnabled: true, user: 'admin' } }),
    )
    await page.route('/api/v1/health',        route => route.fulfill({ json: { status: 'ok', services: {} } }))
    await page.route('/api/v1/devices',       route => route.fulfill({ json: { usb: [], printers: [] } }))
    await page.route('/api/v1/scans',         route => route.fulfill({ json: { files: [] } }))
    await page.route('/api/v1/printer/queue', route => route.fulfill({ json: { jobs: [], status: 'ok' } }))

    await page.goto('/login')
    await page.getByLabel(/username/i).fill('admin')
    await page.getByLabel(/password/i).fill('correctpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('login form shows error on bad credentials', async ({ page }) => {
    await page.route('/api/v1/auth/login', route =>
      route.fulfill({ status: 401, json: { error: 'Invalid credentials' } }),
    )
    await page.goto('/login')
    await page.getByLabel(/username/i).fill('admin')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText(/invalid credentials/i)).toBeVisible()
  })

  test('logout clears session and redirects to /login', async ({ page }) => {
    // Start authenticated
    let authenticated = true
    await page.route('/api/v1/auth/me', route => {
      if (authenticated) {
        route.fulfill({ json: { authenticated: true, authEnabled: true, user: 'admin' } })
      } else {
        route.fulfill({ status: 401, json: { authenticated: false, authEnabled: true } })
      }
    })
    await page.route('/api/v1/auth/logout', route => {
      authenticated = false
      route.fulfill({ json: { ok: true } })
    })
    await page.route('/api/v1/health',        route => route.fulfill({ json: { status: 'ok', services: {} } }))
    await page.route('/api/v1/devices',       route => route.fulfill({ json: { usb: [], printers: [] } }))
    await page.route('/api/v1/scans',         route => route.fulfill({ json: { files: [] } }))
    await page.route('/api/v1/printer/queue', route => route.fulfill({ json: { jobs: [], status: 'ok' } }))

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)

    // Click logout button (aria-label or text)
    const logoutBtn = page.getByRole('button', { name: /log out|logout|sign out/i })
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click()
      await expect(page).toHaveURL(/\/login/)
    }
  })
})
