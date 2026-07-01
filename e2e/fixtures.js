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

  // Dismiss permission onboarding dialog if it appears.
  const onboarding = page.locator('.permission-onboarding')
  if (await onboarding.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await onboarding.getByRole('button', { name: /later|close permissions/i }).first().click()
    await expect(onboarding).toBeHidden({ timeout: 5_000 })
  }
}

export { test, expect }
