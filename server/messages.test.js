/**
 * Integration tests for message visibility rules:
 * - delete-for-me   → message_user_deletions row hides message from that user only
 * - clear-history   → chat_history_clears.cleared_at hides older messages from that user only
 * - delete-for-everyone → messages.deleted_at hides message for all users
 * - pagination      → before + limit cursor-based paging
 *
 * Uses node:test + real PGlite (in-memory, no data files created).
 * Run: node --experimental-vm-modules server/messages.test.js
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { runMigrations } from './migrations.js'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function setupDb() {
  const db = new PGlite() // in-memory

  // Base schema (subset needed for these tests)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      password_salt TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chats (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'private',
      title TEXT NOT NULL DEFAULT '',
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id),
      ciphertext TEXT NOT NULL DEFAULT '',
      iv TEXT NOT NULL DEFAULT '',
      auth_tag TEXT NOT NULL DEFAULT '',
      encryption_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS media_files (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'image',
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      storage_name TEXT NOT NULL UNIQUE,
      encrypted_size BIGINT NOT NULL DEFAULT 0,
      plain_size BIGINT NOT NULL DEFAULT 0,
      original_size BIGINT NOT NULL DEFAULT 0,
      iv TEXT NOT NULL DEFAULT '',
      auth_tag TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await runMigrations(db)

  return db
}

async function createUser(db, overrides = {}) {
  const id = randomUUID()
  const login = overrides.login ?? `user_${id.slice(0, 8)}`
  const username = overrides.username ?? login
  await db.query(
    `INSERT INTO users (id, login, username, name) VALUES ($1, $2, $3, $4)`,
    [id, login, username, overrides.name ?? login],
  )
  return id
}

async function createChat(db, creatorId, type = 'private') {
  const id = randomUUID()
  await db.query(`INSERT INTO chats (id, type, created_by) VALUES ($1, $2, $3)`, [id, type, creatorId])
  await db.query(`INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)`, [id, creatorId])
  return id
}

async function addMember(db, chatId, userId) {
  await db.query(
    `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [chatId, userId],
  )
}

/**
 * Insert a message with an explicit created_at so we can control ordering.
 */
async function insertMessage(db, chatId, senderId, createdAt) {
  const id = randomUUID()
  await db.query(
    `INSERT INTO messages (id, chat_id, sender_id, created_at) VALUES ($1, $2, $3, $4)`,
    [id, chatId, senderId, createdAt],
  )
  return id
}

/**
 * Replicates the server's visibility query for GET /api/chats/:chatId/messages.
 * Returns message ids in chronological order.
 */
