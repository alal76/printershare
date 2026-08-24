// Beta test version v1.2.0
import { test, expect } from '@playwright/test'

const MOCK_HEALTH = {
  status:  'ok',
  services: {
    cups:       { status: 'ok',      uptime: 3600 },
    scanservjs: { status: 'ok',      uptime: 3600 },
    samba:      { status: 'warning', uptime: 100  },
    nfs:        { status: 'ok',      uptime: 3600 },
  },
}

const MOCK_DEVICES = {
  usb:      [],
  printers: [{ name: 'HP-LaserJet', state: 'idle', stateReasons: [], location: '', makeModel: 'HP LaserJet Pro', uri: 'ipp://localhost:631/printers/HP-LaserJet', hasDriver: true, driverName: 'HP LaserJet Pro' }],
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API endpoints
    await page.route('/api/v1/health',   route => route.fulfill({ json: MOCK_HEALTH }))
    await page.route('/api/v1/devices',  route => route.fulfill({ json: MOCK_DEVICES }))
    await page.route('/api/v1/scans',    route => route.fulfill({ json: { files: [] } }))
    await page.route('/api/v1/printer/queue', route => route.fulfill({ json: { jobs: [], status: 'ok' } }))
    await page.goto('/dashboard')
  })

  test('renders stats bar', async ({ page }) => {
    // Stats cards should be visible
    await expect(page.getByText('Services', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Print Queue', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Printers' })).toBeVisible()
  })

  test('renders service health grid', async ({ page }) => {
    await expect(page.locator('[data-testid="service-cups"]')).toBeVisible()
    await expect(page.locator('[data-testid="service-scanservjs"]')).toBeVisible()
  })

  test('shows warning badge for degraded service', async ({ page }) => {
    // samba is 'warning' in mock
    const sambaCard = page.locator('[data-testid="service-samba"]')
    await expect(sambaCard).toBeVisible()
  })
})
