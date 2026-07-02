// Free, self-hosted, rule-based abuse detection.
//
// This is deliberately NOT a paid ML moderation API — no external account,
// API key, or billing involved. It's a set of cheap heuristics (see
// abuse-heuristics.js) backed by Redis sliding-window counters, wired to run
// as an async job (via job-queue.js) *after* a message is sent or a chat is
// created, so detection latency never blocks the sender's request.
//
// When a heuristic trips, this module inserts a system-generated row into
// the existing `reports` table (source = 'auto') for a human admin to review
// via the existing /admin reports queue. It never auto-bans or auto-deletes
// anything — the human-in-the-loop moderation model is preserved.
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { redis } from './redis.js'
import { enqueueJob, registerJobHandler } from './job-queue.js'
import logger from './logger.js'
import {
  hashMessageText,
  isLinkOnlyMessage,
  evaluateIdenticalMessageFlood,
  evaluateNewRecipientBurst,
  evaluateLinkSpamBurst,
  evaluateNewAccountVelocity,
  describeDecision,
} from './abuse-heuristics.js'

export const ABUSE_CHECK_JOB_TYPE = 'abuse:check'

// Sliding-window sizes. Kept short and deliberately generous on thresholds
// (see abuse-heuristics.js) to keep false positives low: these only ever
// create a report for a human to review, never an automated punishment.
const MESSAGE_FLOOD_WINDOW_SECONDS = 5 * 60
const LINK_SPAM_WINDOW_SECONDS = 10 * 60
const NEW_RECIPIENT_WINDOW_SECONDS = 10 * 60
const NEW_ACCOUNT_WINDOW_SECONDS = 15 * 60

// Don't create more than one auto-report for the same sender+heuristic
// within this window, even if the pattern keeps tripping (e.g. a spam burst
// that lasts several minutes shouldn't create dozens of duplicate reports).
const REPORT_COOLDOWN_SECONDS = 30 * 60

function keyPrefix(part) {
  return `astrachat:abuse:${part}`
}

// In-memory fallback so heuristics still work (best-effort, single-instance
// only) when Redis isn't configured, matching the pattern used elsewhere in
// redis.js (e.g. recordFailedLogin). Not shared across replicas, but this
// mirrors existing precedent rather than silently doing nothing.
const memoryStore = new Map()

function memoryIncrSet(key, member, windowSeconds) {
  const now = Date.now()
  const expiresAt = now + windowSeconds * 1000
  let entry = memoryStore.get(key)
  if (!entry || entry.expiresAt < now) {
    entry = { members: new Map(), expiresAt }
    memoryStore.set(key, entry)
  }
  entry.expiresAt = expiresAt
  entry.members.set(member, expiresAt)
  // Sweep stale members lazily.
  for (const [m, exp] of entry.members) {
    if (exp < now) entry.members.delete(m)
  }
  return entry.members.size
}

function memorySetCooldown(key, windowSeconds) {
  const now = Date.now()
  const existing = memoryStore.get(key)
  if (existing?.expiresAt > now) return false
  memoryStore.set(key, { members: new Map(), expiresAt: now + windowSeconds * 1000 })
  return true
}

// Adds `member` to a Redis set at `key` (creating/refreshing a TTL) and
// returns the resulting cardinality — i.e. distinct-member count within the
// sliding window. Falls back to an in-memory approximation if Redis is down.
async function addToWindowSet(key, member, windowSeconds) {
  if (!redis) return memoryIncrSet(key, member, windowSeconds)
  try {
    const multi = redis.multi()
    multi.sadd(key, member)
    multi.expire(key, windowSeconds)
    multi.scard(key)
    const results = await multi.exec()
    const scard = results?.[2]?.[1]
    return Number(scard || 0)
  } catch (error) {
    logger.error({ err: error.message }, '[abuse-detection] redis window set failed')
    return memoryIncrSet(key, member, windowSeconds)
  }
}

// Atomically claims a cooldown slot: returns true the first time it's called
// for a given key within `windowSeconds`, false on subsequent calls until
// the window elapses. Used to dedupe auto-reports per sender+heuristic.
async function claimCooldown(key, windowSeconds) {
  if (!redis) return memorySetCooldown(key, windowSeconds)
  try {
    const result = await redis.set(key, '1', 'EX', windowSeconds, 'NX')
    return result === 'OK'
  } catch (error) {
    logger.error({ err: error.message }, '[abuse-detection] redis cooldown failed')
    return memorySetCooldown(key, windowSeconds)
  }
}

// ── Public entry points (called from the request path — must stay cheap) ───

