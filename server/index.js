import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { createServer } from 'node:http'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'
import { isFcmEnabled, sendFcmMessage } from './fcm.js'
import WebSocket, { WebSocketServer } from 'ws'
import { config } from './config.js'
import { createSavedChat, db, migrateDatabase, cleanupExpiredSessions } from './db.js'
import {
  checkStorage,
  deleteMediaObject,
  getMediaObject,
  getMediaObjectStream,
  saveMediaObject,
  saveMediaObjectStream,
} from './storage.js'
import {
  addPresence,
  closeRedis,
  checkRedis,
  deleteCachedSession,
  deleteCachedSessions,
  getOnlineUserIds,
  initRedis,
  isUserOnline,
  onSocketMessage,
  publishSocketMessage,
  redis,
  refreshPresence,
  removePresence,
} from './redis.js'
import {
  httpRequestDuration,
  metricsContentType,
  metricsText,
  websocketConnections,
} from './metrics.js'
import {
  createSession,
  destroySession,
  getSessionTokenHash,
  getSessionUser,
  requireAuth,
} from './auth.js'
import {
  decryptBuffer,
  decryptMessage,
  encryptBuffer,
  encryptMessage,
  createTotpSecret,
  createTotpUri,
  hashPassword,
  verifyTotpCode,
  verifyPassword,
} from './crypto.js'
import {
  cleanupUploadedFile,
  compressAvatar,
  compressImage,
  compressVideo,
  getMediaKind,
  mediaUpload,
  mediaUploadMaxBytes,
  readUploadedFile,
} from './media.js'
import {
  callSchema,
  banMemberSchema,
  changePasswordSchema,
  chatFolderChatSettingsSchema,
  chatFolderSchema,
  chatModerationSettingsSchema,
  chatSettingsSchema,
  deletePushSubscriptionSchema,
  fcmTokenSchema,
  inviteLinkSchema,
  joinInviteSchema,
  memberPermissionsSchema,
  memberRoleSchema,
  pinMessageSchema,
  createChatSchema,
  editMessageSchema,
  encryptionKeySchema,
  loginSchema,
  messageSchema,
  parseBody,
  phoneAuthStartSchema,
  phoneAuthVerifySchema,
  pollVoteSchema,
  profileSchema,
  pushSubscriptionSchema,
  reactionSchema,
  registerSchema,
  reportSchema,
  reviewJoinRequestSchema,
  topicSchema,
  totpVerifySchema,
  updateTopicSchema,
  updateChatFolderSchema,
} from './validation.js'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const socketsByUserId = new Map()
let onlineUserIdCache = new Set()

if (config.vapid.enabled) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  )
}

app.disable('x-powered-by')
if (config.trustProxy) app.set('trust proxy', config.trustProxy)
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(express.json({ limit: '512kb' }))
app.use(cookieParser())
app.use((request, response, next) => {
  if (!config.allowedOrigins.length) {
    next()
    return
  }
  const origin = request.headers.origin
  if (!origin) {
    next()
    return
  }
  if (!config.allowedOrigins.includes(origin)) {
    response.status(403).json({ error: 'Origin is not allowed' })
    return
  }
  // Cross-origin clients (the Capacitor mobile shell, a separately hosted
  // frontend) need real CORS headers, including credentialed cookies.
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Vary', 'Origin')
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    response.setHeader(
      'Access-Control-Allow-Headers',
      request.headers['access-control-request-headers'] || 'Content-Type',
    )
    response.setHeader('Access-Control-Max-Age', '86400')
    response.status(204).end()
    return
  }
  next()
})
app.use((request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
app.use((request, response, next) => {
  const end = httpRequestDuration.startTimer()
  response.on('finish', () => {
    end({
      method: request.method,
      route: request.route?.path || request.path,
      status: String(response.statusCode),
    })
  })
  next()
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: redis
    ? new RedisStore({
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined,
})

const wallLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  store: redis
    ? new RedisStore({
        prefix: 'rl:wall:',
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined,
})

// 60 messages per minute per user
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  store: redis
    ? new RedisStore({
        prefix: 'rl:msg:',
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined,
})

// 30 media uploads per 10 minutes per user
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  store: redis
    ? new RedisStore({
        prefix: 'rl:upload:',
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined,
})

// 200 general API requests per minute per user (search, profile reads, etc.)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  store: redis
    ? new RedisStore({
        prefix: 'rl:api:',
        sendCommand: (...args) => redis.call(...args),
      })
    : undefined,
})

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    username: user.username,
    phone: user.phone || '',
    name: user.name,
    bio: user.bio,
    status: user.status || '',
    avatar: user.avatar,
    encryptionPublicKey: parsePublicKey(user.encryption_public_key),
    totpEnabled: Boolean(user.totp_enabled_at || user.totp_secret),
    lastSeenAt: user.last_seen_at || null,
    online: socketsByUserId.has(user.id) || onlineUserIdCache.has(user.id),
    blockedByMe: isDatabaseTrue(user.blocked_by_me),
    blockedMe: isDatabaseTrue(user.blocked_me),
    isContact: isDatabaseTrue(user.is_contact),
    contactSince: user.contact_since || null,
  }
}

function parsePublicKey(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function stringifyPublicKey(publicKey) {
  const value = JSON.stringify(publicKey)
  if (value.length > 4096) {
    const error = new Error('Encryption public key is too large')
    error.status = 400
    throw error
  }
  return value
}

function normalizePhone(countryCode, phone) {
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

function hashPhoneCode(phone, code) {
  return createHash('sha256')
    .update(`${phone}:${code}:${config.adminToken}`)
    .digest('hex')
}

function publicPhoneCodePayload(phone, code) {
  if (config.isProduction) return {}
  console.log(`[phone-auth] ${phone} code: ${code}`)
  return { devCode: code }
}

function sealTotpSecret(secret) {
  return JSON.stringify(encryptMessage(secret))
}

function openTotpSecret(value) {
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

async function loadOwnTotpState(userId) {
  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_pending_secret, totp_enabled_at
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  )
  return result.rows[0] || null
}

function parseBooleanFormValue(value) {
  return value === true || value === 'true' || value === '1'
}

function isDatabaseTrue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1'
}

const serverMediaTransformMaxBytes = 100 * 1024 * 1024

function formatByteSize(bytes) {
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

async function encryptUploadedFileToStorage(file, storageName) {
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

function createMediaDecipher(media) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    config.messageKey,
    Buffer.from(media.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(media.auth_tag, 'base64'))
  return decipher
}

class ByteRangeTransform extends Transform {
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

function parseByteRange(range, totalSize) {
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

async function streamDecryptedMedia(response, media, rangeHeader) {
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

const INDEFINITE_MUTE_UNTIL = '9999-12-31T23:59:59.000Z'

function normalizeSearchText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 64000)
}

function normalizeSearchQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

const MESSAGE_SELECT_COLUMNS = `
  m.id, m.chat_id, m.sender_id, m.media_id, m.reply_to_id, m.topic_id, m.ciphertext, m.iv,
  m.auth_tag, m.encryption_version, m.created_at, m.edited_at, m.deleted_at,
  m.forwarded_from_message_id, m.forwarded_from_chat_id,
  m.silent, m.scheduled_at, m.sent_at, m.link_preview,
  mf.kind AS media_kind, mf.original_name AS media_name,
  mf.mime_type AS media_mime_type, mf.plain_size AS media_size,
  mf.original_size AS media_original_size, mf.width AS media_width,
  mf.height AS media_height, mf.client_encrypted AS media_client_encrypted,
  mf.media_envelope AS media_envelope, mf.duration_ms AS media_duration
`

function visibleMessageFilter(userParam = '$2') {
  return `
    AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
    AND m.sent_at IS NOT NULL
    AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
    AND NOT EXISTS (
      SELECT 1 FROM message_user_deletions mud
      WHERE mud.message_id = m.id AND mud.user_id = ${userParam}
    )
  `
}

function normalizeFolderTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isFutureTimestamp(value) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time > Date.now()
}

function publicChatSettings(row = {}) {
  const mutedUntil = row.muted_until || null
  return {
    pinned: isDatabaseTrue(row.pinned),
    pinnedAt: row.pinned_at || null,
    muted: isFutureTimestamp(mutedUntil),
    mutedUntil,
    archived: isDatabaseTrue(row.archived),
    archivedAt: row.archived_at || null,
    pushMode: row.push_mode || 'default',
  }
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
}

const MIME_PATTERN = /^[-+.\w]+\/[-+.\w]+$/

function validateClientMediaMetadata(body) {
  const kind = String(body.kind || '')
  const mimeType = String(body.mimeType || '')
  const envelope = String(body.envelope || '')
  const originalName = String(body.originalName || 'encrypted-media').slice(0, 255)
  if (!['image', 'video', 'voice', 'audio', 'file'].includes(kind)) {
    const error = new Error('Encrypted media kind is invalid')
    error.status = 400
    throw error
  }
  const mimeOk =
    kind === 'image'
      ? /^image\/[-+.\w]+$/.test(mimeType)
      : kind === 'video'
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

function summarizeUserAgent(userAgent = '') {
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

function publicSession(session, currentTokenHash) {
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

function publicSecurityEvent(event) {
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

async function createSecurityEvent({ userId, actorUserId = null, type, severity = 'info', title, body = '', metadata = {} }) {
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

async function hasBlockBetween(firstUserId, secondUserId) {
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

async function privateChatCounterpart(chatId, userId) {
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

async function requireUnblockedPrivateChat(chatId, userId) {
  const counterpartId = await privateChatCounterpart(chatId, userId)
  if (!counterpartId) return true
  const block = await hasBlockBetween(userId, counterpartId)
  if (!block) return true
  const error = new Error(block.blocker_id === userId ? 'You blocked this user' : 'This user is not available')
  error.status = 403
  throw error
}

async function sharedUserIdsForKeyWarnings(userId) {
  const result = await db.query(
    `SELECT DISTINCT cm.user_id
     FROM chat_members mine
     JOIN chat_members cm ON cm.chat_id = mine.chat_id AND cm.user_id <> $1
     WHERE mine.user_id = $1`,
    [userId],
  )
  return result.rows.map((row) => row.user_id)
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

async function isChatMember(chatId, userId) {
  const result = await db.query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 LIMIT 1',
    [chatId, userId],
  )
  return result.rows.length > 0
}

async function requireChatMemberRow(chatId, userId) {
  const result = await db.query(
    `SELECT c.id, c.type, c.title, c.slow_mode_seconds, c.default_permissions,
            cm.role, cm.permissions, cm.last_message_at
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE c.id = $1 AND cm.user_id = $2
     LIMIT 1`,
    [chatId, userId],
  )
  return result.rows[0] || null
}

const ROLE_PERMISSIONS = {
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

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function publicChatPermissions(memberRow = {}) {
  const rolePermissions = ROLE_PERMISSIONS[memberRow.role] || ROLE_PERMISSIONS.member
  const defaultPermissions = parseJsonObject(memberRow.default_permissions)
  const memberPermissions = parseJsonObject(memberRow.permissions)
  return {
    ...rolePermissions,
    ...defaultPermissions,
    ...memberPermissions,
  }
}

function hasPermission(memberRow, permission) {
  if (!memberRow) return false
  if (memberRow.role === 'owner') return true
  return Boolean(publicChatPermissions(memberRow)[permission])
}

function requirePermission(memberRow, permission, message = 'Not enough permissions') {
  if (hasPermission(memberRow, permission)) return
  const error = new Error(message)
  error.status = 403
  throw error
}

async function appendAdminLog(tx, { chatId, actorUserId, targetUserId = null, action, metadata = {} }) {
  await tx.query(
    `INSERT INTO chat_admin_log
      (id, chat_id, actor_user_id, target_user_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), chatId, actorUserId, targetUserId, action, JSON.stringify(metadata)],
  )
}

async function isBannedFromChat(chatId, userId) {
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

async function assertCanSendToChat(chatId, userId, { media = false, poll = false } = {}) {
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

async function ensureChatSettings(chatId, userId) {
  const result = await db.query(
    `INSERT INTO chat_user_settings (chat_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET updated_at = chat_user_settings.updated_at
     RETURNING pinned, pinned_at, muted_until, archived, archived_at, push_mode`,
    [chatId, userId],
  )
  return result.rows[0]
}

async function validateMemberChatIds(userId, chatIds) {
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

async function getReactionCounts(messageId) {
  const result = await db.query(
    `SELECT emoji, COUNT(*)::integer AS count
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId],
  )
  return Object.fromEntries(result.rows.map((reaction) => [reaction.emoji, reaction.count]))
}

async function publicMessagesFromRows(chatId, rows, currentUserId = null) {
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
          encrypted: isDatabaseTrue(message.media_client_encrypted),
          envelope: message.media_envelope || '',
      }
      : null,
    poll: pollsByMessage.get(message.id) || null,
    stats: statsByMessage.get(message.id) || null,
    linkPreview: message.link_preview || null,
  }))
}

function addSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId) || new Set()
  sockets.add(socket)
  socketsByUserId.set(userId, sockets)
  websocketConnections.inc()
  onlineUserIdCache.add(userId)
  return sockets.size
}

function removeSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId)
  if (!sockets) return 0
  sockets.delete(socket)
  websocketConnections.dec()
  if (!sockets.size) {
    socketsByUserId.delete(userId)
    onlineUserIdCache.delete(userId)
  }
  return sockets.size
}

function deliverToLocalUser(userId, payload) {
  const sockets = socketsByUserId.get(userId)
  if (!sockets) return false
  const message = JSON.stringify(payload)
  let delivered = false
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message)
      delivered = true
    }
  }
  return delivered
}

async function sendToUser(userId, payload) {
  const deliveredLocally = deliverToLocalUser(userId, payload)
  await publishSocketMessage({ kind: 'user', userId, payload })
  return deliveredLocally || (await isUserOnline(userId))
}

function deliverLocalBroadcast(payload, excludedUserId = '') {
  const message = JSON.stringify(payload)
  socketsByUserId.forEach((sockets, userId) => {
    if (userId === excludedUserId) return
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    })
  })
}

async function broadcast(payload, excludedUserId = '') {
  deliverLocalBroadcast(payload, excludedUserId)
  await publishSocketMessage({ kind: 'broadcast', excludedUserId, payload })
}

async function sendToChatExcept(chatId, excludedUserId, payload) {
  const members = await db.query(
    'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2',
    [chatId, excludedUserId],
  )
  let delivered = 0
  for (const member of members.rows) {
    if (await sendToUser(member.user_id, payload)) delivered += 1
  }
  return delivered
}

async function sendToChat(chatId, payload) {
  const members = await db.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId])
  let delivered = 0
  for (const member of members.rows) {
    if (await sendToUser(member.user_id, payload)) delivered += 1
  }
  return delivered
}

async function sendToCall(callId, payload, excludedUserId = '') {
  const participants = await db.query(
    'SELECT user_id FROM call_participants WHERE call_id = $1',
    [callId],
  )
  let delivered = 0
  for (const participant of participants.rows) {
    if (participant.user_id === excludedUserId) continue
    if (await sendToUser(participant.user_id, payload)) delivered += 1
  }
  return delivered
}

