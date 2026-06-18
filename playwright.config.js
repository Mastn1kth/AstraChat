import { defineConfig } from '@playwright/test'

const BACKEND_PORT = 3099
const FRONTEND_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    headless: true,
    locale: 'en-US',
    trace: 'on-first-retry',
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${FRONTEND_PORT}`,
          localStorage: [{ name: 'onda.lang', value: 'en' }],
        },
      ],
    },
  },
  webServer: [
    {
      command: `node server/index.js`,
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(BACKEND_PORT),
        HOST: '127.0.0.1',
        DATA_DIR: 'e2e-data',
        DATABASE_URL: '',
        REDIS_URL: '',
        ALLOWED_ORIGINS: `http://localhost:${FRONTEND_PORT}`,
        SESSION_COOKIE_SAME_SITE: 'lax',
        SESSION_COOKIE_SECURE: 'false',
        TRUST_PROXY: '',
        NODE_ENV: 'test',
      },
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --host localhost`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_BACKEND_PORT: String(BACKEND_PORT),
      },
    },
  ],
})
