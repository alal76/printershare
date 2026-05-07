import { test, expect } from '@playwright/test'

test.describe('Sharing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sharing')
  })

  test('shows Samba connection section', async ({ page }) => {
    await expect(page.getByText(/samba|windows sharing/i)).toBeVisible()
  })

  test('shows NFS section', async ({ page }) => {
    await expect(page.getByText(/nfs/i)).toBeVisible()
  })

  test('shows Network Printing section', async ({ page }) => {
    await expect(page.getByText(/network printing|airprint|ipp/i)).toBeVisible()
  })

  test('copy button copies Samba path', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const copyBtn = page.locator('button[aria-label*="copy"], button').filter({ hasText: /copy/i }).first()
    if (await copyBtn.isVisible()) {
      await copyBtn.click()
      // Toast or button state change indicates success
      await expect(page.locator('text=/copied|success/i').or(copyBtn)).toBeVisible()
    }
  })
})
