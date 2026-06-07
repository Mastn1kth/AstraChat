import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { config } from './config.js'
import { createSavedChat, db, migrateDatabase, cleanupExpiredSessions } from './db.js'
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
  hashPassword,
  verifyPassword,
} from './crypto.js'
import { compressAvatar, compressImage, compressVideo, getMediaKind, mediaUpload } from './media.js'
import {
  callSchema,
  changePasswordSchema,
  createChatSchema,
  editMessageSchema,
  encryptionKeySchema,
  loginSchema,
  messageSchema,
  parseBody,
  profileSchema,
  reactionSchema,
  registerSchema,
} from './validation.js'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const socketsByUserId = new Map()

app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(express.json({ limit: '512kb' }))
app.use(cookieParser())
app.use((request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    username: user.username,
    name: user.name,
    bio: user.bio,
    avatar: user.avatar,
    encryptionPublicKey: parsePublicKey(user.encryption_public_key),
    lastSeenAt: user.last_seen_at || null,
    online: socketsByUserId.has(user.id),
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

function parseBooleanFormValue(value) {
  return value === true || value === 'true' || value === '1'
}

function isDatabaseTrue(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1'
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
  if (!['image', 'video', 'voice', 'file'].includes(kind)) {
    const error = new Error('Encrypted media kind is invalid')
    error.status = 400
    throw error
  }
  const mimeOk =
    kind === 'image'
      ? /^image\/[-+.\w]+$/.test(mimeType)
      : kind === 'video'
        ? /^video\/[-+.\w]+$/.test(mimeType)
        : kind === 'voice'
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

function addSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId) || new Set()
  sockets.add(socket)
  socketsByUserId.set(userId, sockets)
}

function removeSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId)
  if (!sockets) return
  sockets.delete(socket)
  if (!sockets.size) socketsByUserId.delete(userId)
}

function sendToUser(userId, payload) {
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

function broadcast(payload, excludedUserId = '') {
  const message = JSON.stringify(payload)
  socketsByUserId.forEach((sockets, userId) => {
    if (userId === excludedUserId) return
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    })
  })
}

async function sendToChatExcept(chatId, excludedUserId, payload) {
  const members = await db.query(
    'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2',
    [chatId, excludedUserId],
  )
  let delivered = 0
  members.rows.forEach((member) => {
    if (sendToUser(member.user_id, payload)) delivered += 1
  })
  return delivered
}

async function sendToChat(chatId, payload) {
  const members = await db.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId])
  let delivered = 0
  members.rows.forEach((member) => {
    if (sendToUser(member.user_id, payload)) delivered += 1
  })
  return delivered
}

app.get('/api/health', async (_request, response) => {
  await db.query('SELECT 1')
  response.json({ ok: true, database: 'ready', websocket: 'ready' })
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
    `SELECT id, login, username, name, bio, avatar, last_seen_at, encryption_public_key
     FROM users WHERE id = $1`,
    [userId],
  )
  response.status(201).json({ user: publicUser(userResult.rows[0]) })
})

const TEST_ACCOUNTS = {
  1: { login: 'test_one', name: 'Test One', password: 'astrachat-demo-one' },
  2: { login: 'test_two', name: 'Test Two', password: 'astrachat-demo-two' },
}

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
    `SELECT id, login, username, name, bio, avatar, last_seen_at, encryption_public_key
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
      `SELECT id, login, username, name, bio, avatar, last_seen_at, encryption_public_key
       FROM users WHERE id = $1`,
      [userId],
    )
  }

  await createSession(response, result.rows[0].id, request)
  response.json({ user: publicUser(result.rows[0]) })
})

app.post('/api/auth/login', authLimiter, async (request, response) => {
  const input = parseBody(loginSchema, request.body)
  const result = await db.query(
    `SELECT id, login, username, name, bio, avatar, last_seen_at, encryption_public_key,
            password_salt, password_hash
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
  await db.query(
    `DELETE FROM sessions
     WHERE user_id = $1 AND token_hash <> $2`,
    [request.user.id, currentTokenHash],
  )
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
  response.status(204).end()
})

