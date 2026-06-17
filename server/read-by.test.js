import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

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

async function registerUser(baseUrl, login) {
  const { response, body } = await postJson(baseUrl, '/api/auth/register', '', {
    login,
    username: login,
    name: login.replace(/_/g, ' '),
    password: 'read-test-pw-123',
  })
  assert.equal(response.status, 201)
  return { user: body.user, cookie: cookieFrom(response) }
}

async function createGroup(baseUrl, ownerCookie, title, memberIds) {
  return postJson(baseUrl, '/api/chats', ownerCookie, { type: 'group', title, memberIds })
}

async function sendMessage(baseUrl, cookie, chatId, text) {
  return postJson(baseUrl, `/api/chats/${chatId}/messages`, cookie, { text, searchText: text })
}

describe('Read receipts - API endpoint', () => {
  let dataDir, db, listener, baseUrl

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'astrachat-readby-test-'))
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

  // ── Auth & access ──────────────────────────────────────────

  it('returns 401 without authentication', async () => {
    const response = await fetch(
      `${baseUrl}/api/chats/${randomUUID()}/messages/${randomUUID()}/read-by`,
    )
    assert.equal(response.status, 401)
  })

  it('returns 404 for non-existent chat', async () => {
    const user = await registerUser(baseUrl, 'rb_nonexistent')
    const response = await fetch(
      `${baseUrl}/api/chats/${randomUUID()}/messages/${randomUUID()}/read-by`,
      { headers: { Cookie: user.cookie } },
    )
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.error, 'Chat not found')
  })

  it('returns 404 when user is not a member', async () => {
    const owner = await registerUser(baseUrl, 'rb_nm_owner')
    const outsider = await registerUser(baseUrl, 'rb_nm_out')

    const created = await createGroup(baseUrl, owner.cookie, 'Non-member test', [])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, owner.cookie, chatId, 'Secret')
    const messageId = msg.body.message.id

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: outsider.cookie } },
    )
    assert.equal(response.status, 404)
  })

  it('returns 404 when the message does not belong to the requested chat', async () => {
    const alice = await registerUser(baseUrl, 'rb_cross_alice')
    const bob = await registerUser(baseUrl, 'rb_cross_bob')

    const chatA = await createGroup(baseUrl, alice.cookie, 'Cross chat A', [bob.user.id])
    const chatB = await createGroup(baseUrl, alice.cookie, 'Cross chat B', [bob.user.id])
    const msg = await sendMessage(baseUrl, alice.cookie, chatA.body.chat.id, 'Wrong chat')

    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [msg.body.message.id, bob.user.id],
    )

    const response = await fetch(
      `${baseUrl}/api/chats/${chatB.body.chat.id}/messages/${msg.body.message.id}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.error, 'Message not found')
  })

  // ── Empty / no readers ─────────────────────────────────────

  it('returns empty array when nobody has read the message', async () => {
    const alice = await registerUser(baseUrl, 'rb_empty_alice')
    const bob = await registerUser(baseUrl, 'rb_empty_bob')

    const created = await createGroup(baseUrl, alice.cookie, 'Empty read-by', [bob.user.id])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Unread message')
    const messageId = msg.body.message.id

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body, [])
  })

  // ── Single reader ──────────────────────────────────────────

  it('returns a single reader after they read the message', async () => {
    const alice = await registerUser(baseUrl, 'rb_single_alice')
    const bob = await registerUser(baseUrl, 'rb_single_bob')

    const created = await createGroup(baseUrl, alice.cookie, 'Single reader', [bob.user.id])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Read by Bob')
    const messageId = msg.body.message.id

    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, bob.user.id],
    )

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.length, 1)
    assert.equal(body[0].id, bob.user.id)
    assert.equal(body[0].name, 'rb single bob')
    assert.equal(body[0].username, 'rb_single_bob')
    assert.ok(body[0].read_at, 'read_at should be present')
  })

  // ── Multiple readers ───────────────────────────────────────

  it('returns multiple readers ordered by read_at (ascending)', async () => {
    const alice = await registerUser(baseUrl, 'rb_multi_alice')
    const bob = await registerUser(baseUrl, 'rb_multi_bob')
    const carol = await registerUser(baseUrl, 'rb_multi_carol')

    const created = await createGroup(baseUrl, alice.cookie, 'Multi reader', [
      bob.user.id,
      carol.user.id,
    ])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Multi read')
    const messageId = msg.body.message.id

    await db.query(
      `INSERT INTO message_reads (message_id, user_id, read_at) VALUES ($1, $2, $3)`,
      [messageId, bob.user.id, '2026-06-10T10:00:00Z'],
    )
    await db.query(
      `INSERT INTO message_reads (message_id, user_id, read_at) VALUES ($1, $2, $3)`,
      [messageId, carol.user.id, '2026-06-10T10:01:00Z'],
    )

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.length, 2)
    assert.equal(body[0].id, bob.user.id, 'Bob read first → should be first')
    assert.equal(body[1].id, carol.user.id, 'Carol read second → should be second')
  })

  // ── Deduplication ──────────────────────────────────────────

  it('ON CONFLICT DO NOTHING prevents duplicate read entries', async () => {
    const alice = await registerUser(baseUrl, 'rb_dedup_alice')
    const bob = await registerUser(baseUrl, 'rb_dedup_bob')

    const created = await createGroup(baseUrl, alice.cookie, 'Dedup', [bob.user.id])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Dedup message')
    const messageId = msg.body.message.id

    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, bob.user.id],
    )
    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, bob.user.id],
    )

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.length, 1, 'Duplicate insert should produce only one row')
  })

  // ── Private chat ───────────────────────────────────────────

  it('returns readers for private (1:1) chat messages', async () => {
    const alice = await registerUser(baseUrl, 'rb_priv_alice')
    const bob = await registerUser(baseUrl, 'rb_priv_bob')

    const createdChat = await postJson(baseUrl, '/api/chats', alice.cookie, {
      type: 'private',
      title: '',
      memberIds: [bob.user.id],
    })
    const chatId = createdChat.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Private msg')
    const messageId = msg.body.message.id

    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, bob.user.id],
    )

    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages/${messageId}/read-by`,
      { headers: { Cookie: alice.cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.length, 1)
    assert.equal(body[0].id, bob.user.id)
  })

  // ── Integration: readBy in message list response ──────────

  it('includes readBy in message list response when fetching messages', async () => {
    const alice = await registerUser(baseUrl, 'rb_list_alice')
    const bob = await registerUser(baseUrl, 'rb_list_bob')

    const created = await createGroup(baseUrl, alice.cookie, 'List test', [bob.user.id])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Check readBy in list')
    const messageId = msg.body.message.id

    await db.query(
      `INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, bob.user.id],
    )

    const response = await fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
      headers: { Cookie: alice.cookie },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    const fetched = body.messages.find((m) => m.id === messageId)
    assert.ok(fetched, 'Message should be in the list')
    assert.equal(fetched.status, 'read')
    assert.ok(Array.isArray(fetched.readBy), 'readBy should be an array')
    assert.equal(fetched.readBy.length, 1)
    assert.equal(fetched.readBy[0].userId, bob.user.id)
    assert.equal(fetched.readBy[0].name, 'rb list bob')
  })

  it('sets status to sent and readBy to empty array for unread messages', async () => {
    const alice = await registerUser(baseUrl, 'rb_unread_alice')
    const bob = await registerUser(baseUrl, 'rb_unread_bob')

    const created = await createGroup(baseUrl, alice.cookie, 'Unread list', [bob.user.id])
    const chatId = created.body.chat.id
    const msg = await sendMessage(baseUrl, alice.cookie, chatId, 'Not yet read')
    const messageId = msg.body.message.id

    const response = await fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
      headers: { Cookie: alice.cookie },
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    const fetched = body.messages.find((m) => m.id === messageId)
    assert.ok(fetched)
    assert.equal(fetched.status, 'sent', 'Should be sent (not read)')
    assert.deepEqual(fetched.readBy, [], 'readBy should be empty array')
  })
})
