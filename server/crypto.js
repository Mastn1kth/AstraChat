import {
  createCipheriv,
  createDecipheriv,
  createHash,
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
