import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('auth middleware', () => {
  let dataDir
  let db
  let migrateDatabase
  let createSession
  let requireAuth

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'astrachat-auth-test-'))
    process.env.DATA_DIR = dataDir
    process.env.DATABASE_URL = ''

    ;({ db, migrateDatabase } = await import('./db.js'))
    ;({ createSession, requireAuth } = await import('./auth.js'))
    await migrateDatabase()
  })

  after(async () => {
    await db.close?.()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('rejects requests without a valid session cookie', async () => {
    let statusCode = 200
    let body = null
    let nextCalled = false

    await requireAuth(
      { cookies: {}, headers: {}, socket: {} },
      {
        status(code) {
          statusCode = code
          return this
        },
        json(payload) {
          body = payload
        },
      },
      () => {
        nextCalled = true
      },
    )

    assert.equal(statusCode, 401)
    assert.deepEqual(body, { error: 'Authentication required' })
    assert.equal(nextCalled, false)
  })

  it('attaches the session user and calls next for valid sessions', async () => {
    const userId = randomUUID()
    await db.query(
      `INSERT INTO users (id, login, username, name, avatar, password_salt, password_hash)
       VALUES ($1, 'auth_user', 'auth_user', 'Auth User', 'AU', 'salt', 'hash')`,
      [userId],
    )

    let cookieValue = ''
    await createSession(
      {
        cookie(_name, value) {
          cookieValue = value
        },
      },
      userId,
      { headers: { 'user-agent': 'node-test' }, ip: '127.0.0.1', socket: {} },
    )

    const request = {
      cookies: { astrachat_session: cookieValue },
      headers: {},
      socket: {},
    }
    let nextCalled = false

    await requireAuth(
      request,
      {
        status() {
          assert.fail('valid session should not set an error status')
        },
        json() {
          assert.fail('valid session should not send an error body')
        },
      },
      () => {
        nextCalled = true
      },
    )

    assert.equal(nextCalled, true)
    assert.equal(request.user.id, userId)
    assert.equal(request.user.login, 'auth_user')
  })
})