async function getCallParticipants(callId, currentUserId) {
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

function publicCallRow(row, participants) {
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

function normalizePushExpiration(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function mentionPattern(username) {
  return new RegExp(`(^|[^\\w])@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i')
}

function messageMentionsUser(searchText, user) {
  const username = String(user.username || '').replace(/^@/, '').trim()
  if (!username) return false
  return mentionPattern(username).test(String(searchText || ''))
}

function messagePushBody(message, mentioned) {
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

function shouldSendChatPush({ muted, pushMode, mentioned }) {
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

async function sendPushToSubscription(row, payload) {
  // Native mobile tokens are stored as `fcm:<token>` and go through FCM v1.
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
      console.warn('[push] fcm send failed', error.message)
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
    console.warn('[push] send failed', error.statusCode || '', error.message)
    return false
  }
}

async function sendLoginCodePush(userId, code) {
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

async function sendOfflineMessagePushes({ chatId, sender, message, searchText }) {
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

async function publishScheduledMessage(messageId) {
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

async function publishDueScheduledMessages() {
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
      console.error('[scheduled] publish failed', message.id, error.message)
    }
  }
}

app.get('/api/live', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/health', async (_request, response) => {
  await db.query('SELECT 1')
  const storage = await checkStorage()
  const redisStatus = await checkRedis()
  response.json({
    ok: true,
    database: config.databaseUrl ? 'postgres' : 'pglite',
    storage,
    redis: redisStatus,
    websocket: 'ready',
  })
})

app.get('/metrics', async (_request, response) => {
  response.setHeader('Content-Type', metricsContentType())
  response.send(await metricsText())
})

// ── OG / Link preview scraper ──────────────────────────────────────────────
const ogCache = new Map()
const OG_CACHE_TTL = 60 * 60 * 1000
const OG_FETCH_TIMEOUT = 5000
const OG_MAX_BYTES = 65536
const OG_BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i

function parseOgTags(html) {
  const meta = {}
  const ogPropRe = /<meta\s+(?:[^>]*?\s)?(?:property|name)=["']og:([^"']+)["'][^>]*?content=["']([^"']*?)["'][^>]*?\/?>/gi
  const ogContRe = /<meta\s+(?:[^>]*?\s)?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']og:([^"']+)["'][^>]*?\/?>/gi
  const titleRe = /<title[^>]*>([^<]{1,512})<\/title>/i
  const descRe = /<meta\s+(?:[^>]*?\s)?name=["']description["'][^>]*?content=["']([^"']{1,1024})["'][^>]*?\/?>/i
  const descCRe = /<meta\s+(?:[^>]*?\s)?content=["']([^"']{1,1024})["'][^>]*?name=["']description["'][^>]*?\/?>/i
  let m
  while ((m = ogPropRe.exec(html)) !== null) meta[m[1].toLowerCase()] = m[2]
  while ((m = ogContRe.exec(html)) !== null) meta[m[2].toLowerCase()] = meta[m[2].toLowerCase()] || m[1]
  if (!meta.title) { const t = titleRe.exec(html); if (t) meta.title = t[1].trim() }
  if (!meta.description) {
    const d = descRe.exec(html) || descCRe.exec(html)
    if (d) meta.description = d[1].trim()
  }
  return {
    title: meta.title?.slice(0, 512) || null,
    description: meta.description?.slice(0, 1024) || null,
    image: meta.image?.slice(0, 2048) || null,
    site: (meta['site_name'] || meta.site)?.slice(0, 128) || null,
  }
}

app.get('/api/og', requireAuth, async (request, response) => {
  const raw = String(request.query.url || '').trim()
  if (!raw) return response.status(400).json({ error: 'Missing url' })
  let parsed
  try { parsed = new URL(raw) } catch { return response.status(400).json({ error: 'Invalid url' }) }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return response.status(400).json({ error: 'Only http/https allowed' })
  }
  if (OG_BLOCKED_HOSTS.test(parsed.hostname)) {
    return response.status(400).json({ error: 'Private hosts not allowed' })
  }
  const cacheKey = raw
  const cached = ogCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
    return response.json(cached.data)
  }
  try {
    const mod = parsed.protocol === 'https:' ? await import('node:https') : await import('node:http')
    const data = await new Promise((resolve, reject) => {
      const req = mod.get(raw, {
        headers: { 'User-Agent': 'OndaBot/1.0 (+https://example.com/bot)', Accept: 'text/html' },
        timeout: OG_FETCH_TIMEOUT,
      }, (res) => {
        if (res.statusCode >= 400) { res.destroy(); reject(new Error(`HTTP ${res.statusCode}`)); return }
        const ct = res.headers['content-type'] || ''
        if (!ct.includes('text/html') && !ct.includes('text/xml')) {
          res.destroy(); reject(new Error('Not HTML')); return
        }
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          buf += chunk
          if (buf.length > OG_MAX_BYTES) { res.destroy(); resolve(buf) }
        })
        res.on('end', () => resolve(buf))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    })
    const tags = parseOgTags(data)
    const result = { url: raw, ...tags }
    ogCache.set(cacheKey, { ts: Date.now(), data: result })
    if (ogCache.size > 500) {
      const oldestKey = ogCache.keys().next().value
      ogCache.delete(oldestKey)
    }
    response.json(result)
  } catch {
    response.status(422).json({ error: 'Could not fetch preview' })
  }
})

app.post('/api/auth/register', authLimiter, async (request, response) => {
  const input = parseBody(registerSchema, request.body)
  const login = input.login.toLowerCase()
  const username = input.username.toLowerCase()
  const password = await hashPassword(input.password)
  const userId = randomUUID()

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users
          (id, login, username, name, avatar, password_salt, password_hash, encryption_public_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          login,
          username,
          input.name,
          initials(input.name),
          password.salt,
          password.hash,
          input.encryptionPublicKey ? stringifyPublicKey(input.encryptionPublicKey) : null,
        ],
      )
      await createSavedChat(tx, userId)
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Login or username is already registered' })
      return
    }
    throw error
  }

  await createSession(response, userId, request)
  const userResult = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at
     FROM users WHERE id = $1`,
    [userId],
  )
  response.status(201).json({ user: publicUser(userResult.rows[0]) })
})

app.post('/api/auth/phone/start', authLimiter, async (request, response) => {
  const input = parseBody(phoneAuthStartSchema, request.body)
  const phone = normalizePhone(input.countryCode, input.phone)
  const code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const userResult = await db.query('SELECT id FROM users WHERE phone = $1 LIMIT 1', [phone])
  const existingUserId = userResult.rows[0]?.id || ''

  await db.query('DELETE FROM phone_login_codes WHERE expires_at <= NOW()')
  await db.query(
    `INSERT INTO phone_login_codes (phone, code_hash, attempts, expires_at)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (phone)
     DO UPDATE SET code_hash = EXCLUDED.code_hash,
                   attempts = 0,
                   expires_at = EXCLUDED.expires_at,
                   created_at = NOW()`,
    [phone, hashPhoneCode(phone, code), expiresAt],
  )
  const pushSent = existingUserId ? await sendLoginCodePush(existingUserId, code) : 0

  response.json({
    phone,
    expiresAt,
    delivery: pushSent > 0 ? 'push' : config.isProduction ? 'sms-provider-required' : 'dev',
    pushSent,
    ...publicPhoneCodePayload(phone, code),
  })
})

app.post('/api/auth/phone/verify', authLimiter, async (request, response) => {
  const input = parseBody(phoneAuthVerifySchema, request.body)
  const phone = normalizePhone(input.countryCode, input.phone)
  const codeResult = await db.query(
    `SELECT phone, code_hash, attempts, expires_at
     FROM phone_login_codes
     WHERE phone = $1
     LIMIT 1`,
    [phone],
  )
  const codeRow = codeResult.rows[0]
  if (!codeRow || new Date(codeRow.expires_at).getTime() <= Date.now()) {
    response.status(400).json({ error: 'Code expired. Request a new one.' })
    return
  }
  if (Number(codeRow.attempts || 0) >= 5) {
    response.status(429).json({ error: 'Too many code attempts. Request a new code.' })
    return
  }
  if (codeRow.code_hash !== hashPhoneCode(phone, input.code)) {
    await db.query('UPDATE phone_login_codes SET attempts = attempts + 1 WHERE phone = $1', [phone])
    response.status(401).json({ error: 'Invalid code' })
    return
  }

  const existing = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at
     FROM users WHERE phone = $1 LIMIT 1`,
    [phone],
  )
  if (existing.rows[0]) {
    await db.query('DELETE FROM phone_login_codes WHERE phone = $1', [phone])
    await createSession(response, existing.rows[0].id, request)
    response.json({ user: publicUser(existing.rows[0]), existing: true })
    return
  }

  if (!input.username || !input.name) {
    response.json({ profileRequired: true, phone })
    return
  }

  const userId = randomUUID()
  const password = await hashPassword(randomBytes(32).toString('base64url'))
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users
          (id, login, username, phone, name, avatar, password_salt, password_hash, encryption_public_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          phone,
          input.username.toLowerCase(),
          phone,
          input.name,
          initials(input.name),
          password.salt,
          password.hash,
          input.encryptionPublicKey ? stringifyPublicKey(input.encryptionPublicKey) : null,
        ],
      )
      await createSavedChat(tx, userId)
      await tx.query('DELETE FROM phone_login_codes WHERE phone = $1', [phone])
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Phone or username is already registered' })
      return
    }
    throw error
  }

  await createSession(response, userId, request)
  const userResult = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at
     FROM users WHERE id = $1`,
    [userId],
  )
  response.status(201).json({ user: publicUser(userResult.rows[0]), existing: false })
})

const TEST_ACCOUNTS = {
  1: { login: 'test_one', name: 'Test One', password: 'astrachat-demo-one' },
  2: { login: 'test_two', name: 'Test Two', password: 'astrachat-demo-two' },
}

const TEST_ACCOUNT_LOGINS = new Set(Object.values(TEST_ACCOUNTS).map((account) => account.login))

app.post('/api/auth/test-login', authLimiter, async (request, response) => {
  if (config.isProduction) {
    response.status(404).json({ error: 'Not found' })
    return
  }
  const slot = Number(request.body?.slot)
  const account = TEST_ACCOUNTS[slot]
  if (!account) {
    response.status(400).json({ error: 'Invalid test account' })
    return
  }

  // Ensure the fixed demo account exists, then sign in as it.
  let result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at
     FROM users WHERE login = $1 LIMIT 1`,
    [account.login],
  )
  if (!result.rows.length) {
    const userId = randomUUID()
    const password = await hashPassword(account.password)
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (id, login, username, name, avatar, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, account.login, account.login, account.name, initials(account.name), password.salt, password.hash],
      )
      await createSavedChat(tx, userId)
    })
    result = await db.query(
      `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
              totp_secret, totp_enabled_at
       FROM users WHERE id = $1`,
      [userId],
    )
  }

  await createSession(response, result.rows[0].id, request)
  response.json({ user: publicUser(result.rows[0]) })
})

// QR login — three-step flow:
//   1. POST /api/auth/qr/start  → { token, expiresAt }   (new device, no auth)
//   2. GET  /api/auth/qr/status → { status }              (new device polls; on 'confirmed' sets session)
//   3. POST /api/auth/qr/confirm → { ok }                 (existing logged-in device scans and confirms)

app.post('/api/auth/qr/start', authLimiter, async (request, response) => {
  await db.query('DELETE FROM qr_tokens WHERE expires_at < NOW()')
  const token = randomBytes(24).toString('hex')
  await db.query(
    `INSERT INTO qr_tokens (token, expires_at) VALUES ($1, NOW() + INTERVAL '3 minutes')`,
    [token],
  )
  const row = await db.query('SELECT expires_at FROM qr_tokens WHERE token = $1', [token])
  response.json({ token, expiresAt: row.rows[0].expires_at })
})

app.get('/api/auth/qr/status', async (request, response) => {
  const { token } = request.query
  if (!token) {
    response.status(400).json({ error: 'token required' })
    return
  }
  const row = await db.query(
    'SELECT user_id, confirmed, expires_at FROM qr_tokens WHERE token = $1',
    [token],
  )
  if (!row.rows[0]) {
    response.json({ status: 'expired' })
    return
  }
  const { user_id, confirmed, expires_at } = row.rows[0]
  if (new Date(expires_at) < new Date()) {
    response.json({ status: 'expired' })
    return
  }
  if (!confirmed) {
    response.json({ status: 'pending' })
    return
  }
  const userResult = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at
     FROM users WHERE id = $1`,
    [user_id],
  )
  if (!userResult.rows[0]) {
    response.json({ status: 'expired' })
    return
  }
  await db.query('DELETE FROM qr_tokens WHERE token = $1', [token])
  await createSession(response, user_id, request)
  response.json({ status: 'confirmed', user: publicUser(userResult.rows[0]) })
})

app.post('/api/auth/qr/confirm', requireAuth, async (request, response) => {
  const { token } = request.body
  if (!token) {
    response.status(400).json({ error: 'token required' })
    return
  }
  const row = await db.query(
    'SELECT confirmed, expires_at FROM qr_tokens WHERE token = $1',
    [token],
  )
  if (!row.rows[0] || new Date(row.rows[0].expires_at) < new Date()) {
    response.status(404).json({ error: 'QR token expired or invalid' })
    return
  }
  if (row.rows[0].confirmed) {
    response.status(409).json({ error: 'Already confirmed' })
    return
  }
  await db.query(
    'UPDATE qr_tokens SET user_id = $1, confirmed = TRUE WHERE token = $2',
    [request.user.id, token],
  )
  response.json({ ok: true })
})

app.post('/api/auth/login', authLimiter, async (request, response) => {
  const input = parseBody(loginSchema, request.body)
  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            password_salt, password_hash, totp_secret, totp_enabled_at,
            cloud_password_hash, cloud_password_salt, cloud_password_hint
     FROM users WHERE login = $1 OR username = $1 LIMIT 1`,
    [input.login.toLowerCase()],
  )
  const user = result.rows[0]
  const valid = user
    ? await verifyPassword(input.password, user.password_salt, user.password_hash)
    : false

  if (!valid) {
    response.status(401).json({ error: 'Invalid login or password' })
    return
  }

  if (user.totp_secret && !input.totpCode) {
    response.json({ totpRequired: true })
    return
  }

  if (user.totp_secret && !verifyTotpCode(openTotpSecret(user.totp_secret), input.totpCode)) {
    response.status(401).json({ error: 'Invalid authentication code' })
    return
  }

  // Cloud password (two-step verification)
  if (user.cloud_password_hash && !input.cloudPassword) {
    response.json({ cloudPasswordRequired: true, hint: user.cloud_password_hint || null })
    return
  }
  if (user.cloud_password_hash && input.cloudPassword) {
    const cpValid = await verifyPassword(input.cloudPassword, user.cloud_password_salt, user.cloud_password_hash)
    if (!cpValid) {
      response.status(401).json({ error: 'Incorrect cloud password' })
      return
    }
  }

  await createSession(response, user.id, request)
  response.json({ user: publicUser(user) })
})

app.get('/api/auth/me', async (request, response) => {
  const user = await getSessionUser(request)
  if (!user) {
    response.status(401).json({ error: 'Not authenticated' })
    return
  }
  response.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', async (request, response) => {
  await destroySession(request, response)
  response.status(204).end()
})

app.get('/api/auth/totp/status', requireAuth, async (request, response) => {
  const user = await loadOwnTotpState(request.user.id)
  response.json({ enabled: Boolean(user?.totp_secret), enabledAt: user?.totp_enabled_at || null })
})

app.post('/api/auth/totp/setup', requireAuth, async (request, response) => {
  const user = await loadOwnTotpState(request.user.id)
  if (!user) {
    response.status(404).json({ error: 'User not found' })
    return
  }
  if (user.totp_secret) {
    response.status(409).json({ error: 'Two-factor authentication is already enabled' })
    return
  }

  const secret = createTotpSecret()
  await db.query(
    `UPDATE users
     SET totp_pending_secret = $1, updated_at = NOW()
     WHERE id = $2`,
    [sealTotpSecret(secret), request.user.id],
  )
  response.json({
    secret,
    otpauthUrl: createTotpUri({ account: user.login || user.username, secret }),
  })
})

app.post('/api/auth/totp/verify', authLimiter, requireAuth, async (request, response) => {
  const input = parseBody(totpVerifySchema, request.body)
  const user = await loadOwnTotpState(request.user.id)
  if (!user?.totp_pending_secret) {
    response.status(400).json({ error: 'Two-factor setup was not started' })
    return
  }

  const secret = openTotpSecret(user.totp_pending_secret)
  if (!verifyTotpCode(secret, input.code)) {
    response.status(400).json({ error: 'Invalid authentication code' })
    return
  }

  const result = await db.query(
    `UPDATE users
     SET totp_secret = $1,
         totp_pending_secret = NULL,
         totp_enabled_at = NOW(),
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
               totp_secret, totp_enabled_at`,
    [sealTotpSecret(secret), request.user.id],
  )
  await createSecurityEvent({
    userId: request.user.id,
    actorUserId: request.user.id,
    type: 'totp_enabled',
    severity: 'medium',
    title: 'Two-factor authentication enabled',
    body: 'Authenticator app codes are now required when signing in.',
  })
  response.json({ user: publicUser(result.rows[0]) })
})

app.delete('/api/auth/totp', authLimiter, requireAuth, async (request, response) => {
  const input = parseBody(totpVerifySchema, request.body)
  const user = await loadOwnTotpState(request.user.id)
  if (!user?.totp_secret) {
    response.status(400).json({ error: 'Two-factor authentication is not enabled' })
    return
  }
  if (!verifyTotpCode(openTotpSecret(user.totp_secret), input.code)) {
    response.status(400).json({ error: 'Invalid authentication code' })
    return
  }

  const result = await db.query(
    `UPDATE users
     SET totp_secret = NULL,
         totp_pending_secret = NULL,
         totp_enabled_at = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
               totp_secret, totp_enabled_at`,
    [request.user.id],
  )
  await createSecurityEvent({
    userId: request.user.id,
    actorUserId: request.user.id,
    type: 'totp_disabled',
    severity: 'high',
    title: 'Two-factor authentication disabled',
    body: 'Authenticator app codes are no longer required when signing in.',
  })
  response.json({ user: publicUser(result.rows[0]) })
})

// ── Cloud password (two-step verification) ───────────────────────────────────
app.get('/api/auth/cloud-password/status', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT cloud_password_hash IS NOT NULL AS enabled,
            cloud_password_hint, cloud_password_set_at
     FROM users WHERE id = $1`,
    [request.user.id],
  )
  const row = result.rows[0]
  response.json({
    enabled: Boolean(row?.enabled),
    hint: row?.cloud_password_hint || null,
    setAt: row?.cloud_password_set_at || null,
  })
})

app.post('/api/auth/cloud-password', authLimiter, requireAuth, async (request, response) => {
  const { password, hint, currentPassword } = request.body
  if (!password || typeof password !== 'string' || password.length < 6) {
    response.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }
  // Verify the account password first as extra confirmation
  const userRow = await db.query(
    'SELECT password_salt, password_hash, cloud_password_hash, cloud_password_salt FROM users WHERE id = $1',
    [request.user.id],
  )
  if (!userRow.rows.length) { response.status(401).json({ error: 'Not found' }); return }
  const row = userRow.rows[0]
  if (row.cloud_password_hash) {
    // Changing: require current cloud password
    if (!currentPassword) { response.status(400).json({ error: 'Current cloud password required' }); return }
    const valid = await verifyPassword(currentPassword, row.cloud_password_salt, row.cloud_password_hash)
    if (!valid) { response.status(403).json({ error: 'Current cloud password is incorrect' }); return }
  }
  const hashed = await hashPassword(password)
  await db.query(
    `UPDATE users SET cloud_password_hash=$1, cloud_password_salt=$2,
     cloud_password_hint=$3, cloud_password_set_at=NOW() WHERE id=$4`,
    [hashed.hash, hashed.salt, hint?.slice(0, 255) || null, request.user.id],
  )
  await createSecurityEvent({
    userId: request.user.id,
    actorUserId: request.user.id,
    type: 'cloud_password_set',
    severity: 'high',
    title: 'Two-step verification password set',
    body: 'A cloud password was configured for your account.',
  })
  response.json({ ok: true })
})

app.delete('/api/auth/cloud-password', authLimiter, requireAuth, async (request, response) => {
  const { password } = request.body
  const userRow = await db.query(
    'SELECT cloud_password_hash, cloud_password_salt FROM users WHERE id = $1',
    [request.user.id],
  )
  const row = userRow.rows[0]
  if (!row?.cloud_password_hash) {
    response.status(400).json({ error: 'Cloud password is not set' }); return
  }
  if (!password) { response.status(400).json({ error: 'Password required' }); return }
  const valid = await verifyPassword(password, row.cloud_password_salt, row.cloud_password_hash)
  if (!valid) { response.status(403).json({ error: 'Incorrect cloud password' }); return }
  await db.query(
    `UPDATE users SET cloud_password_hash=NULL, cloud_password_salt=NULL,
     cloud_password_hint=NULL, cloud_password_set_at=NULL WHERE id=$1`,
    [request.user.id],
  )
  await createSecurityEvent({
    userId: request.user.id,
    actorUserId: request.user.id,
    type: 'cloud_password_removed',
    severity: 'high',
    title: 'Two-step verification disabled',
    body: 'The cloud password was removed from your account.',
  })
  response.json({ ok: true })
})

// Verify cloud password during login (called by client after session established)
app.post('/api/auth/cloud-password/verify', authLimiter, requireAuth, async (request, response) => {
  const { password } = request.body
  const userRow = await db.query(
    'SELECT cloud_password_hash, cloud_password_salt FROM users WHERE id = $1',
    [request.user.id],
  )
  const row = userRow.rows[0]
  if (!row?.cloud_password_hash) { response.json({ required: false }); return }
  if (!password) { response.status(400).json({ required: true, error: 'Cloud password required' }); return }
  const valid = await verifyPassword(password, row.cloud_password_salt, row.cloud_password_hash)
  if (!valid) { response.status(403).json({ error: 'Incorrect cloud password' }); return }
  response.json({ ok: true })
})

