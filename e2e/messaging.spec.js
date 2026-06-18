import { apiLogin, expect, test } from './fixtures.js'

async function openSavedMessages(page) {
  // Dismiss permission onboarding if present
  const later = page.locator('button', { hasText: /later/i })
  if (await later.isVisible({ timeout: 2_000 }).catch(() => false)) await later.click()
  await page.locator('.chat-item').first().click()
  await expect(page.locator('.composer, footer.composer')).toBeVisible({ timeout: 5000 })
}

test.describe('Messaging', () => {
  test.beforeEach(async ({ page }) => apiLogin(page))

  test('opens Saved Messages and sends a text message', async ({ page }) => {
    await openSavedMessages(page)

    const composer = page.locator('.composer textarea, textarea').first()
    await composer.fill('Hello from e2e test 🚀')
    await page.keyboard.press('Enter')

    await expect(
      page.locator('.message-bubble', { hasText: 'Hello from e2e test 🚀' }),
    ).toBeVisible({ timeout: 8000 })
  })

  test('unique message appears in the chat after sending', async ({ page }) => {
    await openSavedMessages(page)

    const uniqueText = `e2e-${Date.now()}`
    const composer = page.locator('.composer textarea, textarea').first()
    await composer.fill(uniqueText)
    await page.keyboard.press('Enter')

    await expect(
      page.locator('.message-bubble', { hasText: uniqueText }),
    ).toBeVisible({ timeout: 8000 })
  })
})
