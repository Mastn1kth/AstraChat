import { apiLogin, expect, test } from './fixtures.js'

test.describe('Authentication', () => {
  test('registration lands on the chat list', async ({ page }) => {
    await apiLogin(page)
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
  })

  test('legacy login with wrong password shows error', async ({ page }) => {
    await page.goto('/')
    await page.locator('button.astra-link').filter({ hasText: /Login with password|Вход по паролю/i }).click()
    await page.locator('.astra-legacy-login input').nth(0).fill('nonexistent_user_xyz')
    await page.locator('.astra-legacy-login input').nth(1).fill('wrongpassword')
    await page.locator('.astra-legacy-login button.astra-link').filter({ hasText: /Password login|Войти по паролю/i }).click()
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
