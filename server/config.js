import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(serverDir, '..')
const dataDir = resolve(rootDir, process.env.DATA_DIR || 'server-data-v5')
const mediaDir = resolve(dataDir, 'media')
const isProduction = process.env.NODE_ENV === 'production'
const databaseUrl = process.env.DATABASE_URL || ''
const redisUrl = process.env.REDIS_URL || ''
const storageDriver = process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? 's3' : 'local')
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
const vapidSubject = process.env.VAPID_SUBJECT || ''
const iceServersRaw = process.env.WEBRTC_ICE_SERVERS || ''
const sessionCookieSameSite = (process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase()
const sessionCookieSecure =
  process.env.SESSION_COOKIE_SECURE === 'true'
    ? true
    : process.env.SESSION_COOKIE_SECURE === 'false'
      ? false
      : isProduction

if (!['lax', 'strict', 'none'].includes(sessionCookieSameSite)) {
  throw new Error('SESSION_COOKIE_SAME_SITE must be lax, strict or none')
}

if (sessionCookieSameSite === 'none' && !sessionCookieSecure) {
  throw new Error('SESSION_COOKIE_SAME_SITE=none requires SESSION_COOKIE_SECURE=true')
}

mkdirSync(dataDir, { recursive: true })
if (storageDriver === 'local') mkdirSync(mediaDir, { recursive: true })

if (isProduction && !databaseUrl) {
  throw new Error('DATABASE_URL is required in production')
}

if (isProduction && !redisUrl) {
  throw new Error('REDIS_URL is required in production')
}

if (isProduction && storageDriver !== 's3') {
  throw new Error('STORAGE_DRIVER=s3 is required in production')
}

if (storageDriver === 's3') {
  for (const name of ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!process.env[name]) throw new Error(`${name} is required when STORAGE_DRIVER=s3`)
  }
}

if ((vapidPublicKey || vapidPrivateKey) && (!vapidPublicKey || !vapidPrivateKey)) {
  throw new Error('Both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required for Web Push')
}

if (isProduction && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) {
  throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required in production')
}

if (vapidSubject && !vapidSubject.startsWith('mailto:') && !vapidSubject.startsWith('https://')) {
  throw new Error('VAPID_SUBJECT must start with mailto: or https://')
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseIceServers() {
  if (iceServersRaw) {
    try {
      const parsed = JSON.parse(iceServersRaw)
      if (!Array.isArray(parsed)) throw new Error('WEBRTC_ICE_SERVERS must be a JSON array')
      return parsed.map((server) => {
        const urls = Array.isArray(server.urls)
          ? server.urls.filter(Boolean)
          : String(server.urls || '').trim()
        if (!urls || (Array.isArray(urls) && !urls.length)) {
          throw new Error('Each ICE server requires urls')
        }
        return {
          urls,
          username: server.username || undefined,
          credential: server.credential || undefined,
        }
      })
    } catch (error) {
      throw new Error(`Invalid WEBRTC_ICE_SERVERS: ${error.message}`, { cause: error })
    }
  }

  const stunUrls = parseCsv(process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
  const turnUrls = parseCsv(process.env.WEBRTC_TURN_URLS)
  const servers = stunUrls.map((urls) => ({ urls }))
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: process.env.WEBRTC_TURN_USERNAME || undefined,
      credential: process.env.WEBRTC_TURN_CREDENTIAL || undefined,
    })
  }
  return servers
}

const iceServers = parseIceServers()

if (isProduction && !iceServers.some((server) => {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  return urls.some((url) => String(url).startsWith('turn:') || String(url).startsWith('turns:'))
})) {
  throw new Error('Production WebRTC requires WEBRTC_TURN_URLS or WEBRTC_ICE_SERVERS with a TURN/TURNS server')
}

function loadMessageKey() {
  if (process.env.MESSAGE_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.MESSAGE_ENCRYPTION_KEY, 'base64')
    if (key.length !== 32) {
      throw new Error('MESSAGE_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
    }
    return key
  }

  if (isProduction) {
    throw new Error('MESSAGE_ENCRYPTION_KEY is required in production')
  }

  const keyPath = resolve(dataDir, '.dev-message-key')
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')
    if (key.length !== 32) throw new Error('Invalid local development message key')
    return key
  }

  const key = randomBytes(32)
  writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 })
  return key
}

function loadAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN
  const tokenPath = resolve(dataDir, '.admin-token')
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, 'utf8').trim()
    if (token) return token
  }
  const token = randomBytes(24).toString('base64url')
  writeFileSync(tokenPath, token, { mode: 0o600 })
  return token
}

export const config = {
  rootDir,
  dataDir,
  databasePath: resolve(dataDir, 'pgdata'),
  databaseUrl,
  mediaDir,
  storageDriver,
  adminToken: loadAdminToken(),
  s3: {
    bucket: process.env.S3_BUCKET || '',
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'auto',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    prefix: (process.env.S3_PREFIX || 'media').replace(/^\/+|\/+$/g, ''),
  },
  redisUrl,
  trustProxy: process.env.TRUST_PROXY || (isProduction ? '1' : ''),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  isProduction,
  sessionCookieName: 'astrachat_session',
  sessionCookieSameSite,
  sessionCookieSecure,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  messageKey: loadMessageKey(),
  vapid: {
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
    subject: vapidSubject || 'mailto:admin@example.com',
    enabled: Boolean(vapidPublicKey && vapidPrivateKey),
  },
  webrtc: {
    iceServers,
  },
}
