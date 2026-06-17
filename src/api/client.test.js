import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getMessageReadBy } from './client'

const CHAT_ID = '550e8400-e29b-41d4-a716-446655440000'
const MESSAGE_ID = '660e8400-e29b-41d4-a716-446655440001'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getMessageReadBy', () => {
  it('calls the correct URL and returns reader data', async () => {
    const readers = [
      { id: 'user-1', name: 'Alice', username: 'alice', read_at: '2026-06-10T10:00:00Z' },
      { id: 'user-2', name: 'Bob', username: 'bob', read_at: '2026-06-10T10:01:00Z' },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(readers),
    })

    const result = await getMessageReadBy(CHAT_ID, MESSAGE_ID)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = globalThis.fetch.mock.calls[0]
    expect(url).toContain(`/api/chats/${encodeURIComponent(CHAT_ID)}/messages/${encodeURIComponent(MESSAGE_ID)}/read-by`)
    expect(opts.method).toBeUndefined()
    expect(result).toEqual(readers)
  })

  it('throws on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Message not found' }),
    })

    await expect(getMessageReadBy(CHAT_ID, MESSAGE_ID)).rejects.toThrow('Message not found')
  })

  it('encodes special characters in IDs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })

    await getMessageReadBy('chat/1', 'msg+1')

    const [url] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/api/chats/chat%2F1/messages/msg%2B1/read-by')
  })
})