app.get('/api/sessions', requireAuth, async (request, response) => {
  const currentTokenHash = getSessionTokenHash(request)
  const result = await db.query(
    `SELECT id, token_hash, user_agent, ip_address, created_at, last_seen_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC`,
    [request.user.id],
  )
  response.json({ sessions: result.rows.map((session) => publicSession(session, currentTokenHash)) })
})

app.delete('/api/sessions', requireAuth, async (request, response) => {
  const currentTokenHash = getSessionTokenHash(request)
  const deleted = await db.query(
    `SELECT token_hash FROM sessions
     WHERE user_id = $1 AND token_hash <> $2`,
    [request.user.id, currentTokenHash],
  )
  await db.query(
    `DELETE FROM sessions
     WHERE user_id = $1 AND token_hash <> $2`,
    [request.user.id, currentTokenHash],
  )
  await deleteCachedSessions(deleted.rows.map((session) => session.token_hash))
  response.status(204).end()
})

app.delete('/api/sessions/:sessionId', requireAuth, async (request, response) => {
  const currentTokenHash = getSessionTokenHash(request)
  const result = await db.query(
    `SELECT id, token_hash
     FROM sessions
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [request.params.sessionId, request.user.id],
  )
  const session = result.rows[0]
  if (!session) {
    response.status(404).json({ error: 'Session not found' })
    return
  }
  if (session.token_hash === currentTokenHash) {
    await destroySession(request, response)
    response.status(204).end()
    return
  }
  await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
    request.params.sessionId,
    request.user.id,
  ])
  await deleteCachedSession(session.token_hash)
  response.status(204).end()
})

app.get('/api/security/events', requireAuth, async (request, response) => {
  const unreadOnly = request.query.unread === 'true' || request.query.unread === '1'
  const result = await db.query(
    `SELECT se.id, se.actor_user_id, se.type, se.severity, se.title, se.body,
            se.metadata, se.read_at, se.created_at,
            u.username AS actor_username, u.name AS actor_name, u.avatar AS actor_avatar
     FROM security_events se
     LEFT JOIN users u ON u.id = se.actor_user_id
     WHERE se.user_id = $1
       AND ($2 = FALSE OR se.read_at IS NULL)
     ORDER BY se.created_at DESC
     LIMIT 50`,
    [request.user.id, unreadOnly],
  )
  response.json({ events: result.rows.map(publicSecurityEvent) })
})

app.post('/api/security/events/read', requireAuth, async (_request, response) => {
  await db.query(
    `UPDATE security_events
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [_request.user.id],
  )
  response.status(204).end()
})

app.post('/api/security/events/:eventId/read', requireAuth, async (request, response) => {
  const result = await db.query(
    `UPDATE security_events
     SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [request.params.eventId, request.user.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Security event not found' })
    return
  }
  response.status(204).end()
})

app.get('/api/users/blocks', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar,
            u.last_seen_at, u.encryption_public_key,
            TRUE AS blocked_by_me, FALSE AS blocked_me,
            ub.created_at AS blocked_at
     FROM user_blocks ub
     JOIN users u ON u.id = ub.blocked_id
     WHERE ub.blocker_id = $1
     ORDER BY ub.created_at DESC`,
    [request.user.id],
  )
  response.json({
    users: result.rows.map((row) => ({
      ...publicUser(row),
      blockedAt: row.blocked_at,
    })),
  })
})

app.get('/api/contacts', requireAuth, async (request, response) => {
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

app.post('/api/contacts/:userId', requireAuth, async (request, response) => {
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

app.delete('/api/contacts/:userId', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_contacts WHERE owner_id = $1 AND contact_user_id = $2',
    [request.user.id, request.params.userId],
  )
  response.status(204).end()
})

app.post('/api/users/:userId/block', requireAuth, async (request, response) => {
  if (request.params.userId === request.user.id) {
    response.status(400).json({ error: 'Cannot block yourself' })
    return
  }
  const target = await db.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [request.params.userId])
  if (!target.rows.length) {
    response.status(404).json({ error: 'User not found' })
    return
  }
  await db.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [request.user.id, request.params.userId],
  )
  await sendToUser(request.user.id, {
    type: 'user:block-updated',
    userId: request.params.userId,
    blockedByMe: true,
  })
  response.status(201).json({ userId: request.params.userId, blockedByMe: true })
})

app.delete('/api/users/:userId/block', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [request.user.id, request.params.userId],
  )
  await sendToUser(request.user.id, {
    type: 'user:block-updated',
    userId: request.params.userId,
    blockedByMe: false,
  })
  response.status(204).end()
})

app.post('/api/reports', requireAuth, async (request, response) => {
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

// Live wall: a public, fully anonymous stream of short notes. Nothing links a
// wall message back to its author — by design, neither in the DB nor in the API.
const WALL_MESSAGE_MAX_LENGTH = 120

function publicWallMessage(row) {
  return {
    id: row.id,
    text: row.text,
    hue: Number(row.hue) || 20,
    createdAt: row.created_at,
  }
}

app.get('/api/wall', requireAuth, async (_request, response) => {
  const result = await db.query(
    `SELECT id, text, hue, created_at
     FROM wall_messages
     ORDER BY created_at DESC
     LIMIT 60`,
  )
  response.json({ messages: result.rows.map(publicWallMessage).reverse() })
})

app.post('/api/wall', requireAuth, wallLimiter, async (request, response) => {
  const text = String(request.body?.text || '')
    // eslint-disable-next-line no-control-regex -- strip control characters from wall input
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text.length < 2 || text.length > WALL_MESSAGE_MAX_LENGTH) {
    response.status(400).json({
      error: `Wall message must be 2-${WALL_MESSAGE_MAX_LENGTH} characters long`,
    })
    return
  }
  if (/https?:\/\/|www\./iu.test(text)) {
    response.status(400).json({ error: 'Links are not allowed on the wall' })
    return
  }

  // Spam heuristics: shouting, keyboard mashing, copy-paste floods.
  const letters = text.match(/\p{L}/gu) || []
  const upper = text.match(/\p{Lu}/gu) || []
  if (letters.length >= 12 && upper.length / letters.length > 0.8) {
    response.status(400).json({ error: 'Too much shouting for the wall' })
    return
  }
  if (/(.)\1{6,}/u.test(text)) {
    response.status(400).json({ error: 'Message looks like spam' })
    return
  }
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const duplicate = await db.query(
    `SELECT 1 FROM wall_messages
     WHERE created_at > NOW() - INTERVAL '15 minutes'
       AND lower(regexp_replace(text, '[^[:alnum:]]+', ' ', 'g')) = $1
     LIMIT 1`,
    [normalized],
  )
  if (duplicate.rows.length) {
    response.status(409).json({ error: 'The wall already heard that recently' })
    return
  }

  const hue = Number.isInteger(request.body?.hue)
    ? Math.min(359, Math.max(0, request.body.hue))
    : Math.floor(Math.random() * 360)
  const id = randomUUID()
  const result = await db.query(
    `INSERT INTO wall_messages (id, text, hue)
     VALUES ($1, $2, $3)
     RETURNING id, text, hue, created_at`,
    [id, text, hue],
  )
  const message = publicWallMessage(result.rows[0])
  void broadcast({ type: 'wall:new', message })
  response.status(201).json({ message })
})

// ── Cloud key backup ─────────────────────────────────────────────────────
// Stores an opaque passphrase-encrypted blob; the server cannot read keys.

app.get('/api/keys/backup', requireAuth, async (request, response) => {
  const result = await db.query('SELECT payload, updated_at FROM key_backups WHERE user_id = $1', [
    request.user.id,
  ])
  if (!result.rows.length) {
    response.status(404).json({ error: 'No cloud key backup' })
    return
  }
  response.json({ payload: result.rows[0].payload, updatedAt: result.rows[0].updated_at })
})

app.put('/api/keys/backup', requireAuth, async (request, response) => {
  const payload = String(request.body?.payload || '')
  if (!payload || payload.length > 32768) {
    response.status(400).json({ error: 'Invalid key backup payload' })
    return
  }
  await db.query(
    `INSERT INTO key_backups (user_id, payload, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET payload = $2, updated_at = NOW()`,
    [request.user.id, payload],
  )
  response.json({ ok: true })
})

app.delete('/api/keys/backup', requireAuth, async (request, response) => {
  await db.query('DELETE FROM key_backups WHERE user_id = $1', [request.user.id])
  response.json({ ok: true })
})

// ── Sticker packs ────────────────────────────────────────────────────────

function publicStickerPack(pack, items = [], installed = false) {
  return {
    id: pack.id,
    title: pack.title,
    icon: pack.icon,
    author: pack.author || '',
    isDefault: Boolean(pack.is_default),
    installed,
    stickers: items.map((item) => ({
      id: item.id,
      packId: item.pack_id,
      emoji: item.emoji,
      title: item.title,
    })),
  }
}

app.get('/api/stickers/packs', requireAuth, async (request, response) => {
  const packsResult = await db.query(
    `SELECT sp.*, (usp.user_id IS NOT NULL) AS installed
     FROM sticker_packs sp
     LEFT JOIN user_sticker_packs usp ON usp.pack_id = sp.id AND usp.user_id = $1
     ORDER BY sp.sort_order, sp.title`,
    [request.user.id],
  )
  const itemsResult = await db.query(
    'SELECT pack_id, id, emoji, title FROM sticker_pack_items ORDER BY pack_id, sort_order',
  )
  const itemsByPack = new Map()
  for (const item of itemsResult.rows) {
    if (!itemsByPack.has(item.pack_id)) itemsByPack.set(item.pack_id, [])
    itemsByPack.get(item.pack_id).push(item)
  }
  const packs = packsResult.rows.map((pack) =>
    publicStickerPack(pack, itemsByPack.get(pack.id) || [], Boolean(pack.installed)),
  )
  response.json({ packs })
})

app.get('/api/stickers/packs/installed', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT sp.*
     FROM user_sticker_packs usp
     JOIN sticker_packs sp ON sp.id = usp.pack_id
     WHERE usp.user_id = $1
     ORDER BY usp.sort_order, usp.installed_at`,
    [request.user.id],
  )
  if (!result.rows.length) {
    response.json({ packs: [] })
    return
  }
  const packIds = result.rows.map((r) => r.id)
  const itemsResult = await db.query(
    `SELECT pack_id, id, emoji, title FROM sticker_pack_items
     WHERE pack_id = ANY($1)
     ORDER BY pack_id, sort_order`,
    [packIds],
  )
  const itemsByPack = new Map()
  for (const item of itemsResult.rows) {
    if (!itemsByPack.has(item.pack_id)) itemsByPack.set(item.pack_id, [])
    itemsByPack.get(item.pack_id).push(item)
  }
  const packs = result.rows.map((pack) =>
    publicStickerPack(pack, itemsByPack.get(pack.id) || [], true),
  )
  response.json({ packs })
})

app.post('/api/stickers/packs/:packId/install', requireAuth, async (request, response) => {
  const { packId } = request.params
  const pack = await db.query('SELECT id FROM sticker_packs WHERE id = $1', [packId])
  if (!pack.rows.length) {
    response.status(404).json({ error: 'Pack not found' })
    return
  }
  const countResult = await db.query(
    'SELECT COUNT(*) AS n FROM user_sticker_packs WHERE user_id = $1',
    [request.user.id],
  )
  await db.query(
    `INSERT INTO user_sticker_packs (user_id, pack_id, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, pack_id) DO NOTHING`,
    [request.user.id, packId, Number(countResult.rows[0].n)],
  )
  response.status(201).json({ ok: true })
})

app.delete('/api/stickers/packs/:packId/install', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_sticker_packs WHERE user_id = $1 AND pack_id = $2',
    [request.user.id, request.params.packId],
  )
  response.json({ ok: true })
})

// ── Stories ──────────────────────────────────────────────────────────────

const storiesLimiter = rateLimit({ windowMs: 60_000, max: 10 })

function publicStory(story, viewerIds = [], viewedByMe = false) {
  return {
    id: story.id,
    userId: story.user_id,
    text: story.text,
    bgColor: story.bg_color,
    mediaUrl: story.media_url || null,
    mediaKind: story.media_kind || null,
    privacy: story.privacy,
    expiresAt: story.expires_at,
    createdAt: story.created_at,
    viewCount: viewerIds.length,
    viewedByMe,
  }
}

app.get('/api/stories', requireAuth, async (request, response) => {
  const userId = request.user.id
  // Return own stories + stories of contacts + groups you belong to
  const result = await db.query(
    `SELECT s.*
     FROM stories s
     WHERE s.expires_at > NOW()
       AND (
         s.user_id = $1
         OR s.user_id IN (
           SELECT contact_user_id FROM user_contacts WHERE owner_id = $1
           UNION
           SELECT owner_id FROM user_contacts WHERE contact_user_id = $1
           UNION
           SELECT cm2.user_id FROM chat_members cm1
           JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id
           WHERE cm1.user_id = $1 AND cm2.user_id <> $1
         )
       )
     ORDER BY s.user_id, s.created_at DESC`,
    [userId],
  )

  if (!result.rows.length) {
    response.json({ stories: [] })
    return
  }

  const storyIds = result.rows.map((r) => r.id)
  const viewsResult = await db.query(
    `SELECT story_id, viewer_id FROM story_views WHERE story_id = ANY($1)`,
    [storyIds],
  )
  const viewersByStory = new Map()
  const viewedByMeSet = new Set()
  for (const row of viewsResult.rows) {
    if (!viewersByStory.has(row.story_id)) viewersByStory.set(row.story_id, [])
    viewersByStory.get(row.story_id).push(row.viewer_id)
    if (row.viewer_id === userId) viewedByMeSet.add(row.story_id)
  }

  const userIds = [...new Set(result.rows.map((r) => r.user_id))]
  const usersResult = await db.query(
    `SELECT id, name, username, avatar FROM users WHERE id = ANY($1)`,
    [userIds],
  )
  const usersById = new Map(usersResult.rows.map((u) => [u.id, u]))

  const grouped = []
  const seen = new Map()
  for (const story of result.rows) {
    const user = usersById.get(story.user_id) || {}
    const entry = seen.get(story.user_id)
    const storyPublic = publicStory(
      story,
      viewersByStory.get(story.id) || [],
      viewedByMeSet.has(story.id),
    )
    if (entry) {
      entry.stories.push(storyPublic)
    } else {
      const group = {
        userId: story.user_id,
        name: user.name || '',
        username: user.username || '',
        avatar: user.avatar || null,
        stories: [storyPublic],
        hasUnviewed: false,
      }
      seen.set(story.user_id, group)
      grouped.push(group)
    }
  }
  for (const group of grouped) {
    group.hasUnviewed = group.stories.some((s) => !s.viewedByMe && s.userId !== userId)
  }

  response.json({ stories: grouped })
})

app.post('/api/stories', requireAuth, storiesLimiter, async (request, response) => {
  const text = String(request.body?.text || '').trim().slice(0, 1000)
  const bgColor = String(request.body?.bgColor || '#7c3aed').slice(0, 20)
  const privacy = ['contacts', 'everyone', 'closeFriends'].includes(request.body?.privacy)
    ? request.body.privacy
    : 'contacts'
  if (!text) {
    response.status(400).json({ error: 'Story text is required' })
    return
  }
  const id = randomUUID()
  const result = await db.query(
    `INSERT INTO stories (id, user_id, text, bg_color, privacy)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, request.user.id, text, bgColor, privacy],
  )
  const story = publicStory(result.rows[0], [], false)
  response.status(201).json({ story })
})

