import { Router } from 'express'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { config } from '../config.js'
import { db, cleanupExpiredSessions } from '../db.js'
import { requireAuth } from '../auth.js'
import { isFcmEnabled } from '../fcm.js'
import { metricsContentType, metricsText } from '../metrics.js'
import { parseBody, pushSubscriptionSchema, deletePushSubscriptionSchema, fcmTokenSchema } from '../validation.js'
import { publicWallMessage } from '../server-helpers.js'
import { normalizePushExpiration } from '../push-service.js'
import logger from '../logger.js'

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function requireAdmin(request, response, next) {
  const token = request.headers['x-admin-token']
  if (!token || !safeEqual(token, config.adminToken)) {
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

// Runs `pg_dump` against `config.databaseUrl` and streams the (gzip
// compressed) output straight to `outputPath`. Using spawn + stdout piping
// (rather than execFileSync with output buffering) keeps memory flat for
// large databases and lets us gzip in-process without shelling out to `gzip`.
//
// The connection string is passed as a single argv element, not interpolated
// into a shell string, so there is no shell-injection risk here even though
// it may contain special characters (password, query params).
async function runPgDump(databaseUrl, outputPath) {
  let child
  try {
    child = spawn('pg_dump', ['--no-owner', '--format=plain', databaseUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new PgDumpUnavailableError(error.message)
  }

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8').slice(0, 4000)
  })

  const exitCodePromise = new Promise((resolvePromise, rejectPromise) => {
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        rejectPromise(new PgDumpUnavailableError('pg_dump binary not found on PATH'))
        return
      }
      rejectPromise(error)
    })
    child.on('close', (code) => resolvePromise(code))
  })

  await pipeline(child.stdout, createGzip(), createWriteStream(outputPath))
  const exitCode = await exitCodePromise
  if (exitCode !== 0) {
    throw new Error(`pg_dump exited with code ${exitCode}: ${stderr || '(no stderr output)'}`)
  }
}

class PgDumpUnavailableError extends Error {
  constructor(detail) {
    super(
      'pg_dump is not available in this runtime. Install the postgresql-client package ' +
        `(e.g. "apt-get install -y postgresql-client" in the Docker image) or run backups ` +
        `from a host that has pg_dump on PATH. Detail: ${detail}`,
    )
    this.name = 'PgDumpUnavailableError'
  }
}

async function adminCount(sql, params = []) {
  const result = await db.query(sql, params)
  return Number(result.rows[0]?.count || 0)
}

const router = Router()

router.get('/admin', requireAuth, (_request, response) => {
  response.sendFile(resolve(config.rootDir, 'server', 'admin-panel.html'))
})

