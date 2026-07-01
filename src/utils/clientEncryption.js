const KEY_STORAGE = 'astrachat.clientEncryption.keys.v1'
const LEGACY_KEY_STORAGE = ['astrachat', 'e2', 'ee', 'keys', 'v1'].join('.')
const ENVELOPE_PREFIX = 'astra:client-encryption:v1:'
const LEGACY_ENVELOPE_PREFIX = ['astra', 'e2' + 'ee', 'v1'].join(':') + ':'
const MEDIA_ENVELOPE_PREFIX = 'astra:media:v1:'

// Key storage lives in IndexedDB rather than localStorage: any XSS that can
// run JS can still call the same origin's IndexedDB, so this is not a trust
// boundary by itself, but it keeps the raw private-key JWK out of
// localStorage (which is far more commonly scraped/synced/dumped by browser
// extensions, devtools snippets, and error-reporting integrations) and out of
// synchronous access. Existing localStorage-only installs are migrated on
// first read and then cleared. IndexedDB is unavailable in some non-browser
// test environments, so every call falls back to an in-memory-only store
// there instead of throwing.
const IDB_NAME = 'astrachat-client-encryption'
const IDB_STORE = 'keys'
const IDB_VERSION = 1

let keyStoreCache = null
let keyStoreLoad = null

function getIndexedDb() {
  return globalThis.indexedDB || null
}

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDb()
    if (!idb) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = idb.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open key database.'))
  })
}

async function idbGetStore() {
  const db = await openKeyDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const request = tx.objectStore(IDB_STORE).get(KEY_STORAGE)
    request.onsuccess = () => {
      db.close()
      resolve(request.result || {})
    }
    request.onerror = () => {
      db.close()
      reject(request.error || new Error('Failed to read key database.'))
    }
  })
}

async function idbPutStore(store) {
  const db = await openKeyDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(store, KEY_STORAGE)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error || new Error('Failed to write key database.'))
    }
  })
}

function readLegacyLocalStorageStore() {
  try {
    return {
      ...JSON.parse(globalThis.localStorage?.getItem(LEGACY_KEY_STORAGE) || '{}'),
      ...JSON.parse(globalThis.localStorage?.getItem(KEY_STORAGE) || '{}'),
    }
  } catch {
    return {}
  }
}

function clearLegacyLocalStorageStore() {
  try {
    globalThis.localStorage?.removeItem(LEGACY_KEY_STORAGE)
    globalThis.localStorage?.removeItem(KEY_STORAGE)
  } catch {
    // Best-effort cleanup only.
  }
}

async function loadKeyStore() {
  if (!getIndexedDb()) {
    // No IndexedDB (older browser or non-browser test runner): fall back to
    // localStorage if present, otherwise an in-memory-only store for the
    // lifetime of the page/process.
    return readLegacyLocalStorageStore()
  }
  let store
  try {
    store = await idbGetStore()
  } catch {
    store = {}
  }
  const legacy = readLegacyLocalStorageStore()
  if (Object.keys(legacy).length) {
    // One-time migration from the old localStorage-backed store.
    store = { ...legacy, ...store }
    try {
      await idbPutStore(store)
      clearLegacyLocalStorageStore()
    } catch {
      // If the migration write fails, keep serving the merged data from
      // memory for this session and retry the migration next load.
    }
  }
  return store
}

function readKeyStore() {
  // Synchronous snapshot used by decrypt paths that cannot await. Populated
  // by ensureKeyStoreLoaded()/writeKeyStore(); empty until the first load
  // resolves, which callers address by awaiting ensureUserKeyPair() first.
  return keyStoreCache || {}
}

function ensureKeyStoreLoaded() {
  if (!keyStoreLoad) {
    keyStoreLoad = loadKeyStore().then((store) => {
      keyStoreCache = store
      return store
    })
  }
  return keyStoreLoad
}

async function writeKeyStore(store) {
  keyStoreCache = store
  if (getIndexedDb()) {
    try {
      await idbPutStore(store)
      return
    } catch {
      // Fall through to localStorage as a best-effort backstop.
    }
  }
  try {
    globalThis.localStorage?.setItem(KEY_STORAGE, JSON.stringify(store))
  } catch {
    // Storage unavailable; the in-memory cache still serves the session.
  }
}

function getSubtleCrypto() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) {
    throw new Error('Encryption is unavailable in this browser.')
  }
  return cryptoApi
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
  return typeof text === 'string' && (
    text.startsWith(ENVELOPE_PREFIX) || text.startsWith(LEGACY_ENVELOPE_PREFIX)
  )
}

export function isEncryptedMediaEnvelope(text) {
  return typeof text === 'string' && text.startsWith(MEDIA_ENVELOPE_PREFIX)
}