// Enqueues an async abuse check after a message has been sent. Intentionally
// fire-and-forget from the caller's perspective: failures here must never
// affect the message-send response.
export async function scheduleMessageAbuseCheck({ senderId, chatId, text }) {
  try {
    await enqueueJob(ABUSE_CHECK_JOB_TYPE, {
      kind: 'message',
      senderId,
      chatId,
      text: String(text || '').slice(0, 4000),
    })
  } catch (error) {
    logger.error({ err: error.message }, '[abuse-detection] failed to enqueue message check')
  }
}

// Enqueues an async abuse check after a new private chat is created with a
// user who wasn't already a contact — feeds heuristic #2 (mass-messaging
// strangers).
export async function scheduleNewChatAbuseCheck({ senderId, targetUserId, wasExistingContact }) {
  if (wasExistingContact) return
  try {
    await enqueueJob(ABUSE_CHECK_JOB_TYPE, {
      kind: 'new_chat',
      senderId,
      targetUserId,
    })
  } catch (error) {
    logger.error({ err: error.message }, '[abuse-detection] failed to enqueue new-chat check')
  }
}

// ── Report creation ──────────────────────────────────────────────────────────

async function createAutoReport({ targetUserId, targetChatId, targetMessageId, decision }) {
  const cooldownKey = keyPrefix(`cooldown:${decision.heuristic}:${targetUserId}`)
  const claimed = await claimCooldown(cooldownKey, REPORT_COOLDOWN_SECONDS)
  if (!claimed) return null

  const reportId = randomUUID()
  await db.query(
    `INSERT INTO reports
      (id, reporter_id, target_user_id, target_message_id, target_chat_id, reason, details, source, heuristic)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, 'auto', $7)`,
    [
      reportId,
      targetUserId,
      targetMessageId || null,
      targetChatId || null,
      'spam',
      describeDecision(decision),
      decision.heuristic,
    ],
  )
  logger.warn(
    { reportId, targetUserId, heuristic: decision.heuristic },
    '[abuse-detection] auto-generated report',
  )
  return reportId
}

// ── Heuristic evaluation (runs inside the job handler, off the request path) ─

async function checkMessage({ senderId, chatId, text }) {
  const textHash = hashMessageText(text)
  const linkOnly = isLinkOnlyMessage(text)

  // Heuristic 1: identical/near-identical text blasted across distinct chats.
  const floodKey = keyPrefix(`msg-hash:${senderId}:${textHash}`)
  const floodChatCount = await addToWindowSet(floodKey, chatId, MESSAGE_FLOOD_WINDOW_SECONDS)
  const floodDecision = evaluateIdenticalMessageFlood(floodChatCount)
  if (floodDecision.triggered) {
    await createAutoReport({ targetUserId: senderId, targetChatId: chatId, decision: floodDecision })
  }

  // Heuristic 3: link-only spam repeated across distinct chats. Only tracked
  // when the message actually is link-only, keeping the false-positive
  // surface limited to that specific shape rather than any link mention.
  if (linkOnly) {
    const linkKey = keyPrefix(`link-spam:${senderId}`)
    const linkChatCount = await addToWindowSet(linkKey, chatId, LINK_SPAM_WINDOW_SECONDS)
    const linkDecision = evaluateLinkSpamBurst(linkChatCount)
    if (linkDecision.triggered) {
      await createAutoReport({ targetUserId: senderId, targetChatId: chatId, decision: linkDecision })
    }
  }

  // Heuristic 4: brand-new account already messaging many distinct chats.
  const userResult = await db.query('SELECT created_at FROM users WHERE id = $1 LIMIT 1', [senderId])
  const createdAt = userResult.rows[0]?.created_at
  if (createdAt) {
    const accountAgeMs = Date.now() - new Date(createdAt).getTime()
    const velocityKey = keyPrefix(`new-account:${senderId}`)
    const velocityChatCount = await addToWindowSet(velocityKey, chatId, NEW_ACCOUNT_WINDOW_SECONDS)
    const velocityDecision = evaluateNewAccountVelocity(accountAgeMs, velocityChatCount)
    if (velocityDecision.triggered) {
      await createAutoReport({ targetUserId: senderId, targetChatId: chatId, decision: velocityDecision })
    }
  }
}

async function checkNewChat({ senderId, targetUserId }) {
  // Heuristic 2: many distinct new (non-contact) recipients in a short window.
  const key = keyPrefix(`new-recipients:${senderId}`)
  const count = await addToWindowSet(key, targetUserId, NEW_RECIPIENT_WINDOW_SECONDS)
  const decision = evaluateNewRecipientBurst(count)
  if (decision.triggered) {
    await createAutoReport({ targetUserId: senderId, decision })
  }
}

registerJobHandler(ABUSE_CHECK_JOB_TYPE, async (payload) => {
  if (payload.kind === 'new_chat') {
    await checkNewChat(payload)
    return
  }
  await checkMessage(payload)
})
