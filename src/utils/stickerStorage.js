const RECENT_KEY = 'onda.stickers.recent.v1'
const FAV_KEY = 'onda.stickers.favorites.v1'
const MAX_RECENT = 16

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

export function addRecentSticker(sticker) {
  const prev = readJson(RECENT_KEY, [])
  const next = [sticker, ...prev.filter((s) => !(s.packId === sticker.packId && s.id === sticker.id))]
  writeJson(RECENT_KEY, next.slice(0, MAX_RECENT))
}

export function getRecentStickers() {
  return readJson(RECENT_KEY, [])
}

export function getFavoriteStickers() {
  return readJson(FAV_KEY, [])
}

export function toggleFavoriteSticker(sticker) {
  const prev = getFavoriteStickers()
  const exists = prev.some((s) => s.packId === sticker.packId && s.id === sticker.id)
  const next = exists
    ? prev.filter((s) => !(s.packId === sticker.packId && s.id === sticker.id))
    : [sticker, ...prev]
  writeJson(FAV_KEY, next)
  return !exists
}
