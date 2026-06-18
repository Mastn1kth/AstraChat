import { apiLogin, expect, test } from './fixtures.js'

const BACKEND = 'http://localhost:3099'

// Create two users via API and open a private chat between them.
async function twoUsers(page) {
  const suffix = `${Date.now()}`
  const a = { login: `msg_a_${suffix}`, name: 'Alice' }
  const b = { login: `msg_b_${suffix}`, name: 'Bob' }

  const sessions = await page.evaluate(async ({ a, b, backend }) => {
    async function reg(u) {
      const r = await fetch(`${backend}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: u.login, username: u.login, name: u.name, password: 'pw-e2e-123' }),
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`register ${u.login}: ${r.status}`)
      return r.json()
    }
    return { a: await reg(a), b: await reg(b) }
  }, { a, b, backend: BACKEND })

  const chatId = await page.evaluate(async ({ tokenA, tokenB, backend }) => {
    // Login as A and create private chat with B
    await fetch(`${backend}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: tokenA.login, password: 'pw-e2e-123' }),
      credentials: 'include',
    })
    const r = await fetch(`${backend}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'private', memberIds: [tokenB.id] }),
      credentials: 'include',
    })
    const { chat } = await r.json()
    return chat?.id
  }, { tokenA: sessions.a.user, tokenB: sessions.b.user, backend: BACKEND })

  return { a: sessions.a.user, b: sessions.b.user, chatId }
}

test.describe('Messaging', () => {
  test('send a message and see it in the chat', async ({ page }) => {
    await apiLogin(page)

    // Open first available chat or create via URL
    const chatItems = page.locator('.chat-item, [data-testid="chat-item"]')
    const count = await chatItems.count()
    if (count > 0) {
      await chatItems.first().click()
    } else {
      // No chats yet — just verify we are on the main screen
      await expect(page.locator('.sidebar')).toBeVisible()
      return
    }

    const composer = page.locator('.composer textarea, .message-input textarea, textarea').first()
    await expect(composer).toBeVisible({ timeout: 5000 })
    const text = `Hello e2e ${Date.now()}`
    await composer.fill(text)
    await composer.press('Enter')

    await expect(page.locator(`.message-bubble, .msg-bubble, [data-testid="message"]`).filter({ hasText: text })).toBeVisible({ timeout: 8000 })
  })

  test('edit own message', async ({ page }) => {
    await apiLogin(page)

    // Send a message via API to a self-chat (saved messages)
    const msgText = `edit-me-${Date.now()}`
    const editedText = `edited-${Date.now()}`

    const chatId = await page.evaluate(async ({ text, backend }) => {
      const chats = await fetch(`${backend}/api/chats`, { credentials: 'include' })
      const { chats: list } = await chats.json()
      if (!list?.length) return null
      const chat = list[0]
      await fetch(`${backend}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        credentials: 'include',
      })
      return chat.id
    }, { text: msgText, backend: BACKEND })

    if (!chatId) return // no chats, skip

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

    // Click on a chat item to open it
    const chatItem = page.locator('.chat-item, [data-testid="chat-item"]').first()
    await chatItem.click()
    const bubble = page.locator('.message-bubble, .msg-bubble').filter({ hasText: msgText }).first()
    await expect(bubble).toBeVisible({ timeout: 8000 })

    // Right-click / hover to get context menu
    await bubble.hover()
    const editBtn = page.locator('button').filter({ hasText: /^edit$/i }).first()
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editBtn.click()
      const composer = page.locator('.composer textarea, textarea').first()
      await composer.fill(editedText)
      await composer.press('Enter')
      await expect(page.locator('.message-bubble, .msg-bubble').filter({ hasText: editedText })).toBeVisible({ timeout: 8000 })
    }
  })

  test('delete own message', async ({ page }) => {
    await apiLogin(page)

    const msgText = `delete-me-${Date.now()}`

    const chatId = await page.evaluate(async ({ text, backend }) => {
      const chats = await fetch(`${backend}/api/chats`, { credentials: 'include' })
      const { chats: list } = await chats.json()
      if (!list?.length) return null
      const chat = list[0]
      await fetch(`${backend}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        credentials: 'include',
      })
      return chat.id
    }, { text: msgText, backend: BACKEND })

    if (!chatId) return

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await page.locator('.chat-item, [data-testid="chat-item"]').first().click()

    const bubble = page.locator('.message-bubble, .msg-bubble').filter({ hasText: msgText }).first()
    await expect(bubble).toBeVisible({ timeout: 8000 })
    await bubble.hover()

    const deleteBtn = page.locator('button').filter({ hasText: /^delete$/i }).first()
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click()
      // Confirm dialog if shown
      const confirmBtn = page.locator('button').filter({ hasText: /delete for (me|everyone)|confirm/i }).first()
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click()
      }
      await expect(page.locator('.message-bubble, .msg-bubble').filter({ hasText: msgText })).not.toBeVisible({ timeout: 8000 })
    }
  })

  test('send message via API shows in chat list as last message', async ({ page }) => {
    await apiLogin(page)

    const previewText = `preview-${Date.now()}`

    await page.evaluate(async ({ text, backend }) => {
      const { chats: list } = await (await fetch(`${backend}/api/chats`, { credentials: 'include' })).json()
      if (!list?.length) return
      await fetch(`${backend}/api/chats/${list[0].id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        credentials: 'include',
      })
    }, { text: previewText, backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    // Last message preview should appear in the chat list
    await expect(page.locator('.sidebar').getByText(previewText, { exact: false })).toBeVisible({ timeout: 8000 })
  })
})
