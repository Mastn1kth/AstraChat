import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptMessage } from '../crypto.js'
import { storiesLimiter } from '../limiters.js'
import { sendToChatExcept, sendToUser } from '../socket-manager.js'
import { enqueueOfflineMessagePushes } from '../push-service.js'
import { parseBody, storyReplySchema } from '../validation.js'
import {
  ensureChatSettings,
  hasBlockBetween,
  isDatabaseTrue,
  normalizeSearchText,
  publicChatSettings,
} from '../server-helpers.js'

const router = Router()

async function findOrCreatePrivateChat(tx, firstUserId, secondUserId) {
  const existing = await tx.query(
    `SELECT c.id
     FROM chats c
     JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
     JOIN chat_members theirs ON theirs.chat_id = c.id AND theirs.user_id = $2
     WHERE c.type = 'private'
       AND (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) = 2
     LIMIT 1`,
    [firstUserId, secondUserId],
  )
  if (existing.rows[0]) return { chatId: existing.rows[0].id, created: false }

  const chatId = randomUUID()
  await tx.query(
    'INSERT INTO chats (id, type, title, created_by) VALUES ($1, $2, $3, $4)',
    [chatId, 'private', '', firstUserId],
  )
  for (const userId of [firstUserId, secondUserId]) {
    await tx.query(
      'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
      [chatId, userId, userId === firstUserId ? 'owner' : 'member'],
    )
    await tx.query(
      `INSERT INTO chat_user_settings (chat_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [chatId, userId],
    )
  }
  return { chatId, created: true }
}

// ── Cloud key backup ──────────────────────────────────────────────────────────
// Stores an opaque passphrase-encrypted blob; the server cannot read keys.

router.get('/api/keys/backup', requireAuth, async (request, response) => {
  const result = await db.query('SELECT payload, updated_at FROM key_backups WHERE user_id = $1', [
    request.user.id,
  ])
  if (!result.rows.length) {
    response.status(404).json({ error: 'No cloud key backup' })
    return
  }
  response.json({ payload: result.rows[0].payload, updatedAt: result.rows[0].updated_at })
})

router.put('/api/keys/backup', requireAuth, async (request, response) => {
  const payload = String(request.body?.payload || '')
  if (!payload || payload.length > 32768) {
    response.status(400).json({ error: 'Invalid key backup payload' })
    return
  }
  await db.query(
    `INSERT INTO key_backups (user_id, payload, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET payload = $2, updated_at = NOW()`,
    [request.user.id, payload],
  )
  response.json({ ok: true })
})

router.delete('/api/keys/backup', requireAuth, async (request, response) => {
  await db.query('DELETE FROM key_backups WHERE user_id = $1', [request.user.id])
  response.json({ ok: true })
})

// ── Sticker packs ─────────────────────────────────────────────────────────────

function publicStickerPack(pack, items = [], installed = false) {
  return {
    id: pack.id,
    title: pack.title,
    icon: pack.icon,
    author: pack.author || '',
    isDefault: Boolean(pack.is_default),
    installed,
    stickers: items.map((item) => ({
      id: item.id,
      packId: item.pack_id,
      emoji: item.emoji,
      title: item.title,
      lottieUrl: item.lottie_url || '',
    })),
  }
}

router.get('/api/stickers/packs', requireAuth, async (request, response) => {
  const packsResult = await db.query(
    `SELECT sp.*, (usp.user_id IS NOT NULL) AS installed
     FROM sticker_packs sp
     LEFT JOIN user_sticker_packs usp ON usp.pack_id = sp.id AND usp.user_id = $1
     ORDER BY sp.sort_order, sp.title`,
    [request.user.id],
  )
  const itemsResult = await db.query(
    'SELECT pack_id, id, emoji, title, lottie_url FROM sticker_pack_items ORDER BY pack_id, sort_order',
  )
  const itemsByPack = new Map()
  for (const item of itemsResult.rows) {
    if (!itemsByPack.has(item.pack_id)) itemsByPack.set(item.pack_id, [])
    itemsByPack.get(item.pack_id).push(item)
  }
  const packs = packsResult.rows.map((pack) =>
    publicStickerPack(pack, itemsByPack.get(pack.id) || [], Boolean(pack.installed)),
  )
  response.json({ packs })
})

router.get('/api/stickers/packs/installed', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT sp.*
     FROM user_sticker_packs usp
     JOIN sticker_packs sp ON sp.id = usp.pack_id
     WHERE usp.user_id = $1
     ORDER BY usp.sort_order, usp.installed_at`,
    [request.user.id],
  )
  if (!result.rows.length) {
    response.json({ packs: [] })
    return
  }
  const packIds = result.rows.map((r) => r.id)
  const itemsResult = await db.query(
    `SELECT pack_id, id, emoji, title, lottie_url FROM sticker_pack_items
     WHERE pack_id = ANY($1)
     ORDER BY pack_id, sort_order`,
    [packIds],
  )
  const itemsByPack = new Map()
  for (const item of itemsResult.rows) {
    if (!itemsByPack.has(item.pack_id)) itemsByPack.set(item.pack_id, [])
    itemsByPack.get(item.pack_id).push(item)
  }
  const packs = result.rows.map((pack) =>
    publicStickerPack(pack, itemsByPack.get(pack.id) || [], true),
  )
  response.json({ packs })
})

router.post('/api/stickers/packs/:packId/install', requireAuth, async (request, response) => {
  const { packId } = request.params
  const pack = await db.query('SELECT id FROM sticker_packs WHERE id = $1', [packId])
  if (!pack.rows.length) {
    response.status(404).json({ error: 'Pack not found' })
    return
  }
  const countResult = await db.query(
    'SELECT COUNT(*) AS n FROM user_sticker_packs WHERE user_id = $1',
    [request.user.id],
  )
  await db.query(
    `INSERT INTO user_sticker_packs (user_id, pack_id, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, pack_id) DO NOTHING`,
    [request.user.id, packId, Number(countResult.rows[0].n)],
  )
  response.status(201).json({ ok: true })
})

router.delete('/api/stickers/packs/:packId/install', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_sticker_packs WHERE user_id = $1 AND pack_id = $2',
    [request.user.id, request.params.packId],
  )
  response.json({ ok: true })
})