async function getVisibleMessages(db, chatId, userId, { before, limit = 50 } = {}) {
  const params = [chatId, userId]
  let beforeClause = ''
  if (before) {
    params.push(before)
    beforeClause = `AND m.created_at < $${params.length}`
  }
  params.push(limit + 1)
  const limitParam = `$${params.length}`

  const result = await db.query(
    `SELECT m.id, m.created_at
     FROM messages m
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.deleted_at IS NULL
       ${beforeClause}
       AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
       AND NOT EXISTS (
         SELECT 1 FROM message_user_deletions mud
         WHERE mud.message_id = m.id AND mud.user_id = $2
       )
     ORDER BY m.created_at DESC
     LIMIT ${limitParam}`,
    params,
  )

  const hasMore = result.rows.length > limit
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows
  pageRows.reverse() // chronological
  return { ids: pageRows.map((r) => r.id), hasMore }
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('Message visibility', () => {
  let db
  let alice, bob
  let chatId

  before(async () => {
    db = await setupDb()
    alice = await createUser(db, { login: 'alice', name: 'Alice' })
    bob = await createUser(db, { login: 'bob', name: 'Bob' })
    chatId = await createChat(db, alice)
    await addMember(db, chatId, bob)
  })

  after(async () => {
    await db.close?.()
  })

  // ── Delete for me ──────────────────────────────────────────

  it('delete-for-me hides message from the deleting user only', async () => {
    const msgId = await insertMessage(db, chatId, alice, '2026-06-07T10:00:00Z')

    // Before deletion, both users see the message
    const { ids: aliceBefore } = await getVisibleMessages(db, chatId, alice)
    const { ids: bobBefore } = await getVisibleMessages(db, chatId, bob)
    assert.ok(aliceBefore.includes(msgId), 'Alice should see message before deletion')
    assert.ok(bobBefore.includes(msgId), 'Bob should see message before deletion')

    // Alice deletes for herself
    await db.query(
      `INSERT INTO message_user_deletions (message_id, user_id) VALUES ($1, $2)`,
      [msgId, alice],
    )

    const { ids: aliceAfter } = await getVisibleMessages(db, chatId, alice)
    const { ids: bobAfter } = await getVisibleMessages(db, chatId, bob)
    assert.ok(!aliceAfter.includes(msgId), 'Alice should NOT see message after delete-for-me')
    assert.ok(bobAfter.includes(msgId), 'Bob should still see message after Alice delete-for-me')
  })

  // ── Clear history ──────────────────────────────────────────

  it('clear-history hides messages sent before cleared_at from that user only', async () => {
    const before1 = await insertMessage(db, chatId, alice, '2026-06-07T11:00:00Z')
    const before2 = await insertMessage(db, chatId, bob, '2026-06-07T11:01:00Z')
    const clearTs = '2026-06-07T11:05:00Z'
    const after1 = await insertMessage(db, chatId, alice, '2026-06-07T11:10:00Z')

    // Bob clears history
    await db.query(
      `INSERT INTO chat_history_clears (chat_id, user_id, cleared_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET cleared_at = EXCLUDED.cleared_at`,
      [chatId, bob, clearTs],
    )

    const { ids: bobIds } = await getVisibleMessages(db, chatId, bob)
    const { ids: aliceIds } = await getVisibleMessages(db, chatId, alice)

    assert.ok(!bobIds.includes(before1), 'Bob should NOT see message before clear timestamp')
    assert.ok(!bobIds.includes(before2), 'Bob should NOT see his own message before clear')
    assert.ok(bobIds.includes(after1), 'Bob should see message sent AFTER clear')

    assert.ok(aliceIds.includes(before1), 'Alice should still see message before Bob\'s clear')
    assert.ok(aliceIds.includes(before2), 'Alice should still see all messages')
    assert.ok(aliceIds.includes(after1), 'Alice should see new message')
  })

  // ── Delete for everyone ───────────────────────────────────

  it('delete-for-everyone hides message for all users', async () => {
    const msgId = await insertMessage(db, chatId, alice, '2026-06-07T12:00:00Z')

    // Confirm both see it
    const { ids: beforeAlice } = await getVisibleMessages(db, chatId, alice)
    const { ids: beforeBob } = await getVisibleMessages(db, chatId, bob)
    assert.ok(beforeAlice.includes(msgId))
    assert.ok(beforeBob.includes(msgId))

    // Delete for everyone (sets deleted_at)
    await db.query(`UPDATE messages SET deleted_at = NOW() WHERE id = $1`, [msgId])

    const { ids: afterAlice } = await getVisibleMessages(db, chatId, alice)
    const { ids: afterBob } = await getVisibleMessages(db, chatId, bob)
    assert.ok(!afterAlice.includes(msgId), 'Alice should NOT see deleted-for-everyone message')
    assert.ok(!afterBob.includes(msgId), 'Bob should NOT see deleted-for-everyone message')
  })

  // ── Pagination ────────────────────────────────────────────

  it('returns messages in chronological order with cursor-based pagination', async () => {
    // Use a fresh chat to avoid interference from other tests
    const paginationChatId = await createChat(db, alice)
    await db.query(
      `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [paginationChatId, bob],
    )

    // Insert 7 messages with known timestamps
    const timestamps = [
      '2026-06-07T13:00:00Z',
      '2026-06-07T13:01:00Z',
      '2026-06-07T13:02:00Z',
      '2026-06-07T13:03:00Z',
      '2026-06-07T13:04:00Z',
      '2026-06-07T13:05:00Z',
      '2026-06-07T13:06:00Z',
    ]
    const msgIds = []
    for (const ts of timestamps) {
      msgIds.push(await insertMessage(db, paginationChatId, alice, ts))
    }

    // Page 1: latest 3 messages
    const page1 = await getVisibleMessages(db, paginationChatId, alice, { limit: 3 })
    assert.equal(page1.ids.length, 3, 'Page 1 should have 3 messages')
    assert.ok(page1.hasMore, 'Page 1 should indicate more messages exist')
    assert.deepEqual(page1.ids, [msgIds[4], msgIds[5], msgIds[6]], 'Page 1 should be latest 3 in order')

    // Page 2: 3 before the oldest on page 1
    const oldestOnPage1Ts = timestamps[4]
    const page2 = await getVisibleMessages(db, paginationChatId, alice, {
      limit: 3,
      before: oldestOnPage1Ts,
    })
    assert.equal(page2.ids.length, 3, 'Page 2 should have 3 messages')
    assert.ok(page2.hasMore, 'Page 2 should indicate more messages exist')
    assert.deepEqual(page2.ids, [msgIds[1], msgIds[2], msgIds[3]], 'Page 2 should be correct middle 3')

    // Page 3: before oldest of page 2
    const oldestOnPage2Ts = timestamps[1]
    const page3 = await getVisibleMessages(db, paginationChatId, alice, {
      limit: 3,
      before: oldestOnPage2Ts,
    })
    assert.equal(page3.ids.length, 1, 'Page 3 should have 1 remaining message')
    assert.ok(!page3.hasMore, 'Page 3 should indicate no more messages')
    assert.deepEqual(page3.ids, [msgIds[0]], 'Page 3 should be first message only')
  })

  // ── Combination: clear history + delete-for-me ─────────────

  it('clear-history and delete-for-me are independent and both apply', async () => {
    const comboChatId = await createChat(db, alice)
    await db.query(
      `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [comboChatId, bob],
    )

    const msg1 = await insertMessage(db, comboChatId, alice, '2026-06-07T14:00:00Z')
    const msg2 = await insertMessage(db, comboChatId, alice, '2026-06-07T14:01:00Z')
    const msg3 = await insertMessage(db, comboChatId, alice, '2026-06-07T14:10:00Z')

    // Bob clears history at 14:05 (hides msg1 and msg2)
    await db.query(
      `INSERT INTO chat_history_clears (chat_id, user_id, cleared_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET cleared_at = EXCLUDED.cleared_at`,
      [comboChatId, bob, '2026-06-07T14:05:00Z'],
    )

    // Alice deletes msg3 for herself
    await db.query(
      `INSERT INTO message_user_deletions (message_id, user_id) VALUES ($1, $2)`,
      [msg3, alice],
    )

    const { ids: aliceIds } = await getVisibleMessages(db, comboChatId, alice)
    const { ids: bobIds } = await getVisibleMessages(db, comboChatId, bob)

    assert.ok(aliceIds.includes(msg1), 'Alice sees msg1 (not cleared for her)')
    assert.ok(aliceIds.includes(msg2), 'Alice sees msg2')
    assert.ok(!aliceIds.includes(msg3), 'Alice does NOT see msg3 (delete-for-me)')

    assert.ok(!bobIds.includes(msg1), 'Bob does NOT see msg1 (before clear)')
    assert.ok(!bobIds.includes(msg2), 'Bob does NOT see msg2 (before clear)')
    assert.ok(bobIds.includes(msg3), 'Bob sees msg3 (not deleted for him)')
  })
})
