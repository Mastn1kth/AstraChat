import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

function signingInput({ mediaId, userId, expires }) {
  return `media-cdn:v1:${mediaId}:${userId}:${expires}`
}

function sign(input) {
  return createHmac('sha256', config.messageKey).update(input).digest('base64url')
}

export function createMediaAccessToken({ mediaId, userId, expires }) {
  return sign(signingInput({ mediaId, userId, expires }))
}

export function verifyMediaAccessToken({ mediaId, userId, expires, token, now = new Date() }) {
  if (!mediaId || !userId || !expires || !token) return false
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry <= Math.floor(now.getTime() / 1000)) return false

  const expected = Buffer.from(createMediaAccessToken({ mediaId, userId, expires: expiry }))
  const actual = Buffer.from(String(token))
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function createMediaCdnUrl({
  mediaId,
  userId,
  clientEncrypted,
  baseUrl = config.mediaCdn.url,
  ttlSeconds = config.mediaCdn.tokenTtlSeconds,
  now = new Date(),
}) {
  if (!clientEncrypted || !baseUrl || !mediaId || !userId) return ''
  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds
  const token = createMediaAccessToken({ mediaId, userId, expires })
  const url = new URL(`${baseUrl.replace(/\/+$/g, '')}/`)
  const basePath = url.pathname.replace(/\/+$/g, '')
  url.pathname = `${basePath}/api/media/${encodeURIComponent(mediaId)}/ciphertext`
  url.searchParams.set('userId', userId)
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('token', token)
  return url.toString()
}
