import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createCallMediaServerSession,
  verifyCallMediaServerToken,
} from './call-media-server.js'

describe('call media server sessions', () => {
  it('creates signed SFU/MCU join sessions', () => {
    const session = createCallMediaServerSession({
      callId: 'call-1',
      userId: 'user-1',
      mode: 'sfu',
      baseUrl: 'https://sfu.example.com/rooms/',
      ttlSeconds: 120,
      now: new Date('2026-06-18T00:00:00Z'),
    })

    assert.equal(session.mode, 'sfu')
    assert.equal(session.roomId, 'call-1')
    assert.equal(session.userId, 'user-1')
    assert.match(session.joinUrl, /^https:\/\/sfu\.example\.com\/rooms\/join\?/)
    assert.match(session.joinUrl, /roomId=call-1/)
    assert.match(session.joinUrl, /userId=user-1/)
    assert.match(session.joinUrl, /expires=1781740920/)
    assert.ok(session.token)

    assert.equal(verifyCallMediaServerToken({
      callId: 'call-1',
      userId: 'user-1',
      mode: 'sfu',
      expires: session.expires,
      token: session.token,
      now: new Date('2026-06-18T00:01:00Z'),
    }), true)
  })

  it('does not create external media sessions for mesh calls', () => {
    assert.equal(createCallMediaServerSession({
      callId: 'call-1',
      userId: 'user-1',
      mode: 'mesh',
      baseUrl: 'https://sfu.example.com',
    }), null)
  })

  it('rejects tampered or expired SFU/MCU tokens', () => {
    const session = createCallMediaServerSession({
      callId: 'call-1',
      userId: 'user-1',
      mode: 'mcu',
      baseUrl: 'https://mcu.example.com',
      ttlSeconds: 60,
      now: new Date('2026-06-18T00:00:00Z'),
    })

    assert.equal(verifyCallMediaServerToken({
      callId: 'call-2',
      userId: 'user-1',
      mode: 'mcu',
      expires: session.expires,
      token: session.token,
      now: new Date('2026-06-18T00:00:30Z'),
    }), false)

    assert.equal(verifyCallMediaServerToken({
      callId: 'call-1',
      userId: 'user-1',
      mode: 'mcu',
      expires: session.expires,
      token: session.token,
      now: new Date('2026-06-18T00:02:00Z'),
    }), false)
  })
})