app.delete('/api/stories/:storyId', requireAuth, async (request, response) => {
  const result = await db.query(
    'DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id',
    [request.params.storyId, request.user.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  response.json({ ok: true })
})

app.post('/api/stories/:storyId/view', requireAuth, async (request, response) => {
  const storyResult = await db.query(
    'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > NOW()',
    [request.params.storyId],
  )
  if (!storyResult.rows.length) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  if (storyResult.rows[0].user_id === request.user.id) {
    response.json({ ok: true })
    return
  }
  await db.query(
    `INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [request.params.storyId, request.user.id],
  )
  response.json({ ok: true })
})

// ── Admin panel ──────────────────────────────────────────────────────────
// Token-protected management API + a self-contained HTML panel at /admin.
// The token lives in ADMIN_TOKEN env or <dataDir>/.admin-token.

function requireAdmin(request, response, next) {
  const token = request.headers['x-admin-token'] || request.query.token
  if (!token || token !== config.adminToken) {
    response.status(401).json({ error: 'Admin token required' })
    return
  }
  next()
}

const adminBackupsDir = resolve(config.rootDir, 'backups')

function directorySize(path) {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name)
    total += entry.isDirectory() ? directorySize(entryPath) : statSync(entryPath).size
  }
  return total
}

async function adminCount(sql, params = []) {
  const result = await db.query(sql, params)
  return Number(result.rows[0]?.count || 0)
}

app.get('/admin', (request, response) => {
  const token = request.headers['x-admin-token'] || request.query.token
  if (!token || token !== config.adminToken) {
    response.status(403).send('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px"><h1>403 Forbidden</h1><p>Admin token required. Append <code>?token=YOUR_TOKEN</code> to the URL.</p></body></html>')
    return
  }
  response.sendFile(resolve(config.rootDir, 'server', 'admin-panel.html'))
})

app.get('/api/admin/overview', requireAdmin, async (_request, response) => {
  const [users, chats, groups, channels, messages, messages24h, wall, media, sessions, calls] =
    await Promise.all([
      adminCount('SELECT COUNT(*)::integer AS count FROM users'),
      adminCount('SELECT COUNT(*)::integer AS count FROM chats'),
      adminCount("SELECT COUNT(*)::integer AS count FROM chats WHERE type = 'group'"),
      adminCount("SELECT COUNT(*)::integer AS count FROM chats WHERE type = 'channel'"),
      adminCount('SELECT COUNT(*)::integer AS count FROM messages'),
      adminCount("SELECT COUNT(*)::integer AS count FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'"),
      adminCount('SELECT COUNT(*)::integer AS count FROM wall_messages'),
      adminCount('SELECT COUNT(*)::integer AS count FROM media_files'),
      adminCount('SELECT COUNT(*)::integer AS count FROM sessions WHERE expires_at > NOW()'),
      adminCount('SELECT COUNT(*)::integer AS count FROM calls'),
    ])
  response.json({
    database: config.databaseUrl ? 'postgres' : 'pglite',
    storage: config.storageDriver || 'local',
    dataSizeBytes: directorySize(config.dataDir),
    users, chats, groups, channels, messages, messages24h, wall, media, sessions, calls,
  })
})

app.get('/api/admin/users', requireAdmin, async (_request, response) => {
  const result = await db.query(
    `SELECT u.id, u.username, u.name, u.created_at, u.last_seen_at,
            COUNT(m.id)::integer AS message_count
     FROM users u LEFT JOIN messages m ON m.sender_id = u.id
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`,
  )
  response.json({
    users: result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      messageCount: Number(row.message_count),
    })),
  })
})

app.delete('/api/admin/users/:userId', requireAdmin, async (request, response) => {
  const userId = request.params.userId
  const target = await db.query('SELECT id, login FROM users WHERE id = $1', [userId])
  if (!target.rows.length) {
    response.status(404).json({ error: 'User not found' })
    return
  }
  if (TEST_ACCOUNT_LOGINS.has(target.rows[0].login)) {
    response.status(400).json({ error: 'Test accounts cannot be deleted' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM messages WHERE sender_id = $1', [userId])
    await tx.query('DELETE FROM calls WHERE initiator_id = $1 OR recipient_id = $1', [userId])
    await tx.query('DELETE FROM chats WHERE created_by = $1', [userId])
    await tx.query('DELETE FROM users WHERE id = $1', [userId])
  })
  response.json({ ok: true })
})

app.post('/api/admin/purge-test-users', requireAdmin, async (_request, response) => {
  // Auto-generated accounts from old test runs (alice_media_…, profile_b_…, test_xxxxx…).
  const junk = await db.query(
    `SELECT id, login FROM users
     WHERE login ~ '^(alice_media_|bob_media_|profile_[ab]_|sessions_|test_[a-z0-9]{6})'
       AND login NOT IN ('test_one', 'test_two')`,
  )
  for (const row of junk.rows) {
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM messages WHERE sender_id = $1', [row.id])
      await tx.query('DELETE FROM calls WHERE initiator_id = $1 OR recipient_id = $1', [row.id])
      await tx.query('DELETE FROM chats WHERE created_by = $1', [row.id])
      await tx.query('DELETE FROM users WHERE id = $1', [row.id])
    })
  }
  response.json({ ok: true, deleted: junk.rows.map((row) => row.login) })
})

app.get('/api/admin/wall', requireAdmin, async (_request, response) => {
  const result = await db.query(
    'SELECT id, text, hue, created_at FROM wall_messages ORDER BY created_at DESC LIMIT 100',
  )
  response.json({ messages: result.rows.map(publicWallMessage) })
})

app.delete('/api/admin/wall/:messageId', requireAdmin, async (request, response) => {
  await db.query('DELETE FROM wall_messages WHERE id = $1', [request.params.messageId])
  response.json({ ok: true })
})

app.get('/api/admin/reports', requireAdmin, async (request, response) => {
  const { status } = request.query
  const allowed = ['open', 'reviewed', 'dismissed']
  const whereClause = status && allowed.includes(status) ? `WHERE r.status = '${status}'` : ''
  const result = await db.query(
    `SELECT r.id, r.reason, r.details, r.status, r.admin_note, r.created_at, r.reviewed_at,
            reporter.username AS reporter, target.username AS target,
            reviewer.username AS reviewed_by
     FROM reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users target ON target.id = r.target_user_id
     LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
     ${whereClause}
     ORDER BY r.created_at DESC LIMIT 200`,
  )
  response.json({ reports: result.rows })
})

app.patch('/api/admin/reports/:id', requireAdmin, async (request, response) => {
  const { status, adminNote } = request.body
  const allowed = ['open', 'reviewed', 'dismissed']
  if (!allowed.includes(status)) {
    response.status(400).json({ error: 'invalid status' })
    return
  }
  const result = await db.query(
    `UPDATE reports SET status=$1, admin_note=$2, reviewed_at=NOW(), reviewed_by=$3
     WHERE id=$4 RETURNING id, status, admin_note, reviewed_at`,
    [status, adminNote || null, request.user.id, request.params.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'not found' })
    return
  }
  response.json({ report: result.rows[0] })
})

app.get('/api/admin/backups', requireAdmin, (_request, response) => {
  const backups = existsSync(adminBackupsDir)
    ? readdirSync(adminBackupsDir)
        .filter((name) => name.startsWith('onda-'))
        .sort()
        .reverse()
        .map((name) => ({ name, sizeBytes: directorySize(resolve(adminBackupsDir, name)) }))
    : []
  response.json({ backups })
})

app.post('/api/admin/backup', requireAdmin, async (_request, response) => {
  mkdirSync(adminBackupsDir, { recursive: true })
  const name = `onda-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const target = resolve(adminBackupsDir, name)
  mkdirSync(target, { recursive: true })
  cpSync(config.dataDir, resolve(target, 'data'), { recursive: true })
  writeFileSync(
    resolve(target, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), database: config.databaseUrl ? 'postgres' : 'pglite' }, null, 2),
  )
  response.json({ ok: true, name, sizeBytes: directorySize(target) })
})

app.delete('/api/admin/backups/:name', requireAdmin, (request, response) => {
  const name = request.params.name
  if (!/^onda-[\w-]+$/.test(name)) {
    response.status(400).json({ error: 'Invalid backup name' })
    return
  }
  rmSync(resolve(adminBackupsDir, name), { recursive: true, force: true })
  response.json({ ok: true })
})

app.post('/api/admin/cleanup', requireAdmin, async (_request, response) => {
  await cleanupExpiredSessions()
  const wall = await db.query(
    `DELETE FROM wall_messages
     WHERE id NOT IN (SELECT id FROM wall_messages ORDER BY created_at DESC LIMIT 500)
     RETURNING id`,
  )
  response.json({ ok: true, wallTrimmed: wall.rows.length })
})

// Native mobile push: store the FCM device token (Capacitor apps).
app.post('/api/push/fcm-token', requireAuth, async (request, response) => {
  if (!isFcmEnabled()) {
    response.status(503).json({ error: 'Native push (FCM) is not configured on this server' })
    return
  }
  const input = parseBody(fcmTokenSchema, request.body)
  await db.query(
    `INSERT INTO push_subscriptions
      (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, '', '', $4)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       updated_at = NOW(),
       last_error = ''`,
    [randomUUID(), request.user.id, `fcm:${input.token}`, String(request.headers['user-agent'] || '').slice(0, 500)],
  )
  response.status(201).json({ ok: true })
})

app.get('/api/push/vapid-public-key', requireAuth, (_request, response) => {
  response.json({
    enabled: config.vapid.enabled,
    publicKey: config.vapid.enabled ? config.vapid.publicKey : '',
  })
})

app.post('/api/push/subscriptions', requireAuth, async (request, response) => {
  if (!config.vapid.enabled) {
    response.status(503).json({ error: 'Web Push is not configured' })
    return
  }

  const input = parseBody(pushSubscriptionSchema, request.body)
  const subscription = input.subscription
  const expirationTime = normalizePushExpiration(subscription.expirationTime)

  await db.query(
    `INSERT INTO push_subscriptions
      (id, user_id, endpoint, p256dh, auth, expiration_time, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       expiration_time = EXCLUDED.expiration_time,
       user_agent = EXCLUDED.user_agent,
       updated_at = NOW(),
       last_error = ''`,
    [
      randomUUID(),
      request.user.id,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      expirationTime,
      String(request.headers['user-agent'] || '').slice(0, 500),
    ],
  )

  response.status(201).json({ ok: true })
})

app.delete('/api/push/subscriptions', requireAuth, async (request, response) => {
  const input = parseBody(deletePushSubscriptionSchema, request.body || {})
  if (input.endpoint) {
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
      request.user.id,
      input.endpoint,
    ])
  } else {
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [request.user.id])
  }
  response.status(204).end()
})

app.get('/api/users', requireAuth, apiLimiter, async (request, response) => {
  const search = String(request.query.search || '').trim()
  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            EXISTS (
              SELECT 1 FROM user_contacts uc
              WHERE uc.owner_id = $1 AND uc.contact_user_id = users.id
            ) AS is_contact,
            (
              SELECT uc.created_at FROM user_contacts uc
              WHERE uc.owner_id = $1 AND uc.contact_user_id = users.id
              LIMIT 1
            ) AS contact_since,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = $1 AND ub.blocked_id = users.id
            ) AS blocked_by_me,
            EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE ub.blocker_id = users.id AND ub.blocked_id = $1
            ) AS blocked_me
     FROM users
     WHERE id <> $1
       AND ($2 = '' OR username ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
     ORDER BY name
     LIMIT 50`,
    [request.user.id, search],
  )
  response.json({ users: result.rows.map(publicUser) })
})

app.post('/api/users/by-phone', requireAuth, apiLimiter, async (request, response) => {
  const rawPhones = request.body?.phones
  if (!Array.isArray(rawPhones) || rawPhones.length === 0) {
    response.status(400).json({ error: 'phones array is required' })
    return
  }
  const normalized = rawPhones
    .map((p) => String(p || '').replace(/\D/g, ''))
    .filter((p) => p.length >= 7 && p.length <= 15)
    .slice(0, 100)
    .map((p) => (p.startsWith('7') || p.startsWith('8') ? `+${p.startsWith('8') ? '7' + p.slice(1) : p}` : `+${p}`))
  if (normalized.length === 0) {
    response.json({ users: [] })
    return
  }
  const placeholders = normalized.map((_, i) => `$${i + 2}`).join(', ')
  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            EXISTS (
              SELECT 1 FROM user_contacts uc
              WHERE uc.owner_id = $1 AND uc.contact_user_id = users.id
            ) AS is_contact
     FROM users
     WHERE id <> $1 AND phone IN (${placeholders})
     ORDER BY name
     LIMIT 100`,
    [request.user.id, ...normalized],
  )
  response.json({ users: result.rows.map(publicUser) })
})

app.patch('/api/users/me/encryption-key', requireAuth, async (request, response) => {
  const input = parseBody(encryptionKeySchema, request.body)
  const keyValue = stringifyPublicKey(input.encryptionPublicKey)
  const current = await db.query(
    'SELECT encryption_public_key FROM users WHERE id = $1 LIMIT 1',
    [request.user.id],
  )
  const previousKey = current.rows[0]?.encryption_public_key || ''
  const result = await db.query(
    `UPDATE users
     SET encryption_public_key = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
               totp_secret, totp_enabled_at`,
    [keyValue, request.user.id],
  )
  if (previousKey && previousKey !== keyValue) {
    const changeId = randomUUID()
    await db.query(
      `INSERT INTO user_key_changes
        (id, user_id, previous_public_key, next_public_key)
       VALUES ($1, $2, $3, $4)`,
      [changeId, request.user.id, previousKey, keyValue],
    )
    await createSecurityEvent({
      userId: request.user.id,
      actorUserId: request.user.id,
      type: 'own_key_changed',
      severity: 'medium',
      title: 'Your encryption key changed',
      body: 'Other devices may lose access to older encrypted messages unless they import the same key backup.',
      metadata: { changeId },
    })
    for (const userId of await sharedUserIdsForKeyWarnings(request.user.id)) {
      await createSecurityEvent({
        userId,
        actorUserId: request.user.id,
        type: 'contact_key_changed',
        severity: 'high',
        title: `${request.user.name}'s encryption key changed`,
        body: 'Verify this contact before trusting newly encrypted messages.',
        metadata: { changeId, changedUserId: request.user.id },
      })
    }
  }
  response.json({ user: publicUser(result.rows[0]) })
})

app.patch('/api/users/me/profile', requireAuth, async (request, response) => {
  const input = parseBody(profileSchema, request.body)
  try {
    const result = await db.query(
      `UPDATE users
       SET name = $1, username = $2, bio = $3, status = $4, avatar = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
                 totp_secret, totp_enabled_at`,
      [input.name, input.username.toLowerCase(), input.bio, input.status, initials(input.name), request.user.id],
    )
    response.json({ user: publicUser(result.rows[0]) })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Username is already taken' })
      return
    }
    throw error
  }
})

app.post('/api/users/me/avatar', requireAuth, uploadLimiter, mediaUpload.single('file'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No file uploaded' })
      return
    }
    if (getMediaKind(request.file.mimetype) !== 'image') {
      response.status(415).json({ error: 'Avatar must be a JPEG, PNG, WebP or AVIF image' })
      return
    }

    const compressed = await compressAvatar(await readUploadedFile(request.file))
    const encrypted = encryptBuffer(compressed.data)
    const storageName = `avatar-${request.user.id}-${Date.now()}.bin`
    await saveMediaObject(storageName, Buffer.from(encrypted.ciphertext, 'base64'))

    const previous = await db.query('SELECT avatar_storage_name FROM users WHERE id = $1', [request.user.id])
    await db.query(
      `UPDATE users
       SET avatar_storage_name = $1, avatar_mime = $2, avatar_iv = $3, avatar_auth_tag = $4,
           avatar_updated_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [storageName, compressed.mimeType, encrypted.iv, encrypted.authTag, request.user.id],
    )
    const previousName = previous.rows[0]?.avatar_storage_name
    if (previousName && previousName !== storageName) {
      try {
        await deleteMediaObject(previousName)
      } catch {
        // Ignore missing old avatar file.
      }
    }
    response.json({ ok: true, avatarUpdatedAt: new Date().toISOString() })
  } finally {
    await cleanupUploadedFile(request.file)
  }
})

app.delete('/api/users/me/avatar', requireAuth, async (request, response) => {
  const previous = await db.query('SELECT avatar_storage_name FROM users WHERE id = $1', [request.user.id])
  await db.query(
    `UPDATE users
     SET avatar_storage_name = NULL, avatar_mime = NULL, avatar_iv = NULL, avatar_auth_tag = NULL,
         avatar_updated_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [request.user.id],
  )
  const previousName = previous.rows[0]?.avatar_storage_name
  if (previousName) {
    try {
      await deleteMediaObject(previousName)
    } catch {
      // Ignore.
    }
  }
  response.json({ ok: true })
})

app.get('/api/users/:userId/avatar', requireAuth, async (request, response) => {
  const result = await db.query(
    'SELECT avatar_storage_name, avatar_mime, avatar_iv, avatar_auth_tag FROM users WHERE id = $1 LIMIT 1',
    [request.params.userId],
  )
  const row = result.rows[0]
  if (!row || !row.avatar_storage_name) {
    response.status(404).json({ error: 'No avatar' })
    return
  }
  let encryptedFile
  try {
    encryptedFile = await getMediaObject(row.avatar_storage_name)
  } catch {
    response.status(404).json({ error: 'No avatar' })
    return
  }
  const data = decryptBuffer({
    ciphertext: encryptedFile.toString('base64'),
    iv: row.avatar_iv,
    authTag: row.avatar_auth_tag,
  })
  response.setHeader('Content-Type', row.avatar_mime || 'image/webp')
  response.setHeader('Cache-Control', 'private, max-age=120')
  response.setHeader('Content-Length', data.length)
  response.send(data)
})

app.post('/api/auth/change-password', requireAuth, async (request, response) => {
  const input = parseBody(changePasswordSchema, request.body)
  const result = await db.query(
    'SELECT password_salt, password_hash FROM users WHERE id = $1 LIMIT 1',
    [request.user.id],
  )
  const row = result.rows[0]
  const valid = row ? await verifyPassword(input.currentPassword, row.password_salt, row.password_hash) : false
  if (!valid) {
    response.status(400).json({ error: 'Current password is incorrect' })
    return
  }
  const password = await hashPassword(input.newPassword)
  const currentTokenHash = getSessionTokenHash(request)
  const deletedSessions = await db.query(
    `SELECT token_hash FROM sessions
     WHERE user_id = $1 AND token_hash <> $2`,
    [request.user.id, currentTokenHash],
  )
  await db.transaction(async (tx) => {
    await tx.query(
      'UPDATE users SET password_salt = $1, password_hash = $2, updated_at = NOW() WHERE id = $3',
      [password.salt, password.hash, request.user.id],
    )
    // Sign out other devices after a password change.
    await tx.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
      request.user.id,
      currentTokenHash,
    ])
  })
  await deleteCachedSessions(deletedSessions.rows.map((session) => session.token_hash))
  response.json({ ok: true })
})

app.delete('/api/users/me', requireAuth, async (request, response) => {
  const userId = request.user.id
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM messages WHERE sender_id = $1', [userId])
    await tx.query('DELETE FROM calls WHERE initiator_id = $1 OR recipient_id = $1', [userId])
    await tx.query('DELETE FROM chats WHERE created_by = $1', [userId])
    await tx.query('DELETE FROM users WHERE id = $1', [userId])
  })
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    path: '/',
  })
  response.json({ ok: true })
})

app.get('/api/chats', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT c.id, c.type, c.title, c.created_at, c.pinned_message_id,
            c.slow_mode_seconds, c.default_permissions, c.linked_group_id,
            cm.role, cm.permissions,
            cus.pinned, cus.pinned_at, cus.muted_until, cus.archived, cus.archived_at,
            cus.push_mode
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     LEFT JOIN chat_user_settings cus
       ON cus.chat_id = c.id AND cus.user_id = cm.user_id
     WHERE cm.user_id = $1
     ORDER BY COALESCE(cus.pinned_at, c.created_at) DESC, c.created_at DESC`,
    [request.user.id],
  )

  const chats = await Promise.all(
    result.rows.map(async (chat) => {
      const members = await db.query(
        `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar, u.last_seen_at,
                u.encryption_public_key, cm.role,
                EXISTS (
                  SELECT 1 FROM user_blocks ub
                  WHERE ub.blocker_id = $2 AND ub.blocked_id = u.id
                ) AS blocked_by_me,
                EXISTS (
                  SELECT 1 FROM user_blocks ub
                  WHERE ub.blocker_id = u.id AND ub.blocked_id = $2
                ) AS blocked_me
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = $1
         ORDER BY cm.joined_at`,
        [chat.id, request.user.id],
      )
      return {
        ...chat,
        settings: publicChatSettings(chat),
        pinnedMessageId: chat.pinned_message_id || null,
        linkedGroupId: chat.linked_group_id || null,
        slowModeSeconds: Number(chat.slow_mode_seconds || 0),
        permissions: publicChatPermissions(chat),
        members: members.rows.map((member) => ({
          ...publicUser(member),
          role: member.role,
        })),
      }
    }),
  )

  response.json({ chats })
})

app.post('/api/chats', requireAuth, async (request, response) => {
  const input = parseBody(createChatSchema, request.body)
  const memberIds = [...new Set([request.user.id, ...input.memberIds])]
  if (input.type === 'private' && memberIds.length !== 2) {
    response.status(400).json({ error: 'Private chat requires exactly one other member' })
    return
  }

  if (input.type === 'private') {
    const targetUserId = input.memberIds[0]
    if (await hasBlockBetween(request.user.id, targetUserId)) {
      response.status(403).json({ error: 'Private chat is blocked' })
      return
    }
    const existing = await db.query(
      `SELECT c.id
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       JOIN chat_members theirs ON theirs.chat_id = c.id AND theirs.user_id = $2
       WHERE c.type = 'private'
         AND (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) = 2
       LIMIT 1`,
      [request.user.id, targetUserId],
    )
    if (existing.rows[0]) {
      const settings = await ensureChatSettings(existing.rows[0].id, request.user.id)
      response.json({
        chat: {
          id: existing.rows[0].id,
          ...input,
          settings: publicChatSettings(settings),
        },
        existing: true,
      })
      return
    }
  }

  const validUsers = await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [memberIds])
  if (validUsers.rows.length !== memberIds.length) {
    response.status(400).json({ error: 'One or more members do not exist' })
    return
  }

  const chatId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO chats (id, type, title, created_by) VALUES ($1, $2, $3, $4)',
      [chatId, input.type, input.title, request.user.id],
    )
    for (const memberId of memberIds) {
      await tx.query(
        'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, memberId, memberId === request.user.id ? 'owner' : 'member'],
      )
      await tx.query(
        `INSERT INTO chat_user_settings (chat_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [chatId, memberId],
      )
    }
  })
  response.status(201).json({
    chat: {
      id: chatId,
      ...input,
      settings: publicChatSettings(),
    },
  })
})

