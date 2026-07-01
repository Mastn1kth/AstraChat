import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkProductionEnv, parseEnvFile } from '../scripts/check-production-env.mjs'

function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:password@db.example.com:5432/astrachat',
    REDIS_URL: 'rediss://redis.example.com:6379/0',
    MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'astrachat',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:admin@example.com',
    FCM_SERVICE_ACCOUNT_JSON: '{}',
    SESSION_COOKIE_SAME_SITE: 'none',
    SESSION_COOKIE_SECURE: 'true',
    ALLOWED_ORIGINS: 'https://onda.example.com,capacitor://localhost',
    WEBRTC_TURN_URLS: 'turns:turn.example.com:5349',
    WEBRTC_TURN_USERNAME: 'turn-user',
    WEBRTC_TURN_CREDENTIAL: 'turn-secret',
    WEBRTC_GROUP_MEDIA_MODE: 'sfu',
    WEBRTC_MEDIA_SERVER_URL: 'https://sfu.example.com',
    ...overrides,
  }
}

describe('production env check', () => {
  it('accepts a complete production environment', () => {
    const result = checkProductionEnv(validProductionEnv())

    assert.deepEqual(result.failures, [])
  })

  it('reports missing required infrastructure', () => {
    const result = checkProductionEnv(validProductionEnv({
      DATABASE_URL: '',
      REDIS_URL: '',
      S3_SECRET_ACCESS_KEY: '',
      WEBRTC_TURN_URLS: '',
    }))

    assert.match(result.failures.join('\n'), /DATABASE_URL is required/)
    assert.match(result.failures.join('\n'), /REDIS_URL is required/)
    assert.match(result.failures.join('\n'), /S3_SECRET_ACCESS_KEY is required/)
    assert.match(result.failures.join('\n'), /TURN\/TURNS/)
  })

  it('requires TURN credentials when TURN is configured', () => {
    const result = checkProductionEnv(validProductionEnv({
      WEBRTC_TURN_USERNAME: '',
      WEBRTC_TURN_CREDENTIAL: '',
    }))

    assert.match(result.failures.join('\n'), /WEBRTC_TURN_USERNAME and WEBRTC_TURN_CREDENTIAL/)
  })

  it('rejects malformed secrets and service JSON', () => {
    const result = checkProductionEnv(validProductionEnv({
      MESSAGE_ENCRYPTION_KEY: 'not-base64',
      FCM_SERVICE_ACCOUNT_JSON: '{',
    }))

    assert.match(result.failures.join('\n'), /MESSAGE_ENCRYPTION_KEY/)
    assert.match(result.failures.join('\n'), /FCM_SERVICE_ACCOUNT_JSON/)
  })

  it('parses simple env files', () => {
    assert.deepEqual(parseEnvFile('A=1\n# comment\nB="two words"\nC='), {
      A: '1',
      B: 'two words',
      C: '',
    })
  })
})
