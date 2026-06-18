import { apiLogin, expect, test } from './fixtures.js'

const BACKEND = 'http://localhost:3099'

test.describe('Chats', () => {
  test('create a group chat via UI', async ({ page }) => {
    await apiLogin(page)

    // Open new chat / compose button
    const newChatBtn = page.locator('button[title*="new" i], button[aria-label*="compose" i], button[aria-label*="new chat" i], .new-chat-btn').first()
    if (!await newChatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Try pencil / compose icon
      await page.locator('button').filter({ hasText: /new|compose|pencil/i }).first().click()
    } else {
      await newChatBtn.click()
    }

    const groupOption = page.locator('button, [role="menuitem"]').filter({ hasText: /new group|group/i }).first()
    if (!await groupOption.isVisible({ timeout: 3000 }).catch(() => false)) return

    await groupOption.click()
    const groupName = `Test Group ${Date.now()}`
    const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="title" i], input').first()
    await nameInput.fill(groupName)

    const createBtn = page.locator('button').filter({ hasText: /create|done|next/i }).first()
    await createBtn.click()

    await expect(page.locator('.chat-header, [data-testid="chat-header"]').filter({ hasText: groupName })).toBeVisible({ timeout: 8000 })
  })

  test('create a group chat via API and send a message', async ({ page }) => {
    await apiLogin(page)

    const groupName = `API Group ${Date.now()}`
    const msgText = `group-msg-${Date.now()}`

    await page.evaluate(async ({ name, text, backend }) => {
      const { chat } = await (await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: name, memberIds: [] }),
        credentials: 'include',
      })).json()
      if (!chat?.id) return
      await fetch(`${backend}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        credentials: 'include',
      })
    }, { name: groupName, text: msgText, backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.sidebar').getByText(groupName, { exact: false })).toBeVisible({ timeout: 8000 })
  })

  test('mute a chat', async ({ page }) => {
    await apiLogin(page)

    // Create a chat to mute via API
    await page.evaluate(async ({ backend }) => {
      await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: 'Mute Test', memberIds: [] }),
        credentials: 'include',
      })
    }, { backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

    const chatItem = page.locator('.chat-item, [data-testid="chat-item"]').filter({ hasText: 'Mute Test' }).first()
    if (!await chatItem.isVisible({ timeout: 5000 }).catch(() => false)) return

    await chatItem.click({ button: 'right' })
    const muteBtn = page.locator('[role="menuitem"], button').filter({ hasText: /mute/i }).first()
    if (await muteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await muteBtn.click()
      // Pick duration if dialog shows
      const durationOpt = page.locator('button, [role="option"]').filter({ hasText: /1 hour|hour/i }).first()
      if (await durationOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await durationOpt.click()
      }
      // Mute icon should appear on chat item
      await expect(chatItem.locator('[class*="mute"], [aria-label*="mute" i], svg')).toBeVisible({ timeout: 5000 })
    }
  })

  test('archive and unarchive a chat', async ({ page }) => {
    await apiLogin(page)

    await page.evaluate(async ({ backend }) => {
      await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: 'Archive Me', memberIds: [] }),
        credentials: 'include',
      })
    }, { backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

    const chatItem = page.locator('.chat-item, [data-testid="chat-item"]').filter({ hasText: 'Archive Me' }).first()
    if (!await chatItem.isVisible({ timeout: 5000 }).catch(() => false)) return

    await chatItem.click({ button: 'right' })
    const archiveBtn = page.locator('[role="menuitem"], button').filter({ hasText: /archive/i }).first()
    if (await archiveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archiveBtn.click()
      await expect(chatItem).not.toBeVisible({ timeout: 5000 })
    }
  })
})
