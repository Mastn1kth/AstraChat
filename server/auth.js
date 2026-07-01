import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { config } from './config.js'
import { createSessionToken, hashSessionToken } from './crypto.js'
import { cacheSession, deleteCachedSession, getCachedSessionUserId } from './redis.js'

// Sliding expiration: only extend a session's expiry when it hasn't been
// extended recently, to avoid writing to the DB (and Redis) on every request.
const SESSION_EXTEND_THROTTLE_MS = 60 * 60 * 1000 // 1 hour

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

export async function getSessionUser(request, response = null) {
  const tokenHash = getSessionTokenHash(request)
  if (!tokenHash) return null

  const cachedUserId = await getCachedSessionUserId(tokenHash)
  const params = cachedUserId ? [tokenHash, cachedUserId] : [tokenHash]
  const result = await db.query(
    `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar,
            u.last_seen_at, u.encryption_public_key, u.totp_secret, u.totp_enabled_at,
            u.privacy_phone, u.privacy_last_seen, u.privacy_avatar,
            s.expires_at AS session_expires_at, s.last_extended_at AS session_last_extended_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       ${cachedUserId ? 'AND s.user_id = $2' : ''}
       AND s.expires_at > NOW()
     LIMIT 1`,
    params,
  )
  const row = result.rows[0]
  if (row) {
    await db.query('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1', [tokenHash])

    let expiresAt = row.session_expires_at
    const lastExtendedAt = row.session_last_extended_at
    // Sliding expiration: bump the session's expiry back out to a full TTL,
    // but only write when the last extension is older than the throttle
    // window, so an active session doesn't hammer the DB on every request.
    const shouldExtend =
      !lastExtendedAt || Date.now() - new Date(lastExtendedAt).getTime() >= SESSION_EXTEND_THROTTLE_MS

    if (shouldExtend) {
      const newExpiresAt = new Date(Date.now() + config.sessionTtlMs)
      await db.query(
        'UPDATE sessions SET expires_at = $1, last_extended_at = NOW() WHERE token_hash = $2',
        [newExpiresAt.toISOString(), tokenHash],
      )
      expiresAt = newExpiresAt.toISOString()

      // Refresh the cookie's own maxAge too, otherwise the browser would
      // still drop the cookie at the original expiry regardless of the
      // server-side extension.
      const token = getSessionToken(request)
      if (response && token) {
        response.cookie(config.sessionCookieName, token, {
          httpOnly: true,
          secure: config.sessionCookieSecure,
          sameSite: config.sessionCookieSameSite,
          maxAge: config.sessionTtlMs,
          path: '/',
        })
      }
    }

    if (!cachedUserId || shouldExtend) {
      // Keep the Redis session cache TTL in sync with the DB row, otherwise
      // a stale cache entry could expire (rejecting a session the DB still
      // considers valid) or outlive an unextended DB row.
      await cacheSession(tokenHash, row.id, expiresAt)
    }

    delete row.session_expires_at
    delete row.session_last_extended_at
  }
  return row || null
}

export async function requireAuth(request, response, next) {
  const user = await getSessionUser(request, response)
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
