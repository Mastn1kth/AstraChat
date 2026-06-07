import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(serverDir, '..')
const dataDir = resolve(rootDir, process.env.DATA_DIR || 'server-data-v5')
const mediaDir = resolve(dataDir, 'media')
const isProduction = process.env.NODE_ENV === 'production'

mkdirSync(dataDir, { recursive: true })
mkdirSync(mediaDir, { recursive: true })

function loadMessageKey() {
  if (process.env.MESSAGE_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.MESSAGE_ENCRYPTION_KEY, 'base64')
    if (key.length !== 32) {
      throw new Error('MESSAGE_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
    }
    return key
  }

  if (isProduction) {
    throw new Error('MESSAGE_ENCRYPTION_KEY is required in production')
  }

  const keyPath = resolve(dataDir, '.dev-message-key')
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')
    if (key.length !== 32) throw new Error('Invalid local development message key')
    return key
  }

  const key = randomBytes(32)
  writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 })
  return key
}

export const config = {
  rootDir,
  dataDir,
  databasePath: resolve(dataDir, 'pgdata'),
  mediaDir,
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  isProduction,
  sessionCookieName: 'astrachat_session',
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  messageKey: loadMessageKey(),
}
