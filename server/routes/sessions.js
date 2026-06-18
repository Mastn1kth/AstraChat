import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, destroySession, getSessionTokenHash } from '../auth.js'
import { hashPassword, verifyPassword } from '../crypto.js'
import { deleteCachedSession, deleteCachedSessions } from '../redis.js'
import { parseBody, changePasswordSchema } from '../validation.js'
import { publicSession, publicSecurityEvent } from '../server-helpers.js'

const router = Router()

router.get('/api/sessions', requireAuth, async (request, response) => {
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

router.delete('/api/sessions', requireAuth, async (request, response) => {
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

router.delete('/api/sessions/:sessionId', requireAuth, async (request, response) => {
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

router.get('/api/security/events', requireAuth, async (request, response) => {
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

router.post('/api/security/events/read', requireAuth, async (request, response) => {
  await db.query(
    `UPDATE security_events
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [request.user.id],
  )
  response.status(204).end()
})

router.post('/api/security/events/:eventId/read', requireAuth, async (request, response) => {
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

router.post('/api/auth/change-password', requireAuth, async (request, response) => {
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

export default router
