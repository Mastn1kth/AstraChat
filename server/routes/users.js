import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptBuffer, decryptBuffer } from '../crypto.js'
import {
  parseBody,
  profileSchema,
  encryptionKeySchema,
} from '../validation.js'
import {
  publicUser,
  initials,
  stringifyPublicKey,
  hasBlockBetween,
  createSecurityEvent,
  sharedUserIdsForKeyWarnings,
} from '../server-helpers.js'
import {
  compressAvatar,
  mediaUpload,
  readUploadedFile,
  getMediaKind,
  cleanupUploadedFile,
} from '../media.js'
import { deleteMediaObject, getMediaObject, saveMediaObject } from '../storage.js'
import { sendToUser } from '../socket-manager.js'
import { apiLimiter, uploadLimiter } from '../limiters.js'

const router = Router()

router.get('/', requireAuth, apiLimiter, async (request, response) => {
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

router.post('/by-phone', requireAuth, apiLimiter, async (request, response) => {
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

router.patch('/me/encryption-key', requireAuth, async (request, response) => {
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

router.patch('/me/profile', requireAuth, async (request, response) => {
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

router.post('/me/avatar', requireAuth, uploadLimiter, mediaUpload.single('file'), async (request, response) => {
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
      try { await deleteMediaObject(previousName) } catch { /* ignore */ }
    }
    response.json({ ok: true, avatarUpdatedAt: new Date().toISOString() })
  } finally {
    await cleanupUploadedFile(request.file)
  }
})

router.delete('/me/avatar', requireAuth, async (request, response) => {
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
    try { await deleteMediaObject(previousName) } catch { /* ignore */ }
  }
  response.json({ ok: true })
})

router.get('/:userId/avatar', requireAuth, async (request, response) => {
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

router.get('/blocks', requireAuth, async (request, response) => {
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

router.post('/:userId/block', requireAuth, async (request, response) => {
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

router.delete('/:userId/block', requireAuth, async (request, response) => {
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

router.delete('/me', requireAuth, async (request, response) => {
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


export default router
