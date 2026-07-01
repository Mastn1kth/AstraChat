import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

function signingInput({ callId, userId, mode, expires }) {
  return `call-media:v1:${mode}:${callId}:${userId}:${expires}`
}

function sign(input) {
  return createHmac('sha256', config.messageKey).update(input).digest('base64url')
}

export function createCallMediaServerToken({ callId, userId, mode, expires }) {
  return sign(signingInput({ callId, userId, mode, expires }))
}

export function verifyCallMediaServerToken({ callId, userId, mode, expires, token, now = new Date() }) {
  if (!callId || !userId || !['sfu', 'mcu'].includes(mode) || !expires || !token) return false
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry <= Math.floor(now.getTime() / 1000)) return false

  const expected = Buffer.from(createCallMediaServerToken({ callId, userId, mode, expires: expiry }))
  const actual = Buffer.from(String(token))
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function createCallMediaServerSession({
  callId,
  userId,
  mode = config.webrtc.groupMediaMode,
  baseUrl = config.webrtc.mediaServerUrl,
  ttlSeconds = config.webrtc.mediaServerTokenTtlSeconds,
  now = new Date(),
}) {
  if (mode === 'mesh') return null
  if (!callId || !userId || !['sfu', 'mcu'].includes(mode) || !baseUrl) return null

  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds
  const token = createCallMediaServerToken({ callId, userId, mode, expires })
  const url = new URL(`${baseUrl.replace(/\/+$/g, '')}/`)
  const basePath = url.pathname.replace(/\/+$/g, '')
  url.pathname = `${basePath}/join`
  url.searchParams.set('roomId', callId)
  url.searchParams.set('userId', userId)
  url.searchParams.set('mode', mode)
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('token', token)

  return {
    mode,
    roomId: callId,
    userId,
    url: baseUrl,
    joinUrl: url.toString(),
    expires,
    token,
  }
}