app.get('/api/users', requireAuth, async (request, response) => {
  const search = String(request.query.search || '').trim()
  const result = await db.query(
    `SELECT id, login, username, name, bio, avatar, last_seen_at, encryption_public_key
     FROM users
     WHERE id <> $1
       AND ($2 = '' OR username ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
     ORDER BY name
     LIMIT 50`,
    [request.user.id, search],
  )
  response.json({ users: result.rows.map(publicUser) })
})

app.patch('/api/users/me/encryption-key', requireAuth, async (request, response) => {
  const input = parseBody(encryptionKeySchema, request.body)
  const keyValue = stringifyPublicKey(input.encryptionPublicKey)
  const result = await db.query(
    `UPDATE users
     SET encryption_public_key = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, login, username, name, bio, avatar, last_seen_at, encryption_public_key`,
    [keyValue, request.user.id],
  )
  response.json({ user: publicUser(result.rows[0]) })
})

app.patch('/api/users/me/profile', requireAuth, async (request, response) => {
  const input = parseBody(profileSchema, request.body)
  try {
    const result = await db.query(
      `UPDATE users
       SET name = $1, username = $2, bio = $3, avatar = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, login, username, name, bio, avatar, last_seen_at, encryption_public_key`,
      [input.name, input.username.toLowerCase(), input.bio, initials(input.name), request.user.id],
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

app.post('/api/users/me/avatar', requireAuth, mediaUpload.single('file'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'No file uploaded' })
    return
  }
  if (getMediaKind(request.file.mimetype) !== 'image') {
    response.status(415).json({ error: 'Avatar must be a JPEG, PNG, WebP or AVIF image' })
    return
  }

  const compressed = await compressAvatar(request.file.buffer)
  const encrypted = encryptBuffer(compressed.data)
  const storageName = `avatar-${request.user.id}-${Date.now()}.bin`
  await writeFile(resolve(config.mediaDir, storageName), Buffer.from(encrypted.ciphertext, 'base64'), {
    mode: 0o600,
  })

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
      await rm(resolve(config.mediaDir, previousName), { force: true })
    } catch {
      // Ignore missing old avatar file.
    }
  }
  response.json({ ok: true, avatarUpdatedAt: new Date().toISOString() })
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
      await rm(resolve(config.mediaDir, previousName), { force: true })
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
    encryptedFile = await readFile(resolve(config.mediaDir, row.avatar_storage_name))
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
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  })
  response.json({ ok: true })
})

app.get('/api/chats', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT c.id, c.type, c.title, c.created_at, cm.role
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [request.user.id],
  )

  const chats = await Promise.all(
    result.rows.map(async (chat) => {
      const members = await db.query(
        `SELECT u.id, u.login, u.username, u.name, u.bio, u.avatar, u.last_seen_at,
                u.encryption_public_key, cm.role
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = $1
         ORDER BY cm.joined_at`,
        [chat.id],
      )
      return {
        ...chat,
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
    const existing = await db.query(
      `SELECT c.id
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       JOIN chat_members theirs ON theirs.chat_id = c.id AND theirs.user_id = $2
       WHERE c.type = 'private'
         AND (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) = 2
       LIMIT 1`,
      [request.user.id, input.memberIds[0]],
    )
    if (existing.rows[0]) {
      response.json({ chat: { id: existing.rows[0].id, ...input }, existing: true })
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
    }
  })
  response.status(201).json({ chat: { id: chatId, ...input } })
})

