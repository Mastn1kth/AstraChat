import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptMessage } from '../crypto.js'
import {
  banMemberSchema,
  chatFolderChatSettingsSchema,
  chatFolderSchema,
  chatModerationSettingsSchema,
  chatSettingsSchema,
  inviteLinkSchema,
  joinInviteSchema,
  markReadSchema,
  memberPermissionsSchema,
  memberRoleSchema,
  pinMessageSchema,
  createChatSchema,
  editMessageSchema,
  messageSchema,
  parseBody,
  pollVoteSchema,
  reactionSchema,
  reviewJoinRequestSchema,
  telegramImportSchema,
  topicSchema,
  updateTopicSchema,
  updateChatFolderSchema,
} from '../validation.js'
import {
  isDatabaseTrue, parseJsonObject,
  normalizeSearchText, normalizeSearchQuery, normalizeFolderTitle,
  publicUser, publicChatSettings,
  isChatMember, requireChatMemberRow, isBannedFromChat, hasBlockBetween,
  requireUnblockedPrivateChat,
  ensureChatSettings, validateMemberChatIds,
  appendAdminLog, getReactionCounts,
  publicChatPermissions, hasPermission, requirePermission, assertCanSendToChat,
  INDEFINITE_MUTE_UNTIL, MESSAGE_SELECT_COLUMNS, visibleMessageFilter,
  publicMessagesFromRows,
} from '../server-helpers.js'
import { sendToUser, sendToChat, sendToChatExcept } from '../socket-manager.js'
import { sendOfflineMessagePushes } from '../push-service.js'
import { publishScheduledMessage } from '../scheduled.js'
import { messageLimiter, apiLimiter } from '../limiters.js'

const router = Router()

// ── System message helper ─────────────────────────────────────────────────────

async function insertSystemMessage(chatId, systemType, systemData = {}) {
  const result = await db.query(
    `INSERT INTO messages (id, chat_id, sender_id, is_system, system_type, system_data, sent_at, created_at)
     VALUES (gen_random_uuid(), $1, NULL, TRUE, $2, $3, NOW(), NOW())
     RETURNING id`,
    [chatId, systemType, JSON.stringify(systemData)],
  )
  const msgId = result.rows[0]?.id
  if (msgId) {
    sendToChat(chatId, {
      type: 'message:new',
      message: {
        id: msgId,
        chatId,
        isSystem: true,
        systemType,
        systemData,
        sentAt: new Date().toISOString(),
        senderId: null,
        text: '',
        readBy: [],
      },
    })
  }
}

// ── System chat folders ───────────────────────────────────────────────────────

const SYSTEM_FOLDERS = [
  { id: 'all', title: 'All', filter: 'all' },
  { id: 'unread', title: 'Unread', filter: 'unread' },
  { id: 'personal', title: 'Personal', filter: 'private' },
  { id: 'groups', title: 'Groups', filter: 'group' },
  { id: 'channels', title: 'Channels', filter: 'channel' },
  { id: 'archived', title: 'Archived', filter: 'archived' },
]

// ── Chats ─────────────────────────────────────────────────────────────────────

router.get('/api/chats', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT c.id, c.type, c.title, c.created_at, c.pinned_message_id,
            c.slow_mode_seconds, c.default_permissions, c.linked_group_id, c.auto_delete_seconds,
            cm.role, cm.permissions,
            cus.pinned, cus.pinned_at, cus.muted_until, cus.archived, cus.archived_at,
            cus.push_mode,
            cm.last_read_message_id,
            (SELECT COUNT(*) FROM messages m2
             WHERE m2.chat_id = c.id
               AND m2.sender_id != cm.user_id
               AND m2.deleted_at IS NULL
               AND m2.sent_at IS NOT NULL
               AND m2.is_system = FALSE
               AND (cm.last_read_message_id IS NULL
                    OR m2.sent_at > (SELECT sent_at FROM messages WHERE id = cm.last_read_message_id LIMIT 1))
            ) AS unread_count
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     LEFT JOIN chat_user_settings cus
       ON cus.chat_id = c.id AND cus.user_id = cm.user_id
     WHERE cm.user_id = $1
     ORDER BY COALESCE(cus.pinned_at, c.created_at) DESC, c.created_at DESC`,
    [request.user.id],
  )

  const chats = await Promise.all(
    result.rows.map(async (chat) => {
      const members = await db.query(
        `SELECT u.id, u.login, u.username, u.phone, u.name, u.bio, u.status, u.avatar, u.last_seen_at,
                u.encryption_public_key, cm.role,
                EXISTS (
                  SELECT 1 FROM user_blocks ub
                  WHERE ub.blocker_id = $2 AND ub.blocked_id = u.id
                ) AS blocked_by_me,
                EXISTS (
                  SELECT 1 FROM user_blocks ub
                  WHERE ub.blocker_id = u.id AND ub.blocked_id = $2
                ) AS blocked_me
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = $1
         ORDER BY cm.joined_at`,
        [chat.id, request.user.id],
      )
      return {
        ...chat,
        settings: publicChatSettings(chat),
        pinnedMessageId: chat.pinned_message_id || null,
        linkedGroupId: chat.linked_group_id || null,
        slowModeSeconds: Number(chat.slow_mode_seconds || 0),
        permissions: publicChatPermissions(chat),
        unreadCount: Number(chat.unread_count || 0),
        members: members.rows.map((member) => ({
          ...publicUser(member),
          role: member.role,
        })),
      }
    }),
  )

  response.json({ chats })
})

router.post('/api/chats', requireAuth, async (request, response) => {
  const input = parseBody(createChatSchema, request.body)
  const memberIds = [...new Set([request.user.id, ...input.memberIds])]
  if (input.type === 'private' && memberIds.length !== 2) {
    response.status(400).json({ error: 'Private chat requires exactly one other member' })
    return
  }

  if (input.type === 'private') {
    const targetUserId = input.memberIds[0]
    if (await hasBlockBetween(request.user.id, targetUserId)) {
      response.status(403).json({ error: 'Private chat is blocked' })
      return
    }
    const existing = await db.query(
      `SELECT c.id
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       JOIN chat_members theirs ON theirs.chat_id = c.id AND theirs.user_id = $2
       WHERE c.type = 'private'
         AND (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) = 2
       LIMIT 1`,
      [request.user.id, targetUserId],
    )
    if (existing.rows[0]) {
      const settings = await ensureChatSettings(existing.rows[0].id, request.user.id)
      response.json({
        chat: {
          id: existing.rows[0].id,
          ...input,
          settings: publicChatSettings(settings),
        },
        existing: true,
      })
      return
    }
  }

  const validUsers = await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [memberIds])
  if (validUsers.rows.length !== memberIds.length) {
    response.status(400).json({ error: 'One or more members do not exist' })
    return
  }

  const chatId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO chats (id, type, title, created_by) VALUES ($1, $2, $3, $4)',
      [chatId, input.type, input.title, request.user.id],
    )
    for (const memberId of memberIds) {
      await tx.query(
        'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, memberId, memberId === request.user.id ? 'owner' : 'member'],
      )
      await tx.query(
        `INSERT INTO chat_user_settings (chat_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [chatId, memberId],
      )
    }
  })
  response.status(201).json({
    chat: {
      id: chatId,
      ...input,
      settings: publicChatSettings(),
    },
  })
})

