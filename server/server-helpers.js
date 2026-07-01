import { createCipheriv, createDecipheriv, createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { db } from './db.js'
import { config } from './config.js'
import logger from './logger.js'
import { decryptMessage, encryptMessage } from './crypto.js'
import { createMediaCdnUrl } from './media-cdn.js'
import { getMediaObjectStream, saveMediaObjectStream } from './storage.js'
import { socketsByUserId, state, sendToUser } from './socket-manager.js'

// ── Scalar utilities ──────────────────────────────────────────────────────────

export function isDatabaseTrue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1'
}

export function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function isFutureTimestamp(value) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time > Date.now()
}

export function parseBooleanFormValue(value) {
  return value === true || value === 'true' || value === '1'
}

export function normalizeSearchText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 64000)
}

export function normalizeSearchQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function normalizeFolderTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function formatByteSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${Number(value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1))} ${units[unitIndex]}`
}

export function initials(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
}

export function summarizeUserAgent(userAgent = '') {
  const value = String(userAgent)
  if (!value) return 'Unknown device'
  const browser = value.includes('Edg/')
    ? 'Microsoft Edge'
    : value.includes('Chrome/')
      ? 'Chrome'
      : value.includes('Firefox/')
        ? 'Firefox'
        : value.includes('Safari/')
          ? 'Safari'
          : 'Browser'
  const os = value.includes('Windows')
    ? 'Windows'
    : value.includes('Mac OS')
      ? 'macOS'
      : value.includes('Android')
        ? 'Android'
        : value.includes('iPhone') || value.includes('iPad')
          ? 'iOS'
          : value.includes('Linux')
            ? 'Linux'
            : 'Unknown OS'
  return `${browser} on ${os}`
}

export function parseByteRange(range, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range || ''))
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null
  let start
  let end
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(totalSize - suffixLength, 0)
    end = totalSize - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : totalSize - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
  end = Math.min(end, totalSize - 1)
  if (start > end || start >= totalSize) return null
  return { start, end }
}

// ── Phone / auth helpers ──────────────────────────────────────────────────────

export function normalizePhone(countryCode, phone) {
  const country = String(countryCode || '').trim()
  const digits = String(phone || '').replace(/\D/g, '')
  if (!/^\+[1-9]\d{0,3}$/.test(country) || digits.length < 4 || digits.length > 15) {
    const error = new Error('Invalid phone number')
    error.status = 400
    throw error
  }
  const normalized = `${country}${digits}`
  if (!/^\+[1-9]\d{7,15}$/.test(normalized)) {
    const error = new Error('Invalid phone number')
    error.status = 400
    throw error
  }
  return normalized
}

export function hashPhoneCode(phone, code) {
  return createHash('sha256')
    .update(`${phone}:${code}:${config.adminToken}`)
    .digest('hex')
}

export function publicPhoneCodePayload(phone, code) {
  if (config.isProduction) return {}
  logger.debug({ phone }, '[phone-auth] dev code: %s', code)
  return { devCode: code }
}

// ── Public object serializers ─────────────────────────────────────────────────

export function parsePublicKey(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function stringifyPublicKey(publicKey) {
  const value = JSON.stringify(publicKey)
  if (value.length > 4096) {
    const error = new Error('Encryption public key is too large')
    error.status = 400
    throw error
  }
  return value
}

export function publicUser(user, { viewerIsContact = false, isSelf = false } = {}) {
  const privacyPhone = user.privacy_phone || 'contacts'
  const privacyLastSeen = user.privacy_last_seen || 'contacts'
  const privacyAvatar = user.privacy_avatar || 'contacts'
  const canSeePhone = isSelf
    || privacyPhone === 'everyone'
    || (privacyPhone === 'contacts' && viewerIsContact)
  const canSeeLastSeen = isSelf
    || privacyLastSeen === 'everyone'
    || (privacyLastSeen === 'contacts' && viewerIsContact)
  const canSeeAvatar = isSelf
    || privacyAvatar === 'everyone'
    || (privacyAvatar === 'contacts' && viewerIsContact)
  return {
    id: user.id,
    login: user.login,
    username: user.username,
    phone: canSeePhone ? (user.phone || '') : '',
    name: user.name,
    bio: user.bio,
    status: user.status || '',
    avatar: canSeeAvatar ? user.avatar : initials(user.name),
    encryptionPublicKey: parsePublicKey(user.encryption_public_key),
    totpEnabled: Boolean(user.totp_enabled_at || user.totp_secret),
    lastSeenAt: canSeeLastSeen ? (user.last_seen_at || null) : null,
    online: canSeeLastSeen
      ? (socketsByUserId.has(user.id) || state.onlineUserIdCache.has(user.id))
      : false,
    blockedByMe: isDatabaseTrue(user.blocked_by_me),
    blockedMe: isDatabaseTrue(user.blocked_me),
    isContact: isDatabaseTrue(user.is_contact),
    contactSince: user.contact_since || null,
    privacyPhone: isSelf ? privacyPhone : undefined,
    privacyLastSeen: isSelf ? privacyLastSeen : undefined,
    privacyAvatar: isSelf ? privacyAvatar : undefined,
  }
}

export function publicChatSettings(row = {}) {
  const mutedUntil = row.muted_until || null
  return {
    pinned: isDatabaseTrue(row.pinned),
    pinnedAt: row.pinned_at || null,
    muted: isFutureTimestamp(mutedUntil),
    mutedUntil,
    archived: isDatabaseTrue(row.archived),
    archivedAt: row.archived_at || null,
    pushMode: row.push_mode || 'default',
    autoDeleteSeconds: row.auto_delete_seconds ? Number(row.auto_delete_seconds) : null,
  }
}

export function publicSession(session, currentTokenHash) {
  return {
    id: session.id,
    device: summarizeUserAgent(session.user_agent),
    userAgent: session.user_agent || '',
    ipAddress: session.ip_address || '',
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at || session.created_at,
    expiresAt: session.expires_at,
    current: session.token_hash === currentTokenHash,
  }
}

function parseSecurityMetadata(value) {
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}

export function publicSecurityEvent(event) {
  return {
    id: event.id,
    type: event.type,
    severity: event.severity,
    title: event.title,
    body: event.body || '',
    metadata: parseSecurityMetadata(event.metadata),
    readAt: event.read_at || null,
    createdAt: event.created_at,
    actor: event.actor_user_id
      ? {
          id: event.actor_user_id,
          username: event.actor_username || '',
          name: event.actor_name || '',
          avatar: event.actor_avatar || '',
        }
      : null,
  }
}

export function publicCallRow(row, participants) {
  return {
    id: row.id,
    chatId: row.chat_id || null,
    initiatorId: row.initiator_id,
    recipientId: row.recipient_id || null,
    kind: row.kind,
    status: row.status,
    chatType: row.chat_type || null,
    chatTitle: row.chat_title || '',
    createdAt: row.created_at,
    answeredAt: row.answered_at || null,
    endedAt: row.ended_at || null,
    participants,
  }
}

export function publicWallMessage(row) {
  return {
    id: row.id,
    text: row.text,
    hue: Number(row.hue) || 20,
    createdAt: row.created_at,
  }
}

// ── TOTP helpers ──────────────────────────────────────────────────────────────

export function sealTotpSecret(secret) {
  return JSON.stringify(encryptMessage(secret))
}

export function openTotpSecret(value) {
  if (!value) return ''
  try {
    const envelope = JSON.parse(value)
    if (envelope?.ciphertext && envelope?.iv && envelope?.authTag) {
      return decryptMessage(envelope)
    }
  } catch {
    // Older/local dev rows may contain a plain base32 secret.
  }
  return value
}

// ── Security events ───────────────────────────────────────────────────────────

export async function createSecurityEvent({ userId, actorUserId = null, type, severity = 'info', title, body = '', metadata = {} }) {
  const id = randomUUID()
  const result = await db.query(
    `INSERT INTO security_events
      (id, user_id, actor_user_id, type, severity, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, actor_user_id, type, severity, title, body, metadata, read_at, created_at`,
    [id, userId, actorUserId, type, severity, title, body, JSON.stringify(metadata)],
  )
  const event = publicSecurityEvent(result.rows[0])
  await sendToUser(userId, { type: 'security:event', event })
  return event
}

// ── DB query helpers ──────────────────────────────────────────────────────────

export async function loadOwnTotpState(userId) {
  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_pending_secret, totp_enabled_at
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  )
  return result.rows[0] || null
}

export async function isChatMember(chatId, userId) {
  const result = await db.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 LIMIT 1',
    [chatId, userId],
  )
  return result.rows.length > 0
}

export async function requireChatMemberRow(chatId, userId) {
  const result = await db.query(
    `SELECT c.id, c.type, c.title, c.slow_mode_seconds, c.default_permissions, c.auto_delete_seconds,
            cm.role, cm.permissions, cm.last_message_at
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE c.id = $1 AND cm.user_id = $2
     LIMIT 1`,
    [chatId, userId],
  )
  return result.rows[0] || null
}

export async function isBannedFromChat(chatId, userId) {
  const result = await db.query(
    `SELECT 1
     FROM chat_bans
     WHERE chat_id = $1 AND user_id = $2
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [chatId, userId],
  )
  return result.rows.length > 0
}

