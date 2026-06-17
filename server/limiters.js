import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { redis } from './redis.js'

function redisStore(prefix) {
  if (!redis) return undefined
  return new RedisStore({ prefix, sendCommand: (...args) => redis.call(...args) })
}

// Disable rate limiting under the test runner so suites that exercise many
// auth/API calls in a tight loop don't trip the limits.
const skipInTests = () => process.env.NODE_ENV === 'test'

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTests,
  store: redisStore('rl:auth:'),
})

export const wallLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  skip: skipInTests,
  store: redisStore('rl:wall:'),
})

export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  skip: skipInTests,
  store: redisStore('rl:msg:'),
})

export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  skip: skipInTests,
  store: redisStore('rl:upload:'),
})

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  skip: skipInTests,
  store: redisStore('rl:api:'),
})

export const storiesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => request.user?.id || ipKeyGenerator(request.ip),
  skip: skipInTests,
  store: redisStore('rl:stories:'),
})