router.patch('/api/chats/:chatId/settings', requireAuth, async (request, response) => {
  const chat = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!chat) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const input = parseBody(chatSettingsSchema, request.body)
  const current = await ensureChatSettings(request.params.chatId, request.user.id)
  const now = new Date().toISOString()

  const pinned = input.pinned ?? isDatabaseTrue(current.pinned)
  const pinnedAt = input.pinned === undefined
    ? current.pinned_at || null
    : input.pinned
      ? now
      : null

  const archived = input.archived ?? isDatabaseTrue(current.archived)
  const archivedAt = input.archived === undefined
    ? current.archived_at || null
    : input.archived
      ? now
      : null

  let mutedUntil = current.muted_until || null
  if (Object.prototype.hasOwnProperty.call(input, 'mutedUntil')) {
    mutedUntil = input.mutedUntil
  }
  if (Object.prototype.hasOwnProperty.call(input, 'muted')) {
    mutedUntil = input.muted ? (input.mutedUntil || INDEFINITE_MUTE_UNTIL) : null
  }

  if (Object.prototype.hasOwnProperty.call(input, 'autoDeleteSeconds')) {
    const seconds = input.autoDeleteSeconds
    if (seconds !== null && (seconds < 0 || !Number.isFinite(seconds))) {
      response.status(400).json({ error: 'autoDeleteSeconds must be a non-negative integer or null' })
      return
    }
    await db.query(
      'UPDATE chats SET auto_delete_seconds = $1 WHERE id = $2',
      [seconds, request.params.chatId],
    )
    await sendToChatExcept(request.params.chatId, request.user.id, {
      type: 'chat:auto-delete-changed',
      chatId: request.params.chatId,
      autoDeleteSeconds: seconds,
    })
  }

  const result = await db.query(
    `UPDATE chat_user_settings
     SET pinned = $1,
         pinned_at = $2,
         muted_until = $3,
         archived = $4,
         archived_at = $5,
         push_mode = $6,
         updated_at = NOW()
     WHERE chat_id = $7 AND user_id = $8
     RETURNING pinned, pinned_at, muted_until, archived, archived_at, push_mode`,
    [
      pinned,
      pinnedAt,
      mutedUntil,
      archived,
      archivedAt,
      input.pushMode || current.push_mode || 'default',
      request.params.chatId,
      request.user.id,
    ],
  )

  const chatRow = await db.query('SELECT auto_delete_seconds FROM chats WHERE id = $1 LIMIT 1', [request.params.chatId])
  const settings = publicChatSettings({
    ...result.rows[0],
    auto_delete_seconds: chatRow.rows[0]?.auto_delete_seconds ?? null,
  })
  await sendToUser(request.user.id, {
    type: 'chat:settings',
    chatId: request.params.chatId,
    settings,
  })
  response.json({ chatId: request.params.chatId, settings })
})

// ── Chat folders ──────────────────────────────────────────────────────────────

router.get('/api/chat-folders', requireAuth, async (request, response) => {
  const foldersResult = await db.query(
    `SELECT id, title, icon, sort_order, created_at, updated_at
     FROM chat_folders
     WHERE user_id = $1
     ORDER BY sort_order, created_at`,
    [request.user.id],
  )
  const chatsResult = await db.query(
    `SELECT folder_id, chat_id, pinned, pinned_at, added_at
     FROM chat_folder_chats
     WHERE user_id = $1
     ORDER BY COALESCE(pinned_at, added_at) DESC, added_at DESC`,
    [request.user.id],
  )
  const chatsByFolder = new Map()
  chatsResult.rows.forEach((row) => {
    const rows = chatsByFolder.get(row.folder_id) || []
    rows.push({
      chatId: row.chat_id,
      pinned: isDatabaseTrue(row.pinned),
      pinnedAt: row.pinned_at || null,
      addedAt: row.added_at,
    })
    chatsByFolder.set(row.folder_id, rows)
  })

  response.json({
    systemFolders: SYSTEM_FOLDERS,
    folders: foldersResult.rows.map((folder) => ({
      id: folder.id,
      title: folder.title,
      icon: folder.icon,
      sortOrder: folder.sort_order,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
      chats: chatsByFolder.get(folder.id) || [],
    })),
  })
})

router.post('/api/chat-folders', requireAuth, async (request, response) => {
  const input = parseBody(chatFolderSchema, request.body)
  const chatIds = await validateMemberChatIds(request.user.id, input.chatIds)
  const folderId = randomUUID()
  const normalizedTitle = normalizeFolderTitle(input.title)
  const sortResult = await db.query(
    'SELECT COALESCE(MAX(sort_order), 0)::integer AS sort_order FROM chat_folders WHERE user_id = $1',
    [request.user.id],
  )
  const sortOrder = Number(sortResult.rows[0]?.sort_order || 0) + 1

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO chat_folders
          (id, user_id, title, normalized_title, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [folderId, request.user.id, input.title, normalizedTitle, input.icon, sortOrder],
      )
      for (const chatId of chatIds) {
        await tx.query(
          `INSERT INTO chat_folder_chats (folder_id, chat_id, user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (folder_id, chat_id) DO NOTHING`,
          [folderId, chatId, request.user.id],
        )
      }
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Folder title already exists' })
      return
    }
    throw error
  }

  response.status(201).json({
    folder: {
      id: folderId,
      title: input.title,
      icon: input.icon,
      sortOrder,
      chats: chatIds.map((chatId) => ({ chatId, pinned: false, pinnedAt: null })),
    },
  })
})

router.patch('/api/chat-folders/:folderId', requireAuth, async (request, response) => {
  const input = parseBody(updateChatFolderSchema, request.body)
  const existing = await db.query(
    `SELECT id, title, icon, sort_order
     FROM chat_folders
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [request.params.folderId, request.user.id],
  )
  if (!existing.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }

  const chatIds = input.chatIds ? await validateMemberChatIds(request.user.id, input.chatIds) : null
  const nextTitle = input.title ?? existing.rows[0].title
  const nextIcon = input.icon ?? existing.rows[0].icon

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE chat_folders
         SET title = $1,
             normalized_title = $2,
             icon = $3,
             updated_at = NOW()
         WHERE id = $4 AND user_id = $5`,
        [
          nextTitle,
          normalizeFolderTitle(nextTitle),
          nextIcon,
          request.params.folderId,
          request.user.id,
        ],
      )
      if (chatIds) {
        await tx.query(
          'DELETE FROM chat_folder_chats WHERE folder_id = $1 AND user_id = $2',
          [request.params.folderId, request.user.id],
        )
        for (const chatId of chatIds) {
          await tx.query(
            `INSERT INTO chat_folder_chats (folder_id, chat_id, user_id)
             VALUES ($1, $2, $3)`,
            [request.params.folderId, chatId, request.user.id],
          )
        }
      }
    })
  } catch (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Folder title already exists' })
      return
    }
    throw error
  }

  response.json({
    folder: {
      id: request.params.folderId,
      title: nextTitle,
      icon: nextIcon,
      sortOrder: existing.rows[0].sort_order,
      chats: chatIds?.map((chatId) => ({ chatId, pinned: false, pinnedAt: null })) || undefined,
    },
  })
})

router.delete('/api/chat-folders/:folderId', requireAuth, async (request, response) => {
  const result = await db.query(
    'DELETE FROM chat_folders WHERE id = $1 AND user_id = $2 RETURNING id',
    [request.params.folderId, request.user.id],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }
  response.status(204).end()
})

router.patch('/api/chat-folders/:folderId/chats/:chatId', requireAuth, async (request, response) => {
  const input = parseBody(chatFolderChatSettingsSchema, request.body)
  const folderResult = await db.query(
    `SELECT id
     FROM chat_folders
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [request.params.folderId, request.user.id],
  )
  if (!folderResult.rows.length) {
    response.status(404).json({ error: 'Folder not found' })
    return
  }
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const pinnedAt = input.pinned ? new Date().toISOString() : null
  const result = await db.query(
    `UPDATE chat_folder_chats
     SET pinned = $1, pinned_at = $2
     WHERE folder_id = $3 AND chat_id = $4 AND user_id = $5
     RETURNING folder_id, chat_id, pinned, pinned_at, added_at`,
    [
      input.pinned,
      pinnedAt,
      request.params.folderId,
      request.params.chatId,
      request.user.id,
    ],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Chat is not in this folder' })
    return
  }

  const row = result.rows[0]
  response.json({
    folderId: row.folder_id,
    chat: {
      chatId: row.chat_id,
      pinned: isDatabaseTrue(row.pinned),
      pinnedAt: row.pinned_at || null,
      addedAt: row.added_at,
    },
  })
})

// ── Group member management ───────────────────────────────────────────────────

router.get('/api/chats/:chatId/members', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `SELECT u.id, u.name, u.username, u.status, u.avatar, u.last_seen_at,
            cm.role, cm.permissions, cm.joined_at
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.chat_id = $1
     ORDER BY cm.joined_at ASC`,
    [request.params.chatId],
  )
  response.json({ members: result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    status: r.status || '',
    avatar: r.avatar,
    lastSeenAt: r.last_seen_at,
    role: r.role,
    permissions: publicChatPermissions({ ...row, role: r.role, permissions: r.permissions }),
    joinedAt: r.joined_at,
  })) })
})

router.post('/api/chats/:chatId/members', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_members', 'Only admins can add members')
  const { userId } = request.body
  if (!userId || typeof userId !== 'string') {
    response.status(400).json({ error: 'userId is required' })
    return
  }
  if (await isBannedFromChat(request.params.chatId, userId)) {
    response.status(403).json({ error: 'User is banned in this chat' })
    return
  }
  const userResult = await db.query('SELECT id, name, username FROM users WHERE id = $1', [userId])
  if (!userResult.rows.length) { response.status(404).json({ error: 'User not found' }); return }
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [request.params.chatId, userId],
    )
    await tx.query(
      `INSERT INTO chat_user_settings (chat_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [request.params.chatId, userId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: userId,
      action: 'member.add',
    })
  })
  const payload = { type: 'chat:member-added', chatId: request.params.chatId, userId }
  await sendToChat(request.params.chatId, payload)
  response.json({ member: { id: userId, name: userResult.rows[0].name, username: userResult.rows[0].username } })
})