export async function hasBlockBetween(firstUserId, secondUserId) {
  const result = await db.query(
    `SELECT blocker_id, blocked_id
     FROM user_blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [firstUserId, secondUserId],
  )
  return result.rows[0] || null
}

export async function privateChatCounterpart(chatId, userId) {
  const result = await db.query(
    `SELECT c.id, c.type, cm.user_id
     FROM chats c
     JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $2
     JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id <> $2
     WHERE c.id = $1 AND c.type = 'private'
     LIMIT 1`,
    [chatId, userId],
  )
  return result.rows[0]?.user_id || null
}

export async function requireUnblockedPrivateChat(chatId, userId) {
  const counterpartId = await privateChatCounterpart(chatId, userId)
  if (!counterpartId) return true
  const block = await hasBlockBetween(userId, counterpartId)
  if (!block) return true
  const error = new Error(block.blocker_id === userId ? 'You blocked this user' : 'This user is not available')
  error.status = 403
  throw error
}

export async function sharedUserIdsForKeyWarnings(userId) {
  const result = await db.query(
    `SELECT DISTINCT cm.user_id
     FROM chat_members mine
     JOIN chat_members cm ON cm.chat_id = mine.chat_id AND cm.user_id <> $1
     WHERE mine.user_id = $1`,
    [userId],
  )
  return result.rows.map((row) => row.user_id)
}

export async function ensureChatSettings(chatId, userId) {
  const result = await db.query(
    `INSERT INTO chat_user_settings (chat_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET updated_at = chat_user_settings.updated_at
     RETURNING pinned, pinned_at, muted_until, archived, archived_at, push_mode`,
    [chatId, userId],
  )
  return result.rows[0]
}

export async function validateMemberChatIds(userId, chatIds) {
  const uniqueChatIds = [...new Set(chatIds)]
  if (!uniqueChatIds.length) return []
  const result = await db.query(
    `SELECT chat_id
     FROM chat_members
     WHERE user_id = $1 AND chat_id = ANY($2::uuid[])`,
    [userId, uniqueChatIds],
  )
  if (result.rows.length !== uniqueChatIds.length) {
    const error = new Error('One or more chats are not available')
    error.status = 400
    throw error
  }
  return uniqueChatIds
}

export async function appendAdminLog(tx, { chatId, actorUserId, targetUserId = null, action, metadata = {} }) {
  await tx.query(
    `INSERT INTO chat_admin_log
      (id, chat_id, actor_user_id, target_user_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), chatId, actorUserId, targetUserId, action, JSON.stringify(metadata)],
  )
}