app.get('/api/chats/:chatId/messages', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const result = await db.query(
    `SELECT m.id, m.chat_id, m.sender_id, m.media_id, m.reply_to_id, m.ciphertext, m.iv,
            m.auth_tag, m.encryption_version, m.created_at, m.edited_at, m.deleted_at,
            mf.kind AS media_kind, mf.original_name AS media_name,
            mf.mime_type AS media_mime_type, mf.plain_size AS media_size,
            mf.original_size AS media_original_size, mf.width AS media_width,
            mf.height AS media_height, mf.client_encrypted AS media_client_encrypted,
            mf.media_envelope AS media_envelope, mf.duration_ms AS media_duration
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.chat_id = $1
     ORDER BY m.created_at ASC
     LIMIT 500`,
    [request.params.chatId],
  )
  const reactionResult = await db.query(
    `SELECT mr.message_id, mr.emoji, COUNT(*)::integer AS count
     FROM message_reactions mr
     JOIN messages m ON m.id = mr.message_id
     WHERE m.chat_id = $1
     GROUP BY mr.message_id, mr.emoji`,
    [request.params.chatId],
  )
  const reactionsByMessage = new Map()
  reactionResult.rows.forEach((reaction) => {
    const reactions = reactionsByMessage.get(reaction.message_id) || {}
    reactions[reaction.emoji] = reaction.count
    reactionsByMessage.set(reaction.message_id, reactions)
  })
  const readResult = await db.query(
    `SELECT mr.message_id
     FROM message_reads mr
     JOIN messages m ON m.id = mr.message_id
     WHERE m.chat_id = $1 AND mr.user_id <> m.sender_id
     GROUP BY mr.message_id`,
    [request.params.chatId],
  )
  const readMessages = new Set(readResult.rows.map((read) => read.message_id))
  const messages = result.rows.map((message) => ({
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
    editedAt: message.edited_at,
    deletedAt: message.deleted_at,
    replyToId: message.reply_to_id,
    reactions: reactionsByMessage.get(message.id) || {},
    status: readMessages.has(message.id) ? 'read' : 'sent',
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
  }))
  response.json({ messages })
})

