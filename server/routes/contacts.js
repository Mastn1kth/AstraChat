import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { parseBody, reportSchema } from '../validation.js'
import { publicUser, isChatMember, hasBlockBetween } from '../server-helpers.js'

const router = Router()

router.get('/api/contacts', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar,
            u.last_seen_at, u.encryption_public_key,
            TRUE AS is_contact,
            uc.created_at AS contact_since,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = $1 AND ub.blocked_id = u.id
            ) AS blocked_by_me,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = u.id AND ub.blocked_id = $1
            ) AS blocked_me
     FROM user_contacts uc
     JOIN users u ON u.id = uc.contact_user_id
     WHERE uc.owner_id = $1
     ORDER BY u.name, u.username`,
    [request.user.id],
  )
  response.json({ contacts: result.rows.map(publicUser) })
})

router.post('/api/contacts/:userId', requireAuth, async (request, response) => {
  if (request.params.userId === request.user.id) {
    response.status(400).json({ error: 'Cannot add yourself as a contact' })
    return
  }
  const target = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [request.params.userId],
  )
  if (!target.rows.length) {
    response.status(404).json({ error: 'User not found' })
    return
  }
  if (await hasBlockBetween(request.user.id, request.params.userId)) {
    response.status(403).json({ error: 'Cannot add a blocked user as a contact' })
    return
  }
  await db.query(
    `INSERT INTO user_contacts (owner_id, contact_user_id)
     VALUES ($1, $2)
     ON CONFLICT (owner_id, contact_user_id) DO NOTHING`,
    [request.user.id, request.params.userId],
  )
  response.status(201).json({
    contact: publicUser({
      ...target.rows[0],
      is_contact: true,
      contact_since: new Date().toISOString(),
      blocked_by_me: false,
      blocked_me: false,
    }),
  })
})

router.delete('/api/contacts/:userId', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_contacts WHERE owner_id = $1 AND contact_user_id = $2',
    [request.user.id, request.params.userId],
  )
  response.status(204).end()
})

router.post('/api/reports', requireAuth, async (request, response) => {
  const input = parseBody(reportSchema, request.body)
  let targetUserId = input.targetUserId || null
  let targetChatId = input.chatId || null

  if (targetUserId === request.user.id) {
    response.status(400).json({ error: 'Cannot report yourself' })
    return
  }

  if (targetUserId) {
    const user = await db.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetUserId])
    if (!user.rows.length) {
      response.status(404).json({ error: 'Reported user not found' })
      return
    }
  }

  if (input.targetMessageId) {
    const message = await db.query(
      `SELECT m.id, m.sender_id, m.chat_id
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = $1
       LIMIT 1`,
      [input.targetMessageId, request.user.id],
    )
    if (!message.rows.length) {
      response.status(404).json({ error: 'Reported message not found' })
      return
    }
    targetUserId = targetUserId || message.rows[0].sender_id
    targetChatId = targetChatId || message.rows[0].chat_id
  }

  if (targetChatId && !(await isChatMember(targetChatId, request.user.id))) {
    response.status(404).json({ error: 'Reported chat not found' })
    return
  }

  const reportId = randomUUID()
  await db.query(
    `INSERT INTO reports
      (id, reporter_id, target_user_id, target_message_id, target_chat_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      reportId,
      request.user.id,
      targetUserId,
      input.targetMessageId || null,
      targetChatId,
      input.reason,
      input.details,
    ],
  )
  response.status(201).json({ report: { id: reportId, status: 'open' } })
})

export default router
