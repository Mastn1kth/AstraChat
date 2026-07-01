import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createMediaAccessToken,
  createMediaCdnUrl,
  verifyMediaAccessToken,
} from './media-cdn.js'

describe('media CDN signing', () => {
  it('creates signed CDN URLs only for client-encrypted media', () => {
    const url = createMediaCdnUrl({
      mediaId: 'media-1',
      userId: 'user-1',
      clientEncrypted: true,
      baseUrl: 'https://cdn.example.com/media-edge/',
      ttlSeconds: 60,
      now: new Date('2026-06-18T00:00:00Z'),
    })

    assert.match(url, /^https:\/\/cdn\.example\.com\/media-edge\/api\/media\/media-1\/ciphertext\?/)
    assert.match(url, /userId=user-1/)
    assert.match(url, /expires=1781740860/)
    assert.match(url, /token=/)

    assert.equal(createMediaCdnUrl({
      mediaId: 'media-1',
      userId: 'user-1',
      clientEncrypted: false,
      baseUrl: 'https://cdn.example.com/',
    }), '')
  })

  it('rejects expired or tampered media CDN tokens', () => {
    const token = createMediaAccessToken({
      mediaId: 'media-1',
      userId: 'user-1',
      expires: 1781740860,
    })

    assert.equal(verifyMediaAccessToken({
      mediaId: 'media-1',
      userId: 'user-1',
      expires: 1781740860,
      token,
      now: new Date('2026-06-18T00:00:30Z'),
    }), true)

    assert.equal(verifyMediaAccessToken({
      mediaId: 'media-2',
      userId: 'user-1',
      expires: 1781740860,
      token,
      now: new Date('2026-06-18T00:00:30Z'),
    }), false)

    assert.equal(verifyMediaAccessToken({
      mediaId: 'media-1',
      userId: 'user-1',
      expires: 1781740860,
      token,
      now: new Date('2026-06-18T00:02:00Z'),
    }), false)
  })
})
