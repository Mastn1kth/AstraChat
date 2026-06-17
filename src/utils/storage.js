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

const CACHE_NAMES = {
  stickers: 'astrachat-stickers-v1',
  gifs: 'astrachat-gifs-v1',
  gifCategories: 'astrachat-gif-categories-v1',
  appCache: 'astrachat-v1',
}

export function formatBytes(n) {
  if (n < 1024) return { n: Math.round(n), unit: 'Б' }
  if (n < 1024 * 1024) return { n: (n / 1024).toFixed(1), unit: 'КБ' }
  if (n < 1024 * 1024 * 1024) return { n: (n / (1024 * 1024)).toFixed(1), unit: 'МБ' }
  return { n: (n / (1024 * 1024 * 1024)).toFixed(1), unit: 'ГБ' }
}

function sizeLabel(n) {
  if (n < 1024) return `storage.bytes`
  if (n < 1024 * 1024) return `storage.kb`
  if (n < 1024 * 1024 * 1024) return `storage.mb`
  return `storage.gb`
}

export function getLocalStorageInfo() {
  const keys = []
  let total = 0
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    const val = window.localStorage.getItem(key)
    const size = key.length * 2 + (val ? val.length * 2 : 0)
    total += size
    keys.push({ key, size, sizeUnit: sizeLabel(size) })
  }
  keys.sort((a, b) => b.size - a.size)
  return { keys, total, totalUnit: sizeLabel(total) }
}

export function clearLocalStorageItem(key) {
  window.localStorage.removeItem(key)
}

export async function getCacheStorageInfo() {
  if (!('caches' in window)) return { caches: [], total: 0 }

  const cacheKeys = [CACHE_NAMES.stickers, CACHE_NAMES.gifs, CACHE_NAMES.gifCategories, CACHE_NAMES.appCache]
  const entries = []
  let totalItems = 0
  let totalSize = 0

  for (const cacheKey of cacheKeys) {
    const cache = await caches.open(cacheKey)
    const requests = await cache.keys()
    const count = requests.length
    let size = 0
    if (count > 0) {
      const sample = await cache.match(requests[0])
      size = count * (Number(sample?.headers?.get('content-length') || 0) || 4096)
    }
    totalItems += count
    totalSize += size
    entries.push({ cacheKey, items: count, size, sizeUnit: sizeLabel(size) })
  }

  return { entries, total: totalSize, totalUnit: sizeLabel(totalSize), totalItems }
}

export async function clearCache(cacheKey) {
  if (!('caches' in window)) return
  const cache = await caches.open(cacheKey)
  const requests = await cache.keys()
  await Promise.all(requests.map((r) => cache.delete(r)))
}

export async function clearAllCaches() {
  if (!('caches' in window)) return
  await Promise.all([
    ...Object.values(CACHE_NAMES).map((key) =>
      caches.open(key).then((cache) => cache.keys().then((rs) => Promise.all(rs.map((r) => cache.delete(r))))),
    ),
  ])
}

export { STORAGE_KEY, CACHE_NAMES }
