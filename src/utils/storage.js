const STORAGE_KEY = 'astrachat.mvp.v1'

function stripEphemeralMedia(message) {
  if (!message?.media?.url?.startsWith?.('blob:')) return message

  return {
    ...message,
    text: message.text || `${message.media.name || 'Attachment'} is unavailable after reload.`,
    media: null,
  }
}

function stripEphemeralMediaState(state) {
  if (!state?.messages) return state

  return {
    ...state,
    messages: Object.fromEntries(
      Object.entries(state.messages).map(([chatId, messages]) => [
        chatId,
        Array.isArray(messages) ? messages.map(stripEphemeralMedia) : messages,
      ]),
    ),
  }
}

// Demo/sample chats were removed from the app; drop any that linger in old
// localStorage snapshots. Only server-backed data survives a reload.
function stripLocalDemoData(parsed) {
  const chats = (parsed.chats || []).filter((chat) => chat.backend)
  const chatIds = new Set(chats.map((chat) => chat.id))
  return {
    ...parsed,
    chats,
    contacts: (parsed.contacts || []).filter((contact) => contact.backend),
    messages: Object.fromEntries(
      Object.entries(parsed.messages || {}).filter(([chatId]) => chatIds.has(chatId)),
    ),
  }
}

export function loadMessengerState(fallbackState) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallbackState
    const parsed = stripLocalDemoData(JSON.parse(raw))
    return stripEphemeralMediaState({
      ...fallbackState,
      ...parsed,
      chatFolders: parsed.chatFolders || fallbackState.chatFolders,
      settings: {
        ...fallbackState.settings,
        ...(parsed.settings || {}),
        wordStream: {
          ...fallbackState.settings.wordStream,
          ...(parsed.settings?.wordStream || {}),
        },
        liveWall: {
          ...fallbackState.settings.liveWall,
          ...(parsed.settings?.liveWall || {}),
        },
      },
    })
  } catch {
    return fallbackState
  }
}

export function saveMessengerState(state) {
  const payload = stripEphemeralMediaState({
    chats: state.chats,
    messages: state.messages,
    contacts: state.contacts,
    user: state.user,
    chatFolders: state.chatFolders,
    settings: state.settings,
  })
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function resetMessengerState() {
  window.localStorage.removeItem(STORAGE_KEY)
}
