import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(';')[0]
}

async function postJson(baseUrl, path, cookie, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

async function patchJson(baseUrl, path, cookie, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

async function registerUser(baseUrl, login) {
  const { response, body } = await postJson(baseUrl, '/api/auth/register', '', {
    login,
    username: login,
    name: login.replace(/_/g, ' '),
    password: 'route-password-123',
  })
  assert.equal(response.status, 201)
  return { user: body.user, cookie: cookieFrom(response) }
}

describe('API routes', () => {
  let dataDir
  let db
  let listener
  let baseUrl

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'astrachat-api-test-'))
    process.env.NODE_ENV = 'test'
    process.env.DATA_DIR = dataDir
    process.env.DATABASE_URL = ''
    process.env.ALLOWED_ORIGINS = ''

    const dbModule = await import('./db.js')
    const serverModule = await import('./index.js')
    db = dbModule.db
    await dbModule.migrateDatabase()

    listener = serverModule.server.listen(0)
    await new Promise((resolve) => listener.once('listening', resolve))
    const { port } = listener.address()
    baseUrl = `http://127.0.0.1:${port}`
  })

  after(async () => {
    await new Promise((resolve) => listener.close(resolve))
    await db.close?.()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('serves the live probe without authentication', async () => {
    const response = await fetch(`${baseUrl}/api/live`)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(body, { ok: true })
  })

  it('returns 401 from authenticated routes without a session', async () => {
    const me = await fetch(`${baseUrl}/api/auth/me`)
    const sessions = await fetch(`${baseUrl}/api/sessions`)

    assert.equal(me.status, 401)
    assert.equal((await me.json()).error, 'Not authenticated')
    assert.equal(sessions.status, 401)
    assert.equal((await sessions.json()).error, 'Authentication required')
  })

  it('registers a user, sets a session cookie, and returns the current user', async () => {
    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'route_user',
        username: 'route_user',
        name: 'Route User',
        password: 'route-password-123',
      }),
    })
    const registerBody = await register.json()
    const cookie = cookieFrom(register)

    assert.equal(register.status, 201)
    assert.equal(registerBody.user.login, 'route_user')
    assert.ok(cookie.startsWith('astrachat_session='))

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    })
    const meBody = await me.json()

    assert.equal(me.status, 200)
    assert.equal(meBody.user.id, registerBody.user.id)
    assert.equal(meBody.user.username, 'route_user')
  })

  it('logs in by phone code and creates a profile for a new number', async () => {
    const started = await postJson(baseUrl, '/api/auth/phone/start', '', {
      countryCode: '+7',
      phone: '900 111-22-33',
    })
    assert.equal(started.response.status, 200)
    assert.equal(started.body.phone, '+79001112233')
    assert.match(started.body.devCode, /^\d{6}$/)
    assert.equal(started.body.pushSent, 0)

    const needsProfile = await postJson(baseUrl, '/api/auth/phone/verify', '', {
      countryCode: '+7',
      phone: '9001112233',
      code: started.body.devCode,
    })
    assert.equal(needsProfile.response.status, 200)
    assert.equal(needsProfile.body.profileRequired, true)

    const created = await postJson(baseUrl, '/api/auth/phone/verify', '', {
      countryCode: '+7',
      phone: '9001112233',
      code: started.body.devCode,
      username: 'phone_route_user',
      name: 'Phone Route',
      password: 'phone-route-password-123',
    })
    assert.equal(created.response.status, 201)
    assert.equal(created.body.user.phone, '+79001112233')
    assert.equal(created.body.user.login, '+79001112233')
    assert.equal(created.body.user.username, 'phone_route_user')
    assert.ok(cookieFrom(created.response).startsWith('astrachat_session='))

    const restarted = await postJson(baseUrl, '/api/auth/phone/start', '', {
      countryCode: '+7',
      phone: '9001112233',
    })
    assert.equal(restarted.body.delivery, 'dev')
    assert.equal(restarted.body.pushSent, 0)
    const existing = await postJson(baseUrl, '/api/auth/phone/verify', '', {
      countryCode: '+7',
      phone: '9001112233',
      code: restarted.body.devCode,
    })
    assert.equal(existing.response.status, 409)
    assert.equal(existing.body.code, 'account_exists')

    const passwordLogin = await postJson(baseUrl, '/api/auth/login', '', {
      login: 'phone_route_user',
      password: 'phone-route-password-123',
    })
    assert.equal(passwordLogin.response.status, 200)
    assert.equal(passwordLogin.body.user.id, created.body.user.id)
  })

  it('rejects invalid login credentials', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'route_user',
        password: 'wrong-password',
      }),
    })
    const body = await response.json()

    assert.equal(response.status, 401)
    assert.equal(body.error, 'Invalid login or password')
  })

  it('adds, lists, marks, and removes saved contacts', async () => {
    const owner = await registerUser(baseUrl, 'contact_owner')
    const target = await registerUser(baseUrl, 'contact_target')

    const emptyContacts = await fetch(`${baseUrl}/api/contacts`, {
      headers: { Cookie: owner.cookie },
    })
    assert.equal(emptyContacts.status, 200)
    assert.deepEqual((await emptyContacts.json()).contacts, [])

    const added = await postJson(baseUrl, `/api/contacts/${target.user.id}`, owner.cookie, {})
    assert.equal(added.response.status, 201)
    assert.equal(added.body.contact.id, target.user.id)
    assert.equal(added.body.contact.isContact, true)

    const contacts = await fetch(`${baseUrl}/api/contacts`, {
      headers: { Cookie: owner.cookie },
    })
    const contactsBody = await contacts.json()
    assert.equal(contacts.status, 200)
    assert.equal(contactsBody.contacts.length, 1)
    assert.equal(contactsBody.contacts[0].id, target.user.id)
    assert.equal(contactsBody.contacts[0].isContact, true)

    const users = await fetch(`${baseUrl}/api/users?search=contact_target`, {
      headers: { Cookie: owner.cookie },
    })
    const usersBody = await users.json()
    assert.equal(users.status, 200)
    assert.equal(usersBody.users.find((user) => user.id === target.user.id)?.isContact, true)

    const removed = await fetch(`${baseUrl}/api/contacts/${target.user.id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    })
    assert.equal(removed.status, 204)

    const afterRemove = await fetch(`${baseUrl}/api/contacts`, {
      headers: { Cookie: owner.cookie },
    })
    assert.equal(afterRemove.status, 200)
    assert.deepEqual((await afterRemove.json()).contacts, [])
  })

  // ── Auth flows ─────────────────────────────────────────────

  it('logs in with valid credentials and rejects duplicate registration', async () => {
    await registerUser(baseUrl, 'auth_flow_user')

    const dupReg = await postJson(baseUrl, '/api/auth/register', '', {
      login: 'auth_flow_user',
      username: 'auth_flow_user',
      name: 'Auth Flow',
      password: 'route-password-123',
    })
    assert.equal(dupReg.response.status, 409)

    const login = await postJson(baseUrl, '/api/auth/login', '', {
      login: 'auth_flow_user',
      password: 'route-password-123',
    })
    assert.equal(login.response.status, 200)
    assert.equal(login.body.user.login, 'auth_flow_user')
    const sessionCookie = cookieFrom(login.response)
    assert.ok(sessionCookie.startsWith('astrachat_session='))

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } })
    assert.equal(me.status, 200)
    assert.equal((await me.json()).user.login, 'auth_flow_user')

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    })
    assert.equal(logout.status, 204)

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie } })
    assert.equal(meAfterLogout.status, 401)
  })

  it('updates user profile fields', async () => {
    const { cookie } = await registerUser(baseUrl, 'profile_update_user')

    const patched = await patchJson(baseUrl, '/api/users/me/profile', cookie, {
      name: 'Updated Name',
      username: 'profile_update_user',
      bio: 'A new bio',
    })
    assert.equal(patched.response.status, 200)
    assert.equal(patched.body.user.name, 'Updated Name')
    assert.equal(patched.body.user.bio, 'A new bio')
  })

  it('rejects registration with username shorter than 3 characters', async () => {
    const short = await postJson(baseUrl, '/api/auth/register', '', {
      login: 'short_un_user',
      username: 'ab',
      name: 'Short Un',
      password: 'route-password-123',
    })
    assert.equal(short.response.status, 400)
  })

  // ── QR login flow ──────────────────────────────────────────

  it('QR login: start → status pending → confirm → status confirmed', async () => {
    const scanner = await registerUser(baseUrl, 'qr_scanner_user')

    const started = await postJson(baseUrl, '/api/auth/qr/start', '', {})
    assert.equal(started.response.status, 200)
    assert.ok(started.body.token, 'token should be returned')
    assert.ok(started.body.expiresAt, 'expiresAt should be returned')
    const { token } = started.body

    const pending = await fetch(`${baseUrl}/api/auth/qr/status?token=${token}`)
    assert.equal(pending.status, 200)
    assert.equal((await pending.json()).status, 'pending')

    const confirmed = await postJson(baseUrl, '/api/auth/qr/confirm', scanner.cookie, { token })
    assert.equal(confirmed.response.status, 200)
    assert.equal(confirmed.body.ok, true)

    const status = await fetch(`${baseUrl}/api/auth/qr/status?token=${token}`)
    assert.equal(status.status, 200)
    const statusBody = await status.json()
    assert.equal(statusBody.status, 'confirmed')
    assert.equal(statusBody.user.id, scanner.user.id)
    assert.ok(cookieFrom(status).startsWith('astrachat_session='))
  })

  it('QR confirm returns 401 without a session', async () => {
    const started = await postJson(baseUrl, '/api/auth/qr/start', '', {})
    const { token } = started.body
    const res = await postJson(baseUrl, '/api/auth/qr/confirm', '', { token })
    assert.equal(res.response.status, 401)
  })

  it('QR status returns expired for unknown token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/qr/status?token=nonexistent-token-xyz`)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).status, 'expired')
  })

  // ── Media upload ───────────────────────────────────────────

  it('uploads a file, returns media metadata, and serves it back', async () => {
    const { cookie } = await registerUser(baseUrl, 'media_upload_user')

    const buf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'image/png' }), 'pixel.png')
    form.append('kind', 'image')

    const upload = await fetch(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    })
    assert.equal(upload.status, 201)
    const uploadBody = await upload.json()
    assert.equal(uploadBody.media.kind, 'image')
    assert.equal(uploadBody.media.name, 'pixel.png')
    assert.ok(uploadBody.media.id, 'media id should be present')
    assert.ok(uploadBody.media.url, 'media url should be present')
  })

  it('rejects media upload without authentication', async () => {
    const buf = Buffer.from('fake', 'utf8')
    const form = new FormData()
    form.append('file', new Blob([buf], { type: 'image/png' }), 'test.png')
    form.append('kind', 'image')

    const upload = await fetch(`${baseUrl}/api/media`, {
      method: 'POST',
      body: form,
    })
    assert.equal(upload.status, 401)
  })

  // ── WebSocket ──────────────────────────────────────────────

  it('WebSocket: accepts authenticated connection and sends initial workspace', async () => {
    const { cookie } = await registerUser(baseUrl, 'ws_auth_user')
    const wsUrl = `ws://127.0.0.1:${listener.address().port}/ws`

    const { default: WebSocket } = await import('ws')

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } })
      const received = []
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket did not receive workspace event in time'))
      }, 4000)

      ws.on('message', (data) => {
        const msg = JSON.parse(String(data))
        received.push(msg)
        if (msg.type === 'session:ready') {
          clearTimeout(timer)
          ws.close()
          assert.ok(msg.userId, 'session:ready should include userId')
          assert.ok(Array.isArray(msg.onlineUserIds), 'session:ready should include onlineUserIds array')
          resolve()
        }
      })
      ws.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
  })

  it('WebSocket: rejects unauthenticated connection with 401', async () => {
    const wsUrl = `ws://127.0.0.1:${listener.address().port}/ws`
    const { default: WebSocket } = await import('ws')

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      ws.on('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 401)
        resolve()
      })
      ws.on('open', () => reject(new Error('Should not have connected without auth')))
      ws.on('error', () => resolve())
    })
  })

  it('WebSocket: delivers a message:new event when a message is sent via API', async () => {
    const alice = await registerUser(baseUrl, 'ws_msg_alice')
    const bob = await registerUser(baseUrl, 'ws_msg_bob')

    const chat = await postJson(baseUrl, '/api/chats', alice.cookie, {
      type: 'private',
      title: '',
      memberIds: [bob.user.id],
    })
    const chatId = chat.body.chat.id

    const wsUrl = `ws://127.0.0.1:${listener.address().port}/ws`
    const { default: WebSocket } = await import('ws')

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: { Cookie: bob.cookie } })
      const timer = setTimeout(() => { ws.close(); reject(new Error('No message:new received')) }, 4000)

      ws.on('open', async () => {
        await postJson(baseUrl, `/api/chats/${chatId}/messages`, alice.cookie, {
          text: 'Hello Bob',
          searchText: 'Hello Bob',
        })
      })

      ws.on('message', (data) => {
        const msg = JSON.parse(String(data))
        if (msg.type === 'message:new' && msg.message?.chatId === chatId) {
          clearTimeout(timer)
          ws.close()
          assert.equal(msg.message.text, 'Hello Bob')
          resolve()
        }
      })
      ws.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
  })

  it('creates group topics, stores message topic ids, and rejects member posts to closed topics', async () => {
    const owner = await registerUser(baseUrl, 'topic_owner')
    const member = await registerUser(baseUrl, 'topic_member')

    const createdChat = await postJson(baseUrl, '/api/chats', owner.cookie, {
      type: 'group',
      title: 'Topic test group',
      memberIds: [member.user.id],
    })
    assert.equal(createdChat.response.status, 201)
    const chatId = createdChat.body.chat.id

    const createdTopic = await postJson(baseUrl, `/api/chats/${chatId}/topics`, owner.cookie, {
      title: 'Release notes',
    })
    assert.equal(createdTopic.response.status, 201)
    const topicId = createdTopic.body.topic.id

    const sentMessage = await postJson(baseUrl, `/api/chats/${chatId}/messages`, owner.cookie, {
      text: 'Message inside topic',
      searchText: 'Message inside topic',
      topicId,
    })
    assert.equal(sentMessage.response.status, 201)
    assert.equal(sentMessage.body.message.topicId, topicId)

    const messages = await fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
      headers: { Cookie: owner.cookie },
    })
    const messagesBody = await messages.json()
    assert.equal(messages.status, 200)
    assert.equal(messagesBody.messages.at(-1).topicId, topicId)

    const closedTopic = await patchJson(baseUrl, `/api/chats/${chatId}/topics/${topicId}`, owner.cookie, {
      closed: true,
    })
    assert.equal(closedTopic.response.status, 200)
    assert.equal(closedTopic.body.topic.closed, true)

    const rejectedMessage = await postJson(baseUrl, `/api/chats/${chatId}/messages`, member.cookie, {
      text: 'Member should not post here',
      topicId,
    })
    assert.equal(rejectedMessage.response.status, 403)
    assert.equal(rejectedMessage.body.error, 'Topic is closed')
  })
})
