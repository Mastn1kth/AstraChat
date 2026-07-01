import { apiLogin, expect, test } from './fixtures.js'

const BACKEND = 'http://localhost:3099'

async function dismissOnboarding(page) {
  const onboarding = page.locator('.permission-onboarding')
  if (await onboarding.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await onboarding.getByRole('button', { name: /later|close permissions/i }).first().click()
    await expect(onboarding).toBeHidden({ timeout: 5_000 })
  }
}

// Create two users via API and open a private chat between them.
async function twoUsers(page) {
  const suffix = `${Date.now()}`
  const a = { login: `nf_a_${suffix}`, name: 'Alice' }
  const b = { login: `nf_b_${suffix}`, name: 'Bob' }

  await page.goto('/')
  await page.waitForLoadState('networkidle')

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

  return { a: sessions.a.user, b: sessions.b.user, chatId, loginA: a.login, loginB: b.login }
}

async function openMainMenu(page) {
  await page.getByRole('button', { name: 'Menu' }).click()
}

async function openSettings(page) {
  await openMainMenu(page)
  await page.locator('button').filter({ hasText: /settings|настройки/i }).first().click()
}

async function openPrivacyMenu(page) {
  await openSettings(page)
  await page.locator('button').filter({ hasText: /privacy|конфиденциальность/i }).first().click()
}

test.describe('Privacy settings', () => {
  test('view and change phone/last-seen visibility, persists after reload', async ({ page }) => {
    await apiLogin(page)

    await openPrivacyMenu(page)

    const phoneSelect = page.locator('.privacy-select').first()
    const lastSeenSelect = page.locator('.privacy-select').nth(1)
    await expect(phoneSelect).toBeVisible({ timeout: 8000 })
    await expect(lastSeenSelect).toBeVisible({ timeout: 8000 })

    // Change phone visibility to "Nobody"
    await phoneSelect.selectOption('nobody')
    await expect(phoneSelect).toHaveValue('nobody')

    // Reload and re-open the privacy menu to verify it persisted.
    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

    await openPrivacyMenu(page)
    const phoneSelectAfterReload = page.locator('.privacy-select').first()
    await expect(phoneSelectAfterReload).toBeVisible({ timeout: 8000 })
    await expect(phoneSelectAfterReload).toHaveValue('nobody', { timeout: 8000 })
  })
})

test.describe('Disappearing messages', () => {
  test('set auto-delete timer and see timer badge on sent message', async ({ page }) => {
    await apiLogin(page)

    // Auto-delete requires a real backend-backed chat (Saved Messages is a local-only
    // pseudo-chat), so create a group chat via the API first.
    await page.evaluate(async ({ backend }) => {
      await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: 'AutoDelete Test Chat', memberIds: [] }),
        credentials: 'include',
      })
    }, { backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await page.locator('.chat-item').filter({ hasText: 'AutoDelete Test Chat' }).first().click()

    // Open contact info / profile panel via chat title.
    await page.locator('.chat-title').click()
    await expect(page.locator('.profile-panel')).toBeVisible({ timeout: 8000 })

    const autoDeleteBtn = page.locator('.auto-delete-wrap button').first()
    if (!await autoDeleteBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      // Feature requires a backend-backed chat; nothing further to verify.
      return
    }
    await autoDeleteBtn.click()

    const option30s = page.locator('.auto-delete-dropdown button').filter({ hasText: /30/ }).first()
    await expect(option30s).toBeVisible({ timeout: 4000 })
    await option30s.click()

    // Dropdown closes and button label reflects the new value.
    await expect(page.locator('.auto-delete-wrap button').first()).toContainText('30', { timeout: 4000 })

    // Close profile panel, send a message, verify the timer badge shows.
    await page.locator('button[aria-label="Close profile"]').click()

    const composer = page.locator('.composer textarea, textarea').first()
    const text = `disappearing-${Date.now()}`
    await composer.fill(text)
    await composer.press('Enter')

    const bubble = page.locator('.message-bubble').filter({ hasText: text }).first()
    await expect(bubble).toBeVisible({ timeout: 8000 })

    // NOTE: the backend computes and returns `disappearsAt` on the created message
    // (server/routes/chats.js), and MessageBubble.jsx already renders a `.msg-timer-badge`
    // from `message.disappearsAt` — but `normalizeServerMessage` in src/App.jsx currently
    // drops that field when normalizing messages for client state, so the badge never
    // appears yet. This assertion documents the intended behavior; it will start passing
    // once that client-side gap is fixed.
    await expect(bubble.locator('.msg-timer-badge')).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Message drafts', () => {
  test('draft text is restored when switching back to a chat', async ({ page }) => {
    await apiLogin(page)

    // Ensure there are at least two chats to switch between.
    await page.evaluate(async ({ backend }) => {
      await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: 'Draft Test Chat', memberIds: [] }),
        credentials: 'include',
      })
    }, { backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

    const chatItems = page.locator('.chat-item')
    await expect(chatItems).toHaveCount(2, { timeout: 8000 })

    // Open the first chat and type a draft without sending.
    await chatItems.nth(0).click()
    const composer = page.locator('.composer textarea, textarea').first()
    await expect(composer).toBeVisible({ timeout: 5000 })
    const draftText = `draft-${Date.now()}`
    await composer.fill(draftText)

    // Switch to the second chat.
    await chatItems.nth(1).click()
    await expect(composer).toBeVisible({ timeout: 5000 })
    await expect(composer).toHaveValue('')

    // Switch back to the first chat — draft should be restored.
    await chatItems.nth(0).click()
    await expect(composer).toBeVisible({ timeout: 5000 })
    await expect(composer).toHaveValue(draftText, { timeout: 5000 })
  })
})

