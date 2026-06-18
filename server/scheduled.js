import { db } from './db.js'
import logger from './logger.js'
import { MESSAGE_SELECT_COLUMNS, publicMessagesFromRows } from './server-helpers.js'
import { sendToChatExcept, sendToUser } from './socket-manager.js'
import { sendOfflineMessagePushes } from './push-service.js'

let publishingScheduled = false

export async function publishScheduledMessage(messageId) {
  const result = await db.query(
    `UPDATE messages
     SET sent_at = NOW()
     WHERE id = $1
       AND scheduled_at IS NOT NULL
       AND sent_at IS NULL
     RETURNING id, chat_id, sender_id, topic_id, forwarded_from_message_id, search_text`,
    [messageId],
  )
  const scheduled = result.rows[0]
  if (!scheduled) return null

  const rows = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.id = $1`,
    [messageId],
  )
  const [publicMessage] = await publicMessagesFromRows(scheduled.chat_id, rows.rows)
  if (!publicMessage) return null

  await db.transaction(async (tx) => {
    await tx.query(
      'UPDATE chat_members SET last_message_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [scheduled.chat_id, scheduled.sender_id],
    )
    if (scheduled.topic_id) {
      await tx.query(
        `UPDATE chat_topics
         SET message_count = message_count + 1,
             last_message_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND chat_id = $2`,
        [scheduled.topic_id, scheduled.chat_id],
      )
    }
    const chatResult = await tx.query('SELECT type FROM chats WHERE id = $1 LIMIT 1', [scheduled.chat_id])
    if (chatResult.rows[0]?.type === 'channel') {
      await tx.query(
        `INSERT INTO channel_post_stats (message_id)
         VALUES ($1)
         ON CONFLICT (message_id) DO NOTHING`,
        [messageId],
      )
    }
    if (scheduled.forwarded_from_message_id) {
      await tx.query(
        `INSERT INTO channel_post_stats (message_id, reposts)
         VALUES ($1, 1)
         ON CONFLICT (message_id)
         DO UPDATE SET reposts = channel_post_stats.reposts + 1,
                       updated_at = NOW()`,
        [scheduled.forwarded_from_message_id],
      )
    }
  })

  await sendToChatExcept(scheduled.chat_id, scheduled.sender_id, {
    type: 'message:new',
    message: publicMessage,
  })
  const senderResult = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [scheduled.sender_id])
  if (senderResult.rows[0] && !publicMessage.silent) {
    await sendOfflineMessagePushes({
      chatId: scheduled.chat_id,
      sender: senderResult.rows[0],
      message: publicMessage,
      searchText: scheduled.search_text,
    })
  }
  await sendToUser(scheduled.sender_id, {
    type: 'message:delivered',
    chatId: scheduled.chat_id,
    messageId,
    delivered: true,
  })
  return publicMessage
}

export async function publishDueScheduledMessages() {
  if (publishingScheduled) return
  publishingScheduled = true
  try {
    const due = await db.query(
      `SELECT id
       FROM messages
       WHERE scheduled_at IS NOT NULL
         AND scheduled_at <= NOW()
         AND sent_at IS NULL
       ORDER BY scheduled_at ASC
       LIMIT 50`,
    )
    for (const message of due.rows) {
      try {
        await publishScheduledMessage(message.id)
      } catch (error) {
        logger.error({ msgId: message.id, err: error.message }, '[scheduled] publish failed')
      }
    }
  } finally {
    publishingScheduled = false
  }
}
