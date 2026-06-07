import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { config } from './config.js'
import { createSessionToken, hashSessionToken } from './crypto.js'

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

  const result = await db.query(
    `SELECT u.id, u.login, u.username, u.name, u.bio, u.avatar,
            u.last_seen_at, u.encryption_public_key
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  )
  if (result.rows[0]) {
    await db.query('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1', [tokenHash])
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
  const expiresAt = new Date(Date.now() + config.sessionTtlMs)
  await db.query(
    `INSERT INTO sessions
      (id, user_id, token_hash, expires_at, user_agent, ip_address, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      randomUUID(),
      userId,
      hashSessionToken(token),
      expiresAt.toISOString(),
      String(request?.headers?.['user-agent'] || '').slice(0, 500),
      request ? getRequestIp(request) : '',
    ],
  )
  response.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: config.sessionTtlMs,
    path: '/',
  })
}

export async function destroySession(request, response) {
  const tokenHash = getSessionTokenHash(request)
  if (tokenHash) {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  })
}