app.patch('/api/chats/:chatId/settings', requireAuth, async (request, response) => {
  const chat = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!chat) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const input = parseBody(chatSettingsSchema, request.body)
  const current = await ensureChatSettings(request.params.chatId, request.user.id)
  const now = new Date().toISOString()

  const pinned = input.pinned ?? isDatabaseTrue(current.pinned)
  const pinnedAt = input.pinned === undefined
    ? current.pinned_at || null
    : input.pinned
      ? now
      : null

  const archived = input.archived ?? isDatabaseTrue(current.archived)
  const archivedAt = input.archived === undefined
    ? current.archived_at || null
    : input.archived
      ? now
      : null

  let mutedUntil = current.muted_until || null
  if (Object.prototype.hasOwnProperty.call(input, 'mutedUntil')) {
    mutedUntil = input.mutedUntil
  }
  if (Object.prototype.hasOwnProperty.call(input, 'muted')) {
    mutedUntil = input.muted ? (input.mutedUntil || INDEFINITE_MUTE_UNTIL) : null
  }

  const result = await db.query(
    `UPDATE chat_user_settings
     SET pinned = $1,
         pinned_at = $2,
         muted_until = $3,
         archived = $4,
         archived_at = $5,
         push_mode = $6,
         updated_at = NOW()
     WHERE chat_id = $7 AND user_id = $8
     RETURNING pinned, pinned_at, muted_until, archived, archived_at, push_mode`,
    [
      pinned,
      pinnedAt,
      mutedUntil,
      archived,
      archivedAt,
      input.pushMode || current.push_mode || 'default',
      request.params.chatId,
      request.user.id,
    ],
  )

  const settings = publicChatSettings(result.rows[0])
  await sendToUser(request.user.id, {
    type: 'chat:settings',
    chatId: request.params.chatId,
    settings,
  })
  response.json({ chatId: request.params.chatId, settings })
})

const SYSTEM_FOLDERS = [
  { id: 'all', title: 'All', filter: 'all' },
  { id: 'unread', title: 'Unread', filter: 'unread' },
  { id: 'personal', title: 'Personal', filter: 'private' },
  { id: 'groups', title: 'Groups', filter: 'group' },
  { id: 'channels', title: 'Channels', filter: 'channel' },
  { id: 'archived', title: 'Archived', filter: 'archived' },
]

app.get('/api/chat-folders', requireAuth, async (request, response) => {
  const foldersResult = await db.query(
    `SELECT id, title, icon, sort_order, created_at, updated_at
     FROM chat_folders
     WHERE user_id = $1
     ORDER BY sort_order, created_at`,
    [request.user.id],
  )
  const chatsResult = await db.query(
    `SELECT folder_id, chat_id, pinned, pinned_at, added_at
     FROM chat_folder_chats
     WHERE user_id = $1
     ORDER BY COALESCE(pinned_at, added_at) DESC, added_at DESC`,
    [request.user.id],
  )
  const chatsByFolder = new Map()
  chatsResult.rows.forEach((row) => {
    const rows = chatsByFolder.get(row.folder_id) || []
    rows.push({
      chatId: row.chat_id,
      pinned: isDatabaseTrue(row.pinned),
      pinnedAt: row.pinned_at || null,
      addedAt: row.added_at,
    })
    chatsByFolder.set(row.folder_id, rows)
  })

  response.json({
    systemFolders: SYSTEM_FOLDERS,
    folders: foldersResult.rows.map((folder) => ({
      id: folder.id,
      title: folder.title,
      icon: folder.icon,
      sortOrder: folder.sort_order,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
      chats: chatsByFolder.get(folder.id) || [],
    })),
  })
})

app.post('/api/chat-folders', requireAuth, async (request, response) => {
  const input = parseBody(chatFolderSchema, request.body)
  const chatIds = await validateMemberChatIds(request.user.id, input.chatIds)
  const folderId = randomUUID()
  const normalizedTitle = normalizeFolderTitle(input.title)
  const sortResult = await db.query(
    'SELECT COALESCE(MAX(sort_order), 0)::integer AS sort_order FROM chat_folders WHERE user_id = $1',
    [request.user.id],
  )
  const sortOrder = Number(sortResult.rows[0]?.sort_order || 0) + 1

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO chat_folders
          (id, user_id, title, normalized_title, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [folderId, request.user.id, input.title, normalizedTitle, input.icon, sortOrder],
      )
      for (const chatId of chatIds) {
        await tx.query(
          `INSERT INTO chat_folder_chats (folder_id, chat_id, user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (folder_id, chat_id) DO NOTHING`,
          [folderId, chatId, request.user.id],
        )
      }
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Folder title already exists' })
      return
    }
    throw error
  }

  response.status(201).json({
    folder: {
      id: folderId,
      title: input.title,
      icon: input.icon,
      sortOrder,
      chats: chatIds.map((chatId) => ({ chatId, pinned: false, pinnedAt: null })),
    },
  })
})

app.patch('/api/chat-folders/:folderId', requireAuth, async (request, response) => {
  const input = parseBody(updateChatFolderSchema, request.body)
  const existing = await db.query(
    `SELECT id, title, icon, sort_order
     FROM chat_folders
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [request.params.folderId, request.user.id],
  )
  if (!existing.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }

  const chatIds = input.chatIds ? await validateMemberChatIds(request.user.id, input.chatIds) : null
  const nextTitle = input.title ?? existing.rows[0].title
  const nextIcon = input.icon ?? existing.rows[0].icon

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE chat_folders
         SET title = $1,
             normalized_title = $2,
             icon = $3,
             updated_at = NOW()
         WHERE id = $4 AND user_id = $5`,
        [
          nextTitle,
          normalizeFolderTitle(nextTitle),
          nextIcon,
          request.params.folderId,
          request.user.id,
        ],
      )
      if (chatIds) {
        await tx.query(
          'DELETE FROM chat_folder_chats WHERE folder_id = $1 AND user_id = $2',
          [request.params.folderId, request.user.id],
        )
        for (const chatId of chatIds) {
          await tx.query(
            `INSERT INTO chat_folder_chats (folder_id, chat_id, user_id)
             VALUES ($1, $2, $3)`,
            [request.params.folderId, chatId, request.user.id],
          )
        }
      }
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Folder title already exists' })
      return
    }
    throw error
  }

  response.json({
    folder: {
      id: request.params.folderId,
      title: nextTitle,
      icon: nextIcon,
      sortOrder: existing.rows[0].sort_order,
      chats: chatIds?.map((chatId) => ({ chatId, pinned: false, pinnedAt: null })) || undefined,
    },
  })
})

app.delete('/api/chat-folders/:folderId', requireAuth, async (request, response) => {
  const result = await db.query(
    'DELETE FROM chat_folders WHERE id = $1 AND user_id = $2 RETURNING id',
    [request.params.folderId, request.user.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }
  response.status(204).end()
})

app.patch('/api/chat-folders/:folderId/chats/:chatId', requireAuth, async (request, response) => {
  const input = parseBody(chatFolderChatSettingsSchema, request.body)
  const folderResult = await db.query(
    `SELECT id
     FROM chat_folders
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [request.params.folderId, request.user.id],
  )
  if (!folderResult.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const pinnedAt = input.pinned ? new Date().toISOString() : null
  const result = await db.query(
    `UPDATE chat_folder_chats
     SET pinned = $1, pinned_at = $2
     WHERE folder_id = $3 AND chat_id = $4 AND user_id = $5
     RETURNING folder_id, chat_id, pinned, pinned_at, added_at`,
    [
      input.pinned,
      pinnedAt,
      request.params.folderId,
      request.params.chatId,
      request.user.id,
    ],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Chat is not in this folder' })
    return
  }

  const row = result.rows[0]
  response.json({
    folderId: row.folder_id,
    chat: {
      chatId: row.chat_id,
      pinned: isDatabaseTrue(row.pinned),
      pinnedAt: row.pinned_at || null,
      addedAt: row.added_at,
    },
  })
})

// ── Link preview ───────────────────────────────────────────────────────────────
const linkPreviewCache = new Map() // url → { title, description, image, siteName, cachedAt }
const LINK_PREVIEW_TTL_MS = 5 * 60 * 1000

app.get('/api/link-preview', requireAuth, async (request, response) => {
  const url = String(request.query.url || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    response.status(400).json({ error: 'Invalid URL' })
    return
  }

  const cached = linkPreviewCache.get(url)
  if (cached && Date.now() - cached.cachedAt < LINK_PREVIEW_TTL_MS) {
    response.json({
      title: cached.title,
      description: cached.description,
      image: cached.image,
      siteName: cached.siteName,
    })
    return
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const fetchResponse = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'OndaBot/1.0' },
      redirect: 'follow',
    })
    clearTimeout(timeoutId)

    const contentType = fetchResponse.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) {
      response.json({ title: null, description: null, image: null, siteName: null })
      return
    }

    const html = await fetchResponse.text()

    function metaContent(property, name) {
      const byProperty = html.match(
        new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
      ) || html.match(
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
      )
      if (byProperty) return byProperty[1]
      if (!name) return null
      const byName = html.match(
        new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
      ) || html.match(
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'),
      )
      return byName ? byName[1] : null
    }

    const titleTag = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)
    const preview = {
      title: metaContent('og:title') || metaContent('twitter:title') || (titleTag ? titleTag[1].trim() : null),
      description: metaContent('og:description', 'description') || metaContent('twitter:description'),
      image: metaContent('og:image') || metaContent('twitter:image'),
      siteName: metaContent('og:site_name'),
    }

    // Trim long strings
    if (preview.title) preview.title = preview.title.slice(0, 120)
    if (preview.description) preview.description = preview.description.slice(0, 240)

    linkPreviewCache.set(url, { ...preview, cachedAt: Date.now() })
    response.json(preview)
  } catch {
    response.json({ title: null, description: null, image: null, siteName: null })
  }
})

// ── Group member management ─────────────────────────────────────────────────
app.get('/api/chats/:chatId/members', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `SELECT u.id, u.name, u.username, u.status, u.avatar, u.last_seen_at,
            cm.role, cm.permissions, cm.joined_at
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = $1
     ORDER BY cm.joined_at ASC`,
    [request.params.chatId],
  )
  response.json({ members: result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    status: r.status || '',
    avatar: r.avatar,
    lastSeenAt: r.last_seen_at,
    role: r.role,
    permissions: publicChatPermissions({ ...row, role: r.role, permissions: r.permissions }),
    joinedAt: r.joined_at,
  })) })
})

app.post('/api/chats/:chatId/members', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_members', 'Only admins can add members')
  const { userId } = request.body
  if (!userId || typeof userId !== 'string') {
    response.status(400).json({ error: 'userId is required' })
    return
  }
  if (await isBannedFromChat(request.params.chatId, userId)) {
    response.status(403).json({ error: 'User is banned in this chat' })
    return
  }
  // Verify user exists
  const userResult = await db.query('SELECT id, name, username FROM users WHERE id = $1', [userId])
  if (!userResult.rows.length) { response.status(404).json({ error: 'User not found' }); return }
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [request.params.chatId, userId],
    )
    await tx.query(
      `INSERT INTO chat_user_settings (chat_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [request.params.chatId, userId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: userId,
      action: 'member.add',
    })
  })
  const payload = { type: 'chat:member-added', chatId: request.params.chatId, userId }
  await sendToChat(request.params.chatId, payload)
  response.json({ member: { id: userId, name: userResult.rows[0].name, username: userResult.rows[0].username } })
})

app.delete('/api/chats/:chatId/members/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const isSelf = request.params.userId === request.user.id
  if (!isSelf) requirePermission(row, 'manage_members', 'Only admins can remove members')
  const target = await requireChatMemberRow(request.params.chatId, request.params.userId)
  if (!target) {
    response.status(404).json({ error: 'Member not found' })
    return
  }
  if (target.role === 'owner' && !isSelf) {
    response.status(403).json({ error: 'Owner cannot be kicked' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [request.params.chatId, request.params.userId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: isSelf ? 'member.leave' : 'member.kick',
    })
  })
  const payload = { type: 'chat:member-removed', chatId: request.params.chatId, userId: request.params.userId }
  await sendToChat(request.params.chatId, payload)
  response.json({ ok: true })
})

app.patch('/api/chats/:chatId/members/:userId/role', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_roles', 'Only owners can change roles')
  const input = parseBody(memberRoleSchema, request.body)
  const target = await requireChatMemberRow(request.params.chatId, request.params.userId)
  if (!target) { response.status(404).json({ error: 'Member not found' }); return }
  if (target.role === 'owner' && request.params.userId !== request.user.id) {
    response.status(403).json({ error: 'Owner role cannot be changed by another user' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_members
       SET role = $1, permissions = $2
       WHERE chat_id = $3 AND user_id = $4`,
      [
        input.role,
        JSON.stringify(input.permissions || {}),
        request.params.chatId,
        request.params.userId,
      ],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.role',
      metadata: { role: input.role, permissions: input.permissions || {} },
    })
  })
  const payload = {
    type: 'chat:member-role',
    chatId: request.params.chatId,
    userId: request.params.userId,
    role: input.role,
    permissions: input.permissions || {},
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.patch('/api/chats/:chatId/members/:userId/permissions', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_roles', 'Only owners can change permissions')
  const input = parseBody(memberPermissionsSchema, request.body)
  await db.transaction(async (tx) => {
    const result = await tx.query(
      `UPDATE chat_members
       SET permissions = $1
       WHERE chat_id = $2 AND user_id = $3
       RETURNING role, permissions`,
      [JSON.stringify(input.permissions), request.params.chatId, request.params.userId],
    )
    if (!result.rows.length) {
      const error = new Error('Member not found')
      error.status = 404
      throw error
    }
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.permissions',
      metadata: { permissions: input.permissions },
    })
  })
  const payload = {
    type: 'chat:member-permissions',
    chatId: request.params.chatId,
    userId: request.params.userId,
    permissions: input.permissions,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.patch('/api/chats/:chatId/moderation', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can update moderation settings')
  const input = parseBody(chatModerationSettingsSchema, request.body)
  const nextSlowMode = input.slowModeSeconds ?? Number(row.slow_mode_seconds || 0)
  const nextDefaults = input.defaultPermissions ?? parseJsonObject(row.default_permissions)
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chats
       SET slow_mode_seconds = $1, default_permissions = $2
       WHERE id = $3`,
      [nextSlowMode, JSON.stringify(nextDefaults), request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'chat.moderation',
      metadata: { slowModeSeconds: nextSlowMode, defaultPermissions: nextDefaults },
    })
  })
  const payload = {
    type: 'chat:moderation',
    chatId: request.params.chatId,
    slowModeSeconds: nextSlowMode,
    defaultPermissions: nextDefaults,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.get('/api/chats/:chatId/bans', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can view bans')
  const result = await db.query(
    `SELECT cb.user_id, cb.banned_by, cb.reason, cb.expires_at, cb.created_at,
            u.name, u.username, u.avatar
     FROM chat_bans cb
     JOIN users u ON u.id = cb.user_id
     WHERE cb.chat_id = $1
       AND (cb.expires_at IS NULL OR cb.expires_at > NOW())
     ORDER BY cb.created_at DESC`,
    [request.params.chatId],
  )
  response.json({
    bans: result.rows.map((ban) => ({
      userId: ban.user_id,
      bannedBy: ban.banned_by,
      reason: ban.reason,
      expiresAt: ban.expires_at || null,
      createdAt: ban.created_at,
      user: { id: ban.user_id, name: ban.name, username: ban.username, avatar: ban.avatar },
    })),
  })
})

app.post('/api/chats/:chatId/bans', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can ban users')
  const input = parseBody(banMemberSchema, request.body)
  const target = await requireChatMemberRow(request.params.chatId, input.userId)
  if (target?.role === 'owner') {
    response.status(403).json({ error: 'Owner cannot be banned' })
    return
  }
  const expiresAt = input.durationSeconds
    ? new Date(Date.now() + input.durationSeconds * 1000).toISOString()
    : null
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_bans (chat_id, user_id, banned_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chat_id, user_id)
       DO UPDATE SET banned_by = EXCLUDED.banned_by,
                     reason = EXCLUDED.reason,
                     expires_at = EXCLUDED.expires_at,
                     created_at = NOW()`,
      [request.params.chatId, input.userId, request.user.id, input.reason, expiresAt],
    )
    await tx.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [
      request.params.chatId,
      input.userId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: input.userId,
      action: expiresAt ? 'member.temp_ban' : 'member.ban',
      metadata: { reason: input.reason, expiresAt },
    })
  })
  const payload = {
    type: 'chat:member-banned',
    chatId: request.params.chatId,
    userId: input.userId,
    expiresAt,
  }
  await sendToChat(request.params.chatId, payload)
  await sendToUser(input.userId, payload)
  response.status(201).json({ ban: { userId: input.userId, reason: input.reason, expiresAt } })
})

app.delete('/api/chats/:chatId/bans/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can unban users')
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM chat_bans WHERE chat_id = $1 AND user_id = $2', [
      request.params.chatId,
      request.params.userId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.unban',
    })
  })
  response.status(204).end()
})

app.get('/api/chats/:chatId/invites', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can view invite links')
  const result = await db.query(
    `SELECT id, token, name, expires_at, usage_limit, uses, require_approval,
            revoked_at, created_at
     FROM chat_invite_links
     WHERE chat_id = $1
     ORDER BY created_at DESC`,
    [request.params.chatId],
  )
  response.json({
    invites: result.rows.map((invite) => ({
      id: invite.id,
      token: invite.token,
      url: `/join/${invite.token}`,
      name: invite.name,
      expiresAt: invite.expires_at || null,
      usageLimit: invite.usage_limit,
      uses: Number(invite.uses || 0),
      requireApproval: isDatabaseTrue(invite.require_approval),
      revokedAt: invite.revoked_at || null,
      createdAt: invite.created_at,
    })),
  })
})

app.post('/api/chats/:chatId/invites', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can create invite links')
  const input = parseBody(inviteLinkSchema, request.body)
  const id = randomUUID()
  const token = randomUUID().replaceAll('-', '')
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_invite_links
        (id, chat_id, token, created_by, name, expires_at, usage_limit, require_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        request.params.chatId,
        token,
        request.user.id,
        input.name,
        input.expiresAt || null,
        input.usageLimit || null,
        input.requireApproval,
      ],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'invite.create',
      metadata: { inviteId: id, requireApproval: input.requireApproval },
    })
  })
  response.status(201).json({
    invite: {
      id,
      token,
      url: `/join/${token}`,
      name: input.name,
      expiresAt: input.expiresAt || null,
      usageLimit: input.usageLimit || null,
      uses: 0,
      requireApproval: input.requireApproval,
    },
  })
})

app.delete('/api/chats/:chatId/invites/:inviteId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can revoke invite links')
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_invite_links
       SET revoked_at = NOW()
       WHERE id = $1 AND chat_id = $2`,
      [request.params.inviteId, request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'invite.revoke',
      metadata: { inviteId: request.params.inviteId },
    })
  })
  response.status(204).end()
})

