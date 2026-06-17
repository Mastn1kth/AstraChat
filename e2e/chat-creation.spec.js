import { apiLogin, expect, test } from './fixtures.js'

test.describe('Chat creation', () => {
  test.beforeEach(async ({ page }) => apiLogin(page))

  test('compose button opens user search', async ({ page }) => {
    // Pencil / new-chat button in sidebar header
    await page.getByRole('button', { name: /new private chat/i }).click()
    // A contacts / user-picker panel should open
    await expect(page.locator('.side-menu, .menu-layer').first()).toBeVisible({ timeout: 5000 })
  })

  test('search bar accepts input and shows results', async ({ page }) => {
    const searchInput = page.locator('.search-row input, input[placeholder*="search" i], .search-input').first()
    await searchInput.click()
    // "Saved" matches the Saved Messages chat which always exists
    await searchInput.fill('Saved')
    await expect(page.locator('.chat-item').first()).toBeVisible({ timeout: 5000 })
  })

  test('chat list shows at least one chat item after login', async ({ page }) => {
    await expect(page.locator('.chat-item').first()).toBeVisible({ timeout: 5000 })
  })
})
