import { apiLogin, expect, test } from './fixtures.js'

test.describe('Authentication', () => {
  test('test login 1 lands on the chat list', async ({ page }) => {
    await page.goto('/')
    // nth(1) skips QR button, clicks first test-login slot (language-agnostic)
    await page.locator('button.astra-qr-row').nth(1).click()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
  })

  test('legacy login with wrong password shows error', async ({ page }) => {
    await page.goto('/')
    await page.locator('button.astra-link', { hasText: 'Login with password' }).click()
    await page.locator('input[placeholder="login or username"]').fill('nonexistent_user_xyz')
    await page.locator('input[placeholder="password"]').fill('wrongpassword')
    await page.locator('button.astra-link', { hasText: 'Password login' }).click()
    await expect(page.locator('.astra-error, .toast, [class*="error"]').first()).toBeVisible({ timeout: 6000 })
  })

  test('logout returns to auth screen', async ({ page }) => {
    await apiLogin(page)

    await page.getByRole('button', { name: 'Menu' }).click()
    // Navigate into Settings sub-view, then click logout (last danger-menu-action)
    await page.locator('button').filter({ hasText: /settings|настройки/i }).first().click()
    await page.locator('button.danger-menu-action').last().click()

    await expect(page.locator('.astra-auth')).toBeVisible({ timeout: 5000 })
  })
})