router.delete('/api/chats/:chatId/members/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const isSelf = request.params.userId === request.user.id
  if (!isSelf) requirePermission(row, 'manage_members', 'Only admins can remove members')
  const target = await requireChatMemberRow(request.params.chatId, request.params.userId)
  if (!target) {
    response.status(404).json({ error: 'Member not found' })
    return
  }
  if (target.role === 'owner' && !isSelf) {
    response.status(403).json({ error: 'Owner cannot be kicked' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      'DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [request.params.chatId, request.params.userId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: isSelf ? 'member.leave' : 'member.kick',
    })
  })
  const payload = { type: 'chat:member-removed', chatId: request.params.chatId, userId: request.params.userId }
  await sendToChat(request.params.chatId, payload)
  response.json({ ok: true })
})

router.patch('/api/chats/:chatId/members/:userId/role', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_roles', 'Only owners can change roles')
  const input = parseBody(memberRoleSchema, request.body)
  const target = await requireChatMemberRow(request.params.chatId, request.params.userId)
  if (!target) { response.status(404).json({ error: 'Member not found' }); return }
  if (target.role === 'owner' && request.params.userId !== request.user.id) {
    response.status(403).json({ error: 'Owner role cannot be changed by another user' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_members
       SET role = $1, permissions = $2
       WHERE chat_id = $3 AND user_id = $4`,
      [
        input.role,
        JSON.stringify(input.permissions || {}),
        request.params.chatId,
        request.params.userId,
      ],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.role',
      metadata: { role: input.role, permissions: input.permissions || {} },
    })
  })
  const payload = {
    type: 'chat:member-role',
    chatId: request.params.chatId,
    userId: request.params.userId,
    role: input.role,
    permissions: input.permissions || {},
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

router.patch('/api/chats/:chatId/members/:userId/permissions', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_roles', 'Only owners can change permissions')
  const input = parseBody(memberPermissionsSchema, request.body)
  await db.transaction(async (tx) => {
    const result = await tx.query(
      `UPDATE chat_members
       SET permissions = $1
       WHERE chat_id = $2 AND user_id = $3
       RETURNING role, permissions`,
      [JSON.stringify(input.permissions), request.params.chatId, request.params.userId],
    )
    if (!result.rows.length) {
      const error = new Error('Member not found')
      error.status = 404
      throw error
    }
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.permissions',
      metadata: { permissions: input.permissions },
    })
  })
  const payload = {
    type: 'chat:member-permissions',
    chatId: request.params.chatId,
    userId: request.params.userId,
    permissions: input.permissions,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

router.patch('/api/chats/:chatId/moderation', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can update moderation settings')
  const input = parseBody(chatModerationSettingsSchema, request.body)
  const nextSlowMode = input.slowModeSeconds ?? Number(row.slow_mode_seconds || 0)
  const nextDefaults = input.defaultPermissions ?? parseJsonObject(row.default_permissions)
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chats
       SET slow_mode_seconds = $1, default_permissions = $2
       WHERE id = $3`,
      [nextSlowMode, JSON.stringify(nextDefaults), request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'chat.moderation',
      metadata: { slowModeSeconds: nextSlowMode, defaultPermissions: nextDefaults },
    })
  })
  const payload = {
    type: 'chat:moderation',
    chatId: request.params.chatId,
    slowModeSeconds: nextSlowMode,
    defaultPermissions: nextDefaults,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

// ── Bans ──────────────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/bans', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can view bans')
  const result = await db.query(
    `SELECT cb.user_id, cb.banned_by, cb.reason, cb.expires_at, cb.created_at,
            u.name, u.username, u.avatar
     FROM chat_bans cb
     JOIN users u ON u.id = cb.user_id
     WHERE cb.chat_id = $1
       AND (cb.expires_at IS NULL OR cb.expires_at > NOW())
     ORDER BY cb.created_at DESC`,
    [request.params.chatId],
  )
  response.json({
    bans: result.rows.map((ban) => ({
      userId: ban.user_id,
      bannedBy: ban.banned_by,
      reason: ban.reason,
      expiresAt: ban.expires_at || null,
      createdAt: ban.created_at,
      user: { id: ban.user_id, name: ban.name, username: ban.username, avatar: ban.avatar },
    })),
  })
})

router.post('/api/chats/:chatId/bans', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can ban users')
  const input = parseBody(banMemberSchema, request.body)
  const target = await requireChatMemberRow(request.params.chatId, input.userId)
  if (target?.role === 'owner') {
    response.status(403).json({ error: 'Owner cannot be banned' })
    return
  }
  const expiresAt = input.durationSeconds
    ? new Date(Date.now() + input.durationSeconds * 1000).toISOString()
    : null
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_bans (chat_id, user_id, banned_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chat_id, user_id)
       DO UPDATE SET banned_by = EXCLUDED.banned_by,
                     reason = EXCLUDED.reason,
                     expires_at = EXCLUDED.expires_at,
                     created_at = NOW()`,
      [request.params.chatId, input.userId, request.user.id, input.reason, expiresAt],
    )
    await tx.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [
      request.params.chatId,
      input.userId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: input.userId,
      action: expiresAt ? 'member.temp_ban' : 'member.ban',
      metadata: { reason: input.reason, expiresAt },
    })
  })
  const payload = {
    type: 'chat:member-banned',
    chatId: request.params.chatId,
    userId: input.userId,
    expiresAt,
  }
  await sendToChat(request.params.chatId, payload)
  await sendToUser(input.userId, payload)
  response.status(201).json({ ban: { userId: input.userId, reason: input.reason, expiresAt } })
})

router.delete('/api/chats/:chatId/bans/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'ban_users', 'Only moderators can unban users')
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM chat_bans WHERE chat_id = $1 AND user_id = $2', [
      request.params.chatId,
      request.params.userId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: 'member.unban',
    })
  })
  response.status(204).end()
})

// ── Invite links ──────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/invites', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can view invite links')
  const result = await db.query(
    `SELECT id, token, name, expires_at, usage_limit, uses, require_approval,
            revoked_at, created_at
     FROM chat_invite_links
     WHERE chat_id = $1
     ORDER BY created_at DESC`,
    [request.params.chatId],
  )
  response.json({
    invites: result.rows.map((invite) => ({
      id: invite.id,
      token: invite.token,
      url: `/join/${invite.token}`,
      name: invite.name,
      expiresAt: invite.expires_at || null,
      usageLimit: invite.usage_limit,
      uses: Number(invite.uses || 0),
      requireApproval: isDatabaseTrue(invite.require_approval),
      revokedAt: invite.revoked_at || null,
      createdAt: invite.created_at,
    })),
  })
})

router.post('/api/chats/:chatId/invites', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can create invite links')
  const input = parseBody(inviteLinkSchema, request.body)
  const id = randomUUID()
  const token = randomUUID().replaceAll('-', '')
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_invite_links
        (id, chat_id, token, created_by, name, expires_at, usage_limit, require_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        request.params.chatId,
        token,
        request.user.id,
        input.name,
        input.expiresAt || null,
        input.usageLimit || null,
        input.requireApproval,
      ],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'invite.create',
      metadata: { inviteId: id, requireApproval: input.requireApproval },
    })
  })
  response.status(201).json({
    invite: {
      id,
      token,
      url: `/join/${token}`,
      name: input.name,
      expiresAt: input.expiresAt || null,
      usageLimit: input.usageLimit || null,
      uses: 0,
      requireApproval: input.requireApproval,
    },
  })
})

router.delete('/api/chats/:chatId/invites/:inviteId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'invite_users', 'Only admins can revoke invite links')
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_invite_links
       SET revoked_at = NOW()
       WHERE id = $1 AND chat_id = $2`,
      [request.params.inviteId, request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'invite.revoke',
      metadata: { inviteId: request.params.inviteId },
    })
  })
  response.status(204).end()
})

