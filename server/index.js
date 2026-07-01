import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { db, migrateDatabase, cleanupExpiredSessions } from './db.js'
import { checkStorage } from './storage.js'
import {
  addPresence,
  closeRedis,
  checkRedis,
  getOnlineUserIds,
  initRedis,
  onSocketMessage,
  refreshPresence,
  removePresence,
} from './redis.js'
import { httpRequestDuration } from './metrics.js'
import logger from './logger.js'
import { getSessionUser } from './auth.js'
import { mediaUploadMaxBytes } from './media.js'
import {
  socketsByUserId,
  state,
  addSocket,
  removeSocket,
  deliverToLocalUser,
  deliverLocalBroadcast,
  sendToUser,
  sendToChatExcept,
  sendToCall,
  broadcast,
} from './socket-manager.js'
import { formatByteSize, isChatMember, getCallParticipants } from './server-helpers.js'
import { publishDueScheduledMessages, deleteExpiredMessages } from './scheduled.js'
import { startJobQueuePolling, stopJobQueuePolling } from './job-queue.js'
import './push-service.js' // registers the push:deliver job handler as a side effect
import { authLimiter } from './limiters.js'
// Route modules
import adminRouter from './routes/admin.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import callsRouter from './routes/calls.js'
import ogRouter from './routes/og.js'
import sessionsRouter from './routes/sessions.js'
import contactsRouter from './routes/contacts.js'
import wallRouter from './routes/wall.js'
import contentRouter from './routes/content.js'
import chatsRouter from './routes/chats.js'
import mediaRouter from './routes/media-routes.js'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

if (config.vapid.enabled) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  )
}

app.disable('x-powered-by')
if (config.trustProxy) app.set('trust proxy', config.trustProxy)

// The frontend normally opens its WebSocket same-origin (`API_BASE` empty,
// see src/api/client.js), but the Capacitor mobile shell and any separately
// hosted frontend build with VITE_API_BASE set connect cross-origin to one
// of the configured ALLOWED_ORIGINS instead (see docs/mobile-release.md).
// Mirror those origins as ws(s):// equivalents rather than allowing any
// WebSocket host.
const allowedWsOrigins = config.allowedOrigins.map((origin) => origin.replace(/^http/, 'ws'))

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // lottie-web (used by src/components/LottieAnimation.jsx) renders
        // its SVG animations by setting inline `style` attributes directly
        // on DOM nodes, which is genuinely CSP-relevant (unlike React's
        // `style` prop, which sets DOM properties, not attributes). There is
        // no inline-style-free renderer option for it, so 'unsafe-inline'
        // stays here for styleSrc.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", ...allowedWsOrigins],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
)
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
  const start = Date.now()
  const end = httpRequestDuration.startTimer()
  response.on('finish', () => {
    const ms = Date.now() - start
    end({ method: request.method, route: request.route?.path || request.path, status: String(response.statusCode) })
    if (!request.path.startsWith('/metrics')) {
      logger.info({ method: request.method, path: request.path, status: response.statusCode, ms }, 'request')
    }
  })
  next()
})

app.get('/api/live', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/health', async (_request, response) => {
  const dbStart = Date.now()
  await db.query('SELECT 1')
  const dbMs = Date.now() - dbStart
  const [storage, redisStatus] = await Promise.all([checkStorage(), checkRedis()])
  const mem = process.memoryUsage()
  response.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    database: { backend: config.databaseUrl ? 'postgres' : 'pglite', pingMs: dbMs },
    storage,
    redis: redisStatus,
    websocket: { connections: socketsByUserId.size },
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
  })
})

app.use('/api/auth', authLimiter, authRouter)
app.use('/api/users', usersRouter)
app.use('/', ogRouter)
app.use('/', sessionsRouter)
app.use('/', contactsRouter)
app.use('/', wallRouter)
app.use('/', contentRouter)
app.use('/', chatsRouter)
app.use('/', mediaRouter)
app.use('/', adminRouter)
app.use('/api/calls', callsRouter)

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
    logger.error({ err: error.message }, '[ws] upgrade failed')
    socket.destroy()
  }
})

