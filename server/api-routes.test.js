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
    process.env.DATA_DIR = dataDir
    process.env.DATABASE_URL = ''
    process.env.ALLOWED_ORIGINS = ''

    const dbModule = await import('./db.js')
    const serverModule = await import('./index.js')
    db = dbModule.db
    await dbModule.migrateDatabase()

    listener = serverModule.app.listen(0)
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