router.post('/api/invites/:token/join', requireAuth, async (request, response) => {
  const input = parseBody(joinInviteSchema, request.body)
  const inviteResult = await db.query(
    `SELECT cil.id, cil.chat_id, cil.usage_limit, cil.uses, cil.require_approval,
            c.type, c.title
     FROM chat_invite_links cil
     JOIN chats c ON c.id = cil.chat_id
     WHERE cil.token = $1
       AND cil.revoked_at IS NULL
       AND (cil.expires_at IS NULL OR cil.expires_at > NOW())
     LIMIT 1`,
    [request.params.token],
  )
  const invite = inviteResult.rows[0]
  if (!invite || (invite.usage_limit && Number(invite.uses) >= Number(invite.usage_limit))) {
    response.status(404).json({ error: 'Invite link is not available' })
    return
  }
  if (await isBannedFromChat(invite.chat_id, request.user.id)) {
    response.status(403).json({ error: 'You are banned in this chat' })
    return
  }
  if (await isChatMember(invite.chat_id, request.user.id)) {
    response.json({ chatId: invite.chat_id, joined: true, existing: true })
    return
  }
  if (isDatabaseTrue(invite.require_approval)) {
    await db.query(
      `INSERT INTO chat_join_requests (chat_id, user_id, invite_link_id, message, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (chat_id, user_id)
       DO UPDATE SET invite_link_id = EXCLUDED.invite_link_id,
                     message = EXCLUDED.message,
                     status = 'pending',
                     reviewed_by = NULL,
                     reviewed_at = NULL,
                     created_at = NOW()`,
      [invite.chat_id, request.user.id, invite.id, input.message],
    )
    response.status(202).json({ chatId: invite.chat_id, joinRequest: 'pending' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_members (chat_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [invite.chat_id, request.user.id],
    )
    await tx.query(
      `INSERT INTO chat_user_settings (chat_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [invite.chat_id, request.user.id],
    )
    await tx.query('UPDATE chat_invite_links SET uses = uses + 1 WHERE id = $1', [invite.id])
    await appendAdminLog(tx, {
      chatId: invite.chat_id,
      actorUserId: request.user.id,
      targetUserId: request.user.id,
      action: 'member.join_invite',
      metadata: { inviteId: invite.id },
    })
  })
  await sendToChat(invite.chat_id, {
    type: 'chat:member-added',
    chatId: invite.chat_id,
    userId: request.user.id,
  })
  response.status(201).json({ chatId: invite.chat_id, joined: true })
})

// ── Join requests ─────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/join-requests', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'approve_join_requests', 'Only admins can review join requests')
  const result = await db.query(
    `SELECT cjr.user_id, cjr.message, cjr.status, cjr.created_at,
            u.name, u.username, u.avatar
     FROM chat_join_requests cjr
     JOIN users u ON u.id = cjr.user_id
     WHERE cjr.chat_id = $1 AND cjr.status = 'pending'
     ORDER BY cjr.created_at ASC`,
    [request.params.chatId],
  )
  response.json({
    requests: result.rows.map((joinRequest) => ({
      userId: joinRequest.user_id,
      message: joinRequest.message,
      status: joinRequest.status,
      createdAt: joinRequest.created_at,
      user: {
        id: joinRequest.user_id,
        name: joinRequest.name,
        username: joinRequest.username,
        avatar: joinRequest.avatar,
      },
    })),
  })
})

router.post('/api/chats/:chatId/join-requests/:userId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'approve_join_requests', 'Only admins can review join requests')
  const input = parseBody(reviewJoinRequestSchema, request.body)
  const requestResult = await db.query(
    `SELECT chat_id, user_id, invite_link_id
     FROM chat_join_requests
     WHERE chat_id = $1 AND user_id = $2 AND status = 'pending'
     LIMIT 1`,
    [request.params.chatId, request.params.userId],
  )
  const joinRequest = requestResult.rows[0]
  if (!joinRequest) { response.status(404).json({ error: 'Join request not found' }); return }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_join_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE chat_id = $3 AND user_id = $4`,
      [input.approved ? 'approved' : 'declined', request.user.id, request.params.chatId, request.params.userId],
    )
    if (input.approved) {
      await tx.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [request.params.chatId, request.params.userId],
      )
      await tx.query(
        `INSERT INTO chat_user_settings (chat_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [request.params.chatId, request.params.userId],
      )
      if (joinRequest.invite_link_id) {
        await tx.query('UPDATE chat_invite_links SET uses = uses + 1 WHERE id = $1', [
          joinRequest.invite_link_id,
        ])
      }
    }
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      targetUserId: request.params.userId,
      action: input.approved ? 'join_request.approve' : 'join_request.decline',
    })
  })
  const payload = {
    type: input.approved ? 'chat:member-added' : 'chat:join-request-declined',
    chatId: request.params.chatId,
    userId: request.params.userId,
  }
  if (input.approved) await sendToChat(request.params.chatId, payload)
  await sendToUser(request.params.userId, payload)
  response.json({ chatId: request.params.chatId, userId: request.params.userId, approved: input.approved })
})

// ── Admin log & chat info ─────────────────────────────────────────────────────

router.get('/api/chats/:chatId/admin-log', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can view admin log')
  const limit = Math.min(100, Math.max(1, parseInt(request.query.limit, 10) || 50))
  const result = await db.query(
    `SELECT id, actor_user_id, target_user_id, action, metadata, created_at
     FROM chat_admin_log
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [request.params.chatId, limit],
  )
  response.json({
    events: result.rows.map((event) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      targetUserId: event.target_user_id,
      action: event.action,
      metadata: parseJsonObject(event.metadata),
      createdAt: event.created_at,
    })),
  })
})

router.patch('/api/chats/:chatId/info', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can update group info')
  const title = String(request.body.title || '').trim().slice(0, 64)
  if (!title) { response.status(400).json({ error: 'Title is required' }); return }
  await db.transaction(async (tx) => {
    await tx.query('UPDATE chats SET title = $1 WHERE id = $2', [title, request.params.chatId])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'chat.info',
      metadata: { title },
    })
  })
  const payload = { type: 'chat:info-updated', chatId: request.params.chatId, title }
  await sendToChat(request.params.chatId, payload)
  response.json({ chat: { id: request.params.chatId, title } })
})

// ── Discussion groups ─────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/discussion', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  if (row.type !== 'channel') { response.status(400).json({ error: 'Only channels can have discussion groups' }); return }

  const result = await db.query(
    `SELECT c.id, c.title, c.type,
            (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) AS member_count
     FROM chats c
     WHERE c.id = (SELECT linked_group_id FROM chats WHERE id = $1)`,
    [request.params.chatId],
  )
  const group = result.rows[0]
  response.json({ group: group
    ? { id: group.id, title: group.title, type: group.type, memberCount: Number(group.member_count) }
    : null,
  })
})

router.put('/api/chats/:chatId/discussion', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  if (row.type !== 'channel') { response.status(400).json({ error: 'Only channels can have discussion groups' }); return }
  requirePermission(row, 'manage_chat', 'Only admins can set discussion group')

  const groupId = request.body.groupId ? String(request.body.groupId) : null

  if (groupId) {
    const groupRow = await requireChatMemberRow(groupId, request.user.id)
    if (!groupRow || groupRow.type !== 'group') {
      response.status(400).json({ error: 'Target must be a group you belong to' })
      return
    }
    if (!hasPermission(groupRow, 'manage_chat')) {
      response.status(403).json({ error: 'You must be an admin of the target group' })
      return
    }
  }

  await db.query(
    'UPDATE chats SET linked_group_id = $1 WHERE id = $2',
    [groupId, request.params.chatId],
  )
  const payload = { type: 'chat:discussion-updated', chatId: request.params.chatId, groupId }
  await sendToChat(request.params.chatId, payload)
  response.json({ groupId })
})

// ── Topics ────────────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/topics', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `SELECT id, title, created_by, pinned, closed, message_count,
            last_message_at, created_at, updated_at
     FROM chat_topics
     WHERE chat_id = $1
     ORDER BY pinned DESC, COALESCE(last_message_at, updated_at) DESC`,
    [request.params.chatId],
  )
  response.json({
    topics: result.rows.map((topic) => ({
      id: topic.id,
      title: topic.title,
      createdBy: topic.created_by,
      pinned: isDatabaseTrue(topic.pinned),
      closed: isDatabaseTrue(topic.closed),
      messageCount: Number(topic.message_count || 0),
      lastMessageAt: topic.last_message_at || null,
      createdAt: topic.created_at,
      updatedAt: topic.updated_at,
    })),
  })
})

router.post('/api/chats/:chatId/topics', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_topics', 'Only moderators can create topics')
  if (row.type !== 'group') {
    response.status(400).json({ error: 'Topics are available only in groups' })
    return
  }
  const input = parseBody(topicSchema, request.body)
  const topicId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO chat_topics (id, chat_id, title, created_by)
       VALUES ($1, $2, $3, $4)`,
      [topicId, request.params.chatId, input.title, request.user.id],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'topic.create',
      metadata: { topicId, title: input.title },
    })
  })
  const topic = {
    id: topicId,
    chatId: request.params.chatId,
    title: input.title,
    createdBy: request.user.id,
    pinned: false,
    closed: false,
    messageCount: 0,
  }
  await sendToChat(request.params.chatId, { type: 'chat:topic-created', topic })
  response.status(201).json({ topic })
})