export async function getReactionCounts(messageId) {
  const result = await db.query(
    `SELECT emoji, COUNT(*)::integer AS count
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId],
  )
  return Object.fromEntries(result.rows.map((reaction) => [reaction.emoji, reaction.count]))
}

export async function getCallParticipants(callId, currentUserId) {
  const result = await db.query(
    `SELECT cp.user_id AS id, cp.role, cp.state, cp.muted, cp.camera_off,
            cp.screen_sharing, cp.joined_at, cp.left_at, cp.last_seen_at,
            u.login, u.username, u.name, u.bio, u.status, u.avatar, u.encryption_public_key,
            u.last_seen_at AS user_last_seen_at,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = $2 AND ub.blocked_id = u.id
            ) AS blocked_by_me,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = u.id AND ub.blocked_id = $2
            ) AS blocked_me
     FROM call_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.call_id = $1
     ORDER BY CASE WHEN cp.role = 'initiator' THEN 0 ELSE 1 END, cp.joined_at, u.name`,
    [callId, currentUserId],
  )
  return result.rows.map((row) => ({
    ...publicUser({ ...row, last_seen_at: row.user_last_seen_at }),
    role: row.role,
    state: row.state,
    muted: isDatabaseTrue(row.muted),
    cameraOff: isDatabaseTrue(row.camera_off),
    sharingScreen: isDatabaseTrue(row.screen_sharing),
    joinedAt: row.joined_at || null,
    leftAt: row.left_at || null,
    callLastSeenAt: row.last_seen_at || null,
    self: row.id === currentUserId,
  }))
}

// ── Permissions ───────────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS = {
  owner: {
    manage_chat: true,
    manage_members: true,
    manage_roles: true,
    ban_users: true,
    delete_messages: true,
    pin_messages: true,
    invite_users: true,
    approve_join_requests: true,
    manage_topics: true,
    send_messages: true,
    send_media: true,
    send_polls: true,
    post_messages: true,
    view_stats: true,
  },
  admin: {
    manage_chat: true,
    manage_members: true,
    manage_roles: false,
    ban_users: true,
    delete_messages: true,
    pin_messages: true,
    invite_users: true,
    approve_join_requests: true,
    manage_topics: true,
    send_messages: true,
    send_media: true,
    send_polls: true,
    post_messages: true,
    view_stats: true,
  },
  moderator: {
    manage_chat: false,
    manage_members: false,
    manage_roles: false,
    ban_users: true,
    delete_messages: true,
    pin_messages: true,
    invite_users: true,
    approve_join_requests: true,
    manage_topics: true,
    send_messages: true,
    send_media: true,
    send_polls: true,
    post_messages: false,
    view_stats: false,
  },
  member: {
    manage_chat: false,
    manage_members: false,
    manage_roles: false,
    ban_users: false,
    delete_messages: false,
    pin_messages: false,
    invite_users: false,
    approve_join_requests: false,
    manage_topics: false,
    send_messages: true,
    send_media: true,
    send_polls: true,
    post_messages: false,
    view_stats: false,
  },
}

export function publicChatPermissions(memberRow = {}) {
  const rolePermissions = ROLE_PERMISSIONS[memberRow.role] || ROLE_PERMISSIONS.member
  const defaultPermissions = parseJsonObject(memberRow.default_permissions)
  const memberPermissions = parseJsonObject(memberRow.permissions)
  return {
    ...rolePermissions,
    ...defaultPermissions,
    ...memberPermissions,
  }
}

export function hasPermission(memberRow, permission) {
  if (!memberRow) return false
  if (memberRow.role === 'owner') return true
  return Boolean(publicChatPermissions(memberRow)[permission])
}

export function requirePermission(memberRow, permission, message = 'Not enough permissions') {
  if (hasPermission(memberRow, permission)) return
  const error = new Error(message)
  error.status = 403
  throw error
}

export async function assertCanSendToChat(chatId, userId, { media = false, poll = false } = {}) {
  const member = await requireChatMemberRow(chatId, userId)
  if (!member) {
    const error = new Error('Chat not found')
    error.status = 404
    throw error
  }
  if (await isBannedFromChat(chatId, userId)) {
    const error = new Error('You are banned in this chat')
    error.status = 403
    throw error
  }
  if (member.type === 'channel') {
    requirePermission(member, 'post_messages', 'Only channel admins can post')
  } else {
    requirePermission(member, 'send_messages', 'Sending messages is not allowed')
  }
  if (media) requirePermission(member, 'send_media', 'Sending media is not allowed')
  if (poll) requirePermission(member, 'send_polls', 'Sending polls is not allowed')

  const slowModeSeconds = Number(member.slow_mode_seconds || 0)
  if (slowModeSeconds > 0 && !['owner', 'admin', 'moderator'].includes(member.role)) {
    const lastMessageAt = member.last_message_at ? new Date(member.last_message_at).getTime() : 0
    const remainingMs = lastMessageAt + slowModeSeconds * 1000 - Date.now()
    if (remainingMs > 0) {
      const error = new Error(`Slow mode is active. Try again in ${Math.ceil(remainingMs / 1000)} seconds`)
      error.status = 429
      throw error
    }
  }
  return member
}

// ── Message constants & query helpers ────────────────────────────────────────

export const INDEFINITE_MUTE_UNTIL = '9999-12-31T23:59:59.000Z'

export const MESSAGE_SELECT_COLUMNS = `
  m.id, m.chat_id, m.sender_id, m.media_id, m.reply_to_id, m.topic_id, m.ciphertext, m.iv,
  m.auth_tag, m.encryption_version, m.created_at, m.edited_at, m.deleted_at,
  m.forwarded_from_message_id, m.forwarded_from_chat_id,
  m.silent, m.scheduled_at, m.sent_at, m.link_preview, m.disappears_at, m.imported_from_name,
  mf.kind AS media_kind, mf.original_name AS media_name,
  mf.mime_type AS media_mime_type, mf.plain_size AS media_size,
  mf.original_size AS media_original_size, mf.width AS media_width,
  mf.height AS media_height, mf.client_encrypted AS media_client_encrypted,
  mf.media_envelope AS media_envelope, mf.duration_ms AS media_duration
