// Shared e2e helpers
import { expect } from '@playwright/test'

let counter = 0
export function uid() {
  return `e2e_${Date.now()}_${++counter}`
}

export async function register(page, login, name) {
  await page.goto('/')
  // Switch to legacy login
  await page.getByRole('button', { name: /phone|login/i }).first().click()
  await page.getByPlaceholder(/login/i).fill(login)
  await page.getByPlaceholder(/password/i).fill('test-pw-e2e-123')
  // Click register / switch to register tab
  await page.getByRole('button', { name: /register|sign up/i }).click()
  // Fill registration form if shown
  const nameInput = page.getByPlaceholder(/full name|name/i)
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill(name || login)
  }
  await page.getByRole('button', { name: /create account|register/i }).click()
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
}

export async function testLogin(page, slot = 0) {
  await page.goto('/')
  const testBtn = page.getByRole('button', { name: new RegExp(`test.*${slot}|slot.*${slot}`, 'i') })
  if (await testBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await testBtn.click()
  } else {
    // Try clicking test login buttons in order
    const btns = page.locator('button').filter({ hasText: /test/i })
    await btns.nth(slot).click()
  }
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10_000 })
}
