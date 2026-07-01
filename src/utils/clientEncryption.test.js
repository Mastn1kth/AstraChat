import { describe, expect, it } from 'vitest'
import {
  buildUserKeyMaterial,
  decryptTextForUser,
  encryptTextForRecipients,
  ensureUserKeyPair,
  exportUserKeyBackup,
  importUserKeyBackup,
} from './clientEncryption'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222'
const PASSPHRASE = 'correct horse battery staple'

// This module falls back to an in-memory-only key store when IndexedDB and
// localStorage are both unavailable, which is exactly the case in this
// plain-Node test environment. That fallback path is what gets exercised
// below; it also means state does not leak between tests as long as each
// test uses distinct user ids or re-imports a fresh backup.

describe('clientEncryption key backup', () => {
  it('ensureUserKeyPair creates and reuses a key pair without a passphrase', async () => {
    const first = await ensureUserKeyPair(USER_ID)
    expect(first.publicKey).toBeTruthy()
    expect(first.privateKey).toBeTruthy()

    const second = await ensureUserKeyPair(USER_ID)
    expect(second.publicKey).toEqual(first.publicKey)
    expect(second.privateKey).toEqual(first.privateKey)
  })

  it('exportUserKeyBackup requires a passphrase of at least 8 characters', async () => {
    await expect(exportUserKeyBackup(USER_ID)).rejects.toThrow(/passphrase/i)
    await expect(exportUserKeyBackup(USER_ID, 'short')).rejects.toThrow(/passphrase/i)
  })

  it('exportUserKeyBackup produces an encrypted v2 backup with no raw private key material', async () => {
    const backupText = await exportUserKeyBackup(USER_ID, PASSPHRASE)
    const backup = JSON.parse(backupText)

    expect(backup.version).toBe(2)
    expect(backup.userId).toBe(USER_ID)
    expect(backup.data).toBeTruthy()
    expect(backup.salt).toBeTruthy()
    expect(backup.iv).toBeTruthy()
    expect(backup.iterations).toBeGreaterThanOrEqual(210000)
    // The plaintext JWK 'd' component must never appear in the exported file.
    expect(backupText).not.toMatch(/"privateKey"/)
    expect(backupText).not.toMatch(/"d":/)
  })

  it('importUserKeyBackup round-trips an encrypted v2 backup with the correct passphrase', async () => {
    const original = await ensureUserKeyPair(USER_ID)
    const backupText = await exportUserKeyBackup(USER_ID, PASSPHRASE)

    const restored = await importUserKeyBackup(USER_ID, backupText, PASSPHRASE)
    expect(restored.publicKey).toEqual(original.publicKey)
    expect(restored.privateKey).toEqual(original.privateKey)
  })

  it('importUserKeyBackup rejects an encrypted v2 backup without a passphrase', async () => {
    const backupText = await exportUserKeyBackup(USER_ID, PASSPHRASE)
    await expect(importUserKeyBackup(USER_ID, backupText)).rejects.toThrow(/passphrase/i)
  })

  it('importUserKeyBackup rejects the wrong passphrase', async () => {
    const backupText = await exportUserKeyBackup(USER_ID, PASSPHRASE)
    await expect(
      importUserKeyBackup(USER_ID, backupText, 'totally-wrong-passphrase'),
    ).rejects.toThrow(/wrong passphrase|corrupted/i)
  })

  it('importUserKeyBackup rejects a backup belonging to another account', async () => {
    const backupText = await exportUserKeyBackup(USER_ID, PASSPHRASE)
    await expect(
      importUserKeyBackup(OTHER_USER_ID, backupText, PASSPHRASE),
    ).rejects.toThrow(/belongs to another account/i)
  })

  it('importUserKeyBackup still accepts a legacy v1 plaintext backup', async () => {
    const legacyUserId = '33333333-3333-3333-3333-333333333333'
    const record = await ensureUserKeyPair(legacyUserId)
    const legacyBackup = JSON.stringify({
      type: 'astrachat-client-encryption-key',
      version: 1,
      userId: legacyUserId,
      createdAt: record.createdAt,
      exportedAt: new Date().toISOString(),
      publicKey: record.publicKey,
      privateKey: record.privateKey,
    })

    // No passphrase supplied: legacy plaintext backups do not require one.
    const restored = await importUserKeyBackup(legacyUserId, legacyBackup)
    expect(restored.publicKey).toEqual(record.publicKey)
    expect(restored.privateKey).toEqual(record.privateKey)
  })

  it('importUserKeyBackup rejects malformed JSON and unsupported formats', async () => {
    await expect(importUserKeyBackup(USER_ID, 'not json')).rejects.toThrow(/not valid JSON/i)
    await expect(
      importUserKeyBackup(USER_ID, JSON.stringify({ type: 'something-else', version: 1 })),
    ).rejects.toThrow(/unsupported/i)
  })

  it('buildUserKeyMaterial returns plain key JSON usable for the cloud backup envelope', async () => {
    const cloudUserId = '44444444-4444-4444-4444-444444444444'
    const record = await ensureUserKeyPair(cloudUserId)
    const material = await buildUserKeyMaterial(cloudUserId)
    const parsed = JSON.parse(material)

    expect(parsed.userId).toBe(cloudUserId)
    expect(parsed.publicKey).toEqual(record.publicKey)
    expect(parsed.privateKey).toEqual(record.privateKey)

    // The plain material itself is importable directly (this is what the
    // cloud-backup restore path does after it decrypts with its own
    // passphrase-derived key).
    const restored = await importUserKeyBackup(cloudUserId, material)
    expect(restored.publicKey).toEqual(record.publicKey)
  })

  it('encrypted messages remain decryptable for the intended recipient after import', async () => {
    const recipientId = '66666666-6666-6666-6666-666666666666'
    const recipientKeys = await ensureUserKeyPair(recipientId)

    const envelope = await encryptTextForRecipients('hello from the audit', [
      { id: recipientId, encryptionPublicKey: recipientKeys.publicKey },
    ])
    expect(envelope).not.toContain('hello from the audit')

    const result = await decryptTextForUser(envelope, recipientId)
    expect(result.failed).toBe(false)
    expect(result.text).toBe('hello from the audit')

    // A backup/import round trip must not change what the key can decrypt.
    const backupText = await exportUserKeyBackup(recipientId, PASSPHRASE)
    await importUserKeyBackup(recipientId, backupText, PASSPHRASE)
    const resultAfterImport = await decryptTextForUser(envelope, recipientId)
    expect(resultAfterImport.failed).toBe(false)
    expect(resultAfterImport.text).toBe('hello from the audit')
  })
})