`

export function visibleMessageFilter(userParam = '$2') {
  return `
    AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
    AND m.sent_at IS NOT NULL
    AND (m.disappears_at IS NULL OR m.disappears_at > NOW())
    AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
    AND NOT EXISTS (
      SELECT 1 FROM message_user_deletions mud
      WHERE mud.message_id = m.id AND mud.user_id = ${userParam}
    )
  `
}

export async function publicMessagesFromRows(chatId, rows, currentUserId = null) {
  const reactionResult = await db.query(
    `SELECT mr.message_id, mr.emoji, COUNT(*)::integer AS count
     FROM message_reactions mr
     JOIN messages m ON m.id = mr.message_id
     WHERE m.chat_id = $1
     GROUP BY mr.message_id, mr.emoji`,
    [chatId],
  )
  const reactionsByMessage = new Map()
  reactionResult.rows.forEach((reaction) => {
    const reactions = reactionsByMessage.get(reaction.message_id) || {}
    reactions[reaction.emoji] = reaction.count
    reactionsByMessage.set(reaction.message_id, reactions)
  })
  const readResult = await db.query(
    `SELECT mr.message_id, mr.user_id, u.name, u.username
     FROM message_reads mr
     JOIN messages m ON m.id = mr.message_id
     JOIN users u ON u.id = mr.user_id
     WHERE m.chat_id = $1 AND mr.user_id <> m.sender_id`,
    [chatId],
  )
  const readMessages = new Set(readResult.rows.map((read) => read.message_id))
  const readByMap = new Map()
  for (const row of readResult.rows) {
    if (!readByMap.has(row.message_id)) readByMap.set(row.message_id, [])
    readByMap.get(row.message_id).push({ userId: row.user_id, name: row.name, username: row.username })
  }
  const messageIds = rows.map((message) => message.id)
  const pollResult = messageIds.length
    ? await db.query(
        `SELECT p.id AS poll_id, p.message_id, p.question, p.multiple_choice,
                p.anonymous, p.quiz, p.closed_at,
                po.id AS option_id, po.text, po.sort_order,
                COUNT(pv.user_id)::integer AS votes,
                ${currentUserId ? `EXISTS (
                  SELECT 1 FROM poll_votes mine
                  WHERE mine.poll_id = p.id
                    AND mine.option_id = po.id
                    AND mine.user_id = $2
                )` : 'FALSE'} AS voted_by_me
         FROM polls p
         JOIN poll_options po ON po.poll_id = p.id
         LEFT JOIN poll_votes pv ON pv.option_id = po.id
         WHERE p.message_id = ANY($1::uuid[])
         GROUP BY p.id, p.message_id, p.question, p.multiple_choice,
                  p.anonymous, p.quiz, p.closed_at, po.id, po.text, po.sort_order
         ORDER BY po.sort_order`,
        currentUserId ? [messageIds, currentUserId] : [messageIds],
      )
    : { rows: [] }
  const pollsByMessage = new Map()
  pollResult.rows.forEach((row) => {
    const poll = pollsByMessage.get(row.message_id) || {
      id: row.poll_id,
      question: row.question,
      multipleChoice: isDatabaseTrue(row.multiple_choice),
      anonymous: isDatabaseTrue(row.anonymous),
      quiz: isDatabaseTrue(row.quiz),
      closedAt: row.closed_at || null,
      options: [],
    }
    poll.options.push({
      id: row.option_id,
      text: row.text,
      votes: Number(row.votes || 0),
      votedByMe: isDatabaseTrue(row.voted_by_me),
    })
    pollsByMessage.set(row.message_id, poll)
  })
  const statsResult = messageIds.length
    ? await db.query(
        `SELECT message_id, views, reposts
         FROM channel_post_stats
         WHERE message_id = ANY($1::uuid[])`,
        [messageIds],
      )
    : { rows: [] }
  const statsByMessage = new Map(
    statsResult.rows.map((row) => [
      row.message_id,
      { views: Number(row.views || 0), reposts: Number(row.reposts || 0) },
    ]),
  )

  return rows.map((message) => ({
    id: message.id,
    chatId: message.chat_id,
    senderId: message.sender_id,
    text: message.deleted_at
      ? ''
      : decryptMessage({
          ciphertext: message.ciphertext,
          iv: message.iv,
          authTag: message.auth_tag,
        }),
    createdAt: message.created_at,
    topicId: message.topic_id || null,
    editedAt: message.edited_at,
    deletedAt: message.deleted_at,
    silent: isDatabaseTrue(message.silent),
    scheduledAt: message.scheduled_at || null,
    sentAt: message.sent_at || null,
    replyToId: message.reply_to_id,
    forwarded: Boolean(message.forwarded_from_message_id),
    forwardedFromMessageId: message.forwarded_from_message_id,
    forwardedFromChatId: message.forwarded_from_chat_id,
    reactions: reactionsByMessage.get(message.id) || {},
    status: readMessages.has(message.id) ? 'read' : 'sent',
    readBy: readByMap.get(message.id) || [],
    media: message.media_id
      ? {
          id: message.media_id,
          kind: message.media_kind,
          name: message.media_name,
          mimeType: message.media_mime_type,
          size: Number(message.media_size),
          originalSize: Number(message.media_original_size),
          width: message.media_width,
          height: message.media_height,
          durationMs: message.media_duration ?? null,
          url: `/api/media/${message.media_id}`,
          cdnUrl: createMediaCdnUrl({
            mediaId: message.media_id,
            userId: currentUserId,
            clientEncrypted: isDatabaseTrue(message.media_client_encrypted),
          }),
          encrypted: isDatabaseTrue(message.media_client_encrypted),
          envelope: message.media_envelope || '',
        }
      : null,
    poll: pollsByMessage.get(message.id) || null,
    stats: statsByMessage.get(message.id) || null,
    linkPreview: message.link_preview || null,
    disappearsAt: message.disappears_at || null,
    importedFromName: message.imported_from_name || null,
  }))
}

// ── Media encryption helpers ──────────────────────────────────────────────────

export const serverMediaTransformMaxBytes = 100 * 1024 * 1024
export const MIME_PATTERN = /^[-+.\w]+\/[-+.\w]+$/

export function validateClientMediaMetadata(body) {
  const kind = String(body.kind || '')
  const mimeType = String(body.mimeType || '')
  const envelope = String(body.envelope || '')
  const originalName = String(body.originalName || 'encrypted-media').slice(0, 255)
  if (!['image', 'video', 'voice', 'audio', 'video_note', 'file'].includes(kind)) {
    const error = new Error('Encrypted media kind is invalid')
    error.status = 400
    throw error
  }
  const mimeOk =
    kind === 'image'
      ? /^image\/[-+.\w]+$/.test(mimeType)
      : kind === 'video' || kind === 'video_note'
        ? /^video\/[-+.\w]+$/.test(mimeType)
        : kind === 'voice' || kind === 'audio'
          ? /^audio\/[-+.\w]+$/.test(mimeType)
          : MIME_PATTERN.test(mimeType)
  if (!mimeOk) {
    const error = new Error('Encrypted media type is invalid')
    error.status = 400
    throw error
  }
  if (!envelope.startsWith('astra:media:v1:') || envelope.length > 128000) {
    const error = new Error('Encrypted media envelope is invalid')
    error.status = 400
    throw error
  }
  return {
    kind,
    mimeType,
    envelope,
    plainSize: parseOptionalInteger(body.plainSize),
    originalSize: parseOptionalInteger(body.originalSize),
    width: parseOptionalInteger(body.width),
    height: parseOptionalInteger(body.height),
    durationMs: parseOptionalInteger(body.durationMs),
    originalName,
  }
}

export async function encryptUploadedFileToStorage(file, storageName) {
  const { randomBytes } = await import('node:crypto')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.messageKey, iv)
  const input = createReadStream(file.path)
  input.on('error', (error) => cipher.destroy(error))
  await saveMediaObjectStream(storageName, input.pipe(cipher), { contentLength: file.size })
  return {
    encryptedSize: file.size,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function createMediaDecipher(media) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    config.messageKey,
    Buffer.from(media.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(media.auth_tag, 'base64'))
  return decipher
}

export class ByteRangeTransform extends Transform {
  constructor(start, end) {
    super()
    this.start = start
    this.end = end
    this.offset = 0
  }

  _transform(chunk, _encoding, callback) {
    const chunkStart = this.offset
    const chunkEnd = this.offset + chunk.length - 1
    this.offset += chunk.length

    if (chunkEnd < this.start || chunkStart > this.end) {
      callback()
      return
    }

    const sliceStart = Math.max(0, this.start - chunkStart)
    const sliceEnd = Math.min(chunk.length, this.end - chunkStart + 1)
    this.push(chunk.subarray(sliceStart, sliceEnd))
    callback()
  }
}

export async function streamDecryptedMedia(response, media, rangeHeader) {
  const contentLength = isDatabaseTrue(media.client_encrypted)
    ? Number(media.encrypted_size)
    : Number(media.plain_size)
  const totalSize = Number.isFinite(contentLength) ? contentLength : 0

  response.setHeader(
    'Content-Type',
    isDatabaseTrue(media.client_encrypted) ? 'application/octet-stream' : media.mime_type,
  )
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Content-Disposition', 'inline')

  if (!rangeHeader) {
    const encryptedStream = await getMediaObjectStream(media.storage_name)
    const decipher = createMediaDecipher(media)
    response.setHeader('Content-Length', totalSize)
    await pipeline(encryptedStream, decipher, response)
    return
  }

  const range = parseByteRange(rangeHeader, totalSize)
  if (!range) {
    response.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end()
    return
  }

  const encryptedStream = await getMediaObjectStream(media.storage_name)
  const decipher = createMediaDecipher(media)
  response.status(206)
  response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`)
  response.setHeader('Content-Length', range.end - range.start + 1)
  await pipeline(encryptedStream, decipher, new ByteRangeTransform(range.start, range.end), response)
}