// ── Custom emoji ──────────────────────────────────────────────────────────────

router.get('/api/custom-emoji/packs', requireAuth, async (request, response) => {
  const [packs, items, installed] = await Promise.all([
    db.query('SELECT * FROM custom_emoji_packs ORDER BY sort_order'),
    db.query('SELECT pack_id, shortcode, image_url, title FROM custom_emoji_items ORDER BY pack_id, sort_order'),
    db.query('SELECT pack_id FROM user_custom_emoji_packs WHERE user_id = $1', [request.user.id]),
  ])
  const installedSet = new Set(installed.rows.map((r) => r.pack_id))
  const itemsByPack = {}
  for (const item of items.rows) {
    if (!itemsByPack[item.pack_id]) itemsByPack[item.pack_id] = []
    itemsByPack[item.pack_id].push({ shortcode: item.shortcode, imageUrl: item.image_url, title: item.title })
  }
  response.json({
    packs: packs.rows.map((p) => ({
      id: p.id, title: p.title, thumbnailUrl: p.thumbnail_url, author: p.author,
      installed: installedSet.has(p.id), isDefault: p.is_default,
      emoji: itemsByPack[p.id] || [],
    })),
  })
})

router.get('/api/custom-emoji/packs/installed', requireAuth, async (request, response) => {
  const [packs, items] = await Promise.all([
    db.query(
      `SELECT cep.* FROM user_custom_emoji_packs ucep
       JOIN custom_emoji_packs cep ON cep.id = ucep.pack_id
       WHERE ucep.user_id = $1 ORDER BY ucep.installed_at`,
      [request.user.id],
    ),
    db.query(
      `SELECT cei.pack_id, cei.shortcode, cei.image_url, cei.title
       FROM custom_emoji_items cei
       WHERE cei.pack_id IN (
         SELECT pack_id FROM user_custom_emoji_packs WHERE user_id = $1
       ) ORDER BY cei.pack_id, cei.sort_order`,
      [request.user.id],
    ),
  ])
  const itemsByPack = {}
  for (const item of items.rows) {
    if (!itemsByPack[item.pack_id]) itemsByPack[item.pack_id] = []
    itemsByPack[item.pack_id].push({ shortcode: item.shortcode, imageUrl: item.image_url, title: item.title })
  }
  response.json({
    packs: packs.rows.map((p) => ({
      id: p.id, title: p.title, thumbnailUrl: p.thumbnail_url, author: p.author,
      emoji: itemsByPack[p.id] || [],
    })),
  })
})

