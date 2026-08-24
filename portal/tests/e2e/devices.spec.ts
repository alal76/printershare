// Beta test version v1.2.0
import { test, expect } from '@playwright/test'

const MOCK_DEVICES = {
  usb: [
    { bus: '001', device: '003', vid: '03f0', pid: '2b17', vidpid: '03f0:2b17', name: 'HP LaserJet Pro M404n', make: 'HP', model: 'LaserJet Pro M404n', capabilities: { print: true, scan: false, escl: false, fax: false } },
    { bus: '001', device: '005', vid: '04b8', pid: '013c', vidpid: '04b8:013c', name: 'Epson Perfection V39',  make: 'Epson', model: 'Perfection V39', capabilities: { print: false, scan: true, escl: true, fax: false } },
  ],
  printers: [
    { name: 'HP-LaserJet', state: 'idle', stateReasons: [], location: 'Office', makeModel: 'HP LaserJet Pro', uri: 'ipp://localhost:631/printers/HP-LaserJet', hasDriver: true, driverName: 'HP LaserJet Pro' },
  ],
}

test.describe('Devices page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/v1/devices',              route => route.fulfill({ json: MOCK_DEVICES }))
    await page.route('/api/v1/devices/printer',      route => route.fulfill({ json: { ok: true } }))
    await page.route('/api/v1/devices/printer/**',   route => route.fulfill({ json: { ok: true } }))
    await page.goto('/devices')
  })

  test('shows CUPS printer card', async ({ page }) => {
    await expect(page.getByText('HP-LaserJet', { exact: true })).toBeVisible()
    await expect(page.getByText('idle', { exact: true })).toBeVisible()
  })

  test('shows USB device cards', async ({ page }) => {
    await expect(page.getByText('HP LaserJet Pro M404n')).toBeVisible()
    await expect(page.getByText('Epson Perfection V39')).toBeVisible()
  })

  test('shows correct capability badges', async ({ page }) => {
    const hpCard = page.locator('div.flex.items-center.gap-4.p-4').filter({
      has: page.getByText('HP LaserJet Pro M404n', { exact: true }),
    }).first()
    await expect(hpCard.locator('span.badge-blue', { hasText: 'Print' })).toBeVisible()

    const epsonCard = page.locator('div.flex.items-center.gap-4.p-4').filter({
      has: page.getByText('Epson Perfection V39', { exact: true }),
    }).first()
    await expect(epsonCard.locator('span.badge-green', { hasText: 'Scan' })).toBeVisible()
  })

  test('opens Add Printer modal', async ({ page }) => {
    await page.getByRole('button', { name: /add.*printer/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByPlaceholder(/ipp:\/\//i)).toBeVisible()
  })

  test('submits add printer form', async ({ page }) => {
    await page.getByRole('button', { name: /add.*printer/i }).click()
    await page.getByRole('textbox', { name: /name/i }).fill('Test-Printer')
    await page.getByPlaceholder(/ipp:\/\//i).fill('ipp://192.168.1.50/ipp/print')
    // Submit
    await page.getByRole('button', { name: /add printer/i }).last().click()
    // Dialog should close after success
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})
