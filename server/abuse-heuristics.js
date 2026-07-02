// Pure, DB/Redis-free heuristics for the automatic abuse-detection layer.
//
// Kept separate from abuse-detection.js so the pattern-matching logic itself
// (message normalization/hashing, link-only detection, threshold decisions)
// is unit-testable without spinning up Postgres or Redis. abuse-detection.js
// wires these into Redis-backed sliding-window counters and the reports table.

import { createHash } from 'node:crypto'

// ── Message normalization & hashing ─────────────────────────────────────────

// Normalizes message text so near-identical spam blasts (differing only in
// whitespace/case/punctuation runs, or a per-recipient name token) hash the
// same. Deliberately simple/cheap: this runs on every message send.
export function normalizeMessageText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[^\p{L}\p{N}\s<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Short hash of the normalized text, used as a Redis key component. Not
// cryptographic — just a cheap way to bucket identical/near-identical
// messages without storing raw text in Redis.
export function hashMessageText(text) {
  const normalized = normalizeMessageText(text)
  return createHash('sha1').update(normalized).digest('hex').slice(0, 20)
}

// ── Link-only spam detection ─────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s]+/gi

export function extractUrls(text) {
  return String(text || '').match(URL_PATTERN) || []
}

// True when a message is essentially "just a link" — a bare URL, or a URL
// plus a handful of extra words (emoji/CTA filler like "check this out 🔥").
export function isLinkOnlyMessage(text, { maxExtraWords = 4 } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const urls = extractUrls(raw)
  if (!urls.length) return false
  const withoutUrls = raw.replace(URL_PATTERN, ' ').trim()
  const extraWords = withoutUrls.length ? withoutUrls.split(/\s+/).filter(Boolean) : []
  return extraWords.length <= maxExtraWords
}

// ── Threshold decisions ──────────────────────────────────────────────────────
//
// Each function takes already-gathered counts (from Redis or the DB) and
// returns a plain decision object. Keeping the arithmetic/thresholds here
// means the "is this abuse" question can be tested without touching Redis.

// Heuristic 1: identical/near-identical message blasted to multiple distinct
// chats within a short window.
export function evaluateIdenticalMessageFlood(distinctChatCount, { threshold = 5 } = {}) {
  return {
    triggered: distinctChatCount >= threshold,
    heuristic: 'identical_message_flood',
    distinctChatCount,
    threshold,
  }
}

// Heuristic 2: many distinct *new* (non-contact) recipients messaged/started
// in a short window.
export function evaluateNewRecipientBurst(distinctNewRecipientCount, { threshold = 8 } = {}) {
  return {
    triggered: distinctNewRecipientCount >= threshold,
    heuristic: 'new_recipient_burst',
    distinctNewRecipientCount,
    threshold,
  }
}

// Heuristic 3: link-only messages repeated across multiple chats in a short
// window — a stronger signal than #1 alone because it targets the specific
// "bare URL spam" shape rather than any repeated text.
export function evaluateLinkSpamBurst(distinctChatCount, { threshold = 3 } = {}) {
  return {
    triggered: distinctChatCount >= threshold,
    heuristic: 'link_spam_burst',
    distinctChatCount,
    threshold,
  }
}

// Heuristic 4: a very-recently-created account already messaging many
// distinct chats/recipients at high velocity.
export function evaluateNewAccountVelocity(
  accountAgeMs,
  distinctChatCount,
  { maxAccountAgeMs = 30 * 60 * 1000, threshold = 6 } = {},
) {
  const isNewAccount = accountAgeMs >= 0 && accountAgeMs <= maxAccountAgeMs
  return {
    triggered: isNewAccount && distinctChatCount >= threshold,
    heuristic: 'new_account_velocity',
    accountAgeMs,
    distinctChatCount,
    threshold,
    isNewAccount,
  }
}

// Builds a human-readable note for the reports table so an admin can
// understand why a report was auto-generated without reading code.
export function describeDecision(decision) {
  switch (decision.heuristic) {
    case 'identical_message_flood':
      return `Auto-flagged: identical/near-identical message sent to ${decision.distinctChatCount} different chats within the detection window (threshold ${decision.threshold}).`
    case 'new_recipient_burst':
      return `Auto-flagged: started conversations with ${decision.distinctNewRecipientCount} previously-unconnected users within the detection window (threshold ${decision.threshold}).`
    case 'link_spam_burst':
      return `Auto-flagged: link-only message sent to ${decision.distinctChatCount} different chats within the detection window (threshold ${decision.threshold}).`
    case 'new_account_velocity':
      return `Auto-flagged: account created ${Math.round(decision.accountAgeMs / 1000)}s ago already messaged ${decision.distinctChatCount} distinct chats (threshold ${decision.threshold}).`
    default:
      return 'Auto-flagged by abuse detection heuristic.'
  }
}