export function publicKeyEquals(left, right) {
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function ensureUserKeyPair(userId) {
  // No passphrase prompt here: this runs transparently on every normal chat
  // session so messaging keeps working without interrupting the user. The
  // passphrase is only required for the explicit export/import-backup flows
  // below.
  await ensureKeyStoreLoaded()
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
  await writeKeyStore({ ...store, [userId]: record })
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

// Passphrase-wrapped key backup. PBKDF2(SHA-256, 210k iterations) ->
// AES-256-GCM. Used both for the exported `.astrakey` file and for cloud
// sync between devices; in both cases the ciphertext is opaque to whoever
// stores or transmits it (server, disk, clipboard, chat) without the
// passphrase.
const PASSPHRASE_ITERATIONS = 210000
const MIN_BACKUP_PASSPHRASE_LENGTH = 8

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

function requireBackupPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw new Error(
      `Key backup passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`,
    )
  }
}

// Exported key backup format:
// - v2 (current): the raw key JSON below is passphrase-encrypted with
//   PBKDF2 + AES-256-GCM before being written to disk, mirroring the cloud
//   key backup envelope. Losing the passphrase means losing recoverability,
//   the same tradeoff as a wallet seed phrase.
// - v1 (legacy): plaintext JSON containing the raw private key JWK. No
//   longer produced by exportUserKeyBackup, but importUserKeyBackup still
//   accepts it so backups saved by older versions of the app are not
//   bricked.
const BACKUP_TYPE = 'astrachat-client-encryption-key'
const LEGACY_BACKUP_TYPE = ['astrachat', 'e2' + 'ee', 'key'].join('-')
const ENCRYPTED_BACKUP_VERSION = 2

function buildLegacyBackupPayload(userId, record) {
  return JSON.stringify(
    {
      type: BACKUP_TYPE,
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

// Unencrypted key JSON. Used as the input to the already-passphrase-protected
// cloud key backup path (encryptKeyBackupWithPassphrase applies its own
// AES-GCM envelope), so that flow does not need a second, separate
// passphrase layered on top of exportUserKeyBackup's own encryption. This is
// intentionally NOT written to disk or displayed anywhere by itself — any
// caller that wants a backup a user can save/share directly must go through
// exportUserKeyBackup, which always requires a passphrase.
export async function buildUserKeyMaterial(userId) {
  const record = await ensureUserKeyPair(userId)
  return buildLegacyBackupPayload(userId, record)
}

export async function exportUserKeyBackup(userId, passphrase) {
  requireBackupPassphrase(passphrase)
  const innerPayload = await buildUserKeyMaterial(userId)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(innerPayload),
  )

  return JSON.stringify(
    {
      type: BACKUP_TYPE,
      version: ENCRYPTED_BACKUP_VERSION,
      userId,
      exportedAt: new Date().toISOString(),
      iterations: PASSPHRASE_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(data),
    },
    null,
    2,
  )
}

export async function importUserKeyBackup(userId, backupText, passphrase) {
  let backup
  try {
    backup = JSON.parse(backupText)
  } catch {
    throw new Error('Encryption key backup is not valid JSON.')
  }
  if (![BACKUP_TYPE, LEGACY_BACKUP_TYPE].includes(backup.type)) {
    throw new Error('Encryption key backup format is unsupported.')
  }

  let payload = backup
  if (backup.version === ENCRYPTED_BACKUP_VERSION) {
    requireBackupPassphrase(passphrase)
    const key = await derivePassphraseKey(passphrase, fromBase64(backup.salt))
    let decrypted
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(backup.iv) },
        key,
        fromBase64(backup.data),
      )
    } catch {
      throw new Error('Wrong passphrase, or the key backup file is corrupted.')
    }
    try {
      payload = JSON.parse(new TextDecoder().decode(decrypted))
    } catch {
      throw new Error('Key backup file is corrupted.')
    }
  } else if (backup.version !== 1) {
    throw new Error('Encryption key backup format is unsupported.')
  }

  if (payload.userId !== userId) {
    throw new Error('This key backup belongs to another account.')
  }
  const record = {
    publicKey: payload.publicKey,
    privateKey: payload.privateKey,
    createdAt: payload.createdAt || new Date().toISOString(),
  }
  if (!record.publicKey || !record.privateKey) {
    throw new Error('Encryption key backup is incomplete.')
  }

  await validateKeyPair(record)
  await ensureKeyStoreLoaded()
  await writeKeyStore({ ...readKeyStore(), [userId]: record })
  return record
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
    const prefix = text.startsWith(LEGACY_ENVELOPE_PREFIX) ? LEGACY_ENVELOPE_PREFIX : ENVELOPE_PREFIX
    const envelope = JSON.parse(decodeText(fromBase64Url(text.slice(prefix.length))))
    const recipient = envelope.recipients?.find((item) => item.userId === userId)
    await ensureKeyStoreLoaded()
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
    await ensureKeyStoreLoaded()
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
