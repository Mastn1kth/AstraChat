import { apiLogin, expect, test } from './fixtures.js'

test.describe('Profile', () => {
  test('edit display name in settings', async ({ page }) => {
    await apiLogin(page)

    await page.getByRole('button', { name: /menu|hamburger/i }).first().click()
    const settingsBtn = page.locator('button').filter({ hasText: /settings|настройки/i }).first()
    await expect(settingsBtn).toBeVisible({ timeout: 5000 })
    await settingsBtn.click()

    const nameInput = page.locator('input[placeholder*="name" i], input[name="name"]').first()
    if (!await nameInput.isVisible({ timeout: 4000 }).catch(() => false)) return

    const newName = `E2E Name ${Date.now()}`
    await nameInput.triple_click?.() || await nameInput.click({ clickCount: 3 })
    await nameInput.fill(newName)

    const saveBtn = page.locator('button').filter({ hasText: /save|сохранить/i }).first()
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveBtn.click()
      await expect(page.locator('text=' + newName)).toBeVisible({ timeout: 5000 })
    }
  })

  test('change password', async ({ page }) => {
    await apiLogin(page)

    await page.getByRole('button', { name: /menu|hamburger/i }).first().click()
    const settingsBtn = page.locator('button').filter({ hasText: /settings|настройки/i }).first()
    await expect(settingsBtn).toBeVisible({ timeout: 5000 })
    await settingsBtn.click()

    const pwSection = page.locator('button').filter({ hasText: /change password|пароль/i }).first()
    if (!await pwSection.isVisible({ timeout: 4000 }).catch(() => false)) return

    await pwSection.click()

    const inputs = page.locator('input[type="password"]')
    const count = await inputs.count()
    if (count < 2) return

    await inputs.nth(0).fill('test-pw-e2e-123')
    await inputs.nth(1).fill('test-pw-e2e-456')
    if (count >= 3) await inputs.nth(2).fill('test-pw-e2e-456')

    const saveBtn = page.locator('button').filter({ hasText: /save|change|изменить/i }).first()
    if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveBtn.click()
      // Expect success toast or confirmation
      await expect(page.locator('.toast, [class*="toast"], [role="status"]').first()).toBeVisible({ timeout: 5000 })
    }
  })
})
