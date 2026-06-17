import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { config } from './config.js'
import logger from './logger.js'

export const instanceId = randomUUID()
const redisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 300, 5000),
}

export const redis = config.redisUrl ? new Redis(config.redisUrl, redisOptions) : null

const subscriber = config.redisUrl ? new Redis(config.redisUrl, redisOptions) : null

const WS_CHANNEL = 'astrachat:ws'
const USER_SET_KEY = 'astrachat:presence:users'
const PRESENCE_TTL_SECONDS = 90
let socketMessageHandler = null

function presenceKey(userId) {
  return `astrachat:presence:user:${userId}:instance:${instanceId}`
}

function sessionKey(tokenHash) {
  return `astrachat:session:${tokenHash}`
}

async function safeRedis(operation, fallback = null) {
  if (!redis) return fallback
  try {
    return await operation(redis)
  } catch (error) {
    logger.error({ err: error.message }, '[redis] operation failed')
    return fallback
  }
}

export async function initRedis() {
  if (!redis) return
  await Promise.all([redis.connect(), subscriber.connect()])
  await subscriber.subscribe(WS_CHANNEL)
  subscriber.on('message', (_channel, raw) => {
    if (!socketMessageHandler) return
    try {
      const message = JSON.parse(raw)
      if (message.origin === instanceId) return
      socketMessageHandler(message)
    } catch (error) {
      logger.error({ err: error.message }, '[redis] pubsub message failed')
    }
  })
}

export function onSocketMessage(handler) {
  socketMessageHandler = handler
}

export async function publishSocketMessage(message) {
  await safeRedis((client) =>
    client.publish(
      WS_CHANNEL,
      JSON.stringify({
        ...message,
        origin: instanceId,
      }),
    ),
  )
}

export async function addPresence(userId, localCount) {
  await safeRedis(async (client) => {
    const key = presenceKey(userId)
    await client
      .multi()
      .set(key, String(localCount), 'EX', PRESENCE_TTL_SECONDS)
      .sadd(USER_SET_KEY, userId)
      .exec()
  })
}

export async function removePresence(userId, localCount) {
  await safeRedis(async (client) => {
    const key = presenceKey(userId)
    if (localCount > 0) {
      await client.set(key, String(localCount), 'EX', PRESENCE_TTL_SECONDS)
      return
    }
    await client.del(key)
    const keys = await scanKeys(client, `astrachat:presence:user:${userId}:instance:*`)
    if (!keys.length) await client.srem(USER_SET_KEY, userId)
  })
}

export async function refreshPresence(entries) {
  await safeRedis(async (client) => {
    const multi = client.multi()
    for (const [userId, count] of entries) {
      multi.set(presenceKey(userId), String(count), 'EX', PRESENCE_TTL_SECONDS)
      multi.sadd(USER_SET_KEY, userId)
    }
    await multi.exec()
  })
}

async function scanKeys(client, pattern) {
  const found = []
  let cursor = '0'
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = nextCursor
    found.push(...keys)
  } while (cursor !== '0')
  return found
}

export async function isUserOnline(userId) {
  return safeRedis(async (client) => {
    const keys = await scanKeys(client, `astrachat:presence:user:${userId}:instance:*`)
    return keys.length > 0
  }, false)
}

export async function getOnlineUserIds() {
  return safeRedis(async (client) => {
    const users = await client.smembers(USER_SET_KEY)
    if (!users.length) return []
    const online = []
    for (const userId of users) {
      const keys = await scanKeys(client, `astrachat:presence:user:${userId}:instance:*`)
      if (keys.length) {
        online.push(userId)
      } else {
        await client.srem(USER_SET_KEY, userId)
      }
    }
    return online
  }, [])
}

export async function closeRedis() {
  if (!redis) return
  await Promise.allSettled([subscriber.quit(), redis.quit()])
}

export async function checkRedis() {
  if (!redis) return 'disabled'
  await redis.ping()
  return 'ready'
}

export async function cacheSession(tokenHash, userId, expiresAt) {
  const ttlSeconds = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
  await safeRedis((client) => client.set(sessionKey(tokenHash), userId, 'EX', ttlSeconds))
}

export async function getCachedSessionUserId(tokenHash) {
  return safeRedis((client) => client.get(sessionKey(tokenHash)), null)
}

export async function deleteCachedSession(tokenHash) {
  await safeRedis((client) => client.del(sessionKey(tokenHash)))
}

export async function deleteCachedSessions(tokenHashes) {
  const hashes = tokenHashes.filter(Boolean)
  if (!hashes.length) return
  await safeRedis((client) => client.del(...hashes.map(sessionKey)))
}

// Brute-force protection: track failed login attempts per login handle.
// In-memory fallback when Redis is unavailable.
const inMemoryLoginAttempts = new Map()

function loginAttemptKey(login) {
  return `astrachat:login:fail:${login.toLowerCase()}`
}

export async function recordFailedLogin(login) {
  const key = loginAttemptKey(login)
  if (redis) {
    await safeRedis(async (client) => {
      const count = await client.incr(key)
      if (count === 1) await client.expire(key, 900) // 15 min window
    })
  } else {
    const entry = inMemoryLoginAttempts.get(key) || { count: 0, resetAt: Date.now() + 900_000 }
    if (Date.now() > entry.resetAt) { entry.count = 0; entry.resetAt = Date.now() + 900_000 }
    entry.count++
    inMemoryLoginAttempts.set(key, entry)
  }
}

export async function clearFailedLogins(login) {
  const key = loginAttemptKey(login)
  if (redis) {
    await safeRedis((client) => client.del(key))
  } else {
    inMemoryLoginAttempts.delete(key)
  }
}

export async function isLoginLocked(login) {
  const key = loginAttemptKey(login)
  if (redis) {
    return safeRedis(async (client) => {
      const count = await client.get(key)
      return Number(count || 0) >= 10
    }, false)
  }
  const entry = inMemoryLoginAttempts.get(key)
  if (!entry) return false
  if (Date.now() > entry.resetAt) { inMemoryLoginAttempts.delete(key); return false }
  return entry.count >= 10
}