app.post('/api/invites/:token/join', requireAuth, async (request, response) => {
  const input = parseBody(joinInviteSchema, request.body)
  const inviteResult = await db.query(
    `SELECT cil.id, cil.chat_id, cil.usage_limit, cil.uses, cil.require_approval,
            c.type, c.title
     FROM chat_invite_links cil
     JOIN chats c ON c.id = cil.chat_id
     WHERE cil.token = $1
       AND cil.revoked_at IS NULL
       AND (cil.expires_at IS NULL OR cil.expires_at > NOW())
     LIMIT 1`,
    [request.params.token],
  )
  const invite = inviteResult.rows[0]
  if (!invite || (invite.usage_limit && Number(invite.uses) >= Number(invite.usage_limit))) {
    response.status(404).json({ error: 'Invite link is not available' })
    return
  }
  if (await isBannedFromChat(invite.chat_id, request.user.id)) {
    response.status(403).json({ error: 'You are banned in this chat' })
    return
  }
  if (await isChatMember(invite.chat_id, request.user.id)) {
    response.json({ chatId: invite.chat_id, joined: true, existing: true })
    return
  }
  if (isDatabaseTrue(invite.require_approval)) {
    await db.query(
      `INSERT INTO chat_join_requests (chat_id, user_id, invite_link_id, message, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (chat_id, user_id)
       DO UPDATE SET invite_link_id = EXCLUDED.invite_link_id,
                     message = EXCLUDED.message,
                     status = 'pending',
                     reviewed_by = NULL,
                     reviewed_at = NULL,
                     created_at = NOW()`,
      [invite.chat_id, request.user.id, invite.id, input.message],
    )
    response.status(202).json({ chatId: invite.chat_id, joinRequest: 'pending' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [invite.chat_id, request.user.id],
    )
    await tx.query(
      `INSERT INTO chat_user_settings (chat_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [invite.chat_id, request.user.id],
    )
    await tx.query('UPDATE chat_invite_links SET uses = uses + 1 WHERE id = $1', [invite.id])
    await appendAdminLog(tx, {
      chatId: invite.chat_id,
      actorUserId: request.user.id,
      targetUserId: request.user.id,
      action: 'member.join_invite',
      metadata: { inviteId: invite.id },
    })
  })
  await sendToChat(invite.chat_id, {
    type: 'chat:member-added',
    chatId: invite.chat_id,
    userId: request.user.id,
  })
  response.status(201).json({ chatId: invite.chat_id, joined: true })
})

app.get('/api/chats/:chatId/join-requests', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'approve_join_requests', 'Only admins can review join requests')
  const result = await db.query(
    `SELECT cjr.user_id, cjr.message, cjr.status, cjr.created_at,
            u.name, u.username, u.avatar
     FROM chat_join_requests cjr
     JOIN users u ON u.id = cjr.user_id
     WHERE cjr.chat_id = $1 AND cjr.status = 'pending'
     ORDER BY cjr.created_at ASC`,
    [request.params.chatId],
  )
  response.json({
    requests: result.rows.map((joinRequest) => ({
      userId: joinRequest.user_id,
      message: joinRequest.message,
      status: joinRequest.status,
      createdAt: joinRequest.created_at,
      user: {
        id: joinRequest.user_id,
        name: joinRequest.name,
        username: joinRequest.username,
        avatar: joinRequest.avatar,
      },
    })),
  })
})

app.post('/api/chats/:chatId/join-requests/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'approve_join_requests', 'Only admins can review join requests')
  const input = parseBody(reviewJoinRequestSchema, request.body)
  const requestResult = await db.query(
    `SELECT chat_id, user_id, invite_link_id
     FROM chat_join_requests
     WHERE chat_id = $1 AND user_id = $2 AND status = 'pending'
     LIMIT 1`,
    [request.params.chatId, request.params.userId],
  )
  const joinRequest = requestResult.rows[0]
  if (!joinRequest) { response.status(404).json({ error: 'Join request not found' }); return }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_join_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE chat_id = $3 AND user_id = $4`,
      [input.approved ? 'approved' : 'declined', request.user.id, request.params.chatId, request.params.userId],
    )
    if (input.approved) {
      await tx.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [request.params.chatId, request.params.userId],
      )
      await tx.query(
        `INSERT INTO chat_user_settings (chat_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [request.params.chatId, request.params.userId],
      )
      if (joinRequest.invite_link_id) {
        await tx.query('UPDATE chat_invite_links SET uses = uses + 1 WHERE id = $1', [
          joinRequest.invite_link_id,
        ])
      }
    }
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: input.approved ? 'join_request.approve' : 'join_request.decline',
    })
  })
  const payload = {
    type: input.approved ? 'chat:member-added' : 'chat:join-request-declined',
    chatId: request.params.chatId,
    userId: request.params.userId,
  }
  if (input.approved) await sendToChat(request.params.chatId, payload)
  await sendToUser(request.params.userId, payload)
  response.json({ chatId: request.params.chatId, userId: request.params.userId, approved: input.approved })
})

app.get('/api/chats/:chatId/admin-log', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can view admin log')
  const limit = Math.min(100, Math.max(1, parseInt(request.query.limit, 10) || 50))
  const result = await db.query(
    `SELECT id, actor_user_id, target_user_id, action, metadata, created_at
     FROM chat_admin_log
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [request.params.chatId, limit],
  )
  response.json({
    events: result.rows.map((event) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      targetUserId: event.target_user_id,
      action: event.action,
      metadata: parseJsonObject(event.metadata),
      createdAt: event.created_at,
    })),
  })
})

app.patch('/api/chats/:chatId/info', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can update group info')
  const title = String(request.body.title || '').trim().slice(0, 64)
  if (!title) { response.status(400).json({ error: 'Title is required' }); return }
  await db.transaction(async (tx) => {
    await tx.query('UPDATE chats SET title = $1 WHERE id = $2', [title, request.params.chatId])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'chat.info',
      metadata: { title },
    })
  })
  const payload = { type: 'chat:info-updated', chatId: request.params.chatId, title }
  await sendToChat(request.params.chatId, payload)
  response.json({ chat: { id: request.params.chatId, title } })
})

// --- Discussion groups ---

app.get('/api/chats/:chatId/discussion', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  if (row.type !== 'channel') { response.status(400).json({ error: 'Only channels can have discussion groups' }); return }

  const result = await db.query(
    `SELECT c.id, c.title, c.type,
            (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) AS member_count
     FROM chats c
     WHERE c.id = (SELECT linked_group_id FROM chats WHERE id = $1)`,
    [request.params.chatId],
  )
  const group = result.rows[0]
  response.json({ group: group
    ? { id: group.id, title: group.title, type: group.type, memberCount: Number(group.member_count) }
    : null,
  })
})

app.put('/api/chats/:chatId/discussion', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  if (row.type !== 'channel') { response.status(400).json({ error: 'Only channels can have discussion groups' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can set discussion group')

  const groupId = request.body.groupId ? String(request.body.groupId) : null

  if (groupId) {
    const groupRow = await requireChatMemberRow(groupId, request.user.id)
    if (!groupRow || groupRow.type !== 'group') {
      response.status(400).json({ error: 'Target must be a group you belong to' })
      return
    }
    if (!hasPermission(groupRow, 'manage_chat')) {
      response.status(403).json({ error: 'You must be an admin of the target group' })
      return
    }
  }

  await db.query(
    'UPDATE chats SET linked_group_id = $1 WHERE id = $2',
    [groupId, request.params.chatId],
  )
  const payload = { type: 'chat:discussion-updated', chatId: request.params.chatId, groupId }
  await sendToChat(request.params.chatId, payload)
  response.json({ groupId })
})

app.get('/api/chats/:chatId/topics', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `SELECT id, title, created_by, pinned, closed, message_count,
            last_message_at, created_at, updated_at
     FROM chat_topics
     WHERE chat_id = $1
     ORDER BY pinned DESC, COALESCE(last_message_at, updated_at) DESC`,
    [request.params.chatId],
  )
  response.json({
    topics: result.rows.map((topic) => ({
      id: topic.id,
      title: topic.title,
      createdBy: topic.created_by,
      pinned: isDatabaseTrue(topic.pinned),
      closed: isDatabaseTrue(topic.closed),
      messageCount: Number(topic.message_count || 0),
      lastMessageAt: topic.last_message_at || null,
      createdAt: topic.created_at,
      updatedAt: topic.updated_at,
    })),
  })
})

app.post('/api/chats/:chatId/topics', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_topics', 'Only moderators can create topics')
  if (row.type !== 'group') {
    response.status(400).json({ error: 'Topics are available only in groups' })
    return
  }
  const input = parseBody(topicSchema, request.body)
  const topicId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_topics (id, chat_id, title, created_by)
       VALUES ($1, $2, $3, $4)`,
      [topicId, request.params.chatId, input.title, request.user.id],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'topic.create',
      metadata: { topicId, title: input.title },
    })
  })
  const topic = {
    id: topicId,
    chatId: request.params.chatId,
    title: input.title,
    createdBy: request.user.id,
    pinned: false,
    closed: false,
    messageCount: 0,
  }
  await sendToChat(request.params.chatId, { type: 'chat:topic-created', topic })
  response.status(201).json({ topic })
})

app.patch('/api/chats/:chatId/topics/:topicId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_topics', 'Only moderators can update topics')
  const input = parseBody(updateTopicSchema, request.body)
  const existing = await db.query(
    'SELECT id, title, pinned, closed FROM chat_topics WHERE id = $1 AND chat_id = $2 LIMIT 1',
    [request.params.topicId, request.params.chatId],
  )
  if (!existing.rows.length) {
    response.status(404).json({ error: 'Topic not found' })
    return
  }
  const current = existing.rows[0]
  const next = {
    title: input.title ?? current.title,
    pinned: input.pinned ?? isDatabaseTrue(current.pinned),
    closed: input.closed ?? isDatabaseTrue(current.closed),
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_topics
       SET title = $1, pinned = $2, closed = $3, updated_at = NOW()
       WHERE id = $4 AND chat_id = $5`,
      [next.title, next.pinned, next.closed, request.params.topicId, request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'topic.update',
      metadata: { topicId: request.params.topicId, ...next },
    })
  })
  const payload = {
    type: 'chat:topic-updated',
    chatId: request.params.chatId,
    topic: { id: request.params.topicId, ...next },
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.get('/api/chats/:chatId/media', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }

  const rawKinds = [request.query.kind].flat().filter(Boolean)
  const allowed = ['image', 'video', 'file', 'voice', 'audio']
  const kinds = rawKinds.length ? rawKinds.filter((k) => allowed.includes(k)) : allowed

  const limit = Math.min(Number(request.query.limit) || 40, 100)
  const before = request.query.before || null

  const result = await db.query(
    `SELECT m.id AS message_id, m.created_at,
            mf.id, mf.kind, mf.original_name, mf.mime_type,
            mf.plain_size, mf.original_size, mf.width, mf.height,
            mf.client_encrypted, mf.media_envelope, mf.duration_ms
     FROM messages m
     JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND mf.kind = ANY($3)
       AND m.deleted_at IS NULL
       AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
       AND m.sent_at IS NOT NULL
       AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
       AND NOT EXISTS (
         SELECT 1 FROM message_user_deletions mud
         WHERE mud.message_id = m.id AND mud.user_id = $2
       )
       AND ($4::timestamptz IS NULL OR m.created_at < $4)
     ORDER BY m.created_at DESC
     LIMIT $5`,
    [request.params.chatId, request.user.id, kinds, before, limit + 1],
  )

  const rows = result.rows
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map((row) => ({
    messageId: row.message_id,
    id: row.id,
    kind: row.kind,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.plain_size || row.original_size || 0),
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    clientEncrypted: isDatabaseTrue(row.client_encrypted),
    mediaEnvelope: row.media_envelope || null,
    durationMs: row.duration_ms ? Number(row.duration_ms) : null,
    url: `/api/media/${row.id}`,
    createdAt: row.created_at,
  }))

  response.json({ items, hasMore, nextBefore: hasMore ? items.at(-1).createdAt : null })
})

app.get('/api/search', requireAuth, async (request, response) => {
  const query = normalizeSearchQuery(request.query.q)
  if (!query) {
    response.json({ query, users: [], chats: [], messages: [] })
    return
  }

  const [usersResult, chatsResult, messagesResult] = await Promise.all([
    db.query(
      `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key
       FROM users
       WHERE id <> $1
         AND (username ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
       ORDER BY name
       LIMIT 20`,
      [request.user.id, query],
    ),
    db.query(
      `SELECT DISTINCT c.id, c.type, c.title, c.created_at
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       LEFT JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE c.title ILIKE '%' || $2 || '%'
          OR u.username ILIKE '%' || $2 || '%'
          OR u.name ILIKE '%' || $2 || '%'
       ORDER BY c.created_at DESC
       LIMIT 25`,
      [request.user.id, query],
    ),
    db.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.created_at, m.search_text,
              c.type AS chat_type, c.title AS chat_title
       FROM messages m
       JOIN chat_members mine ON mine.chat_id = m.chat_id AND mine.user_id = $1
       JOIN chats c ON c.id = m.chat_id
       LEFT JOIN chat_history_clears chc
         ON chc.chat_id = m.chat_id AND chc.user_id = $1
       WHERE m.deleted_at IS NULL
         AND m.search_text <> ''
         AND m.search_text ILIKE '%' || $2 || '%'
         AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
         AND NOT EXISTS (
           SELECT 1 FROM message_user_deletions mud
           WHERE mud.message_id = m.id AND mud.user_id = $1
         )
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [request.user.id, query],
    ),
  ])

  response.json({
    query,
    users: usersResult.rows.map(publicUser),
    chats: chatsResult.rows.map((chat) => ({
      id: chat.id,
      type: chat.type,
      title: chat.title,
      createdAt: chat.created_at,
    })),
    messages: messagesResult.rows.map((message) => ({
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      createdAt: message.created_at,
      preview: message.search_text,
      chat: {
        type: message.chat_type,
        title: message.chat_title,
      },
    })),
    messageSearchLimitedByEncryption: true,
  })
})