router.patch('/api/chats/:chatId/topics/:topicId', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }
  requirePermission(row, 'manage_topics', 'Only moderators can update topics')
  const input = parseBody(updateTopicSchema, request.body)
  const existing = await db.query(
    'SELECT id, title, pinned, closed FROM chat_topics WHERE id = $1 AND chat_id = $2 LIMIT 1',
    [request.params.topicId, request.params.chatId],
  )
  if (!existing.rows.length) {
    response.status(404).json({ error: 'Topic not found' })
    return
  }
  const current = existing.rows[0]
  const next = {
    title: input.title ?? current.title,
    pinned: input.pinned ?? isDatabaseTrue(current.pinned),
    closed: input.closed ?? isDatabaseTrue(current.closed),
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE chat_topics
       SET title = $1, pinned = $2, closed = $3, updated_at = NOW()
       WHERE id = $4 AND chat_id = $5`,
      [next.title, next.pinned, next.closed, request.params.topicId, request.params.chatId],
    )
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: 'topic.update',
      metadata: { topicId: request.params.topicId, ...next },
    })
  })
  const payload = {
    type: 'chat:topic-updated',
    chatId: request.params.chatId,
    topic: { id: request.params.topicId, ...next },
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

// ── Media gallery ─────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/media', requireAuth, async (request, response) => {
  const row = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!row) { response.status(404).json({ error: 'Chat not found' }); return }

  const rawKinds = [request.query.kind].flat().filter(Boolean)
  const allowed = ['image', 'video', 'file', 'voice', 'audio']
  const kinds = rawKinds.length ? rawKinds.filter((k) => allowed.includes(k)) : allowed

  const limit = Math.min(Number(request.query.limit) || 40, 100)
  const before = request.query.before || null

  const result = await db.query(
    `SELECT m.id AS message_id, m.created_at,
            mf.id, mf.kind, mf.original_name, mf.mime_type,
            mf.plain_size, mf.original_size, mf.width, mf.height,
            mf.client_encrypted, mf.media_envelope, mf.duration_ms
     FROM messages m
     JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND mf.kind = ANY($3)
       AND m.deleted_at IS NULL
       AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
       AND m.sent_at IS NOT NULL
       AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
       AND NOT EXISTS (
         SELECT 1 FROM message_user_deletions mud
         WHERE mud.message_id = m.id AND mud.user_id = $2
       )
       AND ($4::timestamptz IS NULL OR m.created_at < $4)
     ORDER BY m.created_at DESC
     LIMIT $5`,
    [request.params.chatId, request.user.id, kinds, before, limit + 1],
  )

  const rows = result.rows
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map((r) => ({
    messageId: r.message_id,
    id: r.id,
    kind: r.kind,
    name: r.original_name,
    mimeType: r.mime_type,
    size: Number(r.plain_size || r.original_size || 0),
    width: r.width ? Number(r.width) : null,
    height: r.height ? Number(r.height) : null,
    clientEncrypted: isDatabaseTrue(r.client_encrypted),
    mediaEnvelope: r.media_envelope || null,
    durationMs: r.duration_ms ? Number(r.duration_ms) : null,
    url: `/api/media/${r.id}`,
    createdAt: r.created_at,
  }))

  response.json({ items, hasMore, nextBefore: hasMore ? items.at(-1).createdAt : null })
})

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/api/search', requireAuth, async (request, response) => {
  const query = normalizeSearchQuery(request.query.q)
  if (!query) {
    response.json({ query, users: [], chats: [], messages: [] })
    return
  }

  const [usersResult, chatsResult, messagesResult] = await Promise.all([
    db.query(
      `SELECT id, login, username, phone, name, bio, status, avatar, last_seen_at, encryption_public_key
       FROM users
       WHERE id <> $1
         AND (username ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
       ORDER BY name
       LIMIT 20`,
      [request.user.id, query],
    ),
    db.query(
      `SELECT DISTINCT c.id, c.type, c.title, c.created_at
       FROM chats c
       JOIN chat_members mine ON mine.chat_id = c.id AND mine.user_id = $1
       LEFT JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE c.title ILIKE '%' || $2 || '%'
          OR u.username ILIKE '%' || $2 || '%'
          OR u.name ILIKE '%' || $2 || '%'
       ORDER BY c.created_at DESC
       LIMIT 25`,
      [request.user.id, query],
    ),
    db.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.created_at, m.search_text,
              c.type AS chat_type, c.title AS chat_title
       FROM messages m
       JOIN chat_members mine ON mine.chat_id = m.chat_id AND mine.user_id = $1
       JOIN chats c ON c.id = m.chat_id
       LEFT JOIN chat_history_clears chc
         ON chc.chat_id = m.chat_id AND chc.user_id = $1
       WHERE m.deleted_at IS NULL
         AND m.search_text <> ''
         AND m.search_text ILIKE '%' || $2 || '%'
         AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
         AND NOT EXISTS (
           SELECT 1 FROM message_user_deletions mud
           WHERE mud.message_id = m.id AND mud.user_id = $1
         )
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [request.user.id, query],
    ),
  ])

  response.json({
    query,
    users: usersResult.rows.map(publicUser),
    chats: chatsResult.rows.map((chat) => ({
      id: chat.id,
      type: chat.type,
      title: chat.title,
      createdAt: chat.created_at,
    })),
    messages: messagesResult.rows.map((message) => ({
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      createdAt: message.created_at,
      preview: message.search_text,
      chat: {
        type: message.chat_type,
        title: message.chat_title,
      },
    })),
    messageSearchLimitedByEncryption: true,
  })
})

router.get('/api/chats/:chatId/search', requireAuth, apiLimiter, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const query = normalizeSearchQuery(request.query.q)
  if (!query) {
    response.json({ query, messages: [], messageSearchLimitedByEncryption: true })
    return
  }
  const result = await db.query(
    `SELECT m.id, m.chat_id, m.sender_id, m.created_at, m.search_text
     FROM messages m
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.deleted_at IS NULL
       AND m.search_text <> ''
       AND m.search_text ILIKE '%' || $3 || '%'
       AND (chc.cleared_at IS NULL OR m.created_at > chc.cleared_at)
       AND NOT EXISTS (
         SELECT 1 FROM message_user_deletions mud
         WHERE mud.message_id = m.id AND mud.user_id = $2
       )
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [request.params.chatId, request.user.id, query],
  )
  response.json({
    query,
    messages: result.rows.map((message) => ({
      id: message.id,
      chatId: message.chat_id,
      senderId: message.sender_id,
      createdAt: message.created_at,
      preview: message.search_text,
    })),
    messageSearchLimitedByEncryption: true,
  })
})

// ── Messages ──────────────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/messages', requireAuth, apiLimiter, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const limit = Math.min(100, Math.max(1, parseInt(request.query.limit, 10) || 50))
  const before = request.query.before ? String(request.query.before) : null
  const params = [request.params.chatId, request.user.id]
  let beforeClause = ''
  if (before) {
    params.push(before)
    beforeClause = `AND m.created_at < $${params.length}`
  }
  params.push(limit + 1)
  const result = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       ${visibleMessageFilter('$2')}
       ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  const hasMore = result.rows.length > limit
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows
  pageRows.reverse()
  const publicMessages = await publicMessagesFromRows(request.params.chatId, pageRows, request.user.id)
  const msgIds = publicMessages.map((m) => m.id)
  let readsByMsgId = {}
  if (msgIds.length) {
    const readsRes = await db.query(
      `SELECT mr.message_id, u.id AS user_id, u.name
       FROM message_reads mr
       JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ANY($1::uuid[])
       ORDER BY mr.read_at ASC`,
      [msgIds],
    )
    for (const row of readsRes.rows) {
      if (!readsByMsgId[row.message_id]) readsByMsgId[row.message_id] = []
      readsByMsgId[row.message_id].push({ userId: row.user_id, name: row.name })
    }
  }
  const messages = publicMessages.map((m) => {
    const readBy = readsByMsgId[m.id] || []
    return {
      ...m,
      readBy,
      status: readBy.length > 0 ? 'read' : (m.status || 'sent'),
    }
  })
  response.json({ messages, hasMore })
})

