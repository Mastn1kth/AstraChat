import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { config } from './config.js'
import { createSessionToken, hashSessionToken } from './crypto.js'
import { cacheSession, deleteCachedSession, getCachedSessionUserId } from './redis.js'

function getSessionToken(request) {
  return request.cookies?.[config.sessionCookieName] || ''
}

export function getSessionTokenHash(request) {
  const token = getSessionToken(request)
  return token ? hashSessionToken(token) : ''
}

function getRequestIp(request) {
  return String(request.headers['x-forwarded-for'] || request.ip || request.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
    .slice(0, 128)
}

export async function getSessionUser(request) {
  const tokenHash = getSessionTokenHash(request)
  if (!tokenHash) return null

  const cachedUserId = await getCachedSessionUserId(tokenHash)
  const params = cachedUserId ? [tokenHash, cachedUserId] : [tokenHash]
  const result = await db.query(
    `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar,
            u.last_seen_at, u.encryption_public_key, u.totp_secret, u.totp_enabled_at,
            u.privacy_phone, u.privacy_last_seen
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       ${cachedUserId ? 'AND s.user_id = $2' : ''}
       AND s.expires_at > NOW()
     LIMIT 1`,
    params,
  )
  if (result.rows[0]) {
    await db.query('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1', [tokenHash])
    if (!cachedUserId) {
      const expires = await db.query('SELECT user_id, expires_at FROM sessions WHERE token_hash = $1', [tokenHash])
      if (expires.rows[0]) await cacheSession(tokenHash, expires.rows[0].user_id, expires.rows[0].expires_at)
    }
  }
  return result.rows[0] || null
}

export async function requireAuth(request, response, next) {
  const user = await getSessionUser(request)
  if (!user) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }
  request.user = user
  next()
}

export async function createSession(response, userId, request = null) {
  const token = createSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = new Date(Date.now() + config.sessionTtlMs)
  const userAgent = String(request?.headers?.['user-agent'] || '').slice(0, 500)
  const ipAddress = request ? getRequestIp(request) : ''
  const previousSessions = await db.query(
    `SELECT user_agent, ip_address
     FROM sessions
     WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId],
  )
  const knownSession = previousSessions.rows.some(
    (session) => (session.user_agent || '') === userAgent && (session.ip_address || '') === ipAddress,
  )
  await db.query(
    `INSERT INTO sessions
      (id, user_id, token_hash, expires_at, user_agent, ip_address, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      randomUUID(),
      userId,
      tokenHash,
      expiresAt.toISOString(),
      userAgent,
      ipAddress,
    ],
  )
  if (previousSessions.rows.length && !knownSession) {
    await db.query(
      `INSERT INTO security_events
        (id, user_id, type, severity, title, body, metadata)
       VALUES ($1, $2, 'suspicious_login', 'high', $3, $4, $5)`,
      [
        randomUUID(),
        userId,
        'New login detected',
        'A new session used a device or network not seen in your recent active sessions.',
        JSON.stringify({
          userAgent,
          ipAddress,
          reason: 'new_device_or_network',
        }),
      ],
    )
  }
  await cacheSession(tokenHash, userId, expiresAt)
  response.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    maxAge: config.sessionTtlMs,
    path: '/',
  })
}

export async function destroySession(request, response) {
  const tokenHash = getSessionTokenHash(request)
  if (tokenHash) {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
    await deleteCachedSession(tokenHash)
  }
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    path: '/',
  })
}
