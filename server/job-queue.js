// Durable Postgres-backed job outbox.
//
// Replaces "fire and forget" background work (currently just push delivery)
// with a table-backed queue so that a crash mid-job, or a throwing handler
// (e.g. a slow/failing push provider), doesn't silently drop work. Jobs are
// retried with exponential backoff up to `max_attempts`, after which they're
// marked `dead` for later inspection instead of disappearing.
//
// Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` so this is safe if the
// app ever runs multiple replicas polling the same `job_queue` table.
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import logger from './logger.js'

const handlers = new Map()

// Base delay for exponential backoff between retries, in milliseconds.
const BASE_RETRY_DELAY_MS = 5000
// Cap so a job that's failed many times doesn't get scheduled days out.
const MAX_RETRY_DELAY_MS = 10 * 60 * 1000

export function registerJobHandler(type, handler) {
  handlers.set(type, handler)
}

export function backoffDelayMs(attempts) {
  const delay = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1)
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

export async function enqueueJob(type, payload = {}, { runAt = null, maxAttempts = 5 } = {}) {
  const id = randomUUID()
  await db.query(
    `INSERT INTO job_queue (id, type, payload, run_at, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, NOW()), $5)`,
    [id, type, JSON.stringify(payload ?? {}), runAt ? new Date(runAt).toISOString() : null, maxAttempts],
  )
  return id
}

// Claim up to `limit` due jobs and mark them `processing` in one round trip.
// FOR UPDATE SKIP LOCKED means concurrent pollers (multiple app replicas)
// never block on or double-claim the same row.
async function claimDueJobs(limit) {
  const result = await db.query(
    `UPDATE job_queue
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM job_queue
       WHERE status = 'pending' AND run_at <= NOW()
       ORDER BY run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, type, payload, attempts, max_attempts`,
    [limit],
  )
  return result.rows
}

async function markDone(id) {
  await db.query(
    `UPDATE job_queue SET status = 'done', updated_at = NOW() WHERE id = $1`,
    [id],
  )
}

async function markFailed(job, error) {
  const attempts = job.attempts + 1
  const message = String(error?.message || error || 'Job failed').slice(0, 2000)
  if (attempts >= job.max_attempts) {
    await db.query(
      `UPDATE job_queue
       SET status = 'dead', attempts = $2, last_error = $3, updated_at = NOW()
       WHERE id = $1`,
      [job.id, attempts, message],
    )
    logger.error({ jobId: job.id, type: job.type, attempts }, '[job-queue] job dead after max attempts')
    return
  }
  const delayMs = backoffDelayMs(attempts)
  await db.query(
    `UPDATE job_queue
     SET status = 'pending', attempts = $2, last_error = $3,
         run_at = NOW() + ($4 || ' milliseconds')::interval, updated_at = NOW()
     WHERE id = $1`,
    [job.id, attempts, message, String(delayMs)],
  )
  logger.warn({ jobId: job.id, type: job.type, attempts, delayMs, err: message }, '[job-queue] job failed, will retry')
}

// Parse the payload column back into an object. PGlite returns JSONB columns
// already parsed; the pg driver (Postgres) does too, but guard against a raw
// string just in case a driver/version returns text.
function parsePayload(raw) {
  if (raw == null) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function processJobBatch(limit = 20) {
  const jobs = await claimDueJobs(limit)
  let processed = 0
  for (const job of jobs) {
    processed += 1
    const handler = handlers.get(job.type)
    if (!handler) {
      logger.error({ jobId: job.id, type: job.type }, '[job-queue] no handler registered for job type')
      await markFailed(job, new Error(`No handler registered for job type "${job.type}"`))
      continue
    }
    try {
      await handler(parsePayload(job.payload), job)
      await markDone(job.id)
    } catch (error) {
      await markFailed(job, error)
    }
  }
  return processed
}

let polling = false
let pollTimer = null

export function startJobQueuePolling(intervalMs = 5000) {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void (async () => {
      if (polling) return
      polling = true
      try {
        await processJobBatch()
      } catch (error) {
        logger.error({ err: error.message }, '[job-queue] poll failed')
      } finally {
        polling = false
      }
    })()
  }, intervalMs)
}

export function stopJobQueuePolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  polling = false
}

export async function getJobQueueStats() {
  const result = await db.query(
    `SELECT status, COUNT(*)::integer AS count FROM job_queue GROUP BY status`,
  )
  const stats = { pending: 0, processing: 0, done: 0, dead: 0 }
  for (const row of result.rows) {
    stats[row.status] = row.count
  }
  return stats
}
