import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptBuffer } from '../crypto.js'
import { createMediaCdnUrl, verifyMediaAccessToken } from '../media-cdn.js'
import {
  cleanupUploadedFile,
  compressImage,
  compressVideo,
  getMediaKind,
  mediaUpload,
  readUploadedFile,
} from '../media.js'
import { deleteMediaObject, saveMediaObject } from '../storage.js'
import { uploadLimiter } from '../limiters.js'
import {
  assertCanSendToChat,
  encryptUploadedFileToStorage,
  formatByteSize,
  isDatabaseTrue,
  isChatMember,
  parseBooleanFormValue,
  requireUnblockedPrivateChat,
  serverMediaTransformMaxBytes,
  streamDecryptedMedia,
  validateClientMediaMetadata,
} from '../server-helpers.js'

const router = Router()

router.post('/api/media', requireAuth, uploadLimiter, mediaUpload.single('file'), async (request, response) => {
  let storageName
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No file uploaded' })
      return
    }

    const clientEncrypted = parseBooleanFormValue(request.body.clientEncrypted)
    const clientMetadata = clientEncrypted ? validateClientMediaMetadata(request.body) : null
    const kind = clientMetadata?.kind || getMediaKind(request.file.mimetype)
    if (!kind) {
      response.status(415).json({ error: 'Unsupported media type' })
      return
    }

    const chatId = request.body.chatId || null
    if (chatId) {
      await assertCanSendToChat(chatId, request.user.id, { media: true })
      await requireUnblockedPrivateChat(chatId, request.user.id)
    }

    const mediaId = randomUUID()
    storageName = `${mediaId}.bin`
    const streamsOriginalFile = clientEncrypted || kind === 'audio' || kind === 'voice' || kind === 'video_note'
    let stored
    let mediaInfo

    if (streamsOriginalFile) {
      stored = await encryptUploadedFileToStorage(request.file, storageName)
      mediaInfo = {
        mimeType: clientMetadata?.mimeType || request.file.mimetype,
        width: clientMetadata?.width ?? null,
        height: clientMetadata?.height ?? null,
        plainSize: clientMetadata?.plainSize || request.file.size,
        originalSize: clientMetadata?.originalSize || request.file.size,
        durationMs: clientMetadata?.durationMs ?? null,
      }
    } else {
      if (request.file.size > serverMediaTransformMaxBytes) {
        response.status(413).json({
          error: `Large image and video uploads must be encrypted by the client. Server transform limit is ${formatByteSize(serverMediaTransformMaxBytes)}.`,
        })
        return
      }

      const fileBuffer = await readUploadedFile(request.file)
      const compressed = kind === 'image'
        ? await compressImage(fileBuffer)
        : kind === 'video'
          ? await compressVideo(fileBuffer)
          : {
              data: fileBuffer,
              mimeType: request.file.mimetype,
              width: null,
              height: null,
            }
      const encrypted = encryptBuffer(compressed.data)
      await saveMediaObject(storageName, Buffer.from(encrypted.ciphertext, 'base64'))
      stored = {
        encryptedSize: Buffer.byteLength(encrypted.ciphertext, 'base64'),
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      }
      mediaInfo = {
        mimeType: compressed.mimeType,
        width: compressed.width,
        height: compressed.height,
        plainSize: compressed.data.length,
        originalSize: request.file.size,
        durationMs: null,
      }
    }

    try {
      await db.query(
        `INSERT INTO media_files
          (id, owner_id, chat_id, kind, original_name, mime_type, storage_name,
           encrypted_size, plain_size, original_size, width, height, client_encrypted,
           media_envelope, duration_ms, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          mediaId,
          request.user.id,
          chatId,
          kind,
          clientMetadata?.originalName || request.file.originalname.slice(0, 255),
          mediaInfo.mimeType,
          storageName,
          stored.encryptedSize,
          mediaInfo.plainSize,
          mediaInfo.originalSize,
          mediaInfo.width,
          mediaInfo.height,
          clientEncrypted,
          clientMetadata?.envelope || '',
          mediaInfo.durationMs,
          stored.iv,
          stored.authTag,
        ],
      )
    } catch (error) {
      await deleteMediaObject(storageName).catch(() => {})
      throw error
    }

    response.status(201).json({
      media: {
        id: mediaId,
        kind,
        name: clientMetadata?.originalName || request.file.originalname,
        mimeType: mediaInfo.mimeType,
        durationMs: mediaInfo.durationMs,
        size: mediaInfo.plainSize,
        originalSize: mediaInfo.originalSize,
        width: mediaInfo.width,
        height: mediaInfo.height,
        url: `/api/media/${mediaId}`,
        cdnUrl: createMediaCdnUrl({
          mediaId,
          userId: request.user.id,
          clientEncrypted,
        }),
        encrypted: clientEncrypted,
        envelope: clientMetadata?.envelope || '',
      },
    })
  } finally {
    await cleanupUploadedFile(request.file)
  }
})

router.get('/api/media/:mediaId/ciphertext', async (request, response) => {
  const userId = String(request.query.userId || '')
  const expires = Number(request.query.expires || 0)
  const token = String(request.query.token || '')

  if (!verifyMediaAccessToken({ mediaId: request.params.mediaId, userId, expires, token })) {
    response.status(403).json({ error: 'Invalid or expired media URL' })
    return
  }

  const result = await db.query(
    `SELECT id, owner_id, chat_id, mime_type, storage_name, encrypted_size, plain_size, iv, auth_tag,
            client_encrypted
     FROM media_files WHERE id = $1 LIMIT 1`,
    [request.params.mediaId],
  )
  const media = result.rows[0]
  if (!media || !isDatabaseTrue(media.client_encrypted)) {
    response.status(404).json({ error: 'Media not found' })
    return
  }

  const canRead =
    media.owner_id === userId ||
    (media.chat_id && (await isChatMember(media.chat_id, userId)))
  if (!canRead) {
    response.status(403).json({ error: 'Media access denied' })
    return
  }

  const maxAge = Math.max(0, Math.min(3600, expires - Math.floor(Date.now() / 1000)))
  response.setHeader('Cache-Control', `public, max-age=${maxAge}`)
  await streamDecryptedMedia(response, media, request.headers.range)
})

router.get('/api/media/:mediaId', requireAuth, async (request, response) => {
  const result = await db.query(
    `SELECT id, owner_id, chat_id, mime_type, storage_name, encrypted_size, plain_size, iv, auth_tag,
            client_encrypted
     FROM media_files WHERE id = $1 LIMIT 1`,
    [request.params.mediaId],
  )
  const media = result.rows[0]
  if (!media) {
    response.status(404).json({ error: 'Media not found' })
    return
  }

  const canRead =
    media.owner_id === request.user.id ||
    (media.chat_id && (await isChatMember(media.chat_id, request.user.id)))
  if (!canRead) {
    response.status(404).json({ error: 'Media not found' })
    return
  }

  await streamDecryptedMedia(response, media, request.headers.range)
})

export default router
