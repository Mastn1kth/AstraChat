import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { config } from './config.js'

const scrypt = promisify(scryptCallback)
const SCRYPT_OPTIONS = {
  N: 65536,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
}
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derivedKey = await scrypt(password, salt, 64, SCRYPT_OPTIONS)
  return {
    salt: salt.toString('base64'),
    hash: Buffer.from(derivedKey).toString('base64'),
  }
}

export async function verifyPassword(password, saltBase64, hashBase64) {
  const salt = Buffer.from(saltBase64, 'base64')
  const expectedHash = Buffer.from(hashBase64, 'base64')
  const derivedKey = Buffer.from(await scrypt(password, salt, expectedHash.length, SCRYPT_OPTIONS))
  return expectedHash.length === derivedKey.length && timingSafeEqual(expectedHash, derivedKey)
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createTotpSecret() {
  return base32Encode(randomBytes(20))
}

export function createTotpUri({ issuer = 'Onda', account, secret }) {
  const label = `${issuer}:${account}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

export function verifyTotpCode(secret, code, { window = 1, now = Date.now() } = {}) {
  const normalizedCode = String(code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalizedCode)) return false
  const secretBytes = base32Decode(secret)
  const counter = Math.floor(now / 1000 / 30)
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = createTotpCode(secretBytes, counter + offset)
    if (safeStringEqual(expected, normalizedCode)) return true
  }
  return false
}

function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let current = 0
  const bytes = []
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) continue
    current = (current << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function createTotpCode(secretBytes, counter) {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuffer.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', secretBytes).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  )
  return String(binary % 1000000).padStart(6, '0')
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function encryptMessage(plaintext) {
  return encryptBuffer(Buffer.from(plaintext, 'utf8'))
}

export function encryptBuffer(buffer) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.messageKey, iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    version: 1,
  }
}

export function decryptMessage({ ciphertext, iv, authTag }) {
  return decryptBuffer({ ciphertext, iv, authTag }).toString('utf8')
}

export function decryptBuffer({ ciphertext, iv, authTag }) {
  const decipher = createDecipheriv('aes-256-gcm', config.messageKey, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ])
}
