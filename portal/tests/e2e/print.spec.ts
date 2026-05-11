// Beta test version v1.2.0
import { test, expect } from '@playwright/test'

const MOCK_DEVICES = {
  usb:      [],
  printers: [
    { name: 'HP-LaserJet', state: 'idle', stateReason: '', location: '', makeModel: 'HP', uri: 'ipp://localhost:631/printers/HP-LaserJet' },
  ],
}

test.describe('Print page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/v1/devices',       route => route.fulfill({ json: MOCK_DEVICES }))
    await page.route('/api/v1/printer/queue', route => route.fulfill({ json: { jobs: [], status: 'ok' } }))
    await page.route('/api/v1/printer/print', route => route.fulfill({ json: { ok: true, jobId: '42' } }))
    await page.goto('/print')
  })

  test('shows printer selector with mocked printer', async ({ page }) => {
    await expect(page.locator('select[id="printer-select"]')).toBeVisible()
    await expect(page.locator('option', { hasText: 'HP-LaserJet' })).toBeAttached()
  })

  test('Print button is disabled without a file', async ({ page }) => {
    const btn = page.getByRole('button', { name: /^print$/i })
    await expect(btn).toBeDisabled()
  })

  test('shows platform instruction tabs', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /macos/i }).or(
      page.getByText(/macos/i),
    )).toBeVisible()
  })

  test('switches platform tabs', async ({ page }) => {
    const windowsTab = page.getByRole('tab', { name: /windows/i }).or(
      page.getByText('Windows'),
    ).first()
    await windowsTab.click()
    await expect(page.getByText('IPP Everywhere', { exact: true })).toBeVisible()
  })
})
