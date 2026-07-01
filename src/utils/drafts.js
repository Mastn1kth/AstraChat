const DRAFT_PREFIX = 'astrachat.draft.'

export function saveDraft(chatId, text) {
  if (!chatId) return
  const key = DRAFT_PREFIX + chatId
  try {
    if (text && text.trim()) {
      globalThis.localStorage?.setItem(key, text)
    } else {
      globalThis.localStorage?.removeItem(key)
    }
  } catch {
    // Ignore storage failures.
  }
}

export function loadDraft(chatId) {
  if (!chatId) return ''
  try {
    return globalThis.localStorage?.getItem(DRAFT_PREFIX + chatId) || ''
  } catch {
    return ''
  }
}

export function clearDraft(chatId) {
  if (!chatId) return
  try {
    globalThis.localStorage?.removeItem(DRAFT_PREFIX + chatId)
  } catch {
    // Ignore storage failures.
  }
}