router.get('/api/admin/overview', requireAdmin, async (_request, response) => {
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

router.get('/api/admin/users', requireAdmin, async (_request, response) => {
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

router.delete('/api/admin/users/:userId', requireAdmin, async (request, response) => {
  const userId = request.params.userId
  const target = await db.query('SELECT id, login FROM users WHERE id = $1', [userId])
  if (!target.rows.length) {
    response.status(404).json({ error: 'User not found' })
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

router.post('/api/admin/purge-test-users', requireAdmin, async (_request, response) => {
  const junk = await db.query(
    `SELECT id, login FROM users
     WHERE login ~ '^(alice_media_|bob_media_|profile_[ab]_|sessions_|test_[a-z0-9]{6}|e2e_[0-9]+_[0-9]+)'`,
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

router.get('/api/admin/wall', requireAdmin, async (_request, response) => {
  const result = await db.query(
    'SELECT id, text, hue, created_at FROM wall_messages ORDER BY created_at DESC LIMIT 100',
  )
  response.json({ messages: result.rows.map(publicWallMessage) })
})

router.delete('/api/admin/wall/:messageId', requireAdmin, async (request, response) => {
  await db.query('DELETE FROM wall_messages WHERE id = $1', [request.params.messageId])
  response.json({ ok: true })
})

router.get('/api/admin/reports', requireAdmin, async (request, response) => {
  const { status } = request.query
  const allowed = ['open', 'reviewed', 'dismissed']
  const params = []
  let whereClause = ''
  if (status && allowed.includes(status)) {
    params.push(status)
    whereClause = 'WHERE r.status = $1'
  }
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
    params,
  )
  response.json({ reports: result.rows })
})

router.patch('/api/admin/reports/:id', requireAdmin, async (request, response) => {
  const { status, adminNote } = request.body
  const allowed = ['open', 'reviewed', 'dismissed']
  if (!allowed.includes(status)) {
    response.status(400).json({ error: 'invalid status' })
    return
  }
  const result = await db.query(
    `UPDATE reports SET status=$1, admin_note=$2, reviewed_at=NOW(), reviewed_by=$3
     WHERE id=$4 RETURNING id, status, admin_note, reviewed_at`,
    [status, adminNote || null, null, request.params.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'not found' })
    return
  }
  response.json({ report: result.rows[0] })
})

function readBackupManifest(name) {
  const manifestPath = resolve(adminBackupsDir, name, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

router.get('/api/admin/backups', requireAdmin, (_request, response) => {
  const backups = existsSync(adminBackupsDir)
    ? readdirSync(adminBackupsDir)
        .filter((name) => name.startsWith('onda-'))
        .sort()
        .reverse()
        .map((name) => {
          const manifest = readBackupManifest(name)
          return {
            name,
            sizeBytes: directorySize(resolve(adminBackupsDir, name)),
            database: manifest?.database || null,
            method: manifest?.method || null,
          }
        })
    : []
  response.json({ backups })
})

router.post('/api/admin/backup', requireAdmin, async (_request, response) => {
  mkdirSync(adminBackupsDir, { recursive: true })
  const name = `onda-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const target = resolve(adminBackupsDir, name)
  mkdirSync(target, { recursive: true })

  const manifest = {
    createdAt: new Date().toISOString(),
    database: config.databaseUrl ? 'postgres' : 'pglite',
  }

  if (config.databaseUrl) {
    // Real production mode: the durable data lives in Postgres, not on local
    // disk, so back up Postgres itself via pg_dump rather than copying
    // config.dataDir (which would silently produce an empty/meaningless
    // backup of message/user data in this mode).
    manifest.method = 'pg_dump'
    manifest.file = 'database.sql.gz'
    try {
      await runPgDump(config.databaseUrl, resolve(target, 'database.sql.gz'))
    } catch (error) {
      rmSync(target, { recursive: true, force: true })
      logger.error({ err: error.message }, '[admin] pg_dump backup failed')
      const status = error instanceof PgDumpUnavailableError ? 503 : 500
      response.status(status).json({ error: error.message })
      return
    }
  } else {
    // PGlite/local mode: the data genuinely lives on local disk under
    // config.dataDir, so copying it is a legitimate backup here.
    manifest.method = 'copy-data-dir'
    cpSync(config.dataDir, resolve(target, 'data'), { recursive: true })
  }

  writeFileSync(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
  response.json({ ok: true, name, sizeBytes: directorySize(target), database: manifest.database, method: manifest.method })
})

router.delete('/api/admin/backups/:name', requireAdmin, (request, response) => {
  const name = request.params.name
  if (!/^onda-[\w-]+$/.test(name)) {
    response.status(400).json({ error: 'Invalid backup name' })
    return
  }
  rmSync(resolve(adminBackupsDir, name), { recursive: true, force: true })
  response.json({ ok: true })
})

router.post('/api/admin/cleanup', requireAdmin, async (_request, response) => {
  await cleanupExpiredSessions()
  const wall = await db.query(
    `DELETE FROM wall_messages
     WHERE id NOT IN (SELECT id FROM wall_messages ORDER BY created_at DESC LIMIT 500)
     RETURNING id`,
  )
  response.json({ ok: true, wallTrimmed: wall.rows.length })
})

router.get('/metrics', requireAdmin, async (_request, response) => {
  response.setHeader('Content-Type', metricsContentType())
  response.send(await metricsText())
})

// ── Push subscriptions ────────────────────────────────────────────────────

router.post('/api/push/fcm-token', requireAuth, async (request, response) => {
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

router.get('/api/push/vapid-public-key', requireAuth, (_request, response) => {
  response.json({
    enabled: config.vapid.enabled,
    publicKey: config.vapid.enabled ? config.vapid.publicKey : '',
  })
})

router.post('/api/push/subscriptions', requireAuth, async (request, response) => {
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

router.delete('/api/push/subscriptions', requireAuth, async (request, response) => {
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

export default router