router.get('/api/chats/:chatId/messages/:messageId/context', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const limit = Math.min(100, Math.max(3, parseInt(request.query.limit, 10) || 50))
  const beforeLimit = Math.floor((limit - 1) / 2)
  const afterLimit = limit - 1 - beforeLimit
  const targetResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.id = $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     LIMIT 1`,
    [request.params.chatId, request.user.id, request.params.messageId],
  )
  const target = targetResult.rows[0]
  if (!target) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const beforeResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.created_at < $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [request.params.chatId, request.user.id, target.created_at, beforeLimit + 1],
  )
  const afterResult = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     LEFT JOIN chat_history_clears chc
       ON chc.chat_id = m.chat_id AND chc.user_id = $2
     WHERE m.chat_id = $1
       AND m.created_at > $3
       AND m.deleted_at IS NULL
       ${visibleMessageFilter('$2')}
     ORDER BY m.created_at ASC
     LIMIT $4`,
    [request.params.chatId, request.user.id, target.created_at, afterLimit + 1],
  )
  const hasMoreBefore = beforeResult.rows.length > beforeLimit
  const hasMoreAfter = afterResult.rows.length > afterLimit
  const contextRows = [
    ...beforeResult.rows.slice(0, beforeLimit).reverse(),
    target,
    ...afterResult.rows.slice(0, afterLimit),
  ]
  const messages = await publicMessagesFromRows(request.params.chatId, contextRows, request.user.id)
  response.json({
    messageId: request.params.messageId,
    messages,
    hasMoreBefore,
    hasMoreAfter,
  })
})

router.post('/api/chats/:chatId/messages', requireAuth, messageLimiter, async (request, response) => {
  await requireUnblockedPrivateChat(request.params.chatId, request.user.id)
  const input = parseBody(messageSchema, request.body)
  const member = await assertCanSendToChat(request.params.chatId, request.user.id, {
    media: Boolean(input.mediaId),
    poll: Boolean(input.poll),
  })
  if (input.topicId) {
    const topicResult = await db.query(
      `SELECT id, closed
       FROM chat_topics
       WHERE id = $1 AND chat_id = $2
       LIMIT 1`,
      [input.topicId, request.params.chatId],
    )
    const topic = topicResult.rows[0]
    if (!topic) {
      response.status(400).json({ error: 'Topic is not available in this chat' })
      return
    }
    if (isDatabaseTrue(topic.closed) && !hasPermission(member, 'manage_topics')) {
      response.status(403).json({ error: 'Topic is closed' })
      return
    }
  }
  if (input.replyToId) {
    const replyResult = await db.query(
      `SELECT id FROM messages
       WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [input.replyToId, request.params.chatId],
    )
    if (!replyResult.rows.length) {
      response.status(400).json({ error: 'Reply message is not available in this chat' })
      return
    }
  }
  let forwardedFromChatId = null
  if (input.forwardedFromMessageId) {
    const forwardResult = await db.query(
      `SELECT m.id, m.chat_id
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
       WHERE m.id = $1 AND m.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_deletions mud
           WHERE mud.message_id = m.id AND mud.user_id = $2
         )
       LIMIT 1`,
      [input.forwardedFromMessageId, request.user.id],
    )
    if (!forwardResult.rows.length) {
      response.status(400).json({ error: 'Forwarded message is not available' })
      return
    }
    forwardedFromChatId = forwardResult.rows[0].chat_id
  }
  let media = null
  if (input.mediaId) {
    const mediaResult = await db.query(
      `SELECT id, owner_id, chat_id, kind, original_name, mime_type, plain_size,
              original_size, width, height, client_encrypted, media_envelope, duration_ms
       FROM media_files
       WHERE id = $1
       LIMIT 1`,
      [input.mediaId],
    )
    media = mediaResult.rows[0]
    if (!media || media.owner_id !== request.user.id || media.chat_id !== request.params.chatId) {
      response.status(400).json({ error: 'Media is not available for this chat' })
      return
    }
  }

  const scheduledAt = input.scheduledAt || null
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : 0
  if (scheduledAt && (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now())) {
    response.status(400).json({ error: 'scheduledAt must be a future timestamp' })
    return
  }
  if (input.poll?.quiz && input.poll.correctOption !== null && input.poll.correctOption !== undefined) {
    if (input.poll.correctOption >= input.poll.options.length) {
      response.status(400).json({ error: 'Correct poll option is out of range' })
      return
    }
  }

  const autoDeleteSeconds = Number(member.auto_delete_seconds || 0)
  const disappearsAt = input.disappearsAt
    || (autoDeleteSeconds > 0 && !scheduledAt
      ? new Date(Date.now() + autoDeleteSeconds * 1000).toISOString()
      : null)

  const encrypted = encryptMessage(input.text)
  const messageId = randomUUID()
  const sentAt = scheduledAt ? null : new Date().toISOString()
  const pollId = input.poll ? randomUUID() : null
  const pollOptions = input.poll
    ? input.poll.options.map((text, index) => ({ id: randomUUID(), text, index }))
    : []
  const correctOptionId =
    input.poll?.quiz && input.poll.correctOption !== null && input.poll.correctOption !== undefined
      ? pollOptions[input.poll.correctOption]?.id || null
      : null
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO messages
        (id, chat_id, sender_id, media_id, reply_to_id, forwarded_from_message_id,
         forwarded_from_chat_id, topic_id, ciphertext, iv, auth_tag, encryption_version,
         search_text, silent, scheduled_at, sent_at, link_preview, disappears_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        messageId,
        request.params.chatId,
        request.user.id,
        input.mediaId || null,
        input.replyToId || null,
        input.forwardedFromMessageId || null,
        forwardedFromChatId,
        input.topicId || null,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.version,
        normalizeSearchText(input.searchText),
        input.silent,
        scheduledAt,
        sentAt,
        input.linkPreview ? JSON.stringify(input.linkPreview) : null,
        disappearsAt,
      ],
    )
    if (input.poll) {
      await tx.query(
        `INSERT INTO polls
          (id, message_id, question, multiple_choice, anonymous, quiz, correct_option_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          pollId,
          messageId,
          input.poll.question,
          input.poll.multipleChoice,
          input.poll.anonymous,
          input.poll.quiz,
          correctOptionId,
        ],
      )
      for (const option of pollOptions) {
        await tx.query(
          `INSERT INTO poll_options (id, poll_id, text, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [option.id, pollId, option.text, option.index],
        )
      }
    }
    if (!scheduledAt) {
      await tx.query(
        'UPDATE chat_members SET last_message_at = NOW() WHERE chat_id = $1 AND user_id = $2',
        [request.params.chatId, request.user.id],
      )
      if (input.topicId) {
        await tx.query(
          `UPDATE chat_topics
           SET message_count = message_count + 1,
               last_message_at = NOW(),
               updated_at = NOW()
           WHERE id = $1 AND chat_id = $2`,
          [input.topicId, request.params.chatId],
        )
      }
      if (member.type === 'channel') {
        await tx.query(
          `INSERT INTO channel_post_stats (message_id)
           VALUES ($1)
           ON CONFLICT (message_id) DO NOTHING`,
          [messageId],
        )
      }
      if (input.forwardedFromMessageId) {
        await tx.query(
          `INSERT INTO channel_post_stats (message_id, reposts)
           VALUES ($1, 1)
           ON CONFLICT (message_id)
           DO UPDATE SET reposts = channel_post_stats.reposts + 1,
                         updated_at = NOW()`,
          [input.forwardedFromMessageId],
        )
      }
    }
  })
  const publicMessage = {
    id: messageId,
    chatId: request.params.chatId,
    senderId: request.user.id,
    text: input.text,
    createdAt: new Date().toISOString(),
    topicId: input.topicId || null,
    replyToId: input.replyToId || null,
    forwarded: Boolean(input.forwardedFromMessageId),
    forwardedFromMessageId: input.forwardedFromMessageId || null,
    forwardedFromChatId,
    silent: input.silent,
    scheduledAt,
    sentAt,
    disappearsAt: disappearsAt || null,
    reactions: {},
    readBy: [],
    status: 'sent',
    media: media
      ? {
          id: media.id,
          kind: media.kind,
          name: media.original_name,
          mimeType: media.mime_type,
          size: Number(media.plain_size),
          originalSize: Number(media.original_size),
          width: media.width,
          height: media.height,
          durationMs: media.duration_ms ?? null,
          url: `/api/media/${media.id}`,
          encrypted: isDatabaseTrue(media.client_encrypted),
          envelope: media.media_envelope || '',
        }
      : null,
    poll: input.poll
      ? {
          id: pollId,
          question: input.poll.question,
          multipleChoice: input.poll.multipleChoice,
          anonymous: input.poll.anonymous,
          quiz: input.poll.quiz,
          closedAt: null,
          options: pollOptions.map((option) => ({
            id: option.id,
            text: option.text,
            votes: 0,
            votedByMe: false,
          })),
        }
      : null,
  }

  if (scheduledAt) {
    response.status(202).json({ message: publicMessage, scheduled: true })
    return
  }

  const recipientDeliveries = await sendToChatExcept(request.params.chatId, request.user.id, {
    type: 'message:new',
    message: publicMessage,
  })
  if (!input.silent) {
    await sendOfflineMessagePushes({
      chatId: request.params.chatId,
      sender: request.user,
      message: publicMessage,
      searchText: input.searchText,
    })
  }
  if (recipientDeliveries > 0) publicMessage.status = 'delivered'
  await sendToUser(request.user.id, {
    type: 'message:delivered',
    chatId: request.params.chatId,
    messageId,
    delivered: recipientDeliveries > 0,
  })

  // Auto-forward channel posts to the linked discussion group (silent, no push)
  if (member?.type === 'channel' && !scheduledAt) {
    const linkedResult = await db.query(
      'SELECT linked_group_id FROM chats WHERE id = $1 AND linked_group_id IS NOT NULL',
      [request.params.chatId],
    )
    if (linkedResult.rows[0]?.linked_group_id) {
      const groupId = linkedResult.rows[0].linked_group_id
      const discussionId = randomUUID()
      await db.query(
        `INSERT INTO messages
           (id, chat_id, sender_id, ciphertext, iv, auth_tag, encryption_version,
            search_text, forwarded_from_message_id, forwarded_from_chat_id, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [discussionId, groupId, request.user.id,
          input.text || '', '', '', 1,
          input.searchText || '',
          messageId, request.params.chatId],
      )
      await sendToChat(groupId, {
        type: 'message:new',
        message: {
          id: discussionId,
          chatId: groupId,
          senderId: request.user.id,
          text: input.text || '',
          createdAt: new Date().toISOString(),
          topicId: null,
          replyToId: null,
          forwarded: true,
          forwardedFromMessageId: messageId,
          forwardedFromChatId: request.params.chatId,
          silent: true,
          reactions: {},
          status: 'sent',
          media: publicMessage.media,
          poll: null,
        },
      })
    }
  }

  response.status(201).json({ message: publicMessage })
})

