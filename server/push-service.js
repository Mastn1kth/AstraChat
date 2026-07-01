import webpush from 'web-push'
import { isFcmEnabled, sendFcmMessage } from './fcm.js'
import { config } from './config.js'
import { db } from './db.js'
import { isUserOnline } from './redis.js'
import { socketsByUserId } from './socket-manager.js'
import logger from './logger.js'
import { isFutureTimestamp } from './server-helpers.js'
import { enqueueJob, registerJobHandler } from './job-queue.js'

export const PUSH_DELIVER_JOB_TYPE = 'push:deliver'

export function normalizePushExpiration(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function mentionPattern(username) {
  return new RegExp(`(^|[^\\w])@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i')
}

export function messageMentionsUser(searchText, user) {
  const username = String(user.username || '').replace(/^@/, '').trim()
  if (!username) return false
  return mentionPattern(username).test(String(searchText || ''))
}

export function messagePushBody(message, mentioned) {
  if (mentioned) return 'Mentioned you'
  if (message.text) return message.text.slice(0, 200)
  if (message.media) {
    const labels = {
      image: 'Photo',
      video: 'Video',
      voice: 'Voice message',
      file: 'File',
    }
    return labels[message.media.kind] || 'Attachment'
  }
  return 'New message'
}

export function shouldSendChatPush({ muted, pushMode, mentioned }) {
  if (pushMode === 'off') return false
  if (mentioned) return true
  if (muted) return false
  if (pushMode === 'mentions') return false
  return true
}

function toWebPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  }
}

export async function sendPushToSubscription(row, payload) {
  if (row.endpoint.startsWith('fcm:')) {
    try {
      const result = await sendFcmMessage(row.endpoint.slice(4), {
        title: payload.title,
        body: payload.body,
        data: {
          type: payload.type || '',
          chatId: payload.chatId || '',
          messageId: payload.messageId || '',
          code: payload.code || '',
        },
      })
      if (result.unregistered) {
        await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id])
        return false
      }
      if (result.ok) {
        await db.query(
          `UPDATE push_subscriptions
           SET last_success_at = NOW(), last_error = '', updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        )
      }
      return result.ok
    } catch (error) {
      logger.warn({ err: error.message }, '[push] fcm send failed')
      return false
    }
  }
  try {
    await webpush.sendNotification(toWebPushSubscription(row), JSON.stringify(payload), {
      TTL: 24 * 60 * 60,
      urgency: payload.mentioned ? 'high' : 'normal',
      topic: `chat-${payload.chatId}`.slice(0, 32),
      timeout: 5000,
    })
    await db.query(
      `UPDATE push_subscriptions
       SET last_success_at = NOW(), last_error = '', updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    )
    return true
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id])
      return false
    }
    await db.query(
      `UPDATE push_subscriptions
       SET last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [String(error.message || 'Push failed').slice(0, 500), row.id],
    )
    logger.warn({ err: error.message, statusCode: error.statusCode }, '[push] send failed')
    return false
  }
}

export async function sendLoginCodePushToToken(fcmToken, code) {
  if (!fcmToken || !isFcmEnabled()) return false
  try {
    const result = await sendFcmMessage(fcmToken, {
      title: 'Onda',
      body: `Your login code: ${code}`,
      data: { type: 'auth:code', code },
    })
    return result.ok
  } catch (error) {
    logger.warn({ err: error.message }, '[push] pre-auth code push failed')
    return false
  }
}

export async function sendLoginCodePush(userId, code) {
  if (!userId || (!config.vapid.enabled && !isFcmEnabled())) return 0
  const subscriptions = await db.query(
    `SELECT id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = $1`,
    [userId],
  )
  let sent = 0
  for (const row of subscriptions.rows) {
    const ok = await sendPushToSubscription(row, {
      title: 'Onda login code',
      body: `Your Onda code: ${code}`,
      type: 'auth:code',
      code,
    })
    if (ok) sent += 1
  }
  return sent
}

// Executes the actual push fan-out for a message. This does real network
// calls to FCM/APNs/web-push, so callers on the request path should prefer
// `enqueueOfflineMessagePushes` (durable, retried) over calling this directly.
export async function sendOfflineMessagePushes({ chatId, sender, message, searchText }) {
  if (!config.vapid.enabled && !isFcmEnabled()) return 0

  const recipients = await db.query(
    `SELECT cm.user_id, u.username, u.name, c.type, c.title,
            cus.muted_until, cus.push_mode
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     JOIN chats c ON c.id = cm.chat_id
     LEFT JOIN chat_user_settings cus
       ON cus.chat_id = cm.chat_id AND cus.user_id = cm.user_id
     WHERE cm.chat_id = $1 AND cm.user_id <> $2`,
    [chatId, sender.id],
  )

  let sent = 0
  for (const recipient of recipients.rows) {
    const online = socketsByUserId.has(recipient.user_id) || (await isUserOnline(recipient.user_id))
    if (online) continue

    const muted = isFutureTimestamp(recipient.muted_until)
    const pushMode = recipient.push_mode || 'default'
    const mentioned = messageMentionsUser(searchText, recipient)
    if (!shouldSendChatPush({ muted, pushMode, mentioned })) continue

    const subscriptions = await db.query(
      `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = $1`,
      [recipient.user_id],
    )
    if (!subscriptions.rows.length) continue

    const chatTitle = recipient.type === 'private'
      ? sender.name
      : recipient.title || (recipient.type === 'channel' ? 'Channel' : 'Group')
    const payload = {
      title: mentioned ? `${sender.name} mentioned you` : chatTitle,
      body: messagePushBody(message, mentioned),
      chatId,
      messageId: message.id,
      url: `/?chat=${encodeURIComponent(chatId)}`,
      tag: `chat-${chatId}`,
      mentioned,
    }

    for (const subscription of subscriptions.rows) {
      if (await sendPushToSubscription(subscription, payload)) sent += 1
    }
  }
  return sent
}

// Enqueues push delivery as a durable job instead of sending inline on the
// request path. A slow/failing push provider can no longer block or fail the
// message-send request, and delivery is retried with backoff on failure.
export async function enqueueOfflineMessagePushes({ chatId, sender, message, searchText }) {
  if (!config.vapid.enabled && !isFcmEnabled()) return null
  return enqueueJob(PUSH_DELIVER_JOB_TYPE, {
    chatId,
    sender: { id: sender.id, name: sender.name },
    message,
    searchText: searchText || '',
  })
}

registerJobHandler(PUSH_DELIVER_JOB_TYPE, async (payload) => {
  await sendOfflineMessagePushes({
    chatId: payload.chatId,
    sender: payload.sender,
    message: payload.message,
    searchText: payload.searchText,
  })
})
