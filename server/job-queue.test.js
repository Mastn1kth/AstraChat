import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('job queue', () => {
  let dataDir
  let db
  let jobQueue

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'astrachat-job-queue-test-'))
    process.env.NODE_ENV = 'test'
    process.env.DATA_DIR = dataDir
    process.env.DATABASE_URL = ''
    process.env.ALLOWED_ORIGINS = ''

    const dbModule = await import('./db.js')
    db = dbModule.db
    await dbModule.migrateDatabase()
    jobQueue = await import('./job-queue.js')
  })

  after(async () => {
    await db.close?.()
    await rm(dataDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.query('DELETE FROM job_queue')
  })

  it('enqueues a job as pending and processes it with the registered handler', async () => {
    const seen = []
    jobQueue.registerJobHandler('test:echo', async (payload) => {
      seen.push(payload)
    })

    const jobId = await jobQueue.enqueueJob('test:echo', { hello: 'world' })
    assert.ok(jobId)

    const before_ = await db.query('SELECT status, attempts FROM job_queue WHERE id = $1', [jobId])
    assert.equal(before_.rows[0].status, 'pending')
    assert.equal(before_.rows[0].attempts, 0)

    const processed = await jobQueue.processJobBatch()
    assert.equal(processed, 1)
    assert.deepEqual(seen, [{ hello: 'world' }])

    const after_ = await db.query('SELECT status FROM job_queue WHERE id = $1', [jobId])
    assert.equal(after_.rows[0].status, 'done')
  })

  it('retries a failing job with backoff and eventually marks it dead', async () => {
    let calls = 0
    jobQueue.registerJobHandler('test:always-fails', async () => {
      calls += 1
      throw new Error('boom')
    })

    const jobId = await jobQueue.enqueueJob('test:always-fails', {}, { maxAttempts: 2 })

    await jobQueue.processJobBatch()
    let row = (await db.query('SELECT status, attempts, last_error, run_at FROM job_queue WHERE id = $1', [jobId])).rows[0]
    assert.equal(row.status, 'pending')
    assert.equal(row.attempts, 1)
    assert.match(row.last_error, /boom/)
    assert.ok(new Date(row.run_at).getTime() > Date.now() - 1000)

    // Force run_at into the past so the second attempt is claimable immediately.
    await db.query(`UPDATE job_queue SET run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [jobId])
    await jobQueue.processJobBatch()
    row = (await db.query('SELECT status, attempts FROM job_queue WHERE id = $1', [jobId])).rows[0]
    assert.equal(row.status, 'dead')
    assert.equal(row.attempts, 2)
    assert.equal(calls, 2)
  })

  it('marks a job dead immediately when no handler is registered for its type', async () => {
    const jobId = await jobQueue.enqueueJob('test:unregistered-type', {}, { maxAttempts: 1 })
    await jobQueue.processJobBatch()
    const row = (await db.query('SELECT status, last_error FROM job_queue WHERE id = $1', [jobId])).rows[0]
    assert.equal(row.status, 'dead')
    assert.match(row.last_error, /No handler registered/)
  })

  it('does not claim jobs whose run_at is in the future', async () => {
    jobQueue.registerJobHandler('test:future', async () => {})
    await jobQueue.enqueueJob('test:future', {}, { runAt: new Date(Date.now() + 60_000) })
    const processed = await jobQueue.processJobBatch()
    assert.equal(processed, 0)
  })

  it('reports queue stats grouped by status', async () => {
    jobQueue.registerJobHandler('test:stats-ok', async () => {})
    await jobQueue.enqueueJob('test:stats-ok', {})
    await jobQueue.processJobBatch()
    const stats = await jobQueue.getJobQueueStats()
    assert.equal(stats.done, 1)
  })

  it('computes exponential backoff delay that grows per attempt and is capped', () => {
    const d1 = jobQueue.backoffDelayMs(1)
    const d2 = jobQueue.backoffDelayMs(2)
    const d3 = jobQueue.backoffDelayMs(3)
    assert.ok(d2 > d1)
    assert.ok(d3 > d2)
    assert.ok(jobQueue.backoffDelayMs(20) <= 10 * 60 * 1000)
  })
})
