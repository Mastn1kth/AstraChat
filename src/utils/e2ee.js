const KEY_STORAGE = 'astrachat.e2ee.keys.v1'
const ENVELOPE_PREFIX = 'astra:e2ee:v1:'
const MEDIA_ENVELOPE_PREFIX = 'astra:media:v1:'

function getSubtleCrypto() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) {
    throw new Error('Encryption is unavailable in this browser.')
  }
  return cryptoApi
}

function readKeyStore() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY_STORAGE) || '{}')
  } catch {
    return {}
  }
}

function writeKeyStore(store) {
  globalThis.localStorage?.setItem(KEY_STORAGE, JSON.stringify(store))
}

function toBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  )
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function encodeText(value) {
  return new TextEncoder().encode(value)
}

function decodeText(value) {
  return new TextDecoder().decode(value)
}

async function importPublicKey(jwk) {
  return getSubtleCrypto().subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

async function importPrivateKey(jwk) {
  return getSubtleCrypto().subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
}

export function isEncryptedEnvelope(text) {
  return typeof text === 'string' && text.startsWith(ENVELOPE_PREFIX)
}

export function isEncryptedMediaEnvelope(text) {
  return typeof text === 'string' && text.startsWith(MEDIA_ENVELOPE_PREFIX)
}

export function publicKeyEquals(left, right) {
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function ensureUserKeyPair(userId) {
  const store = readKeyStore()
  if (store[userId]?.publicKey && store[userId]?.privateKey) return store[userId]

  const cryptoApi = getSubtleCrypto()
  const pair = await cryptoApi.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const [publicKey, privateKey] = await Promise.all([
    cryptoApi.subtle.exportKey('jwk', pair.publicKey),
    cryptoApi.subtle.exportKey('jwk', pair.privateKey),
  ])

  const record = { publicKey, privateKey, createdAt: new Date().toISOString() }
  writeKeyStore({ ...store, [userId]: record })
  return record
}

async function validateKeyPair(record) {
  const cryptoApi = getSubtleCrypto()
  const [publicKey, privateKey] = await Promise.all([
    importPublicKey(record.publicKey),
    importPrivateKey(record.privateKey),
  ])
  const challenge = cryptoApi.getRandomValues(new Uint8Array(32))
  const encrypted = await cryptoApi.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, challenge)
  const decrypted = new Uint8Array(
    await cryptoApi.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encrypted),
  )
  if (!challenge.every((byte, index) => byte === decrypted[index])) {
    throw new Error('Encryption key backup is invalid.')
  }
}

export async function exportUserKeyBackup(userId) {
  const record = await ensureUserKeyPair(userId)
  return JSON.stringify(
    {
      type: 'astrachat-e2ee-key',
      version: 1,
      userId,
      createdAt: record.createdAt,
      exportedAt: new Date().toISOString(),
      publicKey: record.publicKey,
      privateKey: record.privateKey,
    },
    null,
    2,
  )
}

export async function importUserKeyBackup(userId, backupText) {
  let backup
  try {
    backup = JSON.parse(backupText)
  } catch {
    throw new Error('Encryption key backup is not valid JSON.')
  }
  if (backup.type !== 'astrachat-e2ee-key' || backup.version !== 1) {
    throw new Error('Encryption key backup format is unsupported.')
  }
  if (backup.userId !== userId) {
    throw new Error('This key backup belongs to another account.')
  }
  const record = {
    publicKey: backup.publicKey,
    privateKey: backup.privateKey,
    createdAt: backup.createdAt || new Date().toISOString(),
  }
  if (!record.publicKey || !record.privateKey) {
    throw new Error('Encryption key backup is incomplete.')
  }

  await validateKeyPair(record)
  writeKeyStore({ ...readKeyStore(), [userId]: record })
  return record
}

// Passphrase-wrapped key backup for cloud sync between devices.
// PBKDF2(SHA-256, 210k iterations) -> AES-256-GCM. The server stores only
// this opaque blob and can never recover the private key without the phrase.
const PASSPHRASE_ITERATIONS = 210000

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

async function derivePassphraseKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PASSPHRASE_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptKeyBackupWithPassphrase(backupText, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(backupText),
  )
  return JSON.stringify({
    type: 'astrachat-cloud-key',
    version: 1,
    iterations: PASSPHRASE_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  })
}

export async function decryptKeyBackupWithPassphrase(payloadText, passphrase) {
  let payload
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('Cloud key backup is corrupted.')
  }
  if (payload.type !== 'astrachat-cloud-key' || payload.version !== 1) {
    throw new Error('Cloud key backup format is unsupported.')
  }
  const key = await derivePassphraseKey(passphrase, fromBase64(payload.salt))
  let decrypted
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.data),
    )
  } catch {
    throw new Error('Wrong passphrase.')
  }
  return new TextDecoder().decode(decrypted)
}

