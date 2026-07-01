import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deletePushSubscriptionSchema } from './validation.js'

describe('validation schemas', () => {
  it('accepts web push endpoint URLs for deletion', () => {
    const result = deletePushSubscriptionSchema.parse({
      endpoint: 'https://push.example.com/subscription/123',
    })

    assert.equal(result.endpoint, 'https://push.example.com/subscription/123')
  })

  it('accepts native fcm endpoints for deletion', () => {
    const result = deletePushSubscriptionSchema.parse({
      endpoint: 'fcm:token-value',
    })

    assert.equal(result.endpoint, 'fcm:token-value')
  })

  it('rejects unsafe push deletion endpoints', () => {
    assert.throws(
      () => deletePushSubscriptionSchema.parse({ endpoint: 'not-a-url' }),
      /Endpoint must be a URL or fcm token endpoint/,
    )
  })
})
