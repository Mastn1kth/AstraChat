const KEY = 'onda-chat-wallpapers'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function getChatWallpaper(chatId) {
  if (!chatId) return null
  return load()[chatId] || null
}

export function setChatWallpaper(chatId, preset) {
  if (!chatId) return
  const all = load()
  if (preset) {
    all[chatId] = preset
  } else {
    delete all[chatId]
  }
  localStorage.setItem(KEY, JSON.stringify(all))
}