export async function encryptTextForRecipients(plaintext, recipients) {
  if (!plaintext) return ''
  const uniqueRecipients = Array.from(
    new Map(
      recipients
        .filter((recipient) => recipient?.id && recipient.encryptionPublicKey)
        .map((recipient) => [recipient.id, recipient]),
    ).values(),
  )
  if (!uniqueRecipients.length) {
    throw new Error('Encryption key is missing for this chat.')
  }

  const cryptoApi = getSubtleCrypto()
  const contentKey = await cryptoApi.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, encodeText(plaintext)),
  )
  const rawContentKey = new Uint8Array(await cryptoApi.subtle.exportKey('raw', contentKey))
  const wrappedRecipients = await Promise.all(
    uniqueRecipients.map(async (recipient) => {
      const publicKey = await importPublicKey(recipient.encryptionPublicKey)
      const wrappedKey = new Uint8Array(
        await cryptoApi.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawContentKey),
      )
      return {
        userId: recipient.id,
        key: toBase64Url(wrappedKey),
      }
    }),
  )

  return `${ENVELOPE_PREFIX}${toBase64Url(
    encodeText(
      JSON.stringify({
        version: 1,
        algorithm: 'RSA-OAEP-256+A256GCM',
        iv: toBase64Url(iv),
        ciphertext: toBase64Url(ciphertext),
        recipients: wrappedRecipients,
      }),
    ),
  )}`
}

export async function encryptBlobForRecipients(blob, recipients) {
  const uniqueRecipients = Array.from(
    new Map(
      recipients
        .filter((recipient) => recipient?.id && recipient.encryptionPublicKey)
        .map((recipient) => [recipient.id, recipient]),
    ).values(),
  )
  if (!uniqueRecipients.length) {
    throw new Error('Encryption key is missing for this chat.')
  }

  const cryptoApi = getSubtleCrypto()
  const contentKey = await cryptoApi.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    contentKey,
    await blob.arrayBuffer(),
  )
  const rawContentKey = new Uint8Array(await cryptoApi.subtle.exportKey('raw', contentKey))
  const wrappedRecipients = await Promise.all(
    uniqueRecipients.map(async (recipient) => {
      const publicKey = await importPublicKey(recipient.encryptionPublicKey)
      const wrappedKey = new Uint8Array(
        await cryptoApi.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawContentKey),
      )
      return {
        userId: recipient.id,
        key: toBase64Url(wrappedKey),
      }
    }),
  )

  return {
    blob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    envelope: `${MEDIA_ENVELOPE_PREFIX}${toBase64Url(
      encodeText(
        JSON.stringify({
          version: 1,
          algorithm: 'RSA-OAEP-256+A256GCM',
          iv: toBase64Url(iv),
          recipients: wrappedRecipients,
        }),
      ),
    )}`,
  }
}

export async function decryptTextForUser(text, userId) {
  if (!isEncryptedEnvelope(text)) {
    return { text: text || '', encrypted: false, failed: false }
  }

  try {
    const envelope = JSON.parse(decodeText(fromBase64Url(text.slice(ENVELOPE_PREFIX.length))))
    const recipient = envelope.recipients?.find((item) => item.userId === userId)
    const privateKeyRecord = readKeyStore()[userId]
    if (!recipient || !privateKeyRecord?.privateKey) {
      throw new Error('Local private key is missing.')
    }

    const cryptoApi = getSubtleCrypto()
    const privateKey = await importPrivateKey(privateKeyRecord.privateKey)
    const rawContentKey = await cryptoApi.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      fromBase64Url(recipient.key),
    )
    const contentKey = await cryptoApi.subtle.importKey(
      'raw',
      rawContentKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv) },
      contentKey,
      fromBase64Url(envelope.ciphertext),
    )
    return { text: decodeText(plaintext), encrypted: true, failed: false }
  } catch {
    return {
      text: 'Encrypted message unavailable',
      encrypted: true,
      failed: true,
    }
  }
}

export async function decryptBlobForUser(blob, envelopeText, userId, mimeType) {
  if (!isEncryptedMediaEnvelope(envelopeText)) {
    return { blob, encrypted: false, failed: false }
  }

  try {
    const envelope = JSON.parse(
      decodeText(fromBase64Url(envelopeText.slice(MEDIA_ENVELOPE_PREFIX.length))),
    )
    const recipient = envelope.recipients?.find((item) => item.userId === userId)
    const privateKeyRecord = readKeyStore()[userId]
    if (!recipient || !privateKeyRecord?.privateKey) {
      throw new Error('Local private key is missing.')
    }

    const cryptoApi = getSubtleCrypto()
    const privateKey = await importPrivateKey(privateKeyRecord.privateKey)
    const rawContentKey = await cryptoApi.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      fromBase64Url(recipient.key),
    )
    const contentKey = await cryptoApi.subtle.importKey(
      'raw',
      rawContentKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv) },
      contentKey,
      await blob.arrayBuffer(),
    )
    return {
      blob: new Blob([plaintext], { type: mimeType || 'application/octet-stream' }),
      encrypted: true,
      failed: false,
    }
  } catch {
    return { blob: null, encrypted: true, failed: true }
  }
}
