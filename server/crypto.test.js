import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createTotpSecret,
  generateTotpCode,
  matchTotpCounter,
  verifyTotpCode,
} from './crypto.js'

describe('TOTP verification (pure)', () => {
  it('matches a code generated for the current period', () => {
    const secret = createTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secret, { now })
    const counter = Math.floor(now / 1000 / 30)
    assert.equal(matchTotpCounter(secret, code, { now }), counter)
    assert.equal(verifyTotpCode(secret, code, { now }), true)
  })

  it('rejects malformed codes', () => {
    const secret = createTotpSecret()
    assert.equal(matchTotpCounter(secret, 'abcdef'), -1)
    assert.equal(matchTotpCounter(secret, '12345'), -1)
    assert.equal(verifyTotpCode(secret, 'abcdef'), false)
  })

  it('rejects a code whose matched counter is at or before lastCounter', () => {
    const secret = createTotpSecret()
    const now = Date.now()
    const code = generateTotpCode(secret, { now })
    const counter = Math.floor(now / 1000 / 30)

    assert.equal(verifyTotpCode(secret, code, { now, lastCounter: counter }), false)
    assert.equal(verifyTotpCode(secret, code, { now, lastCounter: counter - 1 }), true)
  })
})

describe('TOTP replay protection (DB-backed)', () => {
  let dataDir
  let db
  let migrateDatabase
  let verifyAndConsumeTotpCode
  let userId
  let secret
  let code
  let counter

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'astrachat-totp-test-'))
    process.env.DATA_DIR = dataDir
    process.env.DATABASE_URL = ''

    ;({ db, migrateDatabase } = await import('./db.js'))
    ;({ verifyAndConsumeTotpCode } = await import('./server-helpers.js'))
    await migrateDatabase()

    userId = randomUUID()
    const login = `totp_user_${userId.slice(0, 8)}`
    await db.query(
      `INSERT INTO users (id, login, username, name, avatar, password_salt, password_hash)
       VALUES ($1, $2, $2, 'Totp User', 'TU', 'salt', 'hash')`,
      [userId, login],
    )

    secret = createTotpSecret()
    const now = Date.now()
    counter = Math.floor(now / 1000 / 30)
    code = generateTotpCode(secret, { now })
  })

  after(async () => {
    await db.close?.()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('accepts a valid code the first time', async () => {
    const accepted = await verifyAndConsumeTotpCode(userId, secret, code)
    assert.equal(accepted, true)
  })

  it('rejects the same code on replay', async () => {
    const accepted = await verifyAndConsumeTotpCode(userId, secret, code)
    assert.equal(accepted, false)
  })

  it('still accepts the next period code after a replay attempt', async () => {
    const nextNow = (counter + 1) * 30 * 1000
    const nextCode = generateTotpCode(secret, { now: nextNow })
    const accepted = await verifyAndConsumeTotpCode(userId, secret, nextCode, { now: nextNow })
    assert.equal(accepted, true)
  })
})