wss.on('connection', async (socket, _request, user) => {
  socket.isAlive = true
  const wasOnline = socketsByUserId.has(user.id) || state.onlineUserIdCache.has(user.id)
  const socketCount = addSocket(user.id, socket)
  await addPresence(user.id, socketCount)
  const onlineUserIds = new Set([...state.onlineUserIdCache, ...socketsByUserId.keys(), ...(await getOnlineUserIds())])
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

  // Per-connection throttle: max 20 WS messages/second, typing deduplicated per chat
  let wsMessageCount = 0
  let wsThrottleReset = Date.now() + 1000
  const lastTypingBroadcast = new Map() // chatId -> timestamp

  socket.on('message', async (raw) => {
    try {
      const now = Date.now()
      if (now > wsThrottleReset) { wsMessageCount = 0; wsThrottleReset = now + 1000 }
      wsMessageCount++
      if (wsMessageCount > 20) return // silently drop excess

      const message = JSON.parse(raw.toString())

      if (message.type === 'typing') {
        if (
          typeof message.chatId !== 'string' ||
          typeof message.active !== 'boolean' ||
          !(await isChatMember(message.chatId, user.id))
        ) {
          return
        }
        // Throttle typing to once per 2 s per chat (active=false always passes through)
        if (message.active) {
          const last = lastTypingBroadcast.get(message.chatId) || 0
          if (now - last < 2000) return
          lastTypingBroadcast.set(message.chatId, now)
        } else {
          lastTypingBroadcast.delete(message.chatId)
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
        const messageIds = unread.rows.map((item) => item.id)
        const placeholders = messageIds.map((_, i) => `($${i + 1}, $${messageIds.length + 1})`).join(', ')
        await db.query(
          `INSERT INTO message_reads (message_id, user_id) VALUES ${placeholders}
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [...messageIds, user.id],
        )
        await sendToChatExcept(message.chatId, user.id, {
          type: 'message:read',
          chatId: message.chatId,
          userId: user.id,
          userName: user.name,
          userUsername: user.username,
          messageIds,
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
      logger.error({ err: error.message }, '[ws] message failed')
    }
  })

  socket.on('close', () => {
    lastTypingBroadcast.clear()
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
          logger.error({ err: error.message }, '[presence] disconnect cleanup failed')
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
  socket.on('error', (error) => logger.error({ err: error.message }, '[ws] connection error'))
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
      state.onlineUserIdCache = new Set([
        ...localEntries.map(([userId]) => userId),
        ...(await getOnlineUserIds()),
      ])
    })()
  }, 30000)

  // Scheduled-message publishing and disappearing-message expiry are
  // idempotent SELECT+UPDATE sweeps against Postgres (safe to run from
  // multiple replicas, nothing to lose if a tick is skipped), so they stay
  // as simple interval loops rather than moving into the job_queue table.
  scheduledPublisher = setInterval(() => {
    void publishDueScheduledMessages()
    void deleteExpiredMessages()
  }, 15000)

  // Durable job outbox poller: claims due rows from job_queue (push:deliver
  // jobs enqueued by the message-send routes, plus any future job types)
  // and executes their handler with retry/backoff on failure. See job-queue.js.
  startJobQueuePolling()
}

function stopBackgroundJobs() {
  if (heartbeat) clearInterval(heartbeat)
  if (presenceRefresh) clearInterval(presenceRefresh)
  if (scheduledPublisher) clearInterval(scheduledPublisher)
  heartbeat = null
  presenceRefresh = null
  scheduledPublisher = null
  stopJobQueuePolling()
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
  logger.error({ method: request.method, path: request.path, err: error.message }, '[api] handler error')
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
  state.onlineUserIdCache = new Set(await getOnlineUserIds())
  await migrateDatabase()
  await cleanupExpiredSessions()
  await publishDueScheduledMessages()
  startBackgroundJobs()
  server.listen(config.port, config.host, () => {
    logger.info({ url: `http://${config.host}:${config.port}` }, '[server] listening')
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
    logger.error({ err: error.message }, '[server] startup failed')
    process.exit(1)
  })
}
