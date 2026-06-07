const STORAGE_KEY = 'astrachat.mvp.v1'

export function loadMessengerState(fallbackState) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallbackState
    const parsed = JSON.parse(raw)
    return {
      ...fallbackState,
      ...parsed,
      settings: {
        ...fallbackState.settings,
        ...(parsed.settings || {}),
        wordStream: {
          ...fallbackState.settings.wordStream,
          ...(parsed.settings?.wordStream || {}),
        },
      },
    }
  } catch {
    return fallbackState
  }
}

export function saveMessengerState(state) {
  const payload = {
    chats: state.chats,
    messages: state.messages,
    contacts: state.contacts,
    user: state.user,
    settings: state.settings,
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function resetMessengerState() {
  window.localStorage.removeItem(STORAGE_KEY)
}
