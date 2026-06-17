import { test, expect } from '@playwright/test'

export async function apiLogin(page, slot = 1) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (s) => {
    const resp = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: s }),
      credentials: 'include',
    })
    if (!resp.ok) throw new Error(`test-login failed: ${resp.status}`)
  }, slot)
  await page.reload()
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

  // Dismiss permission onboarding dialog if it appears
  const later = page.locator('button', { hasText: /later/i })
  if (await later.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await later.click()
  }
}

export { test, expect }
