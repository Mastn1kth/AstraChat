import { test, expect } from '@playwright/test'

let counter = 0

export async function apiLogin(page) {
  const suffix = `${Date.now()}_${++counter}`
  const login = `e2e_${suffix}`
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async ({ login: userLogin }) => {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: userLogin,
        username: userLogin,
        name: 'E2E User',
        password: 'test-pw-e2e-123',
      }),
      credentials: 'include',
    })
    if (!resp.ok) throw new Error(`register failed: ${resp.status}`)
  }, { login })
  await page.reload()
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })

  // Dismiss permission onboarding dialog if it appears
  const later = page.locator('button', { hasText: /later/i })
  if (await later.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await later.click()
  }
}

export { test, expect }
