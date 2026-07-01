import { Router } from 'express'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { db, createSavedChat } from '../db.js'
import { requireAuth, createSession, destroySession, getSessionUser } from '../auth.js'
import { hashPassword, verifyPassword, createTotpSecret, createTotpUri } from '../crypto.js'
import { clearFailedLogins, isLoginLocked, recordFailedLogin } from '../redis.js'
import {
  parseBody,
  registerSchema,
  loginSchema,
  phoneAuthStartSchema,
  phoneAuthVerifySchema,
  totpVerifySchema,
} from '../validation.js'
import {
  publicUser,
  initials,
  normalizePhone,
  hashPhoneCode,
  publicPhoneCodePayload,
  stringifyPublicKey,
  sealTotpSecret,
  openTotpSecret,
  loadOwnTotpState,
  createSecurityEvent,
  verifyAndConsumeTotpCode,
} from '../server-helpers.js'
import { sendLoginCodePush, sendLoginCodePushToToken } from '../push-service.js'

const router = Router()

router.post('/register', async (request, response) => {
  if (config.isProduction) {
    response.status(404).json({ error: 'Use phone registration' })
    return
  }
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
  response.status(201).json({ user: publicUser(userResult.rows[0], { isSelf: true }) })
})

router.post('/phone/start', async (request, response) => {
  const input = parseBody(phoneAuthStartSchema, request.body)
  const phone = normalizePhone(input.countryCode, input.phone)
  const code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const userResult = await db.query('SELECT id FROM users WHERE phone = $1 LIMIT 1', [phone])
  const existingUserId = userResult.rows[0]?.id || ''

  // Priority: push to the device that requested the code, then fall back to existing push subscriptions
  let pushSent = 0
  if (input.fcmToken) {
    pushSent = (await sendLoginCodePushToToken(input.fcmToken, code)) ? 1 : 0
  }
  if (!pushSent && existingUserId) {
    pushSent = await sendLoginCodePush(existingUserId, code)
  }

  if (config.isProduction && pushSent <= 0) {
    response.status(503).json({
      error: 'Push notifications are required to receive the login code. Allow notifications and try again.',
      code: 'push_required',
    })
    return
  }

  await db.query('DELETE FROM phone_login_codes WHERE expires_at <= NOW()')
  await db.query(
    `INSERT INTO phone_login_codes (phone, code_hash, attempts, expires_at, fcm_token)
     VALUES ($1, $2, 0, $3, $4)
     ON CONFLICT (phone)
     DO UPDATE SET code_hash = EXCLUDED.code_hash,
                   attempts = 0,
                   expires_at = EXCLUDED.expires_at,
                   fcm_token = EXCLUDED.fcm_token,
                   created_at = NOW()`,
    [phone, hashPhoneCode(phone, code), expiresAt, input.fcmToken || null],
  )

  response.json({
    phone,
    expiresAt,
    delivery: pushSent > 0 ? 'push' : 'dev',
    pushSent,
    ...publicPhoneCodePayload(phone, code),
  })
})