// ── Telegram history import ───────────────────────────────────────────────────

const TELEGRAM_IMPORT_CHUNK_SIZE = 500

router.post('/api/chats/:chatId/import-telegram', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }

  const input = parseBody(telegramImportSchema, request.body)

  let imported = 0
  let skipped = 0
  const rowsToInsert = []

  for (const raw of input.messages) {
    const text = String(raw.text || '').trim()
    if (!text) { skipped += 1; continue }
    const sentAtDate = new Date(raw.date)
    if (Number.isNaN(sentAtDate.getTime())) { skipped += 1; continue }
    const fromName = String(raw.from || '').trim().slice(0, 255) || null
    rowsToInsert.push({ text, sentAt: sentAtDate.toISOString(), fromName })
  }

  for (let offset = 0; offset < rowsToInsert.length; offset += TELEGRAM_IMPORT_CHUNK_SIZE) {
    const chunk = rowsToInsert.slice(offset, offset + TELEGRAM_IMPORT_CHUNK_SIZE)
    await db.transaction(async (tx) => {
      for (const row of chunk) {
        const encrypted = encryptMessage(row.text)
        await tx.query(
          `INSERT INTO messages
            (id, chat_id, sender_id, ciphertext, iv, auth_tag, encryption_version,
             search_text, sent_at, imported_from_name)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            request.params.chatId,
            request.user.id,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            encrypted.version,
            normalizeSearchText(row.text),
            row.sentAt,
            row.fromName,
          ],
        )
        imported += 1
      }
    })
  }

  response.status(201).json({ imported, skipped })
})

// ── Scheduled messages ────────────────────────────────────────────────────────

router.get('/api/chats/:chatId/scheduled-messages', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  if (member.type === 'channel') {
    requirePermission(member, 'post_messages', 'Only channel admins can view scheduled posts')
  }
  const result = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.chat_id = $1
       AND m.scheduled_at IS NOT NULL
       AND m.sent_at IS NULL
       AND (m.sender_id = $2 OR $3 = TRUE)
     ORDER BY m.scheduled_at ASC`,
    [request.params.chatId, request.user.id, hasPermission(member, 'post_messages')],
  )
  const messages = await publicMessagesFromRows(request.params.chatId, result.rows, request.user.id)
  response.json({ messages })
})

router.post('/api/chats/:chatId/scheduled-messages/:messageId/send-now', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  const scheduledResult = await db.query(
    `SELECT sender_id
     FROM messages
     WHERE id = $1 AND chat_id = $2 AND scheduled_at IS NOT NULL AND sent_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const scheduled = scheduledResult.rows[0]
  if (!scheduled) { response.status(404).json({ error: 'Scheduled message not found' }); return }
  if (scheduled.sender_id !== request.user.id) {
    requirePermission(member, 'post_messages', 'Only channel admins can publish scheduled posts')
  }
  await publishScheduledMessage(request.params.messageId)
  response.json({ messageId: request.params.messageId, sent: true })
})

router.delete('/api/chats/:chatId/scheduled-messages/:messageId', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  const result = await db.query(
    `DELETE FROM messages
     WHERE id = $1 AND chat_id = $2
       AND scheduled_at IS NOT NULL
       AND sent_at IS NULL
       AND (sender_id = $3 OR $4 = TRUE)
     RETURNING id`,
    [
      request.params.messageId,
      request.params.chatId,
      request.user.id,
      hasPermission(member, 'post_messages'),
    ],
  )
  if (!result.rows.length) {
    response.status(404).json({ error: 'Scheduled message not found' })
    return
  }
  response.status(204).end()
})

// ── Poll votes ────────────────────────────────────────────────────────────────

router.post('/api/chats/:chatId/messages/:messageId/poll-votes', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(pollVoteSchema, request.body)
  const pollResult = await db.query(
    `SELECT p.id, p.multiple_choice, p.closed_at
     FROM polls p
     JOIN messages m ON m.id = p.message_id
     WHERE p.message_id = $1 AND m.chat_id = $2 AND m.deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const poll = pollResult.rows[0]
  if (!poll || poll.closed_at) {
    response.status(404).json({ error: 'Open poll not found' })
    return
  }
  if (!isDatabaseTrue(poll.multiple_choice) && input.optionIds.length > 1) {
    response.status(400).json({ error: 'Poll accepts one option only' })
    return
  }
  const optionResult = await db.query(
    `SELECT id FROM poll_options
     WHERE poll_id = $1 AND id = ANY($2::uuid[])`,
    [poll.id, input.optionIds],
  )
  if (optionResult.rows.length !== input.optionIds.length) {
    response.status(400).json({ error: 'One or more poll options are invalid' })
    return
  }
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [
      poll.id,
      request.user.id,
    ])
    for (const optionId of input.optionIds) {
      await tx.query(
        `INSERT INTO poll_votes (poll_id, option_id, user_id)
         VALUES ($1, $2, $3)`,
        [poll.id, optionId, request.user.id],
      )
    }
  })
  const rows = await db.query(
    `SELECT ${MESSAGE_SELECT_COLUMNS}
     FROM messages m
     LEFT JOIN media_files mf ON mf.id = m.media_id
     WHERE m.id = $1 AND m.chat_id = $2`,
    [request.params.messageId, request.params.chatId],
  )
  const [message] = await publicMessagesFromRows(request.params.chatId, rows.rows, request.user.id)
  const payload = {
    type: 'message:poll',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    poll: message.poll,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

// ── Channel post views ────────────────────────────────────────────────────────

router.post('/api/chats/:chatId/messages/:messageId/view', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT m.id
     FROM messages m
     JOIN chats c ON c.id = m.chat_id
     WHERE m.id = $1 AND m.chat_id = $2 AND c.type = 'channel'
       AND m.deleted_at IS NULL
       AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
       AND m.sent_at IS NOT NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Channel post not found' })
    return
  }
  const inserted = await db.query(
    `INSERT INTO message_views (message_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (message_id, user_id) DO NOTHING
     RETURNING message_id`,
    [request.params.messageId, request.user.id],
  )
  if (inserted.rows.length) {
    await db.query(
      `INSERT INTO channel_post_stats (message_id, views)
       VALUES ($1, 1)
       ON CONFLICT (message_id)
       DO UPDATE SET views = channel_post_stats.views + 1,
                     updated_at = NOW()`,
      [request.params.messageId],
    )
  }
  const stats = await db.query(
    'SELECT views, reposts FROM channel_post_stats WHERE message_id = $1',
    [request.params.messageId],
  )
  response.json({
    messageId: request.params.messageId,
    stats: {
      views: Number(stats.rows[0]?.views || 0),
      reposts: Number(stats.rows[0]?.reposts || 0),
    },
  })
})