app.get('/api/chats/:chatId/search', requireAuth, apiLimiter, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const query = normalizeSearchQuery(request.query.q)
  if (!query) {
    response.json({ query, messages: [], messageSearchLimitedByEncryption: true })
    return
  }
  const result = await db.query(
    `SELECT m.id, m.chat_id, m.sender_id, m.created_at, m.search_text
     FROM messages m
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.deleted_at IS NULL
       AND m.search_text <> ''
       AND m.search_text ILIKE '%' || $3 || '%'
       AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
       AND NOT EXISTS (
         SELECT 1 FROM message_user_deletions mud
         WHERE mud.message_id = m.id AND mud.user_id = $2
       )
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [request.params.chatId, request.user.id, query],
  )
  response.json({
    query,
    messages: result.rows.map((message) => ({
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      createdAt: message.created_at,
      preview: message.search_text,
    })),
    messageSearchLimitedByEncryption: true,
  })
})

app.get('/api/chats/:chatId/messages', requireAuth, apiLimiter, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const limit = Math.min(100, Math.max(1, parseInt(request.query.limit, 10) || 50))
  const before = request.query.before ? String(request.query.before) : null
  const params = [request.params.chatId, request.user.id]
  let beforeClause = ''
  if (before) {
    params.push(before)
    beforeClause = `AND m.created_at < $${params.length}`
  }
  params.push(limit + 1)
  const result = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       ${visibleMessageFilter('$2')}
       ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  const hasMore = result.rows.length > limit
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows
  pageRows.reverse()
  const messages = await publicMessagesFromRows(request.params.chatId, pageRows, request.user.id)
  response.json({ messages, hasMore })
})

app.get('/api/chats/:chatId/messages/:messageId/context', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const limit = Math.min(100, Math.max(3, parseInt(request.query.limit, 10) || 50))
  const beforeLimit = Math.floor((limit - 1) / 2)
  const afterLimit = limit - 1 - beforeLimit
  const targetResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.id = $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     LIMIT 1`,
    [request.params.chatId, request.user.id, request.params.messageId],
  )
  const target = targetResult.rows[0]
  if (!target) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const beforeResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.created_at < $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [request.params.chatId, request.user.id, target.created_at, beforeLimit + 1],
  )
  const afterResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.created_at > $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     ORDER BY m.created_at ASC
     LIMIT $4`,
    [request.params.chatId, request.user.id, target.created_at, afterLimit + 1],
  )
  const hasMoreBefore = beforeResult.rows.length > beforeLimit
  const hasMoreAfter = afterResult.rows.length > afterLimit
  const contextRows = [
    ...beforeResult.rows.slice(0, beforeLimit).reverse(),
    target,
    ...afterResult.rows.slice(0, afterLimit),
  ]
  const messages = await publicMessagesFromRows(request.params.chatId, contextRows, request.user.id)
  response.json({
    messageId: request.params.messageId,
    messages,
    hasMoreBefore,
    hasMoreAfter,
  })
})

app.post('/api/chats/:chatId/messages', requireAuth, messageLimiter, async (request, response) => {
  await requireUnblockedPrivateChat(request.params.chatId, request.user.id)
  const input = parseBody(messageSchema, request.body)
  const member = await assertCanSendToChat(request.params.chatId, request.user.id, {
    media: Boolean(input.mediaId),
    poll: Boolean(input.poll),
  })
  if (input.topicId) {
    const topicResult = await db.query(
      `SELECT id, closed
       FROM chat_topics
       WHERE id = $1 AND chat_id = $2
       LIMIT 1`,
      [input.topicId, request.params.chatId],
    )
    const topic = topicResult.rows[0]
    if (!topic) {
      response.status(400).json({ error: 'Topic is not available in this chat' })
      return
    }
    if (isDatabaseTrue(topic.closed) && !hasPermission(member, 'manage_topics')) {
      response.status(403).json({ error: 'Topic is closed' })
      return
    }
  }
  if (input.replyToId) {
    const replyResult = await db.query(
      `SELECT id FROM messages
       WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [input.replyToId, request.params.chatId],
    )
    if (!replyResult.rows.length) {
      response.status(400).json({ error: 'Reply message is not available in this chat' })
      return
    }
  }
  let forwardedFromChatId = null
  if (input.forwardedFromMessageId) {
    const forwardResult = await db.query(
      `SELECT m.id, m.chat_id
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_deletions mud
           WHERE mud.message_id = m.id AND mud.user_id = $2
         )
       LIMIT 1`,
      [input.forwardedFromMessageId, request.user.id],
    )
    if (!forwardResult.rows.length) {
      response.status(400).json({ error: 'Forwarded message is not available' })
      return
    }
    forwardedFromChatId = forwardResult.rows[0].chat_id
  }
  let media = null
  if (input.mediaId) {
    const mediaResult = await db.query(
      `SELECT id, owner_id, chat_id, kind, original_name, mime_type, plain_size,
              original_size, width, height, client_encrypted, media_envelope, duration_ms
       FROM media_files
       WHERE id = $1
       LIMIT 1`,
      [input.mediaId],
    )
    media = mediaResult.rows[0]
    if (!media || media.owner_id !== request.user.id || media.chat_id !== request.params.chatId) {
      response.status(400).json({ error: 'Media is not available for this chat' })
      return
    }
  }

  const scheduledAt = input.scheduledAt || null
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : 0
  if (scheduledAt && (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now())) {
    response.status(400).json({ error: 'scheduledAt must be a future timestamp' })
    return
  }
  if (input.poll?.quiz && input.poll.correctOption !== null && input.poll.correctOption !== undefined) {
    if (input.poll.correctOption >= input.poll.options.length) {
      response.status(400).json({ error: 'Correct poll option is out of range' })
      return
    }
  }

  const encrypted = encryptMessage(input.text)
  const messageId = randomUUID()
  const sentAt = scheduledAt ? null : new Date().toISOString()
  const pollId = input.poll ? randomUUID() : null
  const pollOptions = input.poll
    ? input.poll.options.map((text, index) => ({ id: randomUUID(), text, index }))
    : []
  const correctOptionId =
    input.poll?.quiz && input.poll.correctOption !== null && input.poll.correctOption !== undefined
      ? pollOptions[input.poll.correctOption]?.id || null
      : null
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO messages
        (id, chat_id, sender_id, media_id, reply_to_id, forwarded_from_message_id,
         forwarded_from_chat_id, topic_id, ciphertext, iv, auth_tag, encryption_version,
         search_text, silent, scheduled_at, sent_at, link_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        messageId,
        request.params.chatId,
        request.user.id,
        input.mediaId || null,
        input.replyToId || null,
        input.forwardedFromMessageId || null,
        forwardedFromChatId,
        input.topicId || null,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.version,
        normalizeSearchText(input.searchText),
        input.silent,
        scheduledAt,
        sentAt,
        input.linkPreview ? JSON.stringify(input.linkPreview) : null,
      ],
    )
    if (input.poll) {
      await tx.query(
        `INSERT INTO polls
          (id, message_id, question, multiple_choice, anonymous, quiz, correct_option_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          pollId,
          messageId,
          input.poll.question,
          input.poll.multipleChoice,
          input.poll.anonymous,
          input.poll.quiz,
          correctOptionId,
        ],
      )
      for (const option of pollOptions) {
        await tx.query(
          `INSERT INTO poll_options (id, poll_id, text, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [option.id, pollId, option.text, option.index],
        )
      }
    }
    if (!scheduledAt) {
      await tx.query(
        'UPDATE chat_members SET last_message_at = NOW() WHERE chat_id = $1 AND user_id = $2',
        [request.params.chatId, request.user.id],
      )
      if (input.topicId) {
        await tx.query(
          `UPDATE chat_topics
           SET message_count = message_count + 1,
               last_message_at = NOW(),
               updated_at = NOW()
           WHERE id = $1 AND chat_id = $2`,
          [input.topicId, request.params.chatId],
        )
      }
      if (member.type === 'channel') {
        await tx.query(
          `INSERT INTO channel_post_stats (message_id)
           VALUES ($1)
           ON CONFLICT (message_id) DO NOTHING`,
          [messageId],
        )
      }
      if (input.forwardedFromMessageId) {
        await tx.query(
          `INSERT INTO channel_post_stats (message_id, reposts)
           VALUES ($1, 1)
           ON CONFLICT (message_id)
           DO UPDATE SET reposts = channel_post_stats.reposts + 1,
                         updated_at = NOW()`,
          [input.forwardedFromMessageId],
        )
      }
    }
  })
  const publicMessage = {
    id: messageId,
    chatId: request.params.chatId,
    senderId: request.user.id,
    text: input.text,
    createdAt: new Date().toISOString(),
    topicId: input.topicId || null,
    replyToId: input.replyToId || null,
    forwarded: Boolean(input.forwardedFromMessageId),
    forwardedFromMessageId: input.forwardedFromMessageId || null,
    forwardedFromChatId,
    silent: input.silent,
    scheduledAt,
    sentAt,
    reactions: {},
    status: 'sent',
    media: media
      ? {
          id: media.id,
          kind: media.kind,
          name: media.original_name,
          mimeType: media.mime_type,
          size: Number(media.plain_size),
          originalSize: Number(media.original_size),
          width: media.width,
          height: media.height,
          durationMs: media.duration_ms ?? null,
          url: `/api/media/${media.id}`,
          encrypted: isDatabaseTrue(media.client_encrypted),
          envelope: media.media_envelope || '',
        }
      : null,
    poll: input.poll
      ? {
          id: pollId,
          question: input.poll.question,
          multipleChoice: input.poll.multipleChoice,
          anonymous: input.poll.anonymous,
          quiz: input.poll.quiz,
          closedAt: null,
          options: pollOptions.map((option) => ({
            id: option.id,
            text: option.text,
            votes: 0,
            votedByMe: false,
          })),
        }
      : null,
  }

  if (scheduledAt) {
    response.status(202).json({ message: publicMessage, scheduled: true })
    return
  }

  const recipientDeliveries = await sendToChatExcept(request.params.chatId, request.user.id, {
    type: 'message:new',
    message: publicMessage,
  })
  if (!input.silent) {
    await sendOfflineMessagePushes({
      chatId: request.params.chatId,
      sender: request.user,
      message: publicMessage,
      searchText: input.searchText,
    })
  }
  if (recipientDeliveries > 0) publicMessage.status = 'delivered'
  await sendToUser(request.user.id, {
    type: 'message:delivered',
    chatId: request.params.chatId,
    messageId,
    delivered: recipientDeliveries > 0,
  })

  // Auto-forward channel posts to the linked discussion group (silent, no push)
  if (member?.type === 'channel' && !scheduledAt) {
    const linkedResult = await db.query(
      'SELECT linked_group_id FROM chats WHERE id = $1 AND linked_group_id IS NOT NULL',
      [request.params.chatId],
    )
    if (linkedResult.rows[0]?.linked_group_id) {
      const groupId = linkedResult.rows[0].linked_group_id
      const discussionId = randomUUID()
      await db.query(
        `INSERT INTO messages
           (id, chat_id, sender_id, ciphertext, iv, auth_tag, encryption_version,
            search_text, forwarded_from_message_id, forwarded_from_chat_id, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [discussionId, groupId, request.user.id,
          input.text || '', '', '', 1,
          input.searchText || '',
          messageId, request.params.chatId],
      )
      await sendToChat(groupId, {
        type: 'message:new',
        message: {
          id: discussionId,
          chatId: groupId,
          senderId: request.user.id,
          text: input.text || '',
          createdAt: new Date().toISOString(),
          topicId: null,
          replyToId: null,
          forwarded: true,
          forwardedFromMessageId: messageId,
          forwardedFromChatId: request.params.chatId,
          silent: true,
          reactions: {},
          status: 'sent',
          media: publicMessage.media,
          poll: null,
        },
      })
    }
  }

  response.status(201).json({ message: publicMessage })
})

app.get('/api/chats/:chatId/scheduled-messages', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  if (member.type === 'channel') {
    requirePermission(member, 'post_messages', 'Only channel admins can view scheduled posts')
  }
  const result = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.chat_id = $1
       AND m.scheduled_at IS NOT NULL
       AND m.sent_at IS NULL
       AND (m.sender_id = $2 OR $3 = TRUE)
     ORDER BY m.scheduled_at ASC`,
    [request.params.chatId, request.user.id, hasPermission(member, 'post_messages')],
  )
  const messages = await publicMessagesFromRows(request.params.chatId, result.rows, request.user.id)
  response.json({ messages })
})

app.post('/api/chats/:chatId/scheduled-messages/:messageId/send-now', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  const scheduledResult = await db.query(
    `SELECT sender_id
     FROM messages
     WHERE id = $1 AND chat_id = $2 AND scheduled_at IS NOT NULL AND sent_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const scheduled = scheduledResult.rows[0]
  if (!scheduled) { response.status(404).json({ error: 'Scheduled message not found' }); return }
  if (scheduled.sender_id !== request.user.id) {
    requirePermission(member, 'post_messages', 'Only channel admins can publish scheduled posts')
  }
  await publishScheduledMessage(request.params.messageId)
  response.json({ messageId: request.params.messageId, sent: true })
})

app.delete('/api/chats/:chatId/scheduled-messages/:messageId', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `DELETE FROM messages
     WHERE id = $1 AND chat_id = $2
       AND scheduled_at IS NOT NULL
       AND sent_at IS NULL
       AND (sender_id = $3 OR $4 = TRUE)
     RETURNING id`,
    [
      request.params.messageId,
      request.params.chatId,
      request.user.id,
      hasPermission(member, 'post_messages'),
    ],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Scheduled message not found' })
    return
  }
  response.status(204).end()
})

app.post('/api/chats/:chatId/messages/:messageId/poll-votes', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(pollVoteSchema, request.body)
  const pollResult = await db.query(
    `SELECT p.id, p.multiple_choice, p.closed_at
     FROM polls p
     JOIN messages m ON m.id = p.message_id
     WHERE p.message_id = $1 AND m.chat_id = $2 AND m.deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const poll = pollResult.rows[0]
  if (!poll || poll.closed_at) {
    response.status(404).json({ error: 'Open poll not found' })
    return
  }
  if (!isDatabaseTrue(poll.multiple_choice) && input.optionIds.length > 1) {
    response.status(400).json({ error: 'Poll accepts one option only' })
    return
  }
  const optionResult = await db.query(
    `SELECT id FROM poll_options
     WHERE poll_id = $1 AND id = ANY($2::uuid[])`,
    [poll.id, input.optionIds],
  )
  if (optionResult.rows.length !== input.optionIds.length) {
    response.status(400).json({ error: 'One or more poll options are invalid' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [
      poll.id,
      request.user.id,
    ])
    for (const optionId of input.optionIds) {
      await tx.query(
        `INSERT INTO poll_votes (poll_id, option_id, user_id)
         VALUES ($1, $2, $3)`,
        [poll.id, optionId, request.user.id],
      )
    }
  })
  const rows = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.id = $1 AND m.chat_id = $2`,
    [request.params.messageId, request.params.chatId],
  )
  const [message] = await publicMessagesFromRows(request.params.chatId, rows.rows, request.user.id)
  const payload = {
    type: 'message:poll',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    poll: message.poll,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.post('/api/chats/:chatId/messages/:messageId/view', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT m.id
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = $1 AND m.chat_id = $2 AND c.type = 'channel'
       AND m.deleted_at IS NULL
       AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
       AND m.sent_at IS NOT NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Channel post not found' })
    return
  }
  const inserted = await db.query(
    `INSERT INTO message_views (message_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (message_id, user_id) DO NOTHING
     RETURNING message_id`,
    [request.params.messageId, request.user.id],
  )
  if (inserted.rows.length) {
    await db.query(
      `INSERT INTO channel_post_stats (message_id, views)
       VALUES ($1, 1)
       ON CONFLICT (message_id)
       DO UPDATE SET views = channel_post_stats.views + 1,
                     updated_at = NOW()`,
      [request.params.messageId],
    )
  }
  const stats = await db.query(
    'SELECT views, reposts FROM channel_post_stats WHERE message_id = $1',
    [request.params.messageId],
  )
  response.json({
    messageId: request.params.messageId,
    stats: {
      views: Number(stats.rows[0]?.views || 0),
      reposts: Number(stats.rows[0]?.reposts || 0),
    },
  })
})

app.get('/api/chats/:chatId/channel-stats', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  if (member.type !== 'channel') {
    response.status(400).json({ error: 'Stats are available only for channels' })
    return
  }
  requirePermission(member, 'view_stats', 'Only channel admins can view stats')
  const [subscriberResult, postResult] = await Promise.all([
    db.query('SELECT COUNT(*)::integer AS count FROM chat_members WHERE chat_id = $1', [
      request.params.chatId,
    ]),
    db.query(
      `SELECT COUNT(m.id)::integer AS posts,
              COALESCE(SUM(cps.views), 0)::integer AS views,
              COALESCE(SUM(cps.reposts), 0)::integer AS reposts
       FROM messages m
       LEFT JOIN channel_post_stats cps ON cps.message_id = m.id
       WHERE m.chat_id = $1
         AND m.deleted_at IS NULL
         AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
         AND m.sent_at IS NOT NULL`,
      [request.params.chatId],
    ),
  ])
  response.json({
    subscribers: Number(subscriberResult.rows[0]?.count || 0),
    posts: Number(postResult.rows[0]?.posts || 0),
    views: Number(postResult.rows[0]?.views || 0),
    reposts: Number(postResult.rows[0]?.reposts || 0),
  })
})

app.patch('/api/chats/:chatId/messages/:messageId', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(editMessageSchema, request.body)
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND sender_id = $3 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId, request.user.id],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Editable message not found' })
    return
  }

  const encrypted = encryptMessage(input.text)
  const editedAt = new Date().toISOString()
  await db.query(
    `UPDATE messages
     SET ciphertext = $1,
         iv = $2,
         auth_tag = $3,
         encryption_version = $4,
         edited_at = $5,
         search_text = $6
     WHERE id = $7`,
    [
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.version,
      editedAt,
      normalizeSearchText(input.searchText),
      request.params.messageId,
    ],
  )

  const payload = {
    type: 'message:edited',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    text: input.text,
    editedAt,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.delete('/api/chats/:chatId/messages/:messageId', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id, sender_id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const message = messageResult.rows[0]
  if (!message) {
    response.status(404).json({ error: 'Deletable message not found' })
    return
  }
  if (message.sender_id !== request.user.id) {
    requirePermission(member, 'delete_messages', 'Only moderators can delete others messages')
  }

  const deletedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM message_reactions WHERE message_id = $1', [request.params.messageId])
    await tx.query(
      `UPDATE messages
       SET deleted_at = $1, media_id = NULL, reply_to_id = NULL
      WHERE id = $2`,
      [deletedAt, request.params.messageId],
    )
    if (message.sender_id !== request.user.id) {
      await appendAdminLog(tx, {
        chatId: request.params.chatId,
        actorUserId: request.user.id,
        targetUserId: message.sender_id,
        action: 'message.delete',
        metadata: { messageId: request.params.messageId },
      })
    }
  })

  const payload = {
    type: 'message:deleted',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    deletedAt,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.post('/api/chats/:chatId/messages/:messageId/delete-for-me', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const deletedAt = new Date().toISOString()
  await db.query(
    `INSERT INTO message_user_deletions (message_id, user_id, deleted_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id)
     DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
    [request.params.messageId, request.user.id, deletedAt],
  )
  response.json({
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    deletedForMe: true,
    deletedAt,
  })
})

app.post('/api/chats/:chatId/clear-history', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const clearedAt = new Date().toISOString()
  await db.query(
    `INSERT INTO chat_history_clears (chat_id, user_id, cleared_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id, user_id)
     DO UPDATE SET cleared_at = EXCLUDED.cleared_at`,
    [request.params.chatId, request.user.id, clearedAt],
  )
  response.json({ chatId: request.params.chatId, clearedAt })
})

app.patch('/api/chats/:chatId/pinned-message', requireAuth, async (request, response) => {
  const chat = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!chat) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  requirePermission(chat, 'pin_messages', 'Only moderators can pin messages')
  const input = parseBody(pinMessageSchema, request.body)

  if (input.messageId) {
    const msgResult = await db.query(
      'SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL LIMIT 1',
      [input.messageId, request.params.chatId],
    )
    if (!msgResult.rows.length) {
      response.status(404).json({ error: 'Message not found' })
      return
    }
  }

  await db.transaction(async (tx) => {
    await tx.query('UPDATE chats SET pinned_message_id = $1 WHERE id = $2', [
      input.messageId,
      request.params.chatId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: input.messageId ? 'message.pin' : 'message.unpin',
      metadata: { messageId: input.messageId },
    })
  })

  const payload = {
    type: 'chat:pinned-message',
    chatId: request.params.chatId,
    messageId: input.messageId,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.get('/api/chats/:chatId/messages/:messageId/read-by', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }
  const result = await db.query(
    `SELECT u.id, u.name, u.username, mr.read_at
     FROM message_reads mr
     JOIN users u ON u.id = mr.user_id
     WHERE mr.message_id = $1
     ORDER BY mr.read_at ASC`,
    [request.params.messageId],
  )
  response.json(result.rows)
})

