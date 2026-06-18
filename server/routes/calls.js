import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { parseBody, callSchema } from '../validation.js'
import { sendToUser } from '../socket-manager.js'
import {
  publicUser,
  publicCallRow,
  getCallParticipants,
  hasBlockBetween,
  isChatMember,
} from '../server-helpers.js'

const router = Router()

router.get('/', requireAuth, async (request, response) => {
  const chatId = typeof request.query.chatId === 'string' ? request.query.chatId : ''
  const params = [request.user.id]
  let chatFilter = ''
  if (chatId) {
    if (!(await isChatMember(chatId, request.user.id))) {
      response.status(404).json({ error: 'Chat not found' })
      return
    }
    params.push(chatId)
    chatFilter = 'AND c.chat_id = $2'
  }

  const result = await db.query(
    `SELECT c.id, c.chat_id, c.initiator_id, c.recipient_id, c.kind, c.status,
            c.created_at, c.answered_at, c.ended_at, ch.type AS chat_type, ch.title AS chat_title
     FROM calls c
     JOIN call_participants mine ON mine.call_id = c.id AND mine.user_id = $1
     LEFT JOIN chats ch ON ch.id = c.chat_id
     WHERE 1 = 1 ${chatFilter}
     ORDER BY c.created_at DESC
     LIMIT 50`,
    params,
  )

  const calls = []
  for (const row of result.rows) {
    calls.push(publicCallRow(row, await getCallParticipants(row.id, request.user.id)))
  }
  response.json({ calls })
})

router.get('/ice-servers', requireAuth, (_request, response) => {
  response.json({ iceServers: config.webrtc.iceServers })
})

router.post('/', requireAuth, async (request, response) => {
  const input = parseBody(callSchema, request.body)
  if (input.recipientId === request.user.id) {
    response.status(400).json({ error: 'Cannot call yourself' })
    return
  }

  await db.query(
    `UPDATE calls
     SET status = 'missed', ended_at = NOW()
     WHERE status = 'ringing' AND created_at < NOW() - INTERVAL '90 seconds'`,
  )
  await db.query(
    `UPDATE call_participants
     SET state = 'missed', left_at = NOW()
     WHERE state IN ('invited', 'ringing')
       AND call_id IN (SELECT id FROM calls WHERE status = 'missed')`,
  )

  let chat = null
  let recipientIds = []
  if (input.chatId) {
    const chatResult = await db.query(
      `SELECT c.id, c.type, c.title
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $2
       WHERE c.id = $1
       LIMIT 1`,
      [input.chatId, request.user.id],
    )
    chat = chatResult.rows[0]
    if (!chat) {
      response.status(404).json({ error: 'Chat not found' })
      return
    }
    if (chat.type === 'channel' || chat.type === 'saved') {
      response.status(400).json({ error: 'Calls are available in private chats and groups' })
      return
    }
    const members = await db.query(
      'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2',
      [input.chatId, request.user.id],
    )
    recipientIds = members.rows.map((member) => member.user_id)
    if (chat.type === 'private' && input.recipientId && !recipientIds.includes(input.recipientId)) {
      response.status(400).json({ error: 'Calls require a shared private chat' })
      return
    }
  } else {
    const recipient = await db.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [input.recipientId])
    if (!recipient.rows.length) {
      response.status(404).json({ error: 'Recipient not found' })
      return
    }
    recipientIds = [input.recipientId]
  }

  if (input.recipientId && !recipientIds.includes(input.recipientId)) {
    recipientIds = [input.recipientId]
  }
  recipientIds = [...new Set(recipientIds)].filter((userId) => userId !== request.user.id)
  if (!recipientIds.length) {
    response.status(400).json({ error: 'Call requires at least one other participant' })
    return
  }

  for (const recipientId of recipientIds) {
    if (await hasBlockBetween(request.user.id, recipientId)) {
      response.status(403).json({ error: 'Call is blocked' })
      return
    }
  }

  const participantIds = [request.user.id, ...recipientIds]
  const busy = await db.query(
    `SELECT cp.call_id
     FROM call_participants cp
     JOIN calls c ON c.id = cp.call_id
     WHERE cp.user_id = ANY($1::uuid[])
       AND c.status IN ('ringing', 'accepted')
       AND cp.state IN ('invited', 'ringing', 'connected', 'disconnected')
     LIMIT 1`,
    [participantIds],
  )
  if (busy.rows.length) {
    response.status(409).json({ error: 'One of the users is already in a call' })
    return
  }

  const callId = randomUUID()
  const primaryRecipientId = chat?.type === 'group' ? null : recipientIds[0]
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO calls (id, chat_id, initiator_id, recipient_id, kind, status)
       VALUES ($1, $2, $3, $4, $5, 'ringing')`,
      [callId, input.chatId || null, request.user.id, primaryRecipientId, input.kind],
    )
    await tx.query(
      `INSERT INTO call_participants
        (call_id, user_id, role, state, muted, camera_off, joined_at)
       VALUES ($1, $2, 'initiator', 'connected', FALSE, $3, NOW())`,
      [callId, request.user.id, input.kind !== 'video'],
    )
    for (const recipientId of recipientIds) {
      await tx.query(
        `INSERT INTO call_participants
          (call_id, user_id, role, state, camera_off)
         VALUES ($1, $2, 'member', 'ringing', $3)`,
        [callId, recipientId, input.kind !== 'video'],
      )
    }
  })

  const participants = await getCallParticipants(callId, request.user.id)
  const onlineParticipantIds = []
  for (const recipientId of recipientIds) {
    const delivered = await sendToUser(recipientId, {
      type: 'call:incoming',
      callId,
      kind: input.kind,
      chatId: input.chatId || null,
      from: publicUser(request.user),
      participants,
      iceServers: config.webrtc.iceServers,
    })
    if (delivered) {
      onlineParticipantIds.push(recipientId)
    } else {
      await db.query(
        `UPDATE call_participants
         SET state = 'missed', left_at = NOW(), last_seen_at = NOW()
         WHERE call_id = $1 AND user_id = $2 AND state = 'ringing'`,
        [callId, recipientId],
      )
    }
  }

  const row = {
    id: callId,
    chat_id: input.chatId || null,
    initiator_id: request.user.id,
    recipient_id: primaryRecipientId,
    kind: input.kind,
    status: 'ringing',
    created_at: new Date().toISOString(),
    answered_at: null,
    ended_at: null,
    chat_type: chat?.type || (primaryRecipientId ? 'private' : null),
    chat_title: chat?.title || '',
  }
  response.status(201).json({
    call: {
      ...publicCallRow(row, await getCallParticipants(callId, request.user.id)),
      online: onlineParticipantIds.length > 0,
      onlineParticipantIds,
      iceServers: config.webrtc.iceServers,
    },
  })
})

export default router
