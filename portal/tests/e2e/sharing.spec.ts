import { test, expect } from '@playwright/test'

test.describe('Sharing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sharing')
  })

  test('shows Samba connection section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /file sharing/i })).toBeVisible()
  })

  test('shows NFS section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /nfs export/i })).toBeVisible()
  })

  test('shows Network Printing section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /network printing/i })).toBeVisible()
  })

  test('copy button triggers feedback', async ({ page }) => {
    const copyBtn = page.locator('button[aria-label*="Copy"]').first()
    if (await copyBtn.isVisible()) {
      await copyBtn.click()
      await expect(page.getByText(/copied|copy failed/i).first()).toBeVisible()
    }
  })
})