router.post('/api/custom-emoji/packs/:packId/install', requireAuth, async (request, response) => {
  const { packId } = request.params
  const pack = await db.query('SELECT id FROM custom_emoji_packs WHERE id = $1', [packId])
  if (!pack.rows.length) return response.status(404).json({ error: 'Pack not found' })
  await db.query(
    'INSERT INTO user_custom_emoji_packs (user_id, pack_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [request.user.id, packId],
  )
  response.status(201).json({ ok: true })
})

router.delete('/api/custom-emoji/packs/:packId/install', requireAuth, async (request, response) => {
  await db.query(
    'DELETE FROM user_custom_emoji_packs WHERE user_id = $1 AND pack_id = $2',
    [request.user.id, request.params.packId],
  )
  response.json({ ok: true })
})

// ── Stories ───────────────────────────────────────────────────────────────────

function parseStoryMentions(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function publicStory(story, viewerIds = [], viewedByMe = false, reactions = {}, myReaction = null) {
  const mentions = parseStoryMentions(story.mentions)
  return {
    id: story.id,
    userId: story.user_id,
    text: story.text,
    bgColor: story.bg_color,
    mediaUrl: story.media_url || null,
    mediaKind: story.media_kind || null,
    privacy: story.privacy,
    mentions: mentions.filter(Boolean),
    highlighted: isDatabaseTrue(story.is_highlight),
    expiresAt: story.expires_at,
    createdAt: story.created_at,
    viewCount: viewerIds.length,
    viewedByMe,
    reactions,
    myReaction,
  }
}

function extractStoryMentions(text) {
  return [...new Set(String(text || '')
    .match(/(^|[^\w])@([a-zA-Z0-9_]{3,32})/g)
    ?.map((value) => value.replace(/^[^@]*@/, '').toLowerCase()) || [])]
    .slice(0, 20)
}

router.get('/api/stories', requireAuth, async (request, response) => {
  const userId = request.user.id
  // Return own stories + stories of contacts + groups you belong to
  const result = await db.query(
    `SELECT s.*
     FROM stories s
     WHERE (s.expires_at > NOW() OR s.is_highlight = TRUE)
       AND (
         s.user_id = $1
         OR s.user_id IN (
           SELECT contact_user_id FROM user_contacts WHERE owner_id = $1
           UNION
           SELECT owner_id FROM user_contacts WHERE contact_user_id = $1
           UNION
           SELECT cm2.user_id FROM chat_members cm1
           JOIN chat_members cm2 ON cm2.chat_id = cm1.chat_id
           WHERE cm1.user_id = $1 AND cm2.user_id <> $1
         )
       )
     ORDER BY s.user_id, s.created_at DESC`,
    [userId],
  )

  if (!result.rows.length) {
    response.json({ stories: [] })
    return
  }

  const storyIds = result.rows.map((r) => r.id)
  const viewsResult = await db.query(
    `SELECT story_id, viewer_id FROM story_views WHERE story_id = ANY($1)`,
    [storyIds],
  )
  const viewersByStory = new Map()
  const viewedByMeSet = new Set()
  for (const row of viewsResult.rows) {
    if (!viewersByStory.has(row.story_id)) viewersByStory.set(row.story_id, [])
    viewersByStory.get(row.story_id).push(row.viewer_id)
    if (row.viewer_id === userId) viewedByMeSet.add(row.story_id)
  }

  const reactionsResult = await db.query(
    `SELECT story_id, user_id, emoji FROM story_reactions WHERE story_id = ANY($1)`,
    [storyIds],
  )
  const reactionsByStory = new Map()
  const myReactionByStory = new Map()
  for (const row of reactionsResult.rows) {
    const agg = reactionsByStory.get(row.story_id) || {}
    agg[row.emoji] = (agg[row.emoji] || 0) + 1
    reactionsByStory.set(row.story_id, agg)
    if (row.user_id === userId) myReactionByStory.set(row.story_id, row.emoji)
  }

  const userIds = [...new Set(result.rows.map((r) => r.user_id))]
  const usersResult = await db.query(
    `SELECT id, name, username, avatar FROM users WHERE id = ANY($1)`,
    [userIds],
  )
  const usersById = new Map(usersResult.rows.map((u) => [u.id, u]))

  const grouped = []
  const seen = new Map()
  for (const story of result.rows) {
    const user = usersById.get(story.user_id) || {}
    const entry = seen.get(story.user_id)
    const storyPublic = publicStory(
      story,
      viewersByStory.get(story.id) || [],
      viewedByMeSet.has(story.id),
      reactionsByStory.get(story.id) || {},
      myReactionByStory.get(story.id) || null,
    )
    if (entry) {
      entry.stories.push(storyPublic)
    } else {
      const group = {
        userId: story.user_id,
        name: user.name || '',
        username: user.username || '',
        avatar: user.avatar || null,
        stories: [storyPublic],
        hasUnviewed: false,
      }
      seen.set(story.user_id, group)
      grouped.push(group)
    }
  }
  for (const group of grouped) {
    group.hasUnviewed = group.stories.some((s) => !s.viewedByMe && s.userId !== userId)
  }

  response.json({ stories: grouped })
})

router.post('/api/stories', requireAuth, storiesLimiter, async (request, response) => {
  const text = String(request.body?.text || '').trim().slice(0, 1000)
  const bgColor = String(request.body?.bgColor || '#7c3aed').slice(0, 20)
  const highlighted = request.body?.highlighted === true
  const mentions = extractStoryMentions(text)
  const privacy = ['contacts', 'everyone', 'closeFriends'].includes(request.body?.privacy)
    ? request.body.privacy
    : 'contacts'
  if (!text) {
    response.status(400).json({ error: 'Story text is required' })
    return
  }
  const id = randomUUID()
  const result = await db.query(
    `INSERT INTO stories (id, user_id, text, bg_color, privacy, mentions, is_highlight)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, request.user.id, text, bgColor, privacy, JSON.stringify(mentions), highlighted],
  )
  const story = publicStory(result.rows[0], [], false)
  response.status(201).json({ story })
})

router.delete('/api/stories/:storyId', requireAuth, async (request, response) => {
  const result = await db.query(
    'DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id',
    [request.params.storyId, request.user.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  response.json({ ok: true })
})

router.post('/api/stories/:storyId/view', requireAuth, async (request, response) => {
  const storyResult = await db.query(
    'SELECT id, user_id FROM stories WHERE id = $1 AND (expires_at > NOW() OR is_highlight = TRUE)',
    [request.params.storyId],
  )
  if (!storyResult.rows.length) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  if (storyResult.rows[0].user_id === request.user.id) {
    response.json({ ok: true })
    return
  }
  await db.query(
    `INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [request.params.storyId, request.user.id],
  )
  response.json({ ok: true })
})

router.post('/api/stories/:storyId/react', requireAuth, async (request, response) => {
  const emoji = String(request.body?.emoji || '').trim()
  const storyResult = await db.query(
    'SELECT id, user_id FROM stories WHERE id = $1 AND (expires_at > NOW() OR is_highlight = TRUE)',
    [request.params.storyId],
  )
  if (!storyResult.rows.length) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  if (emoji) {
    await db.query(
      `INSERT INTO story_reactions (story_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (story_id, user_id) DO UPDATE SET emoji = $3, created_at = NOW()`,
      [request.params.storyId, request.user.id, emoji],
    )
  } else {
    await db.query(
      'DELETE FROM story_reactions WHERE story_id = $1 AND user_id = $2',
      [request.params.storyId, request.user.id],
    )
  }
  const aggResult = await db.query(
    `SELECT emoji, COUNT(*)::integer AS count FROM story_reactions
     WHERE story_id = $1 GROUP BY emoji`,
    [request.params.storyId],
  )
  const reactions = Object.fromEntries(aggResult.rows.map((r) => [r.emoji, r.count]))
  response.json({ ok: true, reactions, myReaction: emoji || null })
})

router.post('/api/stories/:storyId/reply', requireAuth, async (request, response) => {
  const input = parseBody(storyReplySchema, request.body)
  const storyResult = await db.query(
    `SELECT s.id, s.user_id, s.text, s.expires_at, u.name, u.username
     FROM stories s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND (s.expires_at > NOW() OR s.is_highlight = TRUE)
     LIMIT 1`,
    [request.params.storyId],
  )
  const story = storyResult.rows[0]
  if (!story) {
    response.status(404).json({ error: 'Story not found' })
    return
  }
  if (story.user_id === request.user.id) {
    response.status(400).json({ error: 'Cannot reply to your own story' })
    return
  }
  if (await hasBlockBetween(request.user.id, story.user_id)) {
    response.status(403).json({ error: 'This user is not available' })
    return
  }

  const messageId = randomUUID()
  const sentAt = new Date().toISOString()
  const encrypted = encryptMessage(input.text)
  const storyPreview = {
    title: 'Story reply',
    description: story.text || 'Story',
    site: story.name || story.username || 'Story',
  }
  let chatId = null
  let createdChat = false

  await db.transaction(async (tx) => {
    const chat = await findOrCreatePrivateChat(tx, request.user.id, story.user_id)
    chatId = chat.chatId
    createdChat = chat.created
    await tx.query(
      `INSERT INTO messages
        (id, chat_id, sender_id, ciphertext, iv, auth_tag, encryption_version,
         search_text, sent_at, link_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        messageId,
        chatId,
        request.user.id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.version,
        normalizeSearchText(`${input.text} story ${story.text || ''}`),
        sentAt,
        JSON.stringify(storyPreview),
      ],
    )
    await tx.query(
      'UPDATE chat_members SET last_message_at = NOW() WHERE chat_id = $1 AND user_id = $2',
      [chatId, request.user.id],
    )
    await tx.query(
      `INSERT INTO story_views (story_id, viewer_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [story.id, request.user.id],
    )
  })

  const publicMessage = {
    id: messageId,
    chatId,
    senderId: request.user.id,
    text: input.text,
    createdAt: sentAt,
    topicId: null,
    replyToId: null,
    forwarded: false,
    forwardedFromMessageId: null,
    forwardedFromChatId: null,
    silent: false,
    scheduledAt: null,
    sentAt,
    reactions: {},
    status: 'sent',
    media: null,
    poll: null,
    linkPreview: storyPreview,
  }

  const recipientDeliveries = await sendToChatExcept(chatId, request.user.id, {
    type: 'message:new',
    message: publicMessage,
  })
  if (recipientDeliveries > 0) publicMessage.status = 'delivered'
  await sendToUser(request.user.id, {
    type: 'message:delivered',
    chatId,
    messageId,
    delivered: recipientDeliveries > 0,
  })
  await enqueueOfflineMessagePushes({
    chatId,
    sender: request.user,
    message: publicMessage,
    searchText: input.text,
  })

  const settings = await ensureChatSettings(chatId, request.user.id)
  response.status(201).json({
    ok: true,
    chatId,
    createdChat,
    chat: {
      id: chatId,
      type: 'private',
      title: '',
      memberIds: [request.user.id, story.user_id],
      settings: publicChatSettings(settings),
    },
    message: publicMessage,
  })
})

export default router