app.post('/api/chats/:chatId/messages/:messageId/reactions', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(reactionSchema, request.body)
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const existing = await db.query(
    `SELECT 1 FROM message_reactions
     WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [request.params.messageId, request.user.id, input.emoji],
  )
  if (existing.rows.length) {
    await db.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [request.params.messageId, request.user.id, input.emoji],
    )
  } else {
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)`,
      [request.params.messageId, request.user.id, input.emoji],
    )
  }

  const reactions = await getReactionCounts(request.params.messageId)
  const payload = {
    type: 'message:reactions',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    reactions,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

app.post('/api/media', requireAuth, uploadLimiter, mediaUpload.single('file'), async (request, response) => {
  let storageName
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No file uploaded' })
      return
    }

    const clientEncrypted = parseBooleanFormValue(request.body.clientEncrypted)
    const clientMetadata = clientEncrypted ? validateClientMediaMetadata(request.body) : null
    const kind = clientMetadata?.kind || getMediaKind(request.file.mimetype)
    if (!kind) {
      response.status(415).json({ error: 'Unsupported media type' })
      return
    }

    const chatId = request.body.chatId || null
    if (chatId) {
      await assertCanSendToChat(chatId, request.user.id, { media: true })
      await requireUnblockedPrivateChat(chatId, request.user.id)
    }

    const mediaId = randomUUID()
    storageName = `${mediaId}.bin`
    const streamsOriginalFile = clientEncrypted || kind === 'audio' || kind === 'voice'
    let stored
    let mediaInfo

    if (streamsOriginalFile) {
      stored = await encryptUploadedFileToStorage(request.file, storageName)
      mediaInfo = {
        mimeType: clientMetadata?.mimeType || request.file.mimetype,
        width: clientMetadata?.width ?? null,
        height: clientMetadata?.height ?? null,
        plainSize: clientMetadata?.plainSize || request.file.size,
        originalSize: clientMetadata?.originalSize || request.file.size,
        durationMs: clientMetadata?.durationMs ?? null,
      }
    } else {
      if (request.file.size > serverMediaTransformMaxBytes) {
        response.status(413).json({
          error: `Large image and video uploads must be encrypted by the client. Server transform limit is ${formatByteSize(serverMediaTransformMaxBytes)}.`,
        })
        return
      }

      const fileBuffer = await readUploadedFile(request.file)
      const compressed = kind === 'image'
        ? await compressImage(fileBuffer)
        : kind === 'video'
          ? await compressVideo(fileBuffer)
          : {
              data: fileBuffer,
              mimeType: request.file.mimetype,
              width: null,
              height: null,
            }
      const encrypted = encryptBuffer(compressed.data)
      await saveMediaObject(storageName, Buffer.from(encrypted.ciphertext, 'base64'))
      stored = {
        encryptedSize: Buffer.byteLength(encrypted.ciphertext, 'base64'),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      }
      mediaInfo = {
        mimeType: compressed.mimeType,
        width: compressed.width,
        height: compressed.height,
        plainSize: compressed.data.length,
        originalSize: request.file.size,
        durationMs: null,
      }
    }

    try {
      await db.query(
        `INSERT INTO media_files
          (id, owner_id, chat_id, kind, original_name, mime_type, storage_name,
           encrypted_size, plain_size, original_size, width, height, client_encrypted,
           media_envelope, duration_ms, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          mediaId,
          request.user.id,
          chatId,
          kind,
          clientMetadata?.originalName || request.file.originalname.slice(0, 255),
          mediaInfo.mimeType,
          storageName,
          stored.encryptedSize,
          mediaInfo.plainSize,
          mediaInfo.originalSize,
          mediaInfo.width,
          mediaInfo.height,
          clientEncrypted,
          clientMetadata?.envelope || '',
          mediaInfo.durationMs,
          stored.iv,
          stored.authTag,
        ],
      )
    } catch (error) {
      await deleteMediaObject(storageName).catch(() => {})
      throw error
    }

    response.status(201).json({
      media: {
        id: mediaId,
        kind,
        name: clientMetadata?.originalName || request.file.originalname,
        mimeType: mediaInfo.mimeType,
        durationMs: mediaInfo.durationMs,
        size: mediaInfo.plainSize,
        originalSize: mediaInfo.originalSize,
        width: mediaInfo.width,
        height: mediaInfo.height,
        url: `/api/media/${mediaId}`,
        encrypted: clientEncrypted,
        envelope: clientMetadata?.envelope || '',
      },
    })
  } finally {
    await cleanupUploadedFile(request.file)
  }
})

app.get('/api/media/:mediaId', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT id, owner_id, chat_id, mime_type, storage_name, encrypted_size, plain_size, iv, auth_tag,
            client_encrypted
     FROM media_files WHERE id = $1 LIMIT 1`,
    [request.params.mediaId],
  )
  const media = result.rows[0]
  if (!media) {
    response.status(404).json({ error: 'Media not found' })
    return
  }

  const canRead =
    media.owner_id === request.user.id ||
    (media.chat_id && (await isChatMember(media.chat_id, request.user.id)))
  if (!canRead) {
    response.status(404).json({ error: 'Media not found' })
    return
  }

  await streamDecryptedMedia(response, media, request.headers.range)
})

app.get('/api/calls', requireAuth, async (request, response) => {
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

app.get('/api/calls/ice-servers', requireAuth, (_request, response) => {
  response.json({ iceServers: config.webrtc.iceServers })
})

app.post('/api/calls', requireAuth, async (request, response) => {
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

server.on('upgrade', async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    const origin = request.headers.origin
    if (config.allowedOrigins.length && origin && !config.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }

    const cookieHeader = request.headers.cookie || ''
    request.cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf('=')
          return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))]
        }),
    )
    const user = await getSessionUser(request)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request, user)
    })
  } catch (error) {
    console.error('[ws] upgrade failed', error.message)
    socket.destroy()
  }
})

wss.on('connection', async (socket, _request, user) => {
  socket.isAlive = true
  const wasOnline = socketsByUserId.has(user.id) || onlineUserIdCache.has(user.id)
  const socketCount = addSocket(user.id, socket)
  await addPresence(user.id, socketCount)
  const onlineUserIds = new Set([...onlineUserIdCache, ...socketsByUserId.keys(), ...(await getOnlineUserIds())])
  socket.send(JSON.stringify({
    type: 'session:ready',
    userId: user.id,
    onlineUserIds: [...onlineUserIds],
  }))
  if (!wasOnline) {
    await broadcast({ type: 'presence:update', userId: user.id, online: true }, user.id)
  }

  socket.on('pong', () => {
    socket.isAlive = true
  })

  socket.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString())

      if (message.type === 'typing') {
        if (
          typeof message.chatId !== 'string' ||
          typeof message.active !== 'boolean' ||
          !(await isChatMember(message.chatId, user.id))
        ) {
          return
        }
        await sendToChatExcept(message.chatId, user.id, {
          type: 'typing:update',
          chatId: message.chatId,
          userId: user.id,
          active: message.active,
        })
        return
      }

      if (message.type === 'chat:read') {
        if (
          typeof message.chatId !== 'string' ||
          !(await isChatMember(message.chatId, user.id))
        ) {
          return
        }
        const unread = await db.query(
          `SELECT id FROM messages
           LEFT JOIN chat_history_clears chc
             ON chc.chat_id = messages.chat_id AND chc.user_id = $2
           WHERE messages.chat_id = $1 AND sender_id <> $2 AND deleted_at IS NULL
             AND (chc.cleared_at IS NULL OR messages.created_at > chc.cleared_at)
             AND NOT EXISTS (
               SELECT 1 FROM message_user_deletions mud
               WHERE mud.message_id = messages.id AND mud.user_id = $2
             )
             AND NOT EXISTS (
               SELECT 1 FROM message_reads mr
               WHERE mr.message_id = messages.id AND mr.user_id = $2
             )`,
          [message.chatId, user.id],
        )
        if (!unread.rows.length) return
        for (const unreadMessage of unread.rows) {
          await db.query(
            `INSERT INTO message_reads (message_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (message_id, user_id) DO NOTHING`,
            [unreadMessage.id, user.id],
          )
        }
        await sendToChatExcept(message.chatId, user.id, {
          type: 'message:read',
          chatId: message.chatId,
          userId: user.id,
          userName: user.name,
          userUsername: user.username,
          messageIds: unread.rows.map((item) => item.id),
        })
        return
      }

      if (![
        'call:offer',
        'call:answer',
        'call:ice',
        'call:join',
        'call:participant-state',
        'call:hangup',
        'call:decline',
      ].includes(message.type)) {
        return
      }
      if (typeof message.callId !== 'string') return

      const call = await db.query(
        `SELECT c.id, c.initiator_id, c.recipient_id, c.status, c.chat_id,
                ch.type AS chat_type, cp.state AS participant_state
         FROM calls c
         JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = $2
         LEFT JOIN chats ch ON ch.id = c.chat_id
         WHERE c.id = $1
         LIMIT 1`,
        [message.callId, user.id],
      )
      const callRow = call.rows[0]
      if (!callRow) return
      if (['declined', 'ended', 'missed'].includes(callRow.status)) return

      if (['call:offer', 'call:answer', 'call:ice'].includes(message.type)) {
        if (typeof message.targetUserId !== 'string' || message.targetUserId === user.id) return
        const target = await db.query(
          `SELECT 1 FROM call_participants
           WHERE call_id = $1 AND user_id = $2
             AND state IN ('invited', 'ringing', 'connected', 'disconnected')
           LIMIT 1`,
          [message.callId, message.targetUserId],
        )
        if (!target.rows.length) return
      }
      if (
        (message.type === 'call:offer' || message.type === 'call:answer') &&
        (!message.description || typeof message.description.type !== 'string')
      ) {
        return
      }
      if (message.type === 'call:ice' && !message.candidate) return

      if (message.type === 'call:join') {
        await db.query(
          `UPDATE call_participants
           SET state = 'connected', joined_at = COALESCE(joined_at, NOW()),
               left_at = NULL, last_seen_at = NOW()
           WHERE call_id = $1 AND user_id = $2`,
          [message.callId, user.id],
        )
        await db.query(
          `UPDATE calls SET status = 'accepted', answered_at = COALESCE(answered_at, NOW())
           WHERE id = $1 AND status = 'ringing'`,
          [message.callId],
        )
        const participants = await getCallParticipants(message.callId, user.id)
        await sendToCall(message.callId, {
          type: 'call:participant',
          callId: message.callId,
          userId: user.id,
          state: 'connected',
          participants,
        }, user.id)
        return
      }

      if (message.type === 'call:participant-state') {
        await db.query(
          `UPDATE call_participants
           SET muted = COALESCE($3, muted),
               camera_off = COALESCE($4, camera_off),
               screen_sharing = COALESCE($5, screen_sharing),
               last_seen_at = NOW()
           WHERE call_id = $1 AND user_id = $2`,
          [
            message.callId,
            user.id,
            typeof message.muted === 'boolean' ? message.muted : null,
            typeof message.cameraOff === 'boolean' ? message.cameraOff : null,
            typeof message.sharingScreen === 'boolean' ? message.sharingScreen : null,
          ],
        )
        await sendToCall(message.callId, {
          type: 'call:participant-state',
          callId: message.callId,
          userId: user.id,
          muted: typeof message.muted === 'boolean' ? message.muted : undefined,
          cameraOff: typeof message.cameraOff === 'boolean' ? message.cameraOff : undefined,
          sharingScreen: typeof message.sharingScreen === 'boolean' ? message.sharingScreen : undefined,
        }, user.id)
        return
      }

      if (message.type === 'call:answer') {
        await db.query(
          `UPDATE calls SET status = 'accepted', answered_at = NOW()
           WHERE id = $1 AND status = 'ringing'`,
          [message.callId],
        )
        await db.query(
          `UPDATE call_participants
           SET state = 'connected', joined_at = COALESCE(joined_at, NOW()),
               left_at = NULL, last_seen_at = NOW()
           WHERE call_id = $1 AND user_id = $2`,
          [message.callId, user.id],
        )
      }

      if (message.type === 'call:decline') {
        await db.query(
          `UPDATE call_participants
           SET state = 'declined', left_at = NOW(), last_seen_at = NOW()
           WHERE call_id = $1 AND user_id = $2`,
          [message.callId, user.id],
        )
        const active = await db.query(
          `SELECT COUNT(*)::integer AS count
           FROM call_participants
           WHERE call_id = $1 AND state IN ('ringing', 'connected', 'disconnected')`,
          [message.callId],
        )
        if (!Number(active.rows[0]?.count || 0)) {
          await db.query(
            `UPDATE calls SET status = 'declined', ended_at = NOW()
             WHERE id = $1`,
            [message.callId],
          )
        }
        await sendToCall(message.callId, {
          type: 'call:decline',
          callId: message.callId,
          fromUserId: user.id,
        }, user.id)
        return
      }

      if (message.type === 'call:hangup') {
        const isPrivate = callRow.chat_type === 'private' || Boolean(callRow.recipient_id)
        await db.query(
          `UPDATE call_participants
           SET state = 'left', left_at = NOW(), last_seen_at = NOW()
           WHERE call_id = $1 AND user_id = $2`,
          [message.callId, user.id],
        )
        const active = await db.query(
          `SELECT COUNT(*)::integer AS count
           FROM call_participants
           WHERE call_id = $1 AND state IN ('ringing', 'connected', 'disconnected')`,
          [message.callId],
        )
        if (isPrivate || Number(active.rows[0]?.count || 0) <= 1) {
          await db.query(
            `UPDATE calls SET status = 'ended', ended_at = NOW()
             WHERE id = $1`,
            [message.callId],
          )
          await db.query(
            `UPDATE call_participants
             SET state = CASE WHEN state IN ('ringing', 'invited') THEN 'missed' ELSE state END,
                 left_at = COALESCE(left_at, NOW()), last_seen_at = NOW()
             WHERE call_id = $1 AND state IN ('ringing', 'invited', 'connected', 'disconnected')`,
            [message.callId],
          )
          await sendToCall(message.callId, {
            type: 'call:hangup',
            callId: message.callId,
            fromUserId: user.id,
          }, user.id)
          return
        }
        await sendToCall(message.callId, {
          type: 'call:participant',
          callId: message.callId,
          userId: user.id,
          state: 'left',
        }, user.id)
        return
      }

      await sendToUser(message.targetUserId, {
        ...message,
        fromUserId: user.id,
      })
    } catch (error) {
      console.error('[ws] message failed', error.message)
    }
  })

  socket.on('close', () => {
    const socketCount = removeSocket(user.id, socket)
    void removePresence(user.id, socketCount)
    if (!socketsByUserId.has(user.id)) {
      const lastSeenAt = new Date().toISOString()
      void (async () => {
        try {
          await db.query('UPDATE users SET last_seen_at = $1 WHERE id = $2', [lastSeenAt, user.id])
          const activeCalls = await db.query(
            `SELECT c.id, c.initiator_id, c.recipient_id, c.status, ch.type AS chat_type
             FROM calls c
             JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = $1
             LEFT JOIN chats ch ON ch.id = c.chat_id
             WHERE c.status IN ('ringing', 'accepted')
               AND cp.state IN ('ringing', 'connected', 'disconnected')`,
            [user.id],
          )
          for (const activeCall of activeCalls.rows) {
            if (activeCall.status === 'ringing') {
              await db.query(
                `UPDATE call_participants
                 SET state = 'missed', left_at = NOW(), last_seen_at = NOW()
                 WHERE call_id = $1 AND user_id = $2 AND state = 'ringing'`,
                [activeCall.id, user.id],
              )
              await sendToCall(activeCall.id, {
                type: 'call:participant',
                callId: activeCall.id,
                userId: user.id,
                state: 'missed',
              }, user.id)
              continue
            }

            await db.query(
              `UPDATE call_participants
               SET state = 'disconnected', last_seen_at = NOW()
               WHERE call_id = $1 AND user_id = $2 AND state = 'connected'`,
              [activeCall.id, user.id],
            )
            await sendToCall(activeCall.id, {
              type: 'call:participant',
              callId: activeCall.id,
              userId: user.id,
              state: 'disconnected',
              reason: 'disconnected',
            }, user.id)
          }
        } catch (error) {
          console.error('[presence] disconnect cleanup failed', error.message)
        }
      })()
      void broadcast({
        type: 'presence:update',
        userId: user.id,
        online: false,
        lastSeenAt,
      }, user.id)
    }
  })
  socket.on('error', (error) => console.error('[ws] connection error', error.message))
})

let heartbeat = null
let presenceRefresh = null
let scheduledPublisher = null

function startBackgroundJobs() {
  if (heartbeat) return

  heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, 30000)

  presenceRefresh = setInterval(() => {
    void (async () => {
      const localEntries = [...socketsByUserId.entries()].map(([userId, sockets]) => [userId, sockets.size])
      await refreshPresence(localEntries)
      onlineUserIdCache = new Set([
        ...localEntries.map(([userId]) => userId),
        ...(await getOnlineUserIds()),
      ])
    })()
  }, 30000)

  scheduledPublisher = setInterval(() => {
    void publishDueScheduledMessages()
  }, 15000)
}

function stopBackgroundJobs() {
  if (heartbeat) clearInterval(heartbeat)
  if (presenceRefresh) clearInterval(presenceRefresh)
  if (scheduledPublisher) clearInterval(scheduledPublisher)
  heartbeat = null
  presenceRefresh = null
  scheduledPublisher = null
}

if (config.isProduction && existsSync(resolve(config.rootDir, 'dist'))) {
  app.use(express.static(resolve(config.rootDir, 'dist')))
  app.get('*path', (_request, response) => {
    response.sendFile(resolve(config.rootDir, 'dist', 'index.html'))
  })
}

app.use((request, response) => {
  response.status(404).json({ error: 'Not found', path: request.path })
})

app.use((error, request, response, next) => {
  void next
  if (error?.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: `File is too large. Maximum upload size is ${formatByteSize(mediaUploadMaxBytes)}.` })
    return
  }
  const status = error.status || 500
  console.error(`[api] ${request.method} ${request.path}:`, error.message)
  response.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
    details: error.details,
  })
})

async function start() {
  onSocketMessage((message) => {
    if (message.kind === 'user') {
      deliverToLocalUser(message.userId, message.payload)
      return
    }
    if (message.kind === 'broadcast') {
      deliverLocalBroadcast(message.payload, message.excludedUserId || '')
    }
  })
  await initRedis()
  onlineUserIdCache = new Set(await getOnlineUserIds())
  await migrateDatabase()
  await cleanupExpiredSessions()
  await publishDueScheduledMessages()
  startBackgroundJobs()
  server.listen(config.port, config.host, () => {
    console.log(`[server] http://${config.host}:${config.port}`)
  })
}

async function shutdown() {
  stopBackgroundJobs()
  for (const socket of wss.clients) socket.close(1001, 'Server shutting down')
  await new Promise((resolveClose) => server.close(resolveClose))
  await db.close()
  await closeRedis()
}

export { app, server, start, shutdown }

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.on('SIGINT', async () => {
    await shutdown()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await shutdown()
    process.exit(0)
  })

  start().catch((error) => {
    console.error('[server] startup failed', error)
    process.exit(1)
  })
}