app.post('/api/chats/:chatId/messages', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(messageSchema, request.body)
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

  const encrypted = encryptMessage(input.text)
  const messageId = randomUUID()
  await db.query(
    `INSERT INTO messages
      (id, chat_id, sender_id, media_id, reply_to_id, ciphertext, iv, auth_tag, encryption_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      messageId,
      request.params.chatId,
      request.user.id,
      input.mediaId || null,
      input.replyToId || null,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.version,
    ],
  )
  const publicMessage = {
    id: messageId,
    chatId: request.params.chatId,
    senderId: request.user.id,
    text: input.text,
    createdAt: new Date().toISOString(),
    replyToId: input.replyToId || null,
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
  }

  const recipientDeliveries = await sendToChatExcept(request.params.chatId, request.user.id, {
    type: 'message:new',
    message: publicMessage,
  })
  if (recipientDeliveries > 0) publicMessage.status = 'delivered'
  sendToUser(request.user.id, {
    type: 'message:delivered',
    chatId: request.params.chatId,
    messageId,
    delivered: recipientDeliveries > 0,
  })
  response.status(201).json({ message: publicMessage })
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
     SET ciphertext = $1, iv = $2, auth_tag = $3, encryption_version = $4, edited_at = $5
     WHERE id = $6`,
    [
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.version,
      editedAt,
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
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND sender_id = $3 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId, request.user.id],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Deletable message not found' })
    return
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

app.post('/api/media', requireAuth, mediaUpload.single('file'), async (request, response) => {
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
  if (chatId && !(await isChatMember(chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const compressed = clientEncrypted
    ? {
        data: request.file.buffer,
        mimeType: clientMetadata.mimeType,
        width: clientMetadata.width,
        height: clientMetadata.height,
        originalSize: clientMetadata.originalSize || request.file.size,
        plainSize: clientMetadata.plainSize || request.file.size,
      }
    : kind === 'image'
      ? await compressImage(request.file.buffer)
      : await compressVideo(request.file.buffer)

  const encrypted = encryptBuffer(compressed.data)
  const mediaId = randomUUID()
  const storageName = `${mediaId}.bin`
  await writeFile(resolve(config.mediaDir, storageName), Buffer.from(encrypted.ciphertext, 'base64'), {
    mode: 0o600,
  })

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
      compressed.mimeType,
      storageName,
      Buffer.byteLength(encrypted.ciphertext, 'base64'),
      compressed.plainSize || compressed.data.length,
      compressed.originalSize || request.file.size,
      compressed.width,
      compressed.height,
      clientEncrypted,
      clientMetadata?.envelope || '',
      clientMetadata?.durationMs ?? null,
      encrypted.iv,
      encrypted.authTag,
    ],
  )

  response.status(201).json({
    media: {
      id: mediaId,
      kind,
      name: clientMetadata?.originalName || request.file.originalname,
      mimeType: compressed.mimeType,
      durationMs: clientMetadata?.durationMs ?? null,
      size: compressed.plainSize || compressed.data.length,
      originalSize: compressed.originalSize || request.file.size,
      width: compressed.width,
      height: compressed.height,
      url: `/api/media/${mediaId}`,
      encrypted: clientEncrypted,
      envelope: clientMetadata?.envelope || '',
    },
  })
})

app.get('/api/media/:mediaId', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT id, owner_id, chat_id, mime_type, storage_name, plain_size, iv, auth_tag,
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

  const encryptedFile = await readFile(resolve(config.mediaDir, media.storage_name))
  const data = decryptBuffer({
    ciphertext: encryptedFile.toString('base64'),
    iv: media.iv,
    authTag: media.auth_tag,
  })
  const range = request.headers.range
  response.setHeader(
    'Content-Type',
    isDatabaseTrue(media.client_encrypted) ? 'application/octet-stream' : media.mime_type,
  )
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Content-Disposition', 'inline')

  if (!range) {
    response.setHeader('Content-Length', data.length)
    response.send(data)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    response.status(416).setHeader('Content-Range', `bytes */${data.length}`).end()
    return
  }
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1
  if (start > end || start >= data.length) {
    response.status(416).setHeader('Content-Range', `bytes */${data.length}`).end()
    return
  }
  response.status(206)
  response.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`)
  response.setHeader('Content-Length', end - start + 1)
  response.send(data.subarray(start, end + 1))
})

app.post('/api/calls', requireAuth, async (request, response) => {
  const input = parseBody(callSchema, request.body)
  if (input.recipientId === request.user.id) {
    response.status(400).json({ error: 'Cannot call yourself' })
    return
  }
  const recipient = await db.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [input.recipientId])
  if (!recipient.rows.length) {
    response.status(404).json({ error: 'Recipient not found' })
    return
  }

  if (input.chatId) {
    const chat = await db.query(
      `SELECT c.id
       FROM chats c
       JOIN chat_members caller ON caller.chat_id = c.id AND caller.user_id = $2
       JOIN chat_members recipient ON recipient.chat_id = c.id AND recipient.user_id = $3
       WHERE c.id = $1 AND c.type = 'private'
       LIMIT 1`,
      [input.chatId, request.user.id, input.recipientId],
    )
    if (!chat.rows.length) {
      response.status(400).json({ error: 'Calls require a shared private chat' })
      return
    }
  }

  await db.query(
    `UPDATE calls
     SET status = 'missed', ended_at = NOW()
     WHERE status = 'ringing' AND created_at < NOW() - INTERVAL '90 seconds'`,
  )
  const busy = await db.query(
    `SELECT id
     FROM calls
     WHERE status IN ('ringing', 'accepted')
       AND (
         initiator_id IN ($1, $2)
         OR recipient_id IN ($1, $2)
       )
     LIMIT 1`,
    [request.user.id, input.recipientId],
  )
  if (busy.rows.length) {
    response.status(409).json({ error: 'One of the users is already in a call' })
    return
  }

  const callId = randomUUID()
  await db.query(
    `INSERT INTO calls (id, chat_id, initiator_id, recipient_id, kind, status)
     VALUES ($1, $2, $3, $4, $5, 'ringing')`,
    [callId, input.chatId || null, request.user.id, input.recipientId, input.kind],
  )
  const online = sendToUser(input.recipientId, {
    type: 'call:incoming',
    callId,
    kind: input.kind,
    chatId: input.chatId || null,
    from: publicUser(request.user),
  })
  response.status(201).json({ call: { id: callId, status: 'ringing', online } })
})

server.on('upgrade', async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
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

wss.on('connection', (socket, _request, user) => {
  socket.isAlive = true
  const wasOnline = socketsByUserId.has(user.id)
  addSocket(user.id, socket)
  socket.send(JSON.stringify({
    type: 'session:ready',
    userId: user.id,
    onlineUserIds: [...socketsByUserId.keys()],
  }))
  if (!wasOnline) {
    broadcast({ type: 'presence:update', userId: user.id, online: true }, user.id)
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
           WHERE chat_id = $1 AND sender_id <> $2 AND deleted_at IS NULL
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
          messageIds: unread.rows.map((item) => item.id),
        })
        return
      }

      if (!['call:offer', 'call:answer', 'call:ice', 'call:hangup', 'call:decline'].includes(message.type)) {
        return
      }
      if (typeof message.targetUserId !== 'string' || typeof message.callId !== 'string') return

      const call = await db.query(
        `SELECT id, initiator_id, recipient_id, status
         FROM calls
         WHERE id = $1 AND (initiator_id = $2 OR recipient_id = $2)
         LIMIT 1`,
        [message.callId, user.id],
      )
      const callRow = call.rows[0]
      if (!callRow) return
      const counterpartId =
        callRow.initiator_id === user.id ? callRow.recipient_id : callRow.initiator_id
      if (counterpartId !== message.targetUserId) return
      if (['declined', 'ended', 'missed'].includes(callRow.status)) return
      if (message.type === 'call:offer' && callRow.initiator_id !== user.id) return
      if (message.type === 'call:answer' && callRow.recipient_id !== user.id) return
      if (
        (message.type === 'call:offer' || message.type === 'call:answer') &&
        (!message.description || typeof message.description.type !== 'string')
      ) {
        return
      }
      if (message.type === 'call:ice' && !message.candidate) return

      if (message.type === 'call:answer') {
        await db.query(
          `UPDATE calls SET status = 'accepted', answered_at = NOW()
           WHERE id = $1 AND status = 'ringing'`,
          [message.callId],
        )
      }
      if (message.type === 'call:hangup' || message.type === 'call:decline') {
        await db.query(
          `UPDATE calls SET status = $2, ended_at = NOW()
           WHERE id = $1`,
          [message.callId, message.type === 'call:decline' ? 'declined' : 'ended'],
        )
      }

      sendToUser(message.targetUserId, {
        ...message,
        fromUserId: user.id,
      })
    } catch (error) {
      console.error('[ws] message failed', error.message)
    }
  })

  socket.on('close', () => {
    removeSocket(user.id, socket)
    if (!socketsByUserId.has(user.id)) {
      const lastSeenAt = new Date().toISOString()
      void (async () => {
        try {
          await db.query('UPDATE users SET last_seen_at = $1 WHERE id = $2', [lastSeenAt, user.id])
          const activeCalls = await db.query(
            `SELECT id, initiator_id, recipient_id, status
             FROM calls
             WHERE status IN ('ringing', 'accepted')
               AND (initiator_id = $1 OR recipient_id = $1)`,
            [user.id],
          )
          for (const activeCall of activeCalls.rows) {
            const status = activeCall.status === 'ringing' ? 'missed' : 'ended'
            await db.query(
              `UPDATE calls SET status = $2, ended_at = NOW()
               WHERE id = $1 AND status IN ('ringing', 'accepted')`,
              [activeCall.id, status],
            )
            const counterpartId =
              activeCall.initiator_id === user.id
                ? activeCall.recipient_id
                : activeCall.initiator_id
            sendToUser(counterpartId, {
              type: 'call:hangup',
              callId: activeCall.id,
              fromUserId: user.id,
              reason: 'disconnected',
            })
          }
        } catch (error) {
          console.error('[presence] disconnect cleanup failed', error.message)
        }
      })()
      broadcast({
        type: 'presence:update',
        userId: user.id,
        online: false,
        lastSeenAt,
      }, user.id)
    }
  })
  socket.on('error', (error) => console.error('[ws] connection error', error.message))
})

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, 30000)

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
    response.status(413).json({ error: 'File is too large. Maximum upload size is 100 MB.' })
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
  await migrateDatabase()
  await cleanupExpiredSessions()
  server.listen(config.port, config.host, () => {
    console.log(`[server] http://${config.host}:${config.port}`)
  })
}

async function shutdown() {
  clearInterval(heartbeat)
  for (const socket of wss.clients) socket.close(1001, 'Server shutting down')
  await new Promise((resolveClose) => server.close(resolveClose))
  await db.close()
}

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