router.post('/phone/verify', async (request, response) => {
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
  const expectedHash = hashPhoneCode(phone, input.code)
  const codeMatches =
    codeRow.code_hash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(codeRow.code_hash), Buffer.from(expectedHash))
  if (!codeMatches) {
    await db.query('UPDATE phone_login_codes SET attempts = attempts + 1 WHERE phone = $1', [phone])
    response.status(401).json({ error: 'Invalid code' })
    return
  }

  const existing = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            totp_secret, totp_enabled_at,
            cloud_password_hash, cloud_password_salt, cloud_password_hint
     FROM users WHERE phone = $1 LIMIT 1`,
    [phone],
  )
  if (existing.rows[0]) {
    await db.query('DELETE FROM phone_login_codes WHERE phone = $1', [phone])
    response.status(409).json({
      error: 'Account already exists. Sign in with username and password.',
      code: 'account_exists',
    })
    return
  }

  if (!input.username || !input.name || !input.password) {
    response.json({ profileRequired: true, phone })
    return
  }

  const userId = randomUUID()
  const password = await hashPassword(input.password)
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
  response.status(201).json({ user: publicUser(userResult.rows[0], { isSelf: true }), existing: false })
})

router.post('/qr/start', async (request, response) => {
  await db.query('DELETE FROM qr_tokens WHERE expires_at < NOW()')
  const token = randomBytes(24).toString('hex')
  await db.query(
    `INSERT INTO qr_tokens (token, expires_at) VALUES ($1, NOW() + INTERVAL '3 minutes')`,
    [token],
  )
  const row = await db.query('SELECT expires_at FROM qr_tokens WHERE token = $1', [token])
  response.json({ token, expiresAt: row.rows[0].expires_at })
})

router.get('/qr/status', async (request, response) => {
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
  response.json({ status: 'confirmed', user: publicUser(userResult.rows[0], { isSelf: true }) })
})

router.post('/qr/confirm', requireAuth, async (request, response) => {
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

router.post('/login', async (request, response) => {
  const input = parseBody(loginSchema, request.body)
  const loginKey = input.login.toLowerCase()

  if (await isLoginLocked(loginKey)) {
    response.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' })
    return
  }

  const result = await db.query(
    `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key,
            password_salt, password_hash, totp_secret, totp_enabled_at,
            cloud_password_hash, cloud_password_salt, cloud_password_hint
     FROM users WHERE login = $1 OR username = $1 LIMIT 1`,
    [loginKey],
  )
  const user = result.rows[0]
  const valid = user
    ? await verifyPassword(input.password, user.password_salt, user.password_hash)
    : false

  if (!valid) {
    await recordFailedLogin(loginKey)
    response.status(401).json({ error: 'Invalid login or password' })
    return
  }

  if (user.totp_secret && !input.totpCode) {
    response.json({ totpRequired: true })
    return
  }

  if (user.totp_secret && !(await verifyAndConsumeTotpCode(user.id, openTotpSecret(user.totp_secret), input.totpCode))) {
    await recordFailedLogin(loginKey)
    response.status(401).json({ error: 'Invalid authentication code' })
    return
  }

  if (user.cloud_password_hash && !input.cloudPassword) {
    response.json({ cloudPasswordRequired: true, hint: user.cloud_password_hint || null })
    return
  }
  if (user.cloud_password_hash && input.cloudPassword) {
    const cpValid = await verifyPassword(input.cloudPassword, user.cloud_password_salt, user.cloud_password_hash)
    if (!cpValid) {
      await recordFailedLogin(loginKey)
      response.status(401).json({ error: 'Incorrect cloud password' })
      return
    }
  }

  await clearFailedLogins(loginKey)
  await createSession(response, user.id, request)
  response.json({ user: publicUser(user, { isSelf: true }) })
})

router.get('/me', async (request, response) => {
  const user = await getSessionUser(request, response)
  if (!user) {
    response.status(401).json({ error: 'Not authenticated' })
    return
  }
  response.json({ user: publicUser(user, { isSelf: true }) })
})

router.post('/logout', async (request, response) => {
  await destroySession(request, response)
  response.status(204).end()
})

// TOTP (двухфакторная аутентификация)

router.get('/totp/status', requireAuth, async (request, response) => {
  const user = await loadOwnTotpState(request.user.id)
  response.json({ enabled: Boolean(user?.totp_secret), enabledAt: user?.totp_enabled_at || null })
})

router.post('/totp/setup', requireAuth, async (request, response) => {
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

router.post('/totp/verify', requireAuth, async (request, response) => {
  const input = parseBody(totpVerifySchema, request.body)
  const user = await loadOwnTotpState(request.user.id)
  if (!user?.totp_pending_secret) {
    response.status(400).json({ error: 'Two-factor setup was not started' })
    return
  }

  const secret = openTotpSecret(user.totp_pending_secret)
  if (!(await verifyAndConsumeTotpCode(request.user.id, secret, input.code))) {
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
  response.json({ user: publicUser(result.rows[0], { isSelf: true }) })
})

router.delete('/totp', requireAuth, async (request, response) => {
  const input = parseBody(totpVerifySchema, request.body)
  const user = await loadOwnTotpState(request.user.id)
  if (!user?.totp_secret) {
    response.status(400).json({ error: 'Two-factor authentication is not enabled' })
    return
  }
  if (!(await verifyAndConsumeTotpCode(request.user.id, openTotpSecret(user.totp_secret), input.code))) {
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
  response.json({ user: publicUser(result.rows[0], { isSelf: true }) })
})

// Cloud password (двухшаговая верификация)

router.get('/cloud-password/status', requireAuth, async (request, response) => {
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

router.post('/cloud-password', requireAuth, async (request, response) => {
  const { password, hint, currentPassword } = request.body
  if (!password || typeof password !== 'string' || password.length < 6) {
    response.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }
  const userRow = await db.query(
    'SELECT password_salt, password_hash, cloud_password_hash, cloud_password_salt FROM users WHERE id = $1',
    [request.user.id],
  )
  if (!userRow.rows.length) { response.status(401).json({ error: 'Not found' }); return }
  const row = userRow.rows[0]
  if (row.cloud_password_hash) {
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

router.delete('/cloud-password', requireAuth, async (request, response) => {
  const { password } = request.body
  const userRow = await db.query(
    'SELECT cloud_password_hash, cloud_password_salt FROM users WHERE id = $1',
    [request.user.id],
  )
  const row = userRow.rows[0]
  if (!row?.cloud_password_hash) { response.status(400).json({ error: 'Cloud password is not set' }); return }
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

router.post('/cloud-password/verify', requireAuth, async (request, response) => {
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

export default router
