import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { wallLimiter } from '../limiters.js'
import { publicWallMessage } from '../server-helpers.js'
import { broadcast } from '../socket-manager.js'

const router = Router()

// A public, fully anonymous stream of short notes. Nothing links a
// wall message back to its author — by design, neither in the DB nor in the API.
const WALL_MESSAGE_MAX_LENGTH = 120

function stripControlCharacters(value) {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0)
    return code <= 0x1f || code === 0x7f ? ' ' : char
  }).join('')
}

router.get('/api/wall', requireAuth, async (_request, response) => {
  const result = await db.query(
    `SELECT id, text, hue, created_at
     FROM wall_messages
     ORDER BY created_at DESC
     LIMIT 60`,
  )
  response.json({ messages: result.rows.map(publicWallMessage).reverse() })
})

router.post('/api/wall', requireAuth, wallLimiter, async (request, response) => {
  const text = stripControlCharacters(String(request.body?.text || ''))
    .replace(/\s+/gu, ' ')
    .trim()
  if (text.length < 2 || text.length > WALL_MESSAGE_MAX_LENGTH) {
    response.status(400).json({
      error: `Wall message must be 2-${WALL_MESSAGE_MAX_LENGTH} characters long`,
    })
    return
  }
  if (/https?:\/\/|www\./iu.test(text)) {
    response.status(400).json({ error: 'Links are not allowed on the wall' })
    return
  }

  // Spam heuristics: shouting, keyboard mashing, copy-paste floods.
  const letters = text.match(/\p{L}/gu) || []
  const upper = text.match(/\p{Lu}/gu) || []
  if (letters.length >= 12 && upper.length / letters.length > 0.8) {
    response.status(400).json({ error: 'Too much shouting for the wall' })
    return
  }
  if (/(.)\1{6,}/u.test(text)) {
    response.status(400).json({ error: 'Message looks like spam' })
    return
  }
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const duplicate = await db.query(
    `SELECT 1 FROM wall_messages
     WHERE created_at > NOW() - INTERVAL '15 minutes'
       AND lower(regexp_replace(text, '[^[:alnum:]]+', ' ', 'g')) = $1
     LIMIT 1`,
    [normalized],
  )
  if (duplicate.rows.length) {
    response.status(409).json({ error: 'The wall already heard that recently' })
    return
  }

  const hue = Number.isInteger(request.body?.hue)
    ? Math.min(359, Math.max(0, request.body.hue))
    : Math.floor(Math.random() * 360)
  const id = randomUUID()
  const result = await db.query(
    `INSERT INTO wall_messages (id, text, hue)
     VALUES ($1, $2, $3)
     RETURNING id, text, hue, created_at`,
    [id, text, hue],
  )
  const message = publicWallMessage(result.rows[0])
  void broadcast({ type: 'wall:new', message })
  response.status(201).json({ message })
})

export default router
