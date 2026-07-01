import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

function productionEnv(dataDir, overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    DATABASE_URL: 'postgres://user:password@localhost:5432/astrachat',
    REDIS_URL: 'redis://localhost:6379/0',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'astrachat',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:admin@example.com',
    FCM_SERVICE_ACCOUNT_JSON: '{}',
    WEBRTC_TURN_URLS: 'turns:turn.example.com:5349',
    MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ALLOWED_ORIGINS: 'https://onda.example.com',
    ...overrides,
  }
}

function importConfig(env) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import('./server/config.js').then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1) })",
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      env,
      encoding: 'utf8',
    },
  )
}

describe('production config', () => {
  it('requires REDIS_URL in production', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, { REDIS_URL: '' }))

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /REDIS_URL is required in production/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('requires ALLOWED_ORIGINS in production', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, { ALLOWED_ORIGINS: '' }))

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /ALLOWED_ORIGINS is required in production/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('accepts REDIS_URL in production config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir))

      assert.equal(result.status, 0, result.stderr)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('requires S3 storage in production', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, { STORAGE_DRIVER: 'local' }))

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /STORAGE_DRIVER=s3 is required in production/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('requires S3 credentials when S3 storage is enabled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, { S3_SECRET_ACCESS_KEY: '' }))

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /S3_SECRET_ACCESS_KEY is required when STORAGE_DRIVER=s3/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('requires a media server URL for SFU/MCU group call mode', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, {
        WEBRTC_GROUP_MEDIA_MODE: 'sfu',
        WEBRTC_MEDIA_SERVER_URL: '',
      }))

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /WEBRTC_MEDIA_SERVER_URL is required/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('accepts SFU group call mode with an HTTPS media server URL', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'astrachat-config-test-'))
    try {
      const result = importConfig(productionEnv(dataDir, {
        WEBRTC_GROUP_MEDIA_MODE: 'sfu',
        WEBRTC_MEDIA_SERVER_URL: 'https://sfu.example.com',
      }))

      assert.equal(result.status, 0, result.stderr)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