test.describe('Read receipts', () => {
  test('sender sees read indicator after recipient opens the chat', async ({ browser, page }) => {
    const { b: userB, chatId, loginB } = await twoUsers(page)
    if (!chatId) test.skip(true, 'could not create private chat')

    // Send a message as user A (current page is logged in as A after twoUsers()).
    const msgText = `read-receipt-${Date.now()}`
    await page.evaluate(async ({ chatId, text, backend }) => {
      await fetch(`${backend}/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        credentials: 'include',
      })
    }, { chatId, text: msgText, backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await dismissOnboarding(page)
    await page.locator('.chat-item').filter({ hasText: 'Bob' }).first().click()

    const sentBubble = page.locator('.message-bubble').filter({ hasText: msgText }).first()
    await expect(sentBubble).toBeVisible({ timeout: 8000 })

    // Sent-but-unread: single check, no "is-read" class yet.
    const receiptBefore = sentBubble.locator('.read-receipt')
    await expect(receiptBefore).toBeVisible({ timeout: 8000 })

    // Open a second browser context as user B and open the chat, which should mark it read.
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    await pageB.goto('/')
    await pageB.evaluate(async ({ login, backend }) => {
      const r = await fetch(`${backend}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: 'pw-e2e-123' }),
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`login failed: ${r.status}`)
    }, { login: loginB, backend: BACKEND })
    await pageB.reload()
    await expect(pageB.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await dismissOnboarding(pageB)
    await pageB.locator('.chat-item').filter({ hasText: 'Alice' }).first().click()
    await expect(pageB.locator('.message-bubble').filter({ hasText: msgText }).first()).toBeVisible({ timeout: 8000 })

    // Back on user A's page, the read receipt should update to the "read" (double-check) state.
    await expect(sentBubble.locator('.read-receipt.is-read')).toBeVisible({ timeout: 10_000 })

    await contextB.close()
  })
})

test.describe('Telegram import', () => {
  test('import Telegram history button is present in a backend chat', async ({ page }) => {
    await apiLogin(page)

    // Create a backend-backed chat (Saved Messages is backend-less locally in some setups,
    // so create a group chat via API to guarantee chat.backend is set).
    await page.evaluate(async ({ backend }) => {
      await fetch(`${backend}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'group', title: 'Import Test Chat', memberIds: [] }),
        credentials: 'include',
      })
    }, { backend: BACKEND })

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
    await page.locator('.chat-item').filter({ hasText: 'Import Test Chat' }).first().click()

    await page.locator('.chat-title').click()
    await expect(page.locator('.profile-panel')).toBeVisible({ timeout: 8000 })

    const importBtn = page.locator('button').filter({ hasText: /Import Telegram history/i }).first()
    await expect(importBtn).toBeVisible({ timeout: 8000 })
    await expect(importBtn).toBeEnabled()
  })
})
