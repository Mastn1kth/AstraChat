import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMessageText,
  hashMessageText,
  extractUrls,
  isLinkOnlyMessage,
  evaluateIdenticalMessageFlood,
  evaluateNewRecipientBurst,
  evaluateLinkSpamBurst,
  evaluateNewAccountVelocity,
  describeDecision,
} from './abuse-heuristics.js'

describe('abuse-heuristics: message normalization & hashing', () => {
  it('normalizes case, whitespace and punctuation so near-identical text matches', () => {
    const a = normalizeMessageText('Hey!!!   Check this out???')
    const b = normalizeMessageText('hey check this out')
    assert.equal(a, b)
  })

  it('collapses URLs to a placeholder so different links with the same wrapper text still match', () => {
    const a = normalizeMessageText('Free crypto at https://scam1.example/x')
    const b = normalizeMessageText('Free crypto at https://scam2.example/y?ref=123')
    assert.equal(a, b)
  })

  it('produces identical hashes for near-identical messages and different hashes for unrelated text', () => {
    const h1 = hashMessageText('Hello there, how are you?')
    const h2 = hashMessageText('hello there how are you')
    const h3 = hashMessageText('Completely unrelated message about lunch plans')
    assert.equal(h1, h2)
    assert.notEqual(h1, h3)
  })

  it('handles empty/undefined text without throwing', () => {
    assert.equal(typeof hashMessageText(''), 'string')
    assert.equal(typeof hashMessageText(undefined), 'string')
  })
})

describe('abuse-heuristics: link-only spam detection', () => {
  it('extracts URLs from text', () => {
    const urls = extractUrls('Check out https://example.com/promo and http://foo.bar')
    assert.equal(urls.length, 2)
  })

  it('flags a bare URL as link-only', () => {
    assert.equal(isLinkOnlyMessage('https://spammy.example/promo'), true)
  })

  it('flags a URL with a short CTA as link-only', () => {
    assert.equal(isLinkOnlyMessage('check this out https://spammy.example/promo now'), true)
  })

  it('does not flag a normal message that happens to contain a link', () => {
    const text = 'Hey, I found this great article about cooking pasta, take a look https://example.com/pasta and let me know what you think!'
    assert.equal(isLinkOnlyMessage(text), false)
  })

  it('does not flag messages with no URL at all', () => {
    assert.equal(isLinkOnlyMessage('just a normal message'), false)
  })

  it('does not flag an empty message', () => {
    assert.equal(isLinkOnlyMessage(''), false)
  })

  it('respects a custom maxExtraWords threshold', () => {
    const text = 'one two three https://example.com'
    assert.equal(isLinkOnlyMessage(text, { maxExtraWords: 2 }), false)
    assert.equal(isLinkOnlyMessage(text, { maxExtraWords: 3 }), true)
  })
})

describe('abuse-heuristics: threshold decisions', () => {
  it('identical message flood triggers at/above threshold, not below', () => {
    assert.equal(evaluateIdenticalMessageFlood(4, { threshold: 5 }).triggered, false)
    assert.equal(evaluateIdenticalMessageFlood(5, { threshold: 5 }).triggered, true)
    assert.equal(evaluateIdenticalMessageFlood(9, { threshold: 5 }).triggered, true)
  })

  it('new recipient burst triggers at/above threshold', () => {
    assert.equal(evaluateNewRecipientBurst(7, { threshold: 8 }).triggered, false)
    assert.equal(evaluateNewRecipientBurst(8, { threshold: 8 }).triggered, true)
  })

  it('link spam burst triggers at/above threshold', () => {
    assert.equal(evaluateLinkSpamBurst(2, { threshold: 3 }).triggered, false)
    assert.equal(evaluateLinkSpamBurst(3, { threshold: 3 }).triggered, true)
  })

  it('new account velocity only triggers when both new AND high-velocity', () => {
    const fiveMinutesMs = 5 * 60 * 1000
    const twoHoursMs = 2 * 60 * 60 * 1000

    // New account, high velocity → triggers
    assert.equal(
      evaluateNewAccountVelocity(fiveMinutesMs, 10, { maxAccountAgeMs: 30 * 60 * 1000, threshold: 6 }).triggered,
      true,
    )
    // New account, low velocity → does not trigger
    assert.equal(
      evaluateNewAccountVelocity(fiveMinutesMs, 2, { maxAccountAgeMs: 30 * 60 * 1000, threshold: 6 }).triggered,
      false,
    )
    // Old account, high velocity → does not trigger (not a "new account" pattern)
    assert.equal(
      evaluateNewAccountVelocity(twoHoursMs, 10, { maxAccountAgeMs: 30 * 60 * 1000, threshold: 6 }).triggered,
      false,
    )
  })

  it('treats a negative account age (clock skew) as not-new rather than crashing', () => {
    const decision = evaluateNewAccountVelocity(-1000, 10, { maxAccountAgeMs: 30 * 60 * 1000, threshold: 6 })
    assert.equal(decision.triggered, false)
    assert.equal(decision.isNewAccount, false)
  })
})

describe('abuse-heuristics: human-readable descriptions', () => {
  it('describes each heuristic type distinctly for the admin reports queue', () => {
    const descriptions = [
      describeDecision(evaluateIdenticalMessageFlood(5, { threshold: 5 })),
      describeDecision(evaluateNewRecipientBurst(8, { threshold: 8 })),
      describeDecision(evaluateLinkSpamBurst(3, { threshold: 3 })),
      describeDecision(evaluateNewAccountVelocity(60000, 6, { maxAccountAgeMs: 1800000, threshold: 6 })),
    ]
    const unique = new Set(descriptions)
    assert.equal(unique.size, descriptions.length)
    for (const description of descriptions) {
      assert.equal(typeof description, 'string')
      assert.ok(description.length > 0)
    }
  })

  it('falls back gracefully for an unknown heuristic key', () => {
    assert.equal(describeDecision({ heuristic: 'unknown_thing' }), 'Auto-flagged by abuse detection heuristic.')
  })
})