router.get('/api/chats/:chatId/channel-stats', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) { response.status(404).json({ error: 'Chat not found' }); return }
  if (member.type !== 'channel') {
    response.status(400).json({ error: 'Stats are available only for channels' })
    return
  }
  requirePermission(member, 'view_stats', 'Only channel admins can view stats')
  const [subscriberResult, postResult] = await Promise.all([
    db.query('SELECT COUNT(*)::integer AS count FROM chat_members WHERE chat_id = $1', [
      request.params.chatId,
    ]),
    db.query(
      `SELECT COUNT(m.id)::integer AS posts,
              COALESCE(SUM(cps.views), 0)::integer AS views,
              COALESCE(SUM(cps.reposts), 0)::integer AS reposts
       FROM messages m
       LEFT JOIN channel_post_stats cps ON cps.message_id = m.id
       WHERE m.chat_id = $1
         AND m.deleted_at IS NULL
         AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
         AND m.sent_at IS NOT NULL`,
      [request.params.chatId],
    ),
  ])
  response.json({
    subscribers: Number(subscriberResult.rows[0]?.count || 0),
    posts: Number(postResult.rows[0]?.posts || 0),
    views: Number(postResult.rows[0]?.views || 0),
    reposts: Number(postResult.rows[0]?.reposts || 0),
  })
})

// ── Message edit / delete ─────────────────────────────────────────────────────

router.patch('/api/chats/:chatId/messages/:messageId', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(editMessageSchema, request.body)
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND sender_id = $3 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId, request.user.id],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Editable message not found' })
    return
  }

  const encrypted = encryptMessage(input.text)
  const editedAt = new Date().toISOString()
  await db.query(
    `UPDATE messages
     SET ciphertext = $1,
         iv = $2,
         auth_tag = $3,
         encryption_version = $4,
         edited_at = $5,
         search_text = $6
     WHERE id = $7`,
    [
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.version,
      editedAt,
      normalizeSearchText(input.searchText),
      request.params.messageId,
    ],
  )

  const payload = {
    type: 'message:edited',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    text: input.text,
    editedAt,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

router.delete('/api/chats/:chatId/messages/:messageId', requireAuth, async (request, response) => {
  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id, sender_id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  const message = messageResult.rows[0]
  if (!message) {
    response.status(404).json({ error: 'Deletable message not found' })
    return
  }
  if (message.sender_id !== request.user.id) {
    requirePermission(member, 'delete_messages', 'Only moderators can delete others messages')
  }

  const deletedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM message_reactions WHERE message_id = $1', [request.params.messageId])
    await tx.query(
      `UPDATE messages
       SET deleted_at = $1, media_id = NULL, reply_to_id = NULL
      WHERE id = $2`,
      [deletedAt, request.params.messageId],
    )
    if (message.sender_id !== request.user.id) {
      await appendAdminLog(tx, {
        chatId: request.params.chatId,
        actorUserId: request.user.id,
        targetUserId: message.sender_id,
        action: 'message.delete',
        metadata: { messageId: request.params.messageId },
      })
    }
  })

  const payload = {
    type: 'message:deleted',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    deletedAt,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

router.post('/api/chats/:chatId/messages/:messageId/delete-for-me', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const deletedAt = new Date().toISOString()
  await db.query(
    `INSERT INTO message_user_deletions (message_id, user_id, deleted_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id)
     DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
    [request.params.messageId, request.user.id, deletedAt],
  )
  response.json({
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    deletedForMe: true,
    deletedAt,
  })
})

router.post('/api/chats/:chatId/clear-history', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }

  const clearedAt = new Date().toISOString()
  await db.query(
    `INSERT INTO chat_history_clears (chat_id, user_id, cleared_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id, user_id)
     DO UPDATE SET cleared_at = EXCLUDED.cleared_at`,
    [request.params.chatId, request.user.id, clearedAt],
  )
  response.json({ chatId: request.params.chatId, clearedAt })
})

// ── Pinned message ────────────────────────────────────────────────────────────

router.patch('/api/chats/:chatId/pinned-message', requireAuth, async (request, response) => {
  const chat = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!chat) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  requirePermission(chat, 'pin_messages', 'Only moderators can pin messages')
  const input = parseBody(pinMessageSchema, request.body)

  if (input.messageId) {
    const msgResult = await db.query(
      'SELECT id FROM messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL LIMIT 1',
      [input.messageId, request.params.chatId],
    )
    if (!msgResult.rows.length) {
      response.status(404).json({ error: 'Message not found' })
      return
    }
  }

  await db.transaction(async (tx) => {
    await tx.query('UPDATE chats SET pinned_message_id = $1 WHERE id = $2', [
      input.messageId,
      request.params.chatId,
    ])
    await appendAdminLog(tx, {
      chatId: request.params.chatId,
      actorUserId: request.user.id,
      action: input.messageId ? 'message.pin' : 'message.unpin',
      metadata: { messageId: input.messageId },
    })
  })

  const payload = {
    type: 'chat:pinned-message',
    chatId: request.params.chatId,
    messageId: input.messageId,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

// Mark messages as read up to a given message
router.post('/api/chats/:chatId/read', requireAuth, async (request, response) => {
  const input = parseBody(markReadSchema, request.body)
  const { upToMessageId } = input

  const member = await requireChatMemberRow(request.params.chatId, request.user.id)
  if (!member) return response.status(403).json({ error: 'not a member' })

  const messagesToMark = await db.query(
    `SELECT id FROM messages
     WHERE chat_id = $1
       AND sender_id != $2
       AND deleted_at IS NULL
       AND (disappears_at IS NULL OR disappears_at > NOW())
       AND sent_at IS NOT NULL
       AND sent_at <= (SELECT sent_at FROM messages WHERE id = $3 AND chat_id = $1 LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM message_reads WHERE message_id = messages.id AND user_id = $2)`,
    [request.params.chatId, request.user.id, upToMessageId],
  )

  const count = messagesToMark.rows.length
  if (count === 0) return response.json({ ok: true, count: 0 })

  const messageIds = messagesToMark.rows.map((r) => r.id)
  await db.query(
    `INSERT INTO message_reads (message_id, user_id, read_at)
     SELECT unnest($1::uuid[]), $2, NOW()
     ON CONFLICT DO NOTHING`,
    [messageIds, request.user.id],
  )

  await db.query(
    `UPDATE chat_members SET last_read_message_id = $1 WHERE chat_id = $2 AND user_id = $3`,
    [input.upToMessageId, request.params.chatId, request.user.id],
  )

  await sendToChatExcept(request.params.chatId, request.user.id, {
    type: 'chat:read',
    chatId: request.params.chatId,
    userId: request.user.id,
    userName: request.user.name,
    upToMessageId,
    readAt: new Date().toISOString(),
  })

  return response.json({ ok: true, count: messageIds.length })
})

router.get('/api/chats/:chatId/messages/:messageId/read-by', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }
  const result = await db.query(
    `SELECT u.id, u.name, u.username, mr.read_at
     FROM message_reads mr
     JOIN users u ON u.id = mr.user_id
     WHERE mr.message_id = $1
     ORDER BY mr.read_at ASC`,
    [request.params.messageId],
  )
  response.json(result.rows)
})

// ── Reactions ─────────────────────────────────────────────────────────────────

router.post('/api/chats/:chatId/messages/:messageId/reactions', requireAuth, async (request, response) => {
  if (!(await isChatMember(request.params.chatId, request.user.id))) {
    response.status(404).json({ error: 'Chat not found' })
    return
  }
  const input = parseBody(reactionSchema, request.body)
  const messageResult = await db.query(
    `SELECT id FROM messages
     WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [request.params.messageId, request.params.chatId],
  )
  if (!messageResult.rows.length) {
    response.status(404).json({ error: 'Message not found' })
    return
  }

  const existing = await db.query(
    `SELECT 1 FROM message_reactions
     WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [request.params.messageId, request.user.id, input.emoji],
  )
  if (existing.rows.length) {
    await db.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [request.params.messageId, request.user.id, input.emoji],
    )
  } else {
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)`,
      [request.params.messageId, request.user.id, input.emoji],
    )
  }

  const reactions = await getReactionCounts(request.params.messageId)
  const payload = {
    type: 'message:reactions',
    chatId: request.params.chatId,
    messageId: request.params.messageId,
    reactions,
  }
  await sendToChat(request.params.chatId, payload)
  response.json(payload)
})

export default router
